// snaptrade-place-order (Session 131 — Explicit Account, Direct /trade/place)
// =============================================================================
// TradeSight submits orders to the EXACT SnapTrade account the user selected,
// never a hidden default. This function:
//
//   1. Authenticates the TradeSight user.
//   2. Loads the user's current SnapTrade account snapshot from the DB and
//      validates that the caller-supplied `accountId` actually belongs to
//      this user AND is an INVESTMENT account AND its connection is not
//      disabled. This blocks the class of bugs where the frontend
//      accidentally sends the wrong account_id or targets a deposit /
//      cash-only account that can't place orders.
//   3. Enforces idempotency via `(user_id, client_order_id)`.
//   4. Places the order directly with SnapTrade's /trade/place endpoint
//      through the SDK's `placeForceOrder` method — no /trade/impact.
//   5. Records the outcome in `trade_submissions` and `broker_orders`.
//   6. Triggers `refreshUserAccount` for the SELECTED account so the
//      broker snapshot updates as fast as the plan allows.
//
// SECURITY: SnapTrade credentials live only in Edge Function env vars.
// The frontend never sees clientId / consumerKey / userSecret.
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
function err(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  console.error(`[SnapTrade Order] ${status} ${code}: ${message}`);
  return json(status, { success: false, error: code, message, ...(extra ?? {}) });
}

