// snaptrade-diagnostic (Session 125 — SDK rebuild)
// =============================================================================
// Server-side diagnostic. Proves which part of the SnapTrade authentication
// chain is failing. Runs the 7 checks using the official SDK — never mutates
// state, never leaks secrets.
//
// Response shape identical to Session 124 (frontend already renders it):
//   {
//     success: true,
//     checks: {
//       clientIdConfigured, consumerKeyConfigured, tradeSightUserId,
//       hasUserRecord, hasUserSecret, dbStatus,
//       listUsersOk, existsInSnapTrade, snapTradeUserCount,
//       loginOk, loginErrorCode, loginErrorMessage,
//       redirectURIReturned,
//     },
//     conclusion, nextAction
//   }
// =============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";
import { getSnapTradeClient, extractSDKError, getSnapTradeCredentialsDiagnostic } from "../_shared/snaptrade.ts";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const checks: Record<string, unknown> = {};
  let conclusion = "";
  let nextAction: 'none' | 'register_fresh' | 'reset_credentials' | 'contact_support' = 'none';

  try {
    console.log("[SnapTrade Diagnostic] starting");

    // Session 199 — the diagnostic now surfaces the trimmed credential
    // lengths + a whitespace-was-stripped flag so support can spot the
    // most common env corruption (a copy/paste with a trailing newline)
    // without ever seeing the raw secret values.
    const credDiag = getSnapTradeCredentialsDiagnostic();
    checks.clientIdConfigured = credDiag.clientId.configured;
    checks.consumerKeyConfigured = credDiag.consumerKey.configured;
    checks.clientIdLength = credDiag.clientId.trimmedLength;
    checks.clientIdHadWhitespace = credDiag.clientId.hadWhitespace;
    checks.consumerKeyLength = credDiag.consumerKey.trimmedLength;
    checks.consumerKeyHadWhitespace = credDiag.consumerKey.hadWhitespace;
    if (!checks.clientIdConfigured || !checks.consumerKeyConfigured) {
      conclusion = "SnapTrade credentials are missing on the server. Configure SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY in the Edge Function secrets.";
      nextAction = 'contact_support';
      return json(200, { success: true, checks, conclusion, nextAction });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (authErr || !user) return json(401, { success: false, error: "NOT_AUTHENTICATED", message: "Not authenticated" });
    checks.tradeSightUserId = user.id;

    const { data: conn, error: dbErr } = await admin
      .from("user_broker_connections")
      .select("snaptrade_user_secret, status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (dbErr) {
      conclusion = `Database lookup failed: ${dbErr.message}`;
      nextAction = 'contact_support';
      return json(200, { success: true, checks, conclusion, nextAction });
    }
    checks.hasUserRecord = !!conn;
    checks.hasUserSecret = !!conn?.snaptrade_user_secret;
    checks.dbStatus = conn?.status ?? null;

    const snaptrade = getSnapTradeClient();

    // -------- Check 5: user exists in SnapTrade? --------
    // Session 199 — the listSnapTradeUsers() call is ALSO our
    // partner-credential probe. It uses ONLY the clientId + consumerKey
    // (no per-user userSecret) so any failure here means SnapTrade is
    // rejecting the partner credentials themselves. When that happens
    // we short-circuit downstream checks and surface a clear
    // operator-actionable conclusion so support knows the fix is to
    // update the SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY secrets
    // rather than trying user-level resets.
    let partnerCredentialsRejected = false;
    let partnerRejectionInfo: any = null;
    try {
      const listResp = await snaptrade.authentication.listSnapTradeUsers();
      const ids: string[] = Array.isArray(listResp.data) ? (listResp.data as string[]) : [];
      checks.listUsersOk = true;
      checks.snapTradeUserCount = ids.length;
      checks.existsInSnapTrade = ids.includes(user.id);
    } catch (e) {
      const info = extractSDKError(e);
      checks.listUsersOk = false;
      (checks as any).listUsersError = info.message;
      (checks as any).listUsersErrorCode = info.code;
      checks.existsInSnapTrade = null;
      checks.snapTradeUserCount = null;
      // 1083 or 401/403 with no userSecret in play = partner-level rejection.
      const code = String(info.code ?? '');
      if (code === '1083' || info.status === 401 || info.status === 403) {
        partnerCredentialsRejected = true;
        partnerRejectionInfo = info;
      }
    }

    if (partnerCredentialsRejected) {
      conclusion = `SnapTrade is rejecting the partner credentials themselves (code ${partnerRejectionInfo?.code ?? partnerRejectionInfo?.status}: ${partnerRejectionInfo?.message ?? 'unknown'}). The SNAPTRADE_CLIENT_ID (length ${credDiag.clientId.trimmedLength}${credDiag.clientId.hadWhitespace ? ', had whitespace' : ''}) and/or SNAPTRADE_CONSUMER_KEY (length ${credDiag.consumerKey.trimmedLength}${credDiag.consumerKey.hadWhitespace ? ', had whitespace' : ''}) are not recognized. Verify the exact values in the SnapTrade dashboard and update the OnSpace Cloud secrets — no user-level action can fix this.`;
      nextAction = 'contact_support';
      return json(200, { success: true, checks, conclusion, nextAction });
    }

    if (!checks.hasUserRecord || !checks.hasUserSecret) {
      conclusion = "No SnapTrade credentials are stored for this Sight account. Tapping Connect Brokerage will register a fresh SnapTrade user.";
      nextAction = 'register_fresh';
      return json(200, { success: true, checks, conclusion, nextAction });
    }

    if (checks.existsInSnapTrade === false) {
      conclusion = "Sight has a stored userSecret, but SnapTrade does NOT recognize this userId. The mapping is stale — most likely the SnapTrade user was deleted or never persisted correctly. Reset the credentials to register fresh.";
      nextAction = 'reset_credentials';
      return json(200, { success: true, checks, conclusion, nextAction });
    }

    // -------- Check 6: /snapTrade/login authenticates? --------
    try {
      const loginResp = await snaptrade.authentication.loginSnapTradeUser({
        userId: user.id,
        userSecret: conn!.snaptrade_user_secret,
        connectionType: "trade-if-available",
        immediateRedirect: false,
      } as any);
      checks.loginOk = true;
      const redirectURI = (loginResp.data as any)?.redirectURI ?? (loginResp.data as any)?.redirectUri ?? null;
      checks.redirectURIReturned = !!redirectURI;
      if (!redirectURI) {
        conclusion = "SnapTrade authenticated the user but did not return a redirectURI. Retry or contact support.";
        nextAction = 'contact_support';
        return json(200, { success: true, checks, conclusion, nextAction });
      }
      conclusion = "All 7 checks passed. Brokerage connection should work — if Connect still fails, the problem is on the brokerage OAuth side, not on the Sight ↔ SnapTrade authentication.";
      nextAction = 'none';
      return json(200, { success: true, checks, conclusion, nextAction });
    } catch (e) {
      const info = extractSDKError(e);
      checks.loginOk = false;
      checks.loginErrorCode = info.code ?? null;
      checks.loginErrorMessage = info.message ?? null;
      conclusion = `SnapTrade rejected the /snapTrade/login call with code ${info.code ?? info.status}: "${info.message ?? "unknown"}". The stored userSecret does not match SnapTrade's current record. A credential reset is required — this will delete the SnapTrade user and re-register a fresh one.`;
      nextAction = 'reset_credentials';
      return json(200, { success: true, checks, conclusion, nextAction });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[SnapTrade Diagnostic] unhandled exception", msg);
    return json(500, { success: false, error: "INTERNAL_ERROR", message: msg, checks });
  }
});
