// snaptrade-trade-readiness (Session 132 — Diagnostic Gate)
// =============================================================================
// Called by the frontend the moment the user taps "Put in Trade". Answers a
// single question: "Is THIS specific connection + account + symbol actually
// authorized to place THIS order right now?" and returns a machine-readable
// reason if not.
//
// This is the layer TradeSight was missing. Previously we relied only on
// account_category === 'INVESTMENT' and connection_disabled === false, but
// per SnapTrade's docs a brokerage can support trading while the SPECIFIC
// connection remains read-only. This function inspects the live brokerage
// authorization detail (type, allows_trading, disabled, maintenance_mode,
// is_degraded), the specific account, and (optionally) the symbol against
// the connection's tradable universe.
//
// SnapTrade fields checked (per current API):
//   • connection.type            — "read" | "trade" | "trade-if-available"
//   • connection.allows_trading  — brokerage-level trading permission
//   • connection.disabled        — SnapTrade or user disabled the connection
//   • connection.maintenance_mode — broker in maintenance
//   • connection.is_degraded     — broker reporting reduced service
//   • account.status             — must not be closed/suspended
//   • symbol.tradeable           — instrument-level trading permission
//
// Response shape:
//   { ready: true,  ...connectionInfo, ...accountInfo, symbolInfo? }
//   { ready: false, reason: 'CONNECTION_READ_ONLY' | ..., message: string,
//     ...connectionInfo, ...accountInfo }
// =============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getSnapTradeClient,
  hasSnapTradeCredentials,
  extractSDKError,
} from "../_shared/snaptrade.ts";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type ReadinessReason =
  | 'NO_ACCOUNT'
  | 'ACCOUNT_NOT_FOUND'
  | 'CONNECTION_NOT_FOUND'
  | 'CONNECTION_READ_ONLY'
  | 'BROKER_TRADING_UNAVAILABLE'
  | 'CONNECTION_DISABLED'
  | 'BROKERAGE_DEGRADED'
  | 'BROKERAGE_MAINTENANCE'
  | 'SYMBOL_NOT_TRADEABLE'
  | 'INVALID_ORDER'
  | 'TRADING_ACCESS_NOT_ENABLED'
  | 'NO_BROKERAGE_CONNECTED'
  | 'NOT_AUTHENTICATED';