function normalizeOrderStatus(raw: unknown): 'PENDING' | 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED' | 'CANCELED' | 'SUBMITTED' {
  const s = String(raw ?? '').toUpperCase();
  if (s.includes('FILL') && s.includes('PART')) return 'PARTIALLY_FILLED';
  if (s === 'EXECUTED' || s === 'FILLED') return 'FILLED';
  if (s === 'REJECTED' || s === 'FAILED') return 'REJECTED';
  if (s === 'CANCELED' || s === 'CANCELLED') return 'CANCELED';
  if (s === 'PENDING' || s === 'ACCEPTED' || s === 'QUEUED' || s === 'OPEN' || s === 'PENDING_NEW') return 'PENDING';
  return 'SUBMITTED';
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    console.log("[SnapTrade Order] request received");
    if (!hasSnapTradeCredentials()) {
      return err(500, "SNAPTRADE_NOT_CONFIGURED", "SnapTrade credentials not configured");
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
    if (authErr || !user) return err(401, "NOT_AUTHENTICATED", "Not authenticated");

    const body = await req.json().catch(() => ({}));
    const {
      accountId,
      ticker,
      action,
      orderType,
      quantity,
      price,
      stopPrice,
      timeInForce = 'Day',
      takeProfit,
      stopLoss,
      signalId,
      clientOrderId,
    } = body ?? {};

    if (!clientOrderId) return err(400, "MISSING_CLIENT_ORDER_ID", "clientOrderId is required for idempotent submission");
    if (!accountId) return err(400, "MISSING_ACCOUNT", "accountId is required");
    if (!ticker) return err(400, "MISSING_TICKER", "ticker is required");
    if (action !== 'BUY' && action !== 'SELL') return err(400, "INVALID_ACTION", "action must be BUY or SELL");
    if (!['Market', 'Limit', 'Stop', 'StopLimit'].includes(String(orderType))) {
      return err(400, "INVALID_ORDER_TYPE", "orderType must be Market, Limit, Stop, or StopLimit");
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return err(400, "INVALID_QUANTITY", "quantity must be a positive number");
    if ((orderType === 'Limit' || orderType === 'StopLimit') && !(Number(price) > 0)) {
      return err(400, "MISSING_LIMIT_PRICE", "A valid limit price is required for Limit / StopLimit orders");
    }
    if ((orderType === 'Stop' || orderType === 'StopLimit') && !(Number(stopPrice) > 0)) {
      return err(400, "MISSING_STOP_PRICE", "A valid stop trigger price is required for Stop / StopLimit orders");
    }
    if (!['Day', 'GTC', 'FOK', 'IOC'].includes(String(timeInForce))) {
      return err(400, "INVALID_TIF", "timeInForce must be Day, GTC, FOK, or IOC");
    }

    const { data: conn, error: dbErr } = await admin
      .from("user_broker_connections")
      .select("snaptrade_user_secret, status, accounts_snapshot")
      .eq("user_id", user.id)
      .maybeSingle();
    if (dbErr) return err(500, "DB_LOOKUP_FAILED", "Failed to load broker connection");
    if (!conn?.snaptrade_user_secret) return err(400, "NO_BROKERAGE_CONNECTED", "No brokerage connection");
    if (conn.status && conn.status !== 'active') {
      return err(400, "BROKERAGE_NOT_ACTIVE",
        conn.status === 'needs_reconnect'
          ? "Brokerage connection needs to be refreshed. Please reconnect in Settings."
          : "Brokerage is not currently active.");
    }
    const userSecret = conn.snaptrade_user_secret;

    // --------------------------------------------------------------
    // Explicit account ownership + capability check.
    // Blocks accidental submission to a foreign account, a deposit /
    // LOC account, or an account on a disabled / read-only connection.
    // --------------------------------------------------------------
    const accountsSnapshot: any[] = Array.isArray(conn.accounts_snapshot) ? conn.accounts_snapshot : [];
    const account = accountsSnapshot.find((a: any) => a?.id === accountId);
    if (!account) {
      return err(400, "ACCOUNT_NOT_FOUND",
        "Selected brokerage account is not associated with this Sight user. Sync your brokerage and try again.");
    }
    if (account.connection_disabled === true) {
      return err(400, "CONNECTION_DISABLED",
        "This account's brokerage connection is disabled. Reconnect the brokerage in Settings.");
    }
    const category = String(account.account_category ?? 'INVESTMENT').toUpperCase();
    if (category !== 'INVESTMENT' && category !== 'UNKNOWN' && category !== '') {
      return err(400, "ACCOUNT_NOT_TRADABLE",
        `The selected account is categorized as ${category}. Only investment accounts can place equity orders.`);
    }

    // --------------------------------------------------------------
    // Live connection-type check. Per SnapTrade docs a brokerage can
    // support trading while THIS SPECIFIC CONNECTION remains read-only.
    // We ALWAYS re-check live (not just the cached snapshot) because the
    // connection type can change between the last sync and this order.
    // --------------------------------------------------------------
    let liveConnectionType: string = String(account.connection_type ?? 'unknown').toLowerCase();
    let liveAllowsTrading: boolean = account.connection_allows_trading === true;
    let liveConnectionId: string | null = account.brokerage_authorization ?? null;
    let liveBrokerageName: string = account.institution_name ?? 'Brokerage';
    try {
      const authResp = await snaptrade.connections.listBrokerageAuthorizations({
        userId: user.id, userSecret,
      } as any);
      const auths: any[] = Array.isArray(authResp.data) ? authResp.data : [];
      const auth = auths.find((a: any) => a?.id === liveConnectionId) ?? null;
      if (auth) {
        const rawType = String(auth?.type ?? '').toLowerCase().trim();
        liveConnectionType =
          rawType === 'trade' || rawType === 'trading' ? 'trade'
          : rawType === 'trade-if-available' || rawType === 'trade_if_available' ? 'trade-if-available'
          : rawType === 'read' || rawType === 'read_only' || rawType === 'read-only' ? 'read'
          : 'unknown';
        liveAllowsTrading = auth?.allows_trading === true ||
          (auth?.allows_trading === undefined && liveConnectionType === 'trade');
        liveBrokerageName = auth?.brokerage?.name ?? auth?.brokerage?.display_name ?? liveBrokerageName;
        if (auth?.disabled === true) {
          return err(400, "CONNECTION_DISABLED",
            `${liveBrokerageName} is disabled. Reconnect the brokerage in Settings.`);
        }
      }
    } catch (e) {
      console.warn("[SnapTrade Order] live authorization check failed (falling back to snapshot)", extractSDKError(e));
    }
    console.log("[SnapTrade Order] connection permission check", {
      brokerage: liveBrokerageName,
      connectionId: liveConnectionId,
      connectionType: liveConnectionType,
      allowsTrading: liveAllowsTrading,
      accountId,
    });
    if (liveConnectionType === 'read') {
      return err(400, "CONNECTION_READ_ONLY",
        `Your ${liveBrokerageName} connection is currently read-only. Reconnect it as a trading connection to place orders.`,
        { connectionType: liveConnectionType, allowsTrading: liveAllowsTrading });
    }
    if (liveAllowsTrading === false) {
      return err(400, "BROKER_TRADING_UNAVAILABLE",
        `${liveBrokerageName} does not support order placement through SnapTrade at this time.`,
        { connectionType: liveConnectionType, allowsTrading: liveAllowsTrading });
    }
    if (liveConnectionType === 'unknown' && liveAllowsTrading !== true) {
      return err(400, "CONNECTION_READ_ONLY",
        `Your ${liveBrokerageName} connection does not report trading capability. Reconnect it with trading enabled.`,
        { connectionType: liveConnectionType, allowsTrading: liveAllowsTrading });
    }

    // Idempotency check.
    const { data: existing } = await admin
      .from("trade_submissions")
      .select("id, status, snaptrade_order_id, error_message, raw_response")
      .eq("user_id", user.id)
      .eq("client_order_id", clientOrderId)
      .maybeSingle();
    if (existing && existing.status !== 'DRAFT' && existing.status !== 'FAILED') {
      console.warn("[SnapTrade Order] duplicate submission blocked", clientOrderId);
      return json(200, {
        success: true,
        duplicate: true,
        status: existing.status,
        submissionId: existing.id,
        providerOrderId: existing.snaptrade_order_id,
        message: `Order was already submitted (status: ${existing.status}). Refresh Active Trades to see it.`,
      });
    }

    const upperTicker = String(ticker).toUpperCase();

    // Record the submission before hitting SnapTrade.
    const submissionRecord: any = {
      user_id: user.id,
      client_order_id: clientOrderId,
      account_id: accountId,
      ticker: upperTicker,
      action,
      order_type: orderType,
      time_in_force: timeInForce,
      quantity: qty,
      price: price ? Number(price) : null,
      stop_price: stopPrice ? Number(stopPrice) : null,
      take_profit: takeProfit ? Number(takeProfit) : null,
      stop_loss: stopLoss ? Number(stopLoss) : null,
      status: 'SUBMITTING',
      signal_id: signalId ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data: submission, error: submissionErr } = await admin
      .from("trade_submissions")
      .upsert(submissionRecord, { onConflict: 'user_id,client_order_id' })
      .select("id")
      .single();
    if (submissionErr) {
      console.error("[SnapTrade Order] trade_submissions upsert failed", submissionErr);
      return err(500, "SUBMISSION_RECORD_FAILED", "Failed to record trade submission");
    }
    const submissionId = submission?.id;

    // --------------------------------------------------------------
    // Direct SnapTrade POST /trade/place. Uses the ticker string form
    // supported by /trade/place — no separate symbol resolution step.
    // --------------------------------------------------------------
    const orderPayload: any = {
      userId: user.id,
      userSecret,
      account_id: accountId, accountId,
      action,
      order_type: orderType, orderType,
      time_in_force: timeInForce, timeInForce,
      units: qty,
      symbol: upperTicker,
    };
    if (orderType === 'Limit' || orderType === 'StopLimit') orderPayload.price = Number(price);
    if (orderType === 'Stop' || orderType === 'StopLimit') orderPayload.stop = Number(stopPrice);

    console.log("[SnapTrade Order] placing direct order (sanitized payload)", {
      ticker: upperTicker, action, orderType, qty, timeInForce,
      hasLimit: !!orderPayload.price, hasStop: !!orderPayload.stop,
      accountId, connectionId: liveConnectionId, brokerage: liveBrokerageName,
      clientOrderId,
    });

    try {
      const place = await (snaptrade.trading as any).placeForceOrder(orderPayload);
      const placeData: any = place?.data ?? {};

      const providerOrderId =
        placeData?.brokerage_order_id ??
        placeData?.id ??
        placeData?.order_id ?? null;
      const rawStatus =
        placeData?.state ??
        placeData?.status ??
        placeData?.order_state ??
        'SUBMITTED';
      const normalized = normalizeOrderStatus(rawStatus);
      const filledQty = Number(placeData?.filled_units ?? placeData?.filled_quantity ?? 0) || null;
      const filledPx = Number(placeData?.execution_price ?? placeData?.filled_price ?? 0) || null;

      await admin.from("trade_submissions").update({
        status: normalized,
        snaptrade_order_id: providerOrderId,
        filled_quantity: filledQty,
        filled_price: filledPx,
        raw_response: placeData,
        updated_at: new Date().toISOString(),
      }).eq("id", submissionId);

      await admin.from("broker_orders").insert({
        user_id: user.id,
        provider: 'snaptrade',
        provider_order_id: providerOrderId,
        account_id: accountId,
        ticker: upperTicker,
        action,
        order_type: orderType,
        quantity: qty,
        price: price ? Number(price) : null,
        take_profit: takeProfit ? Number(takeProfit) : null,
        stop_loss: stopLoss ? Number(stopLoss) : null,
        status: normalized.toLowerCase(),
        signal_id: signalId ?? null,
        raw_response: placeData,
      });

      // Fire-and-forget: request a brokerage refresh for just this account
      // so the position lands in the next snapshot quickly.
      try {
        await (snaptrade.transactionsAndReporting as any).refreshUserAccount?.({
          userId: user.id, userSecret, accountId,
        });
      } catch (e) {
        console.warn("[SnapTrade Order] refreshUserAccount failed (non-fatal)", extractSDKError(e).message);
      }

      const okMessage =
        normalized === 'FILLED' ? 'Order filled by the brokerage.'
        : normalized === 'PARTIALLY_FILLED' ? 'Order partially filled — remainder still working.'
        : normalized === 'PENDING' ? 'Order accepted, pending execution at the brokerage.'
        : normalized === 'REJECTED' ? 'Broker rejected this order.'
        : normalized === 'CANCELED' ? 'Order canceled.'
        : 'Order submitted to the brokerage.';

      return json(200, {
        success: true,
        submissionId,
        clientOrderId,
        accountId,
        status: normalized,
        providerOrderId,
        filledQuantity: filledQty,
        filledPrice: filledPx,
        message: okMessage,
        response: placeData,
      });
    } catch (e) {
      const info = extractSDKError(e);
      const msgLower = String(info.message).toLowerCase();
      const codeStr = String(info.code ?? '');

      console.warn("[SnapTrade Order] place failed — sanitized failure summary", {
        code: info.code, status: info.status, message: info.message,
        brokerage: liveBrokerageName,
        connectionType: liveConnectionType,
        allowsTrading: liveAllowsTrading,
        accountId, ticker: upperTicker, action, orderType, qty, timeInForce,
      });

      let code = "SNAPTRADE_PLACE_FAILED";
      let friendly = `Order rejected by broker: ${info.message}`;
      if (msgLower.includes('insufficient') || msgLower.includes('buying power')) {
        code = "INSUFFICIENT_FUNDS";
        friendly = "Insufficient buying power in this account to place the order.";
      } else if (msgLower.includes('closed') || msgLower.includes('market hours')) {
        code = "MARKET_CLOSED";
        friendly = "The market is currently closed and this brokerage does not accept this order type outside regular hours.";
      } else if (codeStr === '1153' || (msgLower.includes('symbol') && (msgLower.includes('not') || msgLower.includes('invalid')))) {
        code = "SYMBOL_NOT_TRADABLE";
        friendly = `${upperTicker} is not tradable at your brokerage right now. This can happen if the broker doesn't offer the ticker or the security is restricted.`;
      } else if (codeStr === '1063' || msgLower.includes('trading not enabled') || msgLower.includes('not enabled for trading')) {
        code = "TRADING_NOT_ENABLED";
        friendly = `The broker rejected this order because trading is not enabled at the connection/account level. Connection type reported as "${liveConnectionType}" (allows_trading=${liveAllowsTrading}). If read-only, reconnect ${liveBrokerageName} with trading access enabled.`;
      } else if (msgLower.includes('quantity') || msgLower.includes('units')) {
        code = "INVALID_QUANTITY";
        friendly = "The broker rejected the quantity for this order.";
      } else if (msgLower.includes('fractional')) {
        code = "FRACTIONAL_NOT_SUPPORTED";
        friendly = "This brokerage does not support fractional shares for this order.";
      } else if (msgLower.includes('order type') || msgLower.includes('not supported')) {
        code = "UNSUPPORTED_ORDER_TYPE";
        friendly = "The broker does not support this order type for this security.";
      } else if (info.status === 401 || info.status === 403) {
        code = "BROKERAGE_UNAUTHORIZED";
        friendly = "The brokerage rejected the request. Try reconnecting your account in Settings.";
      } else if (info.status === 408 || msgLower.includes('timeout')) {
        code = "NETWORK_TIMEOUT";
        friendly = "The request to the brokerage timed out. Please try again.";
      }

      await admin.from("trade_submissions").update({
        status: 'REJECTED',
        error_message: friendly,
        error_code: String(info.code ?? code),
        raw_response: { error: info.message, code: info.code, status: info.status },
        updated_at: new Date().toISOString(),
      }).eq("id", submissionId);

      await admin.from("broker_orders").insert({
        user_id: user.id,
        provider: 'snaptrade',
        account_id: accountId,
        ticker: upperTicker,
        action,
        order_type: orderType,
        quantity: qty,
        price: price ? Number(price) : null,
        take_profit: takeProfit ? Number(takeProfit) : null,
        stop_loss: stopLoss ? Number(stopLoss) : null,
        status: 'rejected',
        signal_id: signalId ?? null,
        raw_response: { error: info.message, code: info.code, status: info.status },
      });

      return err(502, code, friendly, {
        snapTradeCode: info.code, snapTradeStatus: info.status, submissionId, status: 'REJECTED',
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[SnapTrade Order] unhandled exception", msg);
    return err(500, "INTERNAL_ERROR", msg);
  }
});
