// snaptrade-sync-orders — Session 155
// =============================================================================
// Polls the live status of a user's recent trade submissions against SnapTrade
// so filled / partially filled / rejected / cancelled orders are surfaced to
// the app without the user having to keep their broker's screen open.
//
// Called from the client on:
//   • App foreground (immediately after login)
//   • Every 30 seconds while there are outstanding orders
//   • Manually from the Journal / Active Trades screens
//
// The client uses the returned "fills" list (orders whose status just moved
// to FILLED / PARTIALLY_FILLED) to journal completed sells and prune Active
// Trades. journal_synced_at is set by the CLIENT once the journal entry has
// been written locally so a subsequent server-side sync cannot re-log the
// same fill.
//
// This function is completely idempotent — SnapTrade is the source of truth,
// and trade_submissions.status is stamped only if the broker-reported status
// actually changed.
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
function err(status: number, code: string, message: string) {
  console.error(`[SnapTrade SyncOrders] ${status} ${code}: ${message}`);
  return json(status, { success: false, error: code, message });
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

const TERMINAL_STATUSES = new Set(['FILLED', 'REJECTED', 'CANCELED']);

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

    // Load stored SnapTrade credentials for this user.
    const { data: conn } = await admin
      .from("user_broker_connections")
      .select("snaptrade_user_secret, status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!conn?.snaptrade_user_secret) {
      return json(200, { success: true, updated: 0, fills: [], message: "No brokerage connected" });
    }
    if (conn.status && conn.status !== 'active') {
      return json(200, { success: true, updated: 0, fills: [], message: `Brokerage status: ${conn.status}` });
    }
    const userSecret = conn.snaptrade_user_secret;

    // Pull recent submissions still in a non-terminal state so we know which
    // orders to check. Only look at the last 7 days so we don't drag old
    // orders forward forever.
    const sinceIso = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const { data: pending } = await admin
      .from("trade_submissions")
      .select("id, account_id, snaptrade_order_id, status, ticker, action, quantity, price, submitted_at")
      .eq("user_id", user.id)
      .gte("submitted_at", sinceIso)
      .in("status", ['SUBMITTED', 'PENDING', 'PARTIALLY_FILLED', 'SUBMITTING']);
    const submissions = Array.isArray(pending) ? pending : [];

    if (submissions.length === 0) {
      return json(200, { success: true, updated: 0, fills: [], message: "No pending orders" });
    }

    // Group submissions by account_id so we only fetch each account's order
    // history once per run.
    const accountsToPoll = new Map<string, typeof submissions>();
    for (const sub of submissions) {
      if (!sub.account_id) continue;
      const list = accountsToPoll.get(sub.account_id) ?? [];
      list.push(sub);
      accountsToPoll.set(sub.account_id, list);
    }

    const fills: any[] = [];
    let updated = 0;

    for (const [accountId, subs] of accountsToPoll.entries()) {
      let brokerOrders: any[] = [];
      try {
        const resp = await (snaptrade.accountInformation as any).getUserAccountOrders({
          userId: user.id, userSecret, accountId,
        });
        brokerOrders = Array.isArray(resp.data) ? resp.data : [];
      } catch (e) {
        console.warn(`[SnapTrade SyncOrders] getUserAccountOrders failed for account ${accountId}`, extractSDKError(e));
        continue;
      }
      // Build a fast lookup by broker order id AND ticker+quantity fallback.
      const byId = new Map<string, any>();
      for (const o of brokerOrders) {
        const oid = o?.brokerage_order_id ?? o?.id ?? null;
        if (oid) byId.set(String(oid), o);
      }
      for (const sub of subs) {
        let brokerOrder: any = null;
        if (sub.snaptrade_order_id && byId.has(sub.snaptrade_order_id)) {
          brokerOrder = byId.get(sub.snaptrade_order_id);
        }
        if (!brokerOrder) {
          // Fallback: match by ticker + action + qty for orders placed very
          // recently that don't have a snaptrade_order_id yet.
          brokerOrder = brokerOrders.find((o: any) => {
            const t = String(o?.symbol?.symbol ?? o?.symbol ?? '').toUpperCase();
            const act = String(o?.action ?? '').toUpperCase();
            const q = Number(o?.total_quantity ?? o?.units ?? 0);
            return t === String(sub.ticker).toUpperCase()
              && act === String(sub.action).toUpperCase()
              && Math.abs(q - Number(sub.quantity)) < 0.0001;
          }) ?? null;
        }
        if (!brokerOrder) continue;

        const rawStatus = brokerOrder?.state ?? brokerOrder?.status ?? brokerOrder?.order_state ?? 'SUBMITTED';
        const normalized = normalizeOrderStatus(rawStatus);
        const filledQty = Number(brokerOrder?.filled_units ?? brokerOrder?.filled_quantity ?? 0) || null;
        const filledPx = Number(brokerOrder?.execution_price ?? brokerOrder?.filled_price ?? 0) || null;
        const providerOrderId = brokerOrder?.brokerage_order_id ?? brokerOrder?.id ?? sub.snaptrade_order_id ?? null;

        if (normalized === sub.status) continue; // no change

        await admin.from("trade_submissions").update({
          status: normalized,
          snaptrade_order_id: providerOrderId,
          filled_quantity: filledQty,
          filled_price: filledPx,
          raw_response: brokerOrder,
          updated_at: new Date().toISOString(),
        }).eq("id", sub.id);

        updated += 1;

        if (normalized === 'FILLED' || normalized === 'PARTIALLY_FILLED') {
          fills.push({
            submissionId: sub.id,
            accountId,
            ticker: sub.ticker,
            action: sub.action,
            quantity: sub.quantity,
            filledQuantity: filledQty ?? sub.quantity,
            filledPrice: filledPx ?? sub.price ?? null,
            status: normalized,
            providerOrderId,
          });
        }
      }
    }

    return json(200, { success: true, updated, fills });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(500, "INTERNAL_ERROR", msg);
  }
});
