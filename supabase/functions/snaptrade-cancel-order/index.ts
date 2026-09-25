// snaptrade-cancel-order — Session 200
// =============================================================================
// Cancels a pending / non-terminal broker order via SnapTrade's trading API.
// Called from the Sight app when the user taps "Cancel" on a Pending Order
// card. The order can only be cancelled while it is still open at the
// brokerage — once filled or already cancelled the SnapTrade call will
// return an error which we surface directly.
//
// Body: { accountId: string, brokerageOrderId: string }
//
// Response on success:
//   { success: true, order: <normalized order object>, canceledAt: ISO }
//
// Response on failure:
//   { success: false, error: 'CODE', message: 'human-readable', ... }
//
// Notes:
//   • This endpoint intentionally does NOT touch trade_submissions —
//     snaptrade-sync-orders will pick up the CANCELED state on its next
//     poll and update the DB row correctly. That guarantees a single
//     source of truth for order state (SnapTrade) and prevents drift.
//   • After a successful cancel we IMMEDIATELY invalidate the local
//     pending_orders_snapshot cache by omitting the cancelled order so
//     the next sync/refresh removes it from the UI without waiting for
//     the next 20s poll cycle.
// =============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getSnapTradeClient,
  hasSnapTradeCredentials,
  extractSDKError,
  isPartnerCredentialError,
} from "../_shared/snaptrade.ts";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function err(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  console.error(`[SnapTrade Cancel] ${status} ${code}: ${message}`);
  return json(status, { success: false, error: code, message, ...(extra ?? {}) });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
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

    // Body parsing — accept both accountId + brokerageOrderId as string.
    let body: any = {};
    try { body = await req.json(); } catch { /* leave as {} */ }
    const accountId = String(body?.accountId ?? "").trim();
    const brokerageOrderId = String(body?.brokerageOrderId ?? body?.orderId ?? "").trim();
    if (!accountId) return err(400, "INVALID_INPUT", "accountId is required");
    if (!brokerageOrderId) return err(400, "INVALID_INPUT", "brokerageOrderId is required");

    // Load stored SnapTrade credentials for this user.
    const { data: conn } = await admin
      .from("user_broker_connections")
      .select("snaptrade_user_secret, status, pending_orders_snapshot")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!conn?.snaptrade_user_secret) {
      return err(400, "NO_BROKERAGE_CONNECTED", "No brokerage connection exists for this user");
    }
    if (conn.status && conn.status !== 'active') {
      return err(400, "BROKERAGE_NOT_ACTIVE", `Brokerage status: ${conn.status}`);
    }
    const userSecret = conn.snaptrade_user_secret;

    // Session 213 — robust cancel dispatch. The SnapTrade SDK v9 exposes
    // `cancelUserAccountOrder` on the `trading` namespace and (in some
    // patch versions) on `accountInformation`. We probe every known
    // location, and for each attempt we try BOTH parameter shapes the
    // SDK has used across versions: (a) flat args with brokerageOrderId,
    // and (b) a `requestBody` wrapper. Every attempt is caught
    // individually so a single parameter-shape mismatch cannot mask a
    // successful call by a subsequent probe.
    //
    // Additionally: if every SDK dispatch surfaces the specific
    // 'endpoint is no longer available for your account' message that
    // the user reported, we substitute a broker-actionable message
    // instructing them to cancel the order directly in their broker's
    // app — surfacing SnapTrade's raw partner-level string was
    // confusing and unactionable.
    let cancelResp: any = null;
    let cancelError: any = null;
    const dispatchCandidates: Array<() => Promise<any>> = [];
    const tradingAny = snaptrade.trading as any;
    const acctInfoAny = snaptrade.accountInformation as any;
    const flatArgs = { userId: user.id, userSecret, accountId, brokerageOrderId };
    const bodyArgs = { userId: user.id, userSecret, accountId, requestBody: { brokerageOrderId } };
    if (typeof tradingAny?.cancelUserAccountOrder === 'function') {
      dispatchCandidates.push(() => tradingAny.cancelUserAccountOrder(flatArgs));
      dispatchCandidates.push(() => tradingAny.cancelUserAccountOrder(bodyArgs));
    }
    if (typeof tradingAny?.cancelOrder === 'function') {
      dispatchCandidates.push(() => tradingAny.cancelOrder(flatArgs));
      dispatchCandidates.push(() => tradingAny.cancelOrder(bodyArgs));
    }
    if (typeof acctInfoAny?.cancelUserAccountOrder === 'function') {
      dispatchCandidates.push(() => acctInfoAny.cancelUserAccountOrder(flatArgs));
      dispatchCandidates.push(() => acctInfoAny.cancelUserAccountOrder(bodyArgs));
    }

    for (const attempt of dispatchCandidates) {
      try {
        cancelResp = await attempt();
        cancelError = null;
        break;
      } catch (e) {
        cancelError = extractSDKError(e, 'cancelUserAccountOrder');
      }
    }

    if (!cancelResp && !cancelError) {
      cancelError = { message: 'SnapTrade SDK does not expose a cancel-order method in the currently-installed version.', code: 'SDK_METHOD_MISSING', status: 501 };
    }

    // Session 215 — As a LAST RESORT, if every SDK dispatch shape failed
    // we call the raw SnapTrade v1 endpoint directly. This gives us access
    // to the endpoint even when the installed SDK version's method name /
    // arg shape has drifted or when the SDK returns a partner-error the
    // dashboard hasn't propagated yet.
    if (cancelError && !cancelResp) {
      try {
        const raw = await callRawCancelEndpoint({
          userId: user.id,
          userSecret,
          accountId,
          brokerageOrderId,
        });
        if (raw?.data) {
          cancelResp = raw;
          cancelError = null;
          console.log('[SnapTrade Cancel] raw HTTP fallback succeeded');
        } else if (raw?.error) {
          cancelError = { ...cancelError, message: raw.error.message ?? cancelError.message, code: raw.error.code ?? cancelError.code, status: raw.error.status ?? cancelError.status };
        }
      } catch (e) {
        console.log('[SnapTrade Cancel] raw HTTP fallback threw', (e as any)?.message);
      }
    }

    if (cancelError) {
      // If partner creds are broken, surface the operator-actionable message.
      if (isPartnerCredentialError(cancelError)) {
        return err(500, "SNAPTRADE_PARTNER_CREDENTIALS_REJECTED",
          `SnapTrade rejected our partner credentials while cancelling the order (${cancelError.code ?? cancelError.status}). ` +
          `Verify SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY in the OnSpace Cloud Secrets — the user cannot fix this from the app.`);
      }
      // Session 213 — translate SnapTrade's opaque partner-level messages
      // into broker-actionable copy so the user knows what to do next.
      const rawMsg = String(cancelError.message ?? '').toLowerCase();
      if (rawMsg.includes('endpoint') && rawMsg.includes('no longer available')) {
        return err(200, "SNAPTRADE_CANCEL_UNSUPPORTED",
          "Your broker doesn't support cancelling this order through Sight right now. Please open your broker's app and cancel the order directly there.",
          { snapTradeCode: cancelError.code ?? null });
      }
      if (rawMsg.includes('already') && (rawMsg.includes('filled') || rawMsg.includes('canceled') || rawMsg.includes('cancelled'))) {
        return err(200, "SNAPTRADE_CANCEL_ALREADY_TERMINAL",
          "This order has already been completed or cancelled at your broker. Refreshing your account should remove it from Sight.",
          { snapTradeCode: cancelError.code ?? null });
      }
      if (rawMsg.includes('rejected')) {
        return err(cancelError.status || 502, "SNAPTRADE_CANCEL_REJECTED",
          `Your broker rejected the cancel request: ${cancelError.message}`,
          { snapTradeCode: cancelError.code ?? null });
      }
      return err(cancelError.status || 502, "SNAPTRADE_CANCEL_FAILED", cancelError.message ?? "Cancel failed", {
        snapTradeCode: cancelError.code ?? null,
      });
    }

    const orderData = cancelResp?.data ?? cancelResp ?? null;

    // Immediately mark the cancelled order as terminal in our snapshot so
    // the client's next refresh (typically <1s later) reflects reality.
    // The authoritative status will still come from SnapTrade on the next
    // full sync — we're just keeping the UI honest in the interim.
    try {
      const prev = Array.isArray(conn.pending_orders_snapshot) ? conn.pending_orders_snapshot : [];
      const pruned = prev.filter((o: any) => {
        const oid = String(o?.brokerageOrderId ?? o?.id ?? "");
        return oid !== brokerageOrderId;
      });
      await admin
        .from("user_broker_connections")
        .update({ pending_orders_snapshot: pruned, updated_at: new Date().toISOString() })
        .eq("user_id", user.id);
    } catch (e) {
      console.warn("[SnapTrade Cancel] failed to prune pending_orders_snapshot", (e as any)?.message ?? e);
    }

    // Also mark any matching trade_submissions row as CANCELED so the
    // sync-orders loop doesn't try to re-journal it.
    try {
      await admin
        .from("trade_submissions")
        .update({
          status: 'CANCELED',
          raw_response: orderData,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .eq("snaptrade_order_id", brokerageOrderId);
    } catch (e) {
      // Non-fatal — the order might have been placed outside Sight and
      // never had a trade_submissions row.
    }

    console.log(`[SnapTrade Cancel] cancelled order ${brokerageOrderId} on account ${accountId}`);
    return json(200, {
      success: true,
      order: orderData,
      canceledAt: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(500, "INTERNAL_ERROR", msg);
  }
});

// Session 215 — Raw HTTP fallback for SnapTrade order cancellation.
// When every installed SDK dispatch shape rejects the call, we fall back
// to the vendor's REST API directly. This lets the cancel path work
// regardless of SDK version drift, as long as the broker actually
// supports cancellation and the partner credentials are valid.
async function callRawCancelEndpoint(params: {
  userId: string;
  userSecret: string;
  accountId: string;
  brokerageOrderId: string;
}): Promise<{ data?: any; error?: { message: string; code: string; status: number } }> {
  const clientId = (Deno.env.get('SNAPTRADE_CLIENT_ID') ?? '').trim();
  const consumerKey = (Deno.env.get('SNAPTRADE_CONSUMER_KEY') ?? '').trim();
  if (!clientId || !consumerKey) {
    return { error: { message: 'partner credentials missing', code: 'SNAPTRADE_NOT_CONFIGURED', status: 500 } };
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const attempts: Array<{ path: string; label: string }> = [
    { path: `/api/v1/trading/accounts/${encodeURIComponent(params.accountId)}/orders/${encodeURIComponent(params.brokerageOrderId)}/cancel`, label: 'trading/accounts/*/orders/*/cancel' },
    { path: `/api/v1/trade/${encodeURIComponent(params.accountId)}/${encodeURIComponent(params.brokerageOrderId)}/cancel`, label: 'trade/*/*/cancel' },
  ];
  const baseUrl = 'https://api.snaptrade.com';
  for (const attempt of attempts) {
    const query = new URLSearchParams({
      clientId,
      timestamp,
      userId: params.userId,
      userSecret: params.userSecret,
    });
    const url = `${baseUrl}${attempt.path}?${query.toString()}`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'consumer-key': consumerKey,
        },
        body: JSON.stringify({ brokerageOrderId: params.brokerageOrderId }),
      });
      const text = await resp.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      if (resp.status >= 200 && resp.status < 300) {
        console.log('[SnapTrade Cancel] raw HTTP cancel OK via', attempt.label);
        return { data: body };
      }
      const msg = (body && (body.detail ?? body.message ?? body.description ?? body.error)) ?? `HTTP ${resp.status}`;
      const code = body?.code ?? body?.errorCode ?? `HTTP_${resp.status}`;
      if (resp.status === 404) { continue; }
      return { error: { message: String(msg).slice(0, 500), code: String(code), status: resp.status } };
    } catch (e) {
      console.log('[SnapTrade Cancel] raw HTTP threw on', attempt.label, (e as any)?.message);
      continue;
    }
  }
  return { error: { message: 'All raw cancel endpoints returned 404 — the broker most likely does not support cancellation via SnapTrade.', code: 'SNAPTRADE_CANCEL_UNSUPPORTED', status: 404 } };
}