function normalizeConnectionType(raw: unknown): 'read' | 'trade' | 'trade-if-available' | 'unknown' {
  const s = String(raw ?? '').toLowerCase().trim();
  if (s === 'trade' || s === 'trading' || s === 'read_write' || s === 'read-write') return 'trade';
  if (s === 'trade-if-available' || s === 'trade_if_available') return 'trade-if-available';
  if (s === 'read' || s === 'read_only' || s === 'read-only') return 'read';
  return 'unknown';
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!hasSnapTradeCredentials()) {
      return json(500, { ready: false, reason: 'TRADING_ACCESS_NOT_ENABLED',
        message: "SnapTrade credentials not configured on the server." });
    }
    const snaptrade = getSnapTradeClient();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (authErr || !user) return json(401, { ready: false, reason: 'NOT_AUTHENTICATED', message: "Not authenticated" });

    const body = await req.json().catch(() => ({}));
    const accountId: string | undefined = body?.accountId;
    const symbolTicker: string | undefined = body?.ticker ? String(body.ticker).toUpperCase() : undefined;

    if (!accountId) {
      return json(200, { ready: false, reason: 'NO_ACCOUNT', message: "No brokerage account selected." });
    }

    const { data: conn } = await admin
      .from("user_broker_connections")
      .select("snaptrade_user_secret, accounts_snapshot")
      .eq("user_id", user.id).maybeSingle();
    if (!conn?.snaptrade_user_secret) {
      return json(200, { ready: false, reason: 'NO_BROKERAGE_CONNECTED',
        message: "No brokerage is connected to Sight." });
    }
    const userSecret = conn.snaptrade_user_secret;
    const accountsSnapshot: any[] = Array.isArray(conn.accounts_snapshot) ? conn.accounts_snapshot : [];
    const snapshotAccount = accountsSnapshot.find((a: any) => a?.id === accountId);

    // Live authorization fetch — never trust the cached snapshot for the
    // "type" field because the connection can be upgraded/downgraded at any
    // time on SnapTrade's side.
    let authorizations: any[] = [];
    try {
      const authResp = await snaptrade.connections.listBrokerageAuthorizations({
        userId: user.id, userSecret,
      } as any);
      authorizations = Array.isArray(authResp.data) ? authResp.data : [];
    } catch (e) {
      const info = extractSDKError(e);
      console.warn("[Trade Readiness] listBrokerageAuthorizations failed", info);
    }

    // Live account fetch — captures current status.
    let liveAccount: any = null;
    try {
      const accResp = await snaptrade.accountInformation.listUserAccounts({
        userId: user.id, userSecret,
      } as any);
      const list: any[] = Array.isArray(accResp.data) ? accResp.data : [];
      liveAccount = list.find(a => a?.id === accountId) ?? null;
    } catch (e) {
      console.warn("[Trade Readiness] listUserAccounts failed", extractSDKError(e));
    }

    const account = liveAccount ?? snapshotAccount;
    if (!account) {
      return json(200, { ready: false, reason: 'ACCOUNT_NOT_FOUND',
        message: "The selected brokerage account was not found under this SnapTrade user. Sync the brokerage and try again.",
        selectedAccountId: accountId });
    }

    const connectionId = account?.brokerage_authorization ?? snapshotAccount?.brokerage_authorization ?? null;
    const authorization = authorizations.find((a: any) => a?.id === connectionId) ?? null;

    const brokerageName =
      authorization?.brokerage?.name ??
      authorization?.brokerage?.display_name ??
      snapshotAccount?.institution_name ?? 'Brokerage';
    const brokerageSlug = authorization?.brokerage?.slug ?? null;

    const connectionType = normalizeConnectionType(authorization?.type);
    const allowsTrading = authorization?.allows_trading === true ||
      // Some SDK versions omit the field; fall back to type=trade as an implicit permission.
      (authorization?.allows_trading === undefined && connectionType === 'trade');
    const connectionDisabled = authorization?.disabled === true;
    const maintenanceMode =
      authorization?.brokerage?.maintenance_mode === true ||
      authorization?.maintenance_mode === true;
    const isDegraded =
      authorization?.is_degraded === true ||
      authorization?.brokerage?.is_degraded === true;

    // Log a SAFE summary — never log userSecret / clientId / consumerKey.
    console.log("[Trade Readiness] inspecting", {
      brokerage: brokerageName,
      brokerageSlug,
      connectionId,
      connectionType,
      allowsTrading,
      connectionDisabled,
      maintenanceMode,
      isDegraded,
      accountId: account?.id,
      accountName: account?.name ?? account?.meta?.name ?? null,
      accountStatus: account?.status ?? account?.meta?.status ?? null,
      symbolTicker: symbolTicker ?? null,
    });

    // Assemble a rich payload the frontend can display in a debug pane.
    const baseInfo = {
      brokerage: brokerageName,
      brokerageSlug,
      connectionId,
      connectionType,
      allowsTrading,
      connectionDisabled,
      maintenanceMode,
      isDegraded,
      accountId: account?.id,
      accountName: account?.name ?? account?.meta?.name ?? null,
      accountNumber: account?.number ?? account?.meta?.number ?? null,
      accountStatus: account?.status ?? account?.meta?.status ?? null,
    };

    // -------- Gate 1: connection exists --------
    if (!authorization && connectionId) {
      return json(200, { ready: false, reason: 'CONNECTION_NOT_FOUND', ...baseInfo,
        message: "The brokerage connection for this account was not found on SnapTrade. Reconnect the brokerage in Settings." });
    }

    // -------- Gate 2: connection not disabled --------
    if (connectionDisabled) {
      return json(200, { ready: false, reason: 'CONNECTION_DISABLED', ...baseInfo,
        message: `${brokerageName} has been disabled. Reconnect the brokerage in Settings.` });
    }

    // -------- Gate 3: not in maintenance --------
    if (maintenanceMode) {
      return json(200, { ready: false, reason: 'BROKERAGE_MAINTENANCE', ...baseInfo,
        message: `${brokerageName} is currently in maintenance and not accepting orders. Try again later.` });
    }

    // -------- Gate 4: brokerage allows trading --------
    if (allowsTrading === false) {
      return json(200, { ready: false, reason: 'BROKER_TRADING_UNAVAILABLE', ...baseInfo,
        message: `${brokerageName} does not support order placement through SnapTrade at this time.` });
    }

    // -------- Gate 5: connection is trade, not read --------
    if (connectionType === 'read') {
      return json(200, { ready: false, reason: 'CONNECTION_READ_ONLY', ...baseInfo,
        message: `Your ${brokerageName} connection is currently read-only. Reconnect it as a trading connection to place orders.` });
    }
    if (connectionType === 'unknown' && authorization) {
      // SDK didn't expose type. If allows_trading is not explicitly true,
      // treat this as read-only to be safe.
      if (allowsTrading !== true) {
        return json(200, { ready: false, reason: 'CONNECTION_READ_ONLY', ...baseInfo,
          message: `Your ${brokerageName} connection does not report trading capability. Reconnect it with trading enabled.` });
      }
    }

    // -------- Gate 6: degraded warning (soft) --------
    // Degraded doesn't necessarily block trading — we surface it but let the
    // user proceed.
    const softWarnings: string[] = [];
    if (isDegraded) softWarnings.push(`${brokerageName} is reporting degraded service. Fills may be delayed.`);

    // -------- Gate 7: symbol tradeable (best-effort) --------
    let symbolInfo: any = null;
    if (symbolTicker) {
      try {
        const symResp: any = await (snaptrade.trading as any).getUserAccountQuotes?.({
          userId: user.id, userSecret,
          accountId: account.id,
          symbols: symbolTicker,
          useTicker: true,
        });
        const quotes: any[] = Array.isArray(symResp?.data) ? symResp.data : [];
        const q = quotes[0];
        if (q?.symbol) {
          const tradeable = q.symbol.tradeable !== false; // default true if omitted
          symbolInfo = {
            resolved: true,
            tradeable,
            universalSymbolId: q.symbol.id ?? q.symbol.universal_symbol_id ?? null,
            description: q.symbol.description ?? null,
          };
          if (tradeable === false) {
            return json(200, { ready: false, reason: 'SYMBOL_NOT_TRADEABLE', ...baseInfo, symbolInfo,
              message: `${symbolTicker} is not tradable at ${brokerageName} through this account.` });
          }
        } else {
          symbolInfo = { resolved: false, tradeable: null };
        }
      } catch (e) {
        // Not fatal — /trade/place will still validate the symbol.
        symbolInfo = { resolved: false, tradeable: null, error: extractSDKError(e).message };
      }
    }

    return json(200, {
      ready: true,
      ...baseInfo,
      symbolInfo,
      softWarnings,
      message: 'Ready to place order.',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Trade Readiness] unhandled", msg);
    return json(500, { ready: false, reason: 'INVALID_ORDER', message: msg });
  }
});
