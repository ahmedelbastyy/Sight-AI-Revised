// snaptrade-sync-accounts (Session 200 — Historical Activities + Pending Orders)
// =============================================================================
// TradeSight's brokerage data pipeline built around SnapTrade's actual model:
//
//   1 TradeSight User
//     └── N SnapTrade Connections (brokerage authorizations)
//           └── N Accounts per Connection
//                 ├── total_market_value  ← from broker via SnapTrade
//                 ├── cash balances
//                 ├── positions
//                 ├── historical activities (BUY/SELL transactions)
//                 └── pending / non-terminal orders (unfilled BUYs, cancel-able)
//
// Session 200 extends this to ALSO pull historical account activities
// (transactions) and the current pending-orders list per account so the
// Sight app can:
//   • Auto-populate the Journal with every historical closed BUY→SELL
//     round-trip the user made at the broker (before Sight even existed
//     for them).
//   • Show a Pending Orders section on Home listing unfilled orders with
//     the exact ticker / side / quantity / price and let the user cancel
//     them via snaptrade-cancel-order without opening the broker app.
//   • Keep Active Trades in sync with the broker's authoritative position
//     list — new positions opened in the broker instantly become visible
//     as Active Trades in Sight, and closed positions leave Active Trades
//     without stale entries lingering.
//
// Endpoints used (per current SnapTrade docs):
//   • listBrokerageAuthorizations  — connection metadata + disabled flag
//   • listUserAccounts             — every account across every connection
//   • getUserAccountBalance        — cash balances per account
//   • getUserAccountPositions      — equity positions per account
//   • getAccountActivities         — historical transactions per account
//                                    (last 180 days; broker-native pagination)
//   • getUserAccountOrders         — order history including PENDING /
//                                    QUEUED / ACCEPTED per account
//   • refreshUserAccount (best-effort, non-fatal) — asks the brokerage for
//     fresh data before we read (bounded by the customer's SnapTrade plan).
//
// The persisted snapshot keeps rich per-account metadata so the frontend
// can decide correctly which accounts contribute to the portfolio value.
// Activities + pending orders are stored in dedicated JSONB columns so
// AppContext can journal historical closes idempotently and the hook can
// expose pending orders to the UI.
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
  console.error(`[SnapTrade Sync] ${status} ${code}: ${message}`);
  return json(status, { success: false, error: code, message, ...(extra ?? {}) });
}

// ------------------------------------------------------------------
// Field extraction helpers. SnapTrade's SDK sometimes returns fields
// under slightly different casings depending on version; we probe
// several likely locations so we never lose data because of a shape
// mismatch.
// ------------------------------------------------------------------
function extractAccountCategory(acc: any): string {
  const raw =
    acc?.meta?.type ??
    acc?.account_category ??
    acc?.raw_type ??
    acc?.type ??
    acc?.account_type ?? "";
  const s = String(raw ?? "").toUpperCase();
  if (!s) return "INVESTMENT";
  if (s.includes("DEPOSIT") || s === "CHECKING" || s === "SAVINGS" || s === "BANK") return "DEPOSIT";
  if (s.includes("LOC") || s.includes("MARGIN_LOC") || s.includes("LINE_OF_CREDIT")) return "LOC";
  if (s.includes("LOAN") || s.includes("MORTGAGE") || s.includes("CREDIT_CARD")) return "LOAN";
  return "INVESTMENT";
}

function extractAccountTotal(acc: any): { value: number | null; currency: string | null } {
  const t = acc?.balance?.total ?? acc?.total;
  if (t && typeof t === "object") {
    const amt = Number(t.amount ?? t.value);
    const cur = t.currency?.code ?? t.currency ?? null;
    if (Number.isFinite(amt)) return { value: amt, currency: cur };
  }
  const alt = Number(acc?.balance?.equity ?? acc?.equity ?? acc?.total_value?.amount);
  if (Number.isFinite(alt) && alt > 0) {
    return { value: alt, currency: acc?.balance?.equity_currency?.code ?? acc?.currency ?? null };
  }
  return { value: null, currency: null };
}

function extractHoldingsUnavailable(acc: any): boolean {
  return acc?.meta?.holdings_unavailable === true ||
    acc?.holdings_unavailable === true ||
    acc?.sync_status?.holdings?.initial_sync_completed === false;
}

