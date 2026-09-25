// snaptrade-connect (Session 125 — SDK rebuild)
// =============================================================================
// Rebuilt against the official snaptrade-typescript-sdk.
//
// Flow (matches the current SnapTrade Commercial API spec):
//   1. Authenticate the TradeSight user via Supabase JWT.
//   2. Look up their stored SnapTrade userSecret in user_broker_connections.
//   3. If we have no record → registerSnapTradeUser({ userId: tsUserId }).
//      SnapTrade generates the userSecret; we persist it.
//      If SnapTrade says "already exists" (orphan mapping), delete + retry.
//   4. Call loginSnapTradeUser({ userId, userSecret,
//        connectionType: "trade-if-available",
//        immediateRedirect: true,
//        customRedirect: <deep-link back into TradeSight> }).
//   5. If login is rejected with a credential-shaped error (401/403/1076/0000
//      /"invalid userSecret"), SELF-HEAL: delete + re-register + retry once.
//   6. Return the redirectURI to the client. The client opens it in an in-app
//      browser and listens for the customRedirect deep link.
//
// SnapTrade userId = the immutable Supabase auth UUID for the TradeSight user.
// We NEVER use email or another mutable identifier.
// =============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getSnapTradeClient,
  hasSnapTradeCredentials,
  extractSDKError,
  isCredentialError,
  isPartnerCredentialError,
  getSnapTradeCredentialsDiagnostic,
} from "../_shared/snaptrade.ts";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function err(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  console.error(`[SnapTrade Connect] ${status} ${code}: ${message}`);
  return json(status, { success: false, error: code, message, ...(extra ?? {}) });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    console.log("[SnapTrade Connect] request received");

    if (!hasSnapTradeCredentials()) {
      return err(500, "SNAPTRADE_NOT_CONFIGURED",
        "SnapTrade credentials are missing on the server. Configure SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY.");
    }

    const snaptrade = getSnapTradeClient();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // ---------------- 1. Authenticate the TradeSight user ----------------
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return err(401, "NOT_AUTHENTICATED", "Missing authentication token");
    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (authErr || !user) return err(401, "NOT_AUTHENTICATED", "Not authenticated");
    console.log("[SnapTrade Connect] authenticated TradeSight user", user.id);

    const body = await req.json().catch(() => ({}));
    const customRedirect: string = body?.customRedirect ?? "onspaceapp://snaptrade";
    const forceReset: boolean = body?.forceReset === true;
    // Broker-switch flag. When true, we remove every prior brokerage
    // authorization at SnapTrade AND clear the cached snapshot so the old
    // broker's account / positions / balances cannot leak into the new
    // broker's data. Enforces "ONE ACTIVE BROKERAGE = ONE ACTIVE PORTFOLIO".
    const replaceExisting: boolean = body?.replaceExisting === true;
    // Reconnect flow — when the app detects a read-only connection and the
    // user chooses "Enable Trading", we send the existing authorizationId
    // plus connectionType='trade' so SnapTrade re-authorizes THAT specific
    // connection as a trading connection (not a brand-new one).
    const reconnectAuthorizationId: string | undefined = body?.reconnectAuthorizationId;
    const requestedConnectionType: 'trade' | 'trade-if-available' | 'read' =
      (body?.connectionType === 'trade' || body?.connectionType === 'read')
        ? body.connectionType : 'trade-if-available';

    // ---------------- 2. Load stored userSecret ----------------
    const { data: existing, error: dbErr } = await admin
      .from("user_broker_connections")
      .select("snaptrade_user_secret, status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (dbErr) return err(500, "DB_LOOKUP_FAILED", `Failed to read broker connection: ${dbErr.message}`);

    let userSecret: string | null = forceReset ? null : (existing?.snaptrade_user_secret ?? null);
    console.log("[SnapTrade Connect] existing SnapTrade user?", !!userSecret, "forceReset?", forceReset);

    // ---------------- Helpers: register + delete-and-retry ----------------
    async function registerFresh(): Promise<string> {
      console.log("[SnapTrade Connect] registerSnapTradeUser({ userId: %s })", user.id);
      const resp = await snaptrade.authentication.registerSnapTradeUser({ userId: user.id });
      const secret = (resp.data as any)?.userSecret;
      if (!secret) throw new Error("SnapTrade did not return a userSecret");
      return secret;
    }

    async function deleteAndRetry(): Promise<string> {
      console.log("[SnapTrade Connect] deleting SnapTrade user for reset");
      try {
        await snaptrade.authentication.deleteSnapTradeUser({ userId: user.id });
      } catch (e) {
        const info = extractSDKError(e);
        console.warn("[SnapTrade Connect] deleteSnapTradeUser returned non-2xx (continuing)", info);
      }
      // /deleteUser is async — poll registration with backoff until it accepts.
      const backoffs = [500, 1000, 1500, 2500, 4000];
      let lastErr: any = null;
      for (const wait of backoffs) {
        await sleep(wait);
        try {
          return await registerFresh();
        } catch (e) {
          lastErr = e;
          const info = extractSDKError(e);
          console.warn(`[SnapTrade Connect] register retry after ${wait}ms failed: ${info.message}`);
          if (!/(already|exists)/i.test(info.message)) break;
        }
      }
      const finalInfo = extractSDKError(lastErr);
      throw Object.assign(new Error(finalInfo.message), { snapTradeInfo: finalInfo });
    }

    // ---------------- 3. Register / reset if needed ----------------
    // Session 199 — 1083 short-circuit. If SnapTrade rejects the partner
    // credentials themselves during registration ("Invalid clientId"),
    // NEVER burn cycles retrying user resets or delete-and-retry loops —
    // those cannot fix a partner-credential problem. Surface the error
    // immediately with a clear operator-actionable message and safe
    // credential fingerprint so support can pinpoint the env issue.
    const failPartnerCreds = (info: any) => {
      const credDiag = getSnapTradeCredentialsDiagnostic();
      console.error("[SnapTrade Connect] PARTNER CREDENTIALS REJECTED by SnapTrade", {
        code: info.code,
        status: info.status,
        clientIdLength: credDiag.clientId.trimmedLength,
        clientIdHadWhitespace: credDiag.clientId.hadWhitespace,
        consumerKeyLength: credDiag.consumerKey.trimmedLength,
        consumerKeyHadWhitespace: credDiag.consumerKey.hadWhitespace,
      });
      return err(
        502,
        "SNAPTRADE_PARTNER_CREDENTIALS_REJECTED",
        `SnapTrade is rejecting the partner credentials (code ${info.code ?? info.status}: ${info.message}). This is a server-side configuration issue — the SNAPTRADE_CLIENT_ID or SNAPTRADE_CONSUMER_KEY stored in the OnSpace Cloud secrets does not match a currently-active SnapTrade partner. No user action can fix this. Please contact support.`,
        {
          snapTradeCode: info.code,
          snapTradeStatus: info.status,
          clientIdLength: credDiag.clientId.trimmedLength,
          clientIdHadWhitespace: credDiag.clientId.hadWhitespace,
          consumerKeyLength: credDiag.consumerKey.trimmedLength,
          consumerKeyHadWhitespace: credDiag.consumerKey.hadWhitespace,
        },
      );
    };

    if (forceReset) {
      try {
        userSecret = await deleteAndRetry();
      } catch (e) {
        const info = (e as any)?.snapTradeInfo ?? extractSDKError(e);
        if (isPartnerCredentialError(info)) return failPartnerCreds(info);
        return err(502, "SNAPTRADE_REGISTER_FAILED", info.message, {
          snapTradeCode: info.code, snapTradeStatus: info.status,
        });
      }
    } else if (!userSecret) {
      try {
        userSecret = await registerFresh();
        console.log("[SnapTrade Connect] fresh registration succeeded");
      } catch (e) {
        const info = extractSDKError(e);
        if (isPartnerCredentialError(info)) return failPartnerCreds(info);
        if (/(already|exists)/i.test(info.message)) {
          console.warn("[SnapTrade Connect] user exists on SnapTrade but we have no secret — resetting");
          try {
            userSecret = await deleteAndRetry();
          } catch (e2) {
            const info2 = (e2 as any)?.snapTradeInfo ?? extractSDKError(e2);
            if (isPartnerCredentialError(info2)) return failPartnerCreds(info2);
            return err(502, "SNAPTRADE_REGISTER_FAILED", info2.message, {
              snapTradeCode: info2.code, snapTradeStatus: info2.status,
            });
          }
        } else {
          return err(502, "SNAPTRADE_REGISTER_FAILED", info.message, {
            snapTradeCode: info.code, snapTradeStatus: info.status,
          });
        }
      }
    } else {
      console.log("[SnapTrade Connect] reusing existing SnapTrade credentials");
    }

    if (!userSecret) return err(500, "NO_USER_SECRET", "Failed to obtain a SnapTrade userSecret");

    // ---------------- 3b. Broker switching — remove prior authorizations ----------------
    // Runs BEFORE we generate a new portal URL so, when the new brokerage's
    // connection completes and snaptrade-sync-accounts runs, only the new
    // authorization exists and no old accounts/positions/balances survive.
    // We deliberately keep the SnapTrade userSecret so the user does not
    // need to re-register — just their existing brokerage attachments go.
    if (replaceExisting && !forceReset) {
      try {
        const list = await snaptrade.connections.listBrokerageAuthorizations({
          userId: user.id, userSecret,
        } as any);
        const auths = Array.isArray(list.data) ? list.data : [];
        console.log(`[SnapTrade Connect] replaceExisting=true — removing ${auths.length} prior authorization(s)`);
        for (const a of auths) {
          const authId = (a as any)?.id;
          if (!authId) continue;
          try {
            await snaptrade.connections.removeBrokerageAuthorization({
              userId: user.id, userSecret, authorizationId: authId,
            } as any);
            console.log(`[SnapTrade Connect] removed authorization ${authId}`);
          } catch (e) {
            const info = extractSDKError(e);
            console.warn(`[SnapTrade Connect] removeBrokerageAuthorization(${authId}) failed`, info);
          }
        }
      } catch (e) {
        const info = extractSDKError(e);
        console.warn("[SnapTrade Connect] listBrokerageAuthorizations failed during replace (continuing)", info);
      }
    }

    // SPEED OPTIMIZATION (Session 194): only persist to the DB when
    // something actually changed. For the majority of Connect Brokerage
    // taps — an existing user with a valid userSecret, no reset, no
    // broker-switch — the DB row is already identical to what we would
    // write; the only "change" would be a status flip to
    // 'pending_connection' + updated_at bump, and neither is required
    // to generate the SnapTrade login URL. Skipping this UPSERT on the
    // hot path removes a full Postgres round-trip (~50-100ms) between
    // the client tap and the SnapTrade portal opening.
    //
    // We MUST still write when:
    //   1. The userSecret is new (fresh registration OR forceReset) —
    //      losing it would strand the user's SnapTrade account.
    //   2. replaceExisting is true — snapshots must be wiped so the old
    //      broker's data cannot leak into the new broker's UI.
    //   3. forceReset is true — same reason as (1), plus optional
    //      snapshot wipe covered by the same branch below.
    const secretChanged = !existing || existing.snaptrade_user_secret !== userSecret;
    const needsSnapshotWipe = replaceExisting || forceReset;
    const shouldPersistPreLogin = secretChanged || needsSnapshotWipe;
    if (shouldPersistPreLogin) {
      const persistPayload: Record<string, unknown> = {
        user_id: user.id,
        snaptrade_user_secret: userSecret,
        status: "pending_connection",
        updated_at: new Date().toISOString(),
      };
      if (needsSnapshotWipe) {
        persistPayload.accounts_snapshot = [];
        persistPayload.positions_snapshot = [];
        persistPayload.balances_snapshot = {};
        persistPayload.last_synced_at = null;
      }
      const persistErr = (await admin
        .from("user_broker_connections")
        .upsert(persistPayload, { onConflict: "user_id" })).error;
      if (persistErr) {
        return err(500, "DB_WRITE_FAILED", `Failed to save broker credentials: ${persistErr.message}`);
      }
      console.log(`[SnapTrade Connect] persisted userSecret + status (secretChanged=${secretChanged}, snapshotWipe=${needsSnapshotWipe})`);
    } else {
      console.log("[SnapTrade Connect] skipped pre-login UPSERT (no change to persist) — hot path");
    }

    // ---------------- 4. Generate the Connection Portal URL ----------------
    async function attemptLogin(secret: string) {
      const params: any = {
        userId: user.id,
        userSecret: secret,
        connectionType: requestedConnectionType,
        immediateRedirect: true,
        customRedirect,
      };
      if (reconnectAuthorizationId) {
        // Per SnapTrade docs: passing `reconnect` triggers reauth of the
        // existing authorization instead of creating a new one — the way
        // a read-only connection is upgraded to trade.
        params.reconnect = reconnectAuthorizationId;
      }
      return await snaptrade.authentication.loginSnapTradeUser(params);
    }

    console.log(`[SnapTrade Connect] loginSnapTradeUser (connectionType=${requestedConnectionType}${reconnectAuthorizationId ? `, reconnect=${reconnectAuthorizationId}` : ''})`);
    let loginData: any;
    try {
      const resp = await attemptLogin(userSecret);
      loginData = resp.data;
    } catch (e) {
      const info = extractSDKError(e);
      console.warn("[SnapTrade Connect] login failed", info);
      // Session 199 — check partner-credential rejection FIRST so we
      // don't waste time delete-and-retrying against invalid partner
      // credentials. isCredentialError still catches per-user issues.
      if (isPartnerCredentialError(info)) return failPartnerCreds(info);
      // Self-heal on credential-shaped errors (unless we already reset once).
      if (isCredentialError(info) && !forceReset) {
        console.warn("[SnapTrade Connect] treating as invalid credentials — self-healing");
        try {
          userSecret = await deleteAndRetry();
        } catch (e2) {
          const info2 = (e2 as any)?.snapTradeInfo ?? extractSDKError(e2);
          return err(502, "SNAPTRADE_RESET_FAILED",
            `Stored SnapTrade credentials are invalid and automatic recovery failed: ${info2.message}`,
            { snapTradeCode: info2.code, snapTradeStatus: info2.status });
        }
        await admin.from("user_broker_connections").update({
          snaptrade_user_secret: userSecret,
          status: "pending_connection",
          updated_at: new Date().toISOString(),
        }).eq("user_id", user.id);
        try {
          const resp2 = await attemptLogin(userSecret);
          loginData = resp2.data;
        } catch (e3) {
          const info3 = extractSDKError(e3);
          return err(502, "SNAPTRADE_LOGIN_FAILED",
            `SnapTrade rejected the reconnection${info3.code ? ` (code ${info3.code})` : ""}: ${info3.message}`,
            { snapTradeCode: info3.code, snapTradeStatus: info3.status });
        }
      } else {
        return err(502, "SNAPTRADE_LOGIN_FAILED",
          `SnapTrade rejected the connection request${info.code ? ` (code ${info.code})` : ""}: ${info.message}`,
          { snapTradeCode: info.code, snapTradeStatus: info.status });
      }
    }

    const redirectURI = loginData?.redirectURI ?? loginData?.redirectUri ?? null;
    if (!redirectURI) {
      return err(502, "SNAPTRADE_NO_REDIRECT",
        "SnapTrade authenticated the user but did not return a redirectURI.");
    }

    console.log("[SnapTrade Connect] success — returning redirectURI");
    return json(200, {
      success: true,
      redirectURI,
      sessionId: loginData?.sessionId ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("[SnapTrade Connect] unhandled exception", msg, stack);
    return err(500, "INTERNAL_ERROR", msg);
  }
});
