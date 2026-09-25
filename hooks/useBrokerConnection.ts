// useBrokerConnection — Session 200 (Historical Activities + Pending Orders)
// =============================================================================
// TradeSight consumes brokerage data through this hook. It honors SnapTrade's
// actual model:
//
//   TradeSight User
//     └── N Brokerage Connections
//           └── N Accounts (each with its own SnapTrade account_id)
//                 └── Positions (bound to their source account)
//                 └── Activities (historical BUY/SELL transactions)
//                 └── Pending Orders (unfilled orders, cancel-able)
//
// Guarantees:
//   • Portfolio value = SUM(account.total_market_value) across all eligible
//     INVESTMENT accounts. When SnapTrade provides `total` from the broker,
//     we use it verbatim (documented as the broker's authoritative account
//     total). If unavailable, we fall back to `positions_value + cash` for
//     that account only — never for the whole portfolio.
//   • DEPOSIT / LOC / LOAN accounts are excluded from the investment
//     portfolio unless the caller explicitly asks for them.
//   • Positions are NEVER merged across accounts. AAPL held in Account A
//     and AAPL held in Account B are exposed as two distinct entries with
//     accountId, institution, and account name preserved so the UI can
//     label them individually.
//   • `holdings_unavailable` accounts still contribute their broker total
//     to the portfolio value (per SnapTrade docs) but don't fabricate
//     positions when SnapTrade can't return them.
//   • Session 200: Pending orders are surfaced so the UI can show unfilled
//     BUY/SELL orders with a Cancel button, and historical activities are
//     surfaced so AppContext can auto-journal completed BUY→SELL round-
//     trips into the user's Journal.
//
// Currency handling: only accounts denominated in USD (or currency-less
// legacy accounts) contribute to the portfolio total. Non-USD accounts
// are flagged in `nonUsdAccounts` so the UI can warn the user rather
// than silently mixing FX.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/template';
import { useApp } from '../contexts/AppContext';
import { subscribeBrokerRefresh } from '../services/brokerConnectionBus';

const supabase = getSupabaseClient();

export type BrokerConnectionStatus =
  | 'active'
  | 'needs_reconnect'
  | 'disconnected'
  | 'pending_connection'
  | 'none';

export interface BrokerAccount {
  id: string;
  name?: string;
  number?: string;
  institution_name?: string;
  brokerage_slug?: string | null;
  brokerage_authorization?: string | null;
  connection_type?: 'read' | 'trade' | 'trade-if-available' | 'unknown';
  connection_allows_trading?: boolean;
  connection_disabled?: boolean;
  connection_maintenance_mode?: boolean;
  connection_is_degraded?: boolean;
  trading_enabled?: boolean;
  account_category?: 'INVESTMENT' | 'DEPOSIT' | 'LOC' | 'LOAN' | string;
  status?: string | null;
  currency?: string | null;
  total_market_value?: number | null;
  computed_value?: number | null;
  cash?: number;
  positions_value?: number;
  holdings_unavailable?: boolean;
  sync_status?: any;
  is_paper?: boolean;
}

export interface BrokerPosition {
  accountId: string;
  connectionId?: string | null;
  institutionName?: string;
  accountName?: string;
  accountNumber?: string;
  ticker: string;
  quantity: number;
  averagePrice?: number | null;
  currentPrice?: number | null;
  marketValue?: number | null;
  currency?: string | null;
  // Session 203 — take-profit / stop-loss surfaced from bracket child
  // orders when SnapTrade returns them on the same account. When present,
  // the client renders the entry → TP progress bar and SL line just like
  // it does for locally-placed trades. When absent (null), the client
  // falls back to a plain Active Trade card without the bracket UI.
  takeProfit?: number | null;
  stopLoss?: number | null;
}

// Session 200 — historical broker activity (transaction) row.
export interface BrokerActivity {
  id: string;
  accountId: string;
  institutionName?: string;
  type: string;
  side: 'BUY' | 'SELL' | null;
  ticker: string;
  quantity: number;
  price: number;
  amount: number;
  currency?: string | null;
  tradeDate?: string | null;
  settlementDate?: string | null;
  description?: string;
  fees?: number;
}