function extractSymbolTicker(p: any): string {
  return (
    p?.symbol?.symbol?.symbol ??
    p?.symbol?.symbol ??
    p?.symbol?.raw_symbol ??
    p?.symbol?.description ??
    p?.universal_symbol?.symbol ??
    p?.universal_symbol?.raw_symbol ??
    p?.instrument?.symbol ??
    p?.instrument?.ticker ??
    p?.ticker ??
    p?.raw_symbol ??
    ""
  );
}

function extractMarketValue(p: any): number | null {
  const q = Number(p?.units ?? p?.quantity ?? 0);
  const px = Number(p?.price ?? p?.current_price ?? 0);
  if (Number.isFinite(q) && Number.isFinite(px) && q !== 0 && px > 0) return q * px;
  const explicit = Number(p?.market_value?.amount ?? p?.market_value);
  if (Number.isFinite(explicit)) return explicit;
  return null;
}

// Session 200 — normalize a SnapTrade activity (transaction) row into a
// small stable shape the client can journal. Handles the various field
// name variations across brokerage integrations.
function normalizeActivity(a: any, accountId: string, institutionName: string): any {
  const rawType = String(a?.type ?? a?.activity_type ?? a?.transaction_type ?? "").toUpperCase();
  // Only surface BUY/SELL rows to the client's journaling logic. Deposits,
  // dividends, interest, fees etc. are stored raw but aren't journaled.
  const isBuy = rawType.includes("BUY") || rawType === "TRADE_BUY";
  const isSell = rawType.includes("SELL") || rawType === "TRADE_SELL";
  const side = isBuy ? "BUY" : isSell ? "SELL" : null;
  const ticker = extractSymbolTicker(a) || String(a?.symbol?.symbol ?? "").toUpperCase();
  const qty = Number(a?.units ?? a?.quantity ?? 0) || 0;
  const price = Number(a?.price ?? a?.execution_price ?? 0) || 0;
  const tradeDate = a?.trade_date ?? a?.settlement_date ?? a?.date ?? a?.executed_at ?? null;
  return {
    id: String(a?.id ?? a?.transaction_id ?? `${accountId}-${ticker}-${tradeDate}-${qty}-${price}`),
    accountId,
    institutionName,
    type: rawType,
    side,
    ticker: String(ticker).toUpperCase(),
    quantity: Math.abs(qty),
    price,
    amount: Number(a?.amount ?? 0) || 0,
    currency: a?.currency?.code ?? a?.currency ?? null,
    tradeDate,
    settlementDate: a?.settlement_date ?? null,
    description: String(a?.description ?? "").slice(0, 300),
    fees: Number(a?.fee ?? a?.fees ?? 0) || 0,
    raw: a,
  };
}

// Session 200 — normalize a SnapTrade order row into a stable shape the
// client can render as a Pending Order card.
function normalizeOrder(o: any, accountId: string, institutionName: string): any {
  const rawState = String(o?.state ?? o?.status ?? o?.order_state ?? "").toUpperCase();
  const isFilled = rawState === "FILLED" || rawState === "EXECUTED";
  const isPartial = rawState.includes("PARTIAL");
  const isCanceled = rawState === "CANCELED" || rawState === "CANCELLED";
  const isRejected = rawState === "REJECTED" || rawState === "FAILED";
  const isTerminal = isFilled || isCanceled || isRejected;
  const ticker = extractSymbolTicker(o) || String(o?.symbol?.symbol ?? "").toUpperCase();
  // Session 203 — richer field probing so brokers that return alternate
  // field names (Webull returns `filled_quantity` while others return
  // `filled_units`; some return `execution_price` at the top level, others
  // nest it under `executions[0].price`) all flow through to the client
  // with correctly filled quantities and prices.
  const totalQty = Number(
    o?.total_quantity ?? o?.units ?? o?.quantity ?? o?.order_quantity ?? 0,
  ) || 0;
  const filledQty = Number(
    o?.filled_units ?? o?.filled_quantity ?? o?.units_filled ?? o?.filled ?? 0,
  ) || 0;
  const executionPx = Number(
    o?.execution_price ?? o?.filled_price ?? o?.avg_execution_price ??
    o?.executions?.[0]?.price ?? 0,
  ) || null;
  return {
    id: String(o?.brokerage_order_id ?? o?.id ?? `${accountId}-${ticker}-${o?.time_placed ?? ""}`),
    brokerageOrderId: String(o?.brokerage_order_id ?? o?.id ?? ""),
    accountId,
    institutionName,
    ticker: String(ticker).toUpperCase(),
    action: String(o?.action ?? "").toUpperCase(),
    orderType: String(o?.order_type ?? "MARKET").toUpperCase(),
    timeInForce: String(o?.time_in_force ?? "").toUpperCase(),
    totalQuantity: totalQty,
    filledQuantity: filledQty,
    openQuantity: Number(o?.open_quantity ?? Math.max(0, totalQty - filledQty)) || 0,
    canceledQuantity: Number(o?.canceled_quantity ?? 0) || 0,
    price: Number(o?.price ?? o?.limit_price ?? 0) || null,
    stopPrice: Number(o?.stop_price ?? 0) || null,
    executionPrice: executionPx,
    state: rawState,
    isPending: !isTerminal && !isPartial,
    isPartiallyFilled: isPartial,
    isFilled,
    isTerminal,
    timePlaced: o?.time_placed ?? o?.created_at ?? null,
    timeUpdated: o?.time_updated ?? o?.updated_at ?? null,
    currency: o?.currency?.code ?? o?.currency ?? null,
    raw: o,
  };
}