// Session 200 — pending or in-flight broker order (unfilled BUY/SELL).
export interface BrokerPendingOrder {
  id: string;
  brokerageOrderId: string;
  accountId: string;
  institutionName?: string;
  ticker: string;
  action: string;
  orderType: string;
  timeInForce?: string;
  totalQuantity: number;
  filledQuantity: number;
  openQuantity: number;
  canceledQuantity: number;
  price?: number | null;
  stopPrice?: number | null;
  executionPrice?: number | null;
  state: string;
  isPending: boolean;
  isPartiallyFilled: boolean;
  isFilled: boolean;
  isTerminal: boolean;
  timePlaced?: string | null;
  timeUpdated?: string | null;
  currency?: string | null;
}

export interface AccountView {
  account: BrokerAccount;
  positions: BrokerPosition[];
  cash: number;
  positionsValue: number;
  totalValue: number;      // authoritative total for this account
  currency: string;
  contributesToPortfolio: boolean;
}

export interface BrokerConnectionSummary {
  status: BrokerConnectionStatus;
  hasActiveConnection: boolean;
  isTransitioning: boolean;
  accountCount: number;
  investmentAccountCount: number;
  lastSyncedAt: string | null;

  // Raw
  accounts: BrokerAccount[];
  positions: BrokerPosition[];
  balancesByAccount: Record<string, any[]>;
  // Session 200
  activities: BrokerActivity[];
  pendingOrders: BrokerPendingOrder[];

  // Derived
  accountViews: AccountView[];      // rich per-account rollup
  investmentAccounts: BrokerAccount[];
  investmentAccountViews: AccountView[];
  positionsValue: number;
  cash: number;
  portfolioValue: number;
  brokerNames: string[];
  nonUsdAccounts: BrokerAccount[];  // accounts excluded due to non-USD currency

  syncing: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  sync: () => Promise<{ success: boolean; error?: string }>;

  // Helpers
  findAccount: (accountId: string) => BrokerAccount | undefined;
  positionsForAccount: (accountId: string) => BrokerPosition[];
  pendingOrdersForAccount: (accountId: string) => BrokerPendingOrder[];
  // Session 200 — cancel a pending broker order via snaptrade-cancel-order.
  cancelOrder: (accountId: string, brokerageOrderId: string) => Promise<{ success: boolean; error?: string }>;
}

// Currencies TradeSight aggregates today. Anything else is surfaced but
// excluded from the aggregate to avoid faking FX conversion.
const PORTFOLIO_CURRENCIES = new Set(['USD', 'usd', '', null]);

function isPortfolioCurrency(cur: string | null | undefined): boolean {
  if (cur === null || cur === undefined) return true;
  const s = String(cur).trim();
  return PORTFOLIO_CURRENCIES.has(s) || s.toUpperCase() === 'USD';
}

function isInvestmentAccount(acc: BrokerAccount): boolean {
  const cat = String(acc.account_category ?? 'INVESTMENT').toUpperCase();
  return cat === 'INVESTMENT' || cat === '' || cat === 'UNKNOWN';
}

// SAFE DEFAULT SUMMARY — returned when the AppContext has not yet resolved
// userId / isLoggedIn (very early in the render tree) so any consumer that
// destructures useBrokerConnection() during initial mount receives a
// fully-populated, non-undefined summary.
export function createSafeSummary(overrides?: Partial<BrokerConnectionSummary>): BrokerConnectionSummary {
  return {
    status: 'none',
    hasActiveConnection: false,
    isTransitioning: false,
    accountCount: 0,
    investmentAccountCount: 0,
    lastSyncedAt: null,
    accounts: [],
    positions: [],
    balancesByAccount: {},
    activities: [],
    pendingOrders: [],
    accountViews: [],
    investmentAccounts: [],
    investmentAccountViews: [],
    positionsValue: 0,
    cash: 0,
    portfolioValue: 0,
    brokerNames: [],
    nonUsdAccounts: [],
    syncing: false,
    loading: true,
    refresh: async () => {},
    sync: async () => ({ success: false, error: 'Broker context initializing' }),
    findAccount: () => undefined,
    positionsForAccount: () => [],
    pendingOrdersForAccount: () => [],
    cancelOrder: async () => ({ success: false, error: 'Broker context initializing' }),
    ...(overrides ?? {}),
  };
}