// Session 201 — brokerage summary logger for debugging "open positions
// not showing". Emits a single log line summarizing what SnapTrade
// actually returned for this user so we can diagnose from server logs
// whether the missing positions are broker-side (holdings_unavailable /
// empty response) or extractor-side (ticker probe failing).
function logPositionsSummary(userId: string, accounts: any[], normalizedPositions: any[]) {
  const investmentAccounts = accounts.filter(a => (a.account_category ?? 'INVESTMENT') === 'INVESTMENT');
  const holdingsUnavailable = accounts.filter(a => a.holdings_unavailable === true);
  console.log(`[SnapTrade Sync] user=${userId} accounts=${accounts.length} investment=${investmentAccounts.length} holdings_unavailable=${holdingsUnavailable.length} positions=${normalizedPositions.length}`);
  if (normalizedPositions.length === 0 && investmentAccounts.length > 0) {
    console.log(`[SnapTrade Sync] WARNING zero positions returned despite ${investmentAccounts.length} investment account(s). Institutions: ${investmentAccounts.map(a => a.institution_name).join(', ')}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    console.log("[SnapTrade Sync] request received");
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
    console.log("[SnapTrade Sync] user", user.id);

    const { data: conn, error: dbErr } = await admin
      .from("user_broker_connections")
      .select("snaptrade_user_secret")
      .eq("user_id", user.id)
      .maybeSingle();
    if (dbErr) return err(500, "DB_LOOKUP_FAILED", "Failed to load broker connection");
    if (!conn?.snaptrade_user_secret) {
      return err(400, "NO_BROKERAGE_CONNECTED", "No brokerage connection exists for this user");
    }
    const userSecret = conn.snaptrade_user_secret;

    // -------------------------------------------------------------------
    // 1. Connections (brokerage authorizations).
    // -------------------------------------------------------------------
    let authorizations: any[] = [];
    try {
      const authResp = await snaptrade.connections.listBrokerageAuthorizations({
        userId: user.id, userSecret,
      } as any);
      authorizations = Array.isArray(authResp.data) ? authResp.data : [];
    } catch (e) {
      const info = extractSDKError(e);
      console.warn("[SnapTrade Sync] listBrokerageAuthorizations failed (continuing)", info);
    }
    console.log(`[SnapTrade Sync] ${authorizations.length} authorization(s)`);

    const connectionsById = new Map<string, any>();
    for (const a of authorizations) {
      if (a?.id) connectionsById.set(String(a.id), a);
    }

    // -------------------------------------------------------------------
    // 2. Accounts across every connection.
    // -------------------------------------------------------------------
    let accountsResp;
    try {
      accountsResp = await snaptrade.accountInformation.listUserAccounts({
        userId: user.id, userSecret,
      } as any);
    } catch (e) {
      const info = extractSDKError(e);
      return err(502, "SNAPTRADE_ACCOUNTS_FAILED", info.message, {
        snapTradeCode: info.code, snapTradeStatus: info.status,
      });
    }
    const rawAccounts: any[] = Array.isArray(accountsResp.data) ? accountsResp.data : [];
    console.log(`[SnapTrade Sync] ${rawAccounts.length} account(s) across all connections`);

    // -------------------------------------------------------------------
    // 3. Best-effort refresh for every account.
    // -------------------------------------------------------------------
    await Promise.all(rawAccounts.map(async (acc) => {
      try {
        await (snaptrade.transactionsAndReporting as any).refreshUserAccount?.({
          userId: user.id, userSecret, accountId: acc.id,
        });
      } catch (e) {
        // silent — refresh entitlements vary by plan/brokerage
      }
    }));

    // -------------------------------------------------------------------
    // 4. Balances + positions + activities + orders per account
    //    (parallel, tolerant of per-account failures).
    //
    //    Session 200: activities and orders are pulled per-account here
    //    alongside balances/positions so we get a fully coherent snapshot
    //    of the broker's state in one round-trip. Both endpoints use
    //    per-broker pagination internally in the SDK; we cap the activity
    //    lookback to 180 days so we don't drag prehistoric transactions
    //    forward forever, and we bound orders to non-terminal + last-7-day
    //    filled orders so the client always has enough history to display
    //    context but the payload never balloons.
    // -------------------------------------------------------------------
    const activitiesFromDate = new Date(Date.now() - 180 * 86400 * 1000).toISOString().slice(0, 10);
    const activitiesToDate = new Date().toISOString().slice(0, 10);

    const perAccount = await Promise.all(rawAccounts.map(async (acc: any) => {
      const [positionsRes, balancesRes, activitiesRes, ordersRes] = await Promise.allSettled([
        snaptrade.accountInformation.getUserAccountPositions({
          userId: user.id, userSecret, accountId: acc.id,
        } as any),
        snaptrade.accountInformation.getUserAccountBalance({
          userId: user.id, userSecret, accountId: acc.id,
        } as any),
        // Session 200 — historical transactions (BUY / SELL / dividends /
        // fees / etc). We only surface BUY / SELL to the client's
        // journaling logic; other rows are preserved raw for future use.
        (snaptrade.accountInformation as any).getAccountActivities?.({
          userId: user.id, userSecret, accountId: acc.id,
          startDate: activitiesFromDate, endDate: activitiesToDate,
        }).catch(async () => {
          // Fallback to transactionsAndReporting.getActivities on SDK
          // versions where the AccountInformation.getAccountActivities
          // method is not present.
          return await (snaptrade.transactionsAndReporting as any).getActivities?.({
            userId: user.id, userSecret, accounts: acc.id,
            startDate: activitiesFromDate, endDate: activitiesToDate,
          });
        }),
        // Session 200 — order history per account (pending + terminal).
        (snaptrade.accountInformation as any).getUserAccountOrders?.({
          userId: user.id, userSecret, accountId: acc.id,
          state: 'all',
        }),
      ]);

      const positions = positionsRes.status === "fulfilled" && Array.isArray(positionsRes.value.data)
        ? positionsRes.value.data : [];
      const balances = balancesRes.status === "fulfilled" && Array.isArray(balancesRes.value.data)
        ? balancesRes.value.data : [];
      const activities = activitiesRes.status === "fulfilled" && Array.isArray(activitiesRes.value?.data)
        ? activitiesRes.value.data : [];
      const orders = ordersRes.status === "fulfilled" && Array.isArray(ordersRes.value?.data)
        ? ordersRes.value.data : [];

      if (positionsRes.status === "rejected") {
        console.warn(`[SnapTrade Sync] positions failed for account ${acc.id}`, extractSDKError(positionsRes.reason));
      }
      if (balancesRes.status === "rejected") {
        console.warn(`[SnapTrade Sync] balances failed for account ${acc.id}`, extractSDKError(balancesRes.reason));
      }
      if (activitiesRes.status === "rejected") {
        console.warn(`[SnapTrade Sync] activities failed for account ${acc.id}`, extractSDKError(activitiesRes.reason));
      }
      if (ordersRes.status === "rejected") {
        console.warn(`[SnapTrade Sync] orders failed for account ${acc.id}`, extractSDKError(ordersRes.reason));
      }
      return { account: acc, positions, balances, activities, orders };
    }));

    // -------------------------------------------------------------------
    // 5. Normalize into TradeSight's flat, account-scoped shape.
    // -------------------------------------------------------------------
    const normalizedAccounts: any[] = [];
    const normalizedPositions: any[] = [];
    const normalizedActivities: any[] = [];
    const normalizedOrders: any[] = [];
    const normalizedPendingOrders: any[] = [];
    const balancesByAccount: Record<string, any[]> = {};

    for (const per of perAccount) {
      const acc = per.account;
      const connectionId = acc?.brokerage_authorization ?? null;
      const connection = connectionId ? connectionsById.get(String(connectionId)) : null;
      const institution = connection?.brokerage?.name ??
        connection?.brokerage?.display_name ??
        acc?.institution_name ??
        acc?.brokerage_name ??
        "Brokerage";
      const category = extractAccountCategory(acc);
      const { value: totalValue, currency: totalCurrency } = extractAccountTotal(acc);
      const holdingsUnavailable = extractHoldingsUnavailable(acc);

      // Sum cash balances at this account.
      let cash = 0;
      for (const b of per.balances) {
        const amt = Number((b as any)?.cash ?? (b as any)?.amount ?? 0);
        if (Number.isFinite(amt)) cash += amt;
      }

      // Sum positions market value for this account.
      let positionsValue = 0;
      const acctPositions: any[] = [];
      for (const p of per.positions) {
        const ticker = extractSymbolTicker(p);
        if (!ticker) continue;
        const qty = Number((p as any)?.units ?? (p as any)?.quantity ?? 0);
        const avg = Number((p as any)?.average_purchase_price ?? 0) || null;
        const cur = Number((p as any)?.price ?? 0) || null;
        const mv = extractMarketValue(p);
        if (mv !== null) positionsValue += mv;

        const normalized = {
          accountId: acc.id,
          connectionId,
          institutionName: institution,
          accountName: acc?.name ?? acc?.meta?.name ?? "",
          accountNumber: acc?.number ?? acc?.meta?.number ?? "",
          ticker: String(ticker).toUpperCase(),
          quantity: qty,
          averagePrice: avg,
          currentPrice: cur,
          marketValue: mv,
          currency: (p as any)?.symbol?.currency?.code ?? (p as any)?.currency ?? null,
        };
        acctPositions.push(normalized);
        normalizedPositions.push(normalized);
      }

      // Normalize activities. Only journalable BUY / SELL rows land in
      // normalizedActivities (client filters further before journaling).
      for (const a of per.activities) {
        const norm = normalizeActivity(a, acc.id, institution);
        if (!norm.side || !norm.ticker) continue;
        normalizedActivities.push(norm);
      }

      // Normalize orders. Split pending vs terminal so the client has
      // both — pending are surfaced in the Pending Orders UI card.
      // Session 202 — ALSO synthesize activities from executed orders when
      // the activities endpoint returned nothing for this account (which is
      // what Webull + a few other brokers do — they only expose executions
      // through the orders endpoint). And synthesize positions from the
      // net BUY-SELL count when the positions endpoint returned empty but
      // the orders endpoint clearly shows executed trades. Together these
      // guarantee that any REAL, EXECUTED broker trade is visible in Sight
      // even when SnapTrade + broker upstream is silent on the
      // getUserAccountPositions / getAccountActivities endpoints.
      const normalizedOrdersThisAccount: any[] = [];
      for (const o of per.orders) {
        const norm = normalizeOrder(o, acc.id, institution);
        if (!norm.ticker || !norm.action) continue;
        normalizedOrders.push(norm);
        normalizedOrdersThisAccount.push(norm);
        if (norm.isPending || norm.isPartiallyFilled) {
          normalizedPendingOrders.push(norm);
        }
      }

      // ---- SYNTHESIZE ACTIVITIES FROM EXECUTED ORDERS (Session 202) ----
      // If we already have activities for this account from the dedicated
      // activities endpoint, we skip synthesis to avoid double-journaling.
      // Otherwise every executed order becomes a synthetic activity so
      // AppContext.processHistoricalActivities can journal BUY→SELL round-
      // trips and the Journal reflects every real broker execution.
      const hasRealActivitiesForAccount = per.activities.length > 0;
      if (!hasRealActivitiesForAccount) {
        for (const norm of normalizedOrdersThisAccount) {
          if (!norm.isFilled && !norm.isPartiallyFilled) continue;
          const filledQty = norm.filledQuantity > 0 ? norm.filledQuantity : norm.totalQuantity;
          if (filledQty <= 0) continue;
          const filledPx = norm.executionPrice ?? norm.price ?? 0;
          if (filledPx <= 0) continue;
          const side = norm.action === 'BUY' ? 'BUY' : norm.action === 'SELL' ? 'SELL' : null;
          if (!side) continue;
          const tradeDate = norm.timeUpdated ?? norm.timePlaced ?? null;
          normalizedActivities.push({
            id: `order-${norm.brokerageOrderId || norm.id}`,
            accountId: acc.id,
            institutionName: institution,
            type: 'TRADE',
            side,
            ticker: norm.ticker,
            quantity: filledQty,
            price: filledPx,
            amount: filledQty * filledPx,
            currency: norm.currency ?? 'USD',
            tradeDate,
            settlementDate: null,
            description: `${side} ${filledQty} ${norm.ticker} @ $${filledPx.toFixed(2)}`,
            fees: 0,
            raw: norm.raw,
          });
        }
      }

      // ---- SYNTHESIZE POSITIONS FROM EXECUTED ORDERS (Session 202) ----
      // If the positions endpoint returned nothing for this account but the
      // orders endpoint reveals net non-zero share balances, we synthesize
      // positions so the user sees their real broker holdings in Sight. Uses
      // FIFO cost-basis accounting: each BUY adds shares at its execution
      // price; each SELL pops shares FIFO. The remainder is exposed as an
      // open position with the correct weighted-average cost basis.
      if (acctPositions.length === 0 && normalizedOrdersThisAccount.length > 0) {
        // Chronological order (oldest first) so FIFO is honored.
        const filledOrders = normalizedOrdersThisAccount
          .filter((o) => (o.isFilled || o.isPartiallyFilled))
          .filter((o) => {
            const qty = o.filledQuantity > 0 ? o.filledQuantity : o.totalQuantity;
            const px = o.executionPrice ?? o.price ?? 0;
            return qty > 0 && px > 0 && (o.action === 'BUY' || o.action === 'SELL');
          })
          .sort((a, b) => {
            const at = new Date(a.timeUpdated ?? a.timePlaced ?? 0).getTime();
            const bt = new Date(b.timeUpdated ?? b.timePlaced ?? 0).getTime();
            return at - bt;
          });

        // Ledger keyed by ticker → FIFO queue of { shares, price }.
        const ledger = new Map<string, { shares: number; price: number }[]>();
        for (const o of filledOrders) {
          const qty = o.filledQuantity > 0 ? o.filledQuantity : o.totalQuantity;
          const px = o.executionPrice ?? o.price ?? 0;
          const list = ledger.get(o.ticker) ?? [];
          if (o.action === 'BUY') {
            list.push({ shares: qty, price: px });
          } else if (o.action === 'SELL') {
            let remaining = qty;
            while (remaining > 0.00001 && list.length > 0) {
              const head = list[0];
              const take = Math.min(remaining, head.shares);
              head.shares -= take;
              remaining -= take;
              if (head.shares <= 0.00001) list.shift();
            }
          }
          ledger.set(o.ticker, list);
        }

        // Emit remaining lots as open positions.
        // Session 203 — also detect TP / SL bracket child orders for each
        // synthesized position. Bracket orders at most brokers appear as
        // separate SELL orders for the same ticker in a non-terminal state:
        //   • TAKE PROFIT  → LIMIT sell above the buy price
        //   • STOP LOSS    → STOP  sell below the buy price
        // Attaching these values to the synthesized position lets the Home
        // tab render the classic entry / TP / SL progress bar even when the
        // broker doesn't expose bracket linkage through the positions API.
        for (const [ticker, lots] of ledger.entries()) {
          let totalShares = 0;
          let totalCost = 0;
          for (const lot of lots) {
            totalShares += lot.shares;
            totalCost += lot.shares * lot.price;
          }
          if (totalShares <= 0.00001) continue;
          const avgPrice = totalCost / totalShares;
          // Best-effort bracket detection: look for pending SELL orders on
          // the SAME ticker in the SAME account.
          const bracketChildren = normalizedOrdersThisAccount.filter(
            (o) => o.ticker === ticker && o.action === 'SELL' && !o.isTerminal,
          );
          let takeProfit: number | null = null;
          let stopLoss: number | null = null;
          for (const child of bracketChildren) {
            if (child.orderType === 'LIMIT' && child.price && child.price > avgPrice) {
              takeProfit = child.price;
            } else if ((child.orderType === 'STOP' || child.orderType === 'STOP_LOSS') && (child.stopPrice ?? child.price) && (child.stopPrice ?? child.price)! < avgPrice) {
              stopLoss = child.stopPrice ?? child.price;
            }
          }
          const synthesized: any = {
            accountId: acc.id,
            connectionId,
            institutionName: institution,
            accountName: acc?.name ?? acc?.meta?.name ?? "",
            accountNumber: acc?.number ?? acc?.meta?.number ?? "",
            ticker,
            quantity: totalShares,
            averagePrice: avgPrice,
            currentPrice: avgPrice, // client-side stockService overlays live price
            marketValue: totalShares * avgPrice,
            currency: 'USD',
            takeProfit,
            stopLoss,
            synthesized: true,
          };
          acctPositions.push(synthesized);
          normalizedPositions.push(synthesized);
          positionsValue += totalShares * avgPrice;
          console.log(`[SnapTrade Sync] synthesized position from orders: ${ticker} qty=${totalShares} avg=${avgPrice} tp=${takeProfit} sl=${stopLoss} account=${acc.id}`);
        }
      }

      const rawConnType = String(connection?.type ?? '').toLowerCase().trim();
      const connectionType: 'read' | 'trade' | 'trade-if-available' | 'unknown' =
        rawConnType === 'trade' || rawConnType === 'trading' ? 'trade'
        : rawConnType === 'trade-if-available' || rawConnType === 'trade_if_available' ? 'trade-if-available'
        : rawConnType === 'read' || rawConnType === 'read_only' || rawConnType === 'read-only' ? 'read'
        : connection ? 'unknown' : 'unknown';
      const connectionAllowsTrading =
        connection?.allows_trading === true ||
        (connection?.allows_trading === undefined && connectionType === 'trade');

      normalizedAccounts.push({
        id: acc.id,
        name: acc?.name ?? acc?.meta?.name ?? "",
        number: acc?.number ?? acc?.meta?.number ?? "",
        institution_name: institution,
        brokerage_slug: connection?.brokerage?.slug ?? null,
        brokerage_authorization: connectionId,
        connection_type: connectionType,
        connection_allows_trading: connectionAllowsTrading,
        connection_disabled: connection?.disabled === true,
        connection_maintenance_mode:
          connection?.brokerage?.maintenance_mode === true ||
          connection?.maintenance_mode === true,
        connection_is_degraded:
          connection?.is_degraded === true ||
          connection?.brokerage?.is_degraded === true,
        trading_enabled: connectionType === 'trade' && connectionAllowsTrading && connection?.disabled !== true,
        account_category: category,
        status: acc?.status ?? acc?.meta?.status ?? null,
        currency: totalCurrency,
        total_market_value: totalValue,
        computed_value: positionsValue + cash,
        cash,
        positions_value: positionsValue,
        holdings_unavailable: holdingsUnavailable,
        sync_status: acc?.sync_status ?? null,
        is_paper: acc?.meta?.is_paper === true || acc?.is_paper === true,
        raw: acc,
      });
      balancesByAccount[acc.id] = per.balances;
    }

    logPositionsSummary(user.id, normalizedAccounts, normalizedPositions);
    console.log(
      `[SnapTrade Sync] normalized ${normalizedAccounts.length} account(s), ${normalizedPositions.length} position(s), ${normalizedActivities.length} activity/activities, ${normalizedOrders.length} order(s), ${normalizedPendingOrders.length} pending order(s)`,
    );

    // Determine overall connection status: needs_reconnect if any authorization is disabled.
    const anyDisabled = authorizations.some((a: any) => a?.disabled === true);
    const overallStatus = anyDisabled ? "needs_reconnect" : "active";

    const { error: upErr } = await admin
      .from("user_broker_connections")
      .update({
        accounts_snapshot: normalizedAccounts,
        positions_snapshot: normalizedPositions,
        balances_snapshot: balancesByAccount,
        activities_snapshot: normalizedActivities,
        pending_orders_snapshot: normalizedPendingOrders,
        last_synced_at: new Date().toISOString(),
        status: overallStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);
    if (upErr) return err(500, "DB_WRITE_FAILED", "Failed to store synchronized snapshot");

    console.log("[SnapTrade Sync] success — status", overallStatus);
    return json(200, {
      success: true,
      status: overallStatus,
      authorizations,
      accounts: normalizedAccounts,
      positions: normalizedPositions,
      balances: balancesByAccount,
      activities: normalizedActivities,
      pendingOrders: normalizedPendingOrders,
      orders: normalizedOrders,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[SnapTrade Sync] unhandled exception", msg);
    return err(500, "INTERNAL_ERROR", msg);
  }
});