export function useBrokerConnection(): BrokerConnectionSummary {
  const { isLoggedIn, userId } = useApp();
  const [status, setStatus] = useState<BrokerConnectionStatus>('none');
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [positions, setPositions] = useState<BrokerPosition[]>([]);
  const [balancesByAccount, setBalancesByAccount] = useState<Record<string, any[]>>({});
  const [activities, setActivities] = useState<BrokerActivity[]>([]);
  const [pendingOrders, setPendingOrders] = useState<BrokerPendingOrder[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    if (!isLoggedIn) {
      setStatus('none'); setAccounts([]); setPositions([]); setBalancesByAccount({});
      setActivities([]); setPendingOrders([]); setLastSyncedAt(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase
        .from('user_broker_connections')
        .select('status, accounts_snapshot, positions_snapshot, balances_snapshot, activities_snapshot, pending_orders_snapshot, last_synced_at')
        .maybeSingle();
      if (!data) {
        setStatus('none'); setAccounts([]); setPositions([]); setBalancesByAccount({});
        setActivities([]); setPendingOrders([]); setLastSyncedAt(null);
        return;
      }
      const nextStatus = (data.status as BrokerConnectionStatus) ?? 'none';
      setStatus(nextStatus);
      setAccounts(Array.isArray(data.accounts_snapshot) ? (data.accounts_snapshot as BrokerAccount[]) : []);
      setPositions(Array.isArray(data.positions_snapshot) ? (data.positions_snapshot as BrokerPosition[]) : []);
      setBalancesByAccount(
        typeof data.balances_snapshot === 'object' && data.balances_snapshot
          ? (data.balances_snapshot as Record<string, any[]>)
          : {},
      );
      setActivities(Array.isArray(data.activities_snapshot) ? (data.activities_snapshot as BrokerActivity[]) : []);
      setPendingOrders(Array.isArray(data.pending_orders_snapshot) ? (data.pending_orders_snapshot as BrokerPendingOrder[]) : []);
      setLastSyncedAt((data.last_synced_at as string) ?? null);
    } catch {
      setStatus('none'); setAccounts([]); setPositions([]); setBalancesByAccount({});
      setActivities([]); setPendingOrders([]); setLastSyncedAt(null);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => { refresh(); }, [refresh, userId]);

  const sync = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!isLoggedIn) return { success: false, error: 'Not authenticated' };
    setSyncing(true);
    console.log('[SnapTrade Hook] sync requested');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return { success: false, error: 'Not authenticated' };
      const { data, error } = await supabase.functions.invoke('snaptrade-sync-accounts', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) {
        let msg = 'Sync failed';
        if (error instanceof FunctionsHttpError) {
          try {
            const txt = await (error as any).context?.text();
            if (txt) {
              try { const p = JSON.parse(txt); msg = p?.message ?? p?.error ?? msg; } catch { msg = txt.slice(0, 200); }
            }
          } catch {}
        } else if (typeof (error as any)?.message === 'string') {
          msg = (error as any).message;
        }
        return { success: false, error: msg };
      }
      if (data?.success === false) return { success: false, error: data.message ?? data.error ?? 'Sync failed' };
      const nextAccounts = Array.isArray(data?.accounts) ? (data.accounts as BrokerAccount[]) : [];
      const nextPositions = Array.isArray(data?.positions) ? (data.positions as BrokerPosition[]) : [];
      const nextBalances = (data?.balances ?? {}) as Record<string, any[]>;
      const nextActivities = Array.isArray(data?.activities) ? (data.activities as BrokerActivity[]) : [];
      const nextPendingOrders = Array.isArray(data?.pendingOrders) ? (data.pendingOrders as BrokerPendingOrder[]) : [];
      setAccounts(nextAccounts);
      // Preserve last-known positions on a transient empty response.
      if (nextPositions.length > 0 || nextAccounts.length === 0 || positions.length === 0) {
        setPositions(nextPositions);
      }
      setBalancesByAccount(nextBalances);
      setActivities(nextActivities);
      setPendingOrders(nextPendingOrders);
      setLastSyncedAt(data?.syncedAt ?? new Date().toISOString());
      const overall = data?.status as string | undefined;
      if (overall === 'needs_reconnect') setStatus('needs_reconnect');
      else if (nextAccounts.length > 0) setStatus('active');
      console.log(`[SnapTrade Hook] sync ok accounts=${nextAccounts.length} positions=${nextPositions.length} activities=${nextActivities.length} pendingOrders=${nextPendingOrders.length}`);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message ?? 'Sync failed' };
    } finally {
      setSyncing(false);
    }
  }, [isLoggedIn, positions.length]);

  // Periodic auto-refresh so broker positions, cash, and account totals
  // stay accurate throughout the trading day without the user having to
  // pull-to-refresh. Fires every 20 seconds while a brokerage is actively
  // connected, calling the SnapTrade sync every other cycle (40s) so
  // SnapTrade re-pulls fresh data from the broker (not just the cached
  // snapshot) — the same cadence as Session 198.
  useEffect(() => {
    if (!isLoggedIn) return;
    if (status !== 'active' || accounts.length === 0) return;
    let syncCounter = 0;
    const refreshInterval = setInterval(() => {
      refresh().catch(() => {});
      syncCounter += 1;
      if (syncCounter >= 2) {
        syncCounter = 0;
        sync().catch(() => {});
      }
    }, 20 * 1000);
    return () => clearInterval(refreshInterval);
  }, [isLoggedIn, status, accounts.length, refresh, sync]);

  // Subscribe to the broker refresh event bus so any triggerBrokerRefresh()
  // call (e.g. from AppContext when syncBrokerOrders detects a new fill,
  // or from connect-brokerage.tsx after a successful SnapTrade connection)
  // instantly re-reads the persisted snapshot AND fires a fresh sync call
  // so this hook's state updates INSTANTLY instead of waiting 20 seconds.
  useEffect(() => {
    if (!isLoggedIn) return;
    const unsub = subscribeBrokerRefresh(() => {
      refresh().catch(() => {});
      sync().catch(() => {});
    });
    return unsub;
  }, [isLoggedIn, refresh, sync]);

  // -------------------------------------------------------------------
  // Session 200 — cancel a pending broker order.
  //
  // Optimistically remove the order from local state so the UI updates
  // instantly. The next sync (typically <1s after the response) reads
  // the authoritative state from SnapTrade and confirms the removal.
  // If the SnapTrade call fails, we restore the order locally so the
  // UI accurately reflects that it's still pending at the broker.
  // -------------------------------------------------------------------
  const cancelOrder = useCallback(async (accountId: string, brokerageOrderId: string): Promise<{ success: boolean; error?: string }> => {
    if (!isLoggedIn) return { success: false, error: 'Not authenticated' };
    if (!accountId || !brokerageOrderId) return { success: false, error: 'Missing order details' };
    const prev = pendingOrders;
    setPendingOrders(prev.filter((o) => o.brokerageOrderId !== brokerageOrderId));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setPendingOrders(prev);
        return { success: false, error: 'Not authenticated' };
      }
      const { data, error } = await supabase.functions.invoke('snaptrade-cancel-order', {
        body: { accountId, brokerageOrderId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) {
        setPendingOrders(prev);
        let msg = 'Cancel failed';
        if (error instanceof FunctionsHttpError) {
          try {
            const txt = await (error as any).context?.text();
            if (txt) {
              try { const p = JSON.parse(txt); msg = p?.message ?? p?.error ?? msg; } catch { msg = txt.slice(0, 200); }
            }
          } catch {}
        } else if (typeof (error as any)?.message === 'string') {
          msg = (error as any).message;
        }
        return { success: false, error: msg };
      }
      if (data?.success === false) {
        setPendingOrders(prev);
        return { success: false, error: data.message ?? data.error ?? 'Cancel failed' };
      }
      // Force an immediate sync so the authoritative order state comes
      // back from SnapTrade — this also updates the DB snapshot.
      sync().catch(() => {});
      return { success: true };
    } catch (e: any) {
      setPendingOrders(prev);
      return { success: false, error: e?.message ?? 'Cancel failed' };
    }
  }, [isLoggedIn, pendingOrders, sync]);

  // -------------------------------------------------------------------
  // Build per-account views and aggregate portfolio value.
  // -------------------------------------------------------------------
  const {
    accountViews,
    investmentAccounts,
    investmentAccountViews,
    portfolioValue,
    positionsValue,
    cash,
    brokerNames,
    nonUsdAccounts,
  } = useMemo(() => {
    const positionsByAccount = new Map<string, BrokerPosition[]>();
    for (const p of positions) {
      const key = p.accountId ?? '';
      if (!key) continue;
      const list = positionsByAccount.get(key) ?? [];
      list.push(p);
      positionsByAccount.set(key, list);
    }

    const views: AccountView[] = accounts.map((acc) => {
      const acctPositions = positionsByAccount.get(acc.id) ?? [];
      let posValue = 0;
      for (const p of acctPositions) {
        if (typeof p.marketValue === 'number' && Number.isFinite(p.marketValue)) {
          posValue += p.marketValue;
        } else {
          const q = Math.abs(Number(p.quantity) || 0);
          const px = Number(p.currentPrice) || 0;
          if (q > 0 && px > 0) posValue += q * px;
        }
      }
      const cashAmt = typeof acc.cash === 'number' && Number.isFinite(acc.cash) ? acc.cash : 0;
      const authoritativeTotal =
        (typeof acc.total_market_value === 'number' && Number.isFinite(acc.total_market_value) && acc.total_market_value > 0)
          ? acc.total_market_value
          : (typeof acc.computed_value === 'number' && Number.isFinite(acc.computed_value)
              ? acc.computed_value
              : posValue + cashAmt);
      const cur = (acc.currency ?? 'USD').toString().toUpperCase();
      const investment = isInvestmentAccount(acc);
      const usable = investment && isPortfolioCurrency(cur);
      return {
        account: acc,
        positions: acctPositions,
        cash: cashAmt,
        positionsValue: posValue,
        totalValue: authoritativeTotal,
        currency: cur,
        contributesToPortfolio: usable,
      };
    });

    const invAccounts = accounts.filter(isInvestmentAccount);
    const invViews = views.filter((v) => isInvestmentAccount(v.account));

    let totalValue = 0;
    let totalPositions = 0;
    let totalCash = 0;
    for (const v of views) {
      if (!v.contributesToPortfolio) continue;
      totalValue += v.totalValue;
      totalPositions += v.positionsValue;
      totalCash += v.cash;
    }

    const names = Array.from(new Set(accounts.map((a) => a.institution_name).filter(Boolean) as string[]));
    const nonUsd = accounts.filter((a) => !isPortfolioCurrency(a.currency));

    return {
      accountViews: views,
      investmentAccounts: invAccounts,
      investmentAccountViews: invViews,
      portfolioValue: totalValue,
      positionsValue: totalPositions,
      cash: totalCash,
      brokerNames: names,
      nonUsdAccounts: nonUsd,
    };
  }, [accounts, positions]);

  const findAccount = useCallback((accountId: string) => accounts.find((a) => a.id === accountId), [accounts]);
  const positionsForAccount = useCallback(
    (accountId: string) => positions.filter((p) => p.accountId === accountId),
    [positions],
  );
  const pendingOrdersForAccount = useCallback(
    (accountId: string) => pendingOrders.filter((o) => o.accountId === accountId),
    [pendingOrders],
  );

  return {
    status,
    accountCount: accounts.length,
    investmentAccountCount: investmentAccounts.length,
    lastSyncedAt,
    accounts,
    positions,
    balancesByAccount,
    activities,
    pendingOrders,
    accountViews,
    investmentAccounts,
    investmentAccountViews,
    positionsValue,
    cash,
    portfolioValue,
    brokerNames,
    nonUsdAccounts,
    hasActiveConnection: status === 'active' && accounts.length > 0,
    isTransitioning: status === 'pending_connection' && accounts.length === 0,
    loading,
    syncing,
    refresh,
    sync,
    findAccount,
    positionsForAccount,
    pendingOrdersForAccount,
    cancelOrder,
  };
}
