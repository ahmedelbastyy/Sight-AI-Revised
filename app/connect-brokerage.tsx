
// Connect Brokerage — Session 128 (in-app WebView rebuild)
// =============================================================================
// The user does NOT want the SFSafariViewController-style sliding sheet that
// expo-web-browser presents. They want the SnapTrade Connection Portal to
// feel like it lives INSIDE TradeSight — full-screen, no TradeSight header,
// no external Safari popup — exactly what the previous WebView-based
// implementation did, minus the TradeSight chrome that used to sit above it.
//
// Flow:
//   1. Tap Connect Brokerage → snaptrade-connect returns a fresh redirectURI.
//   2. We open that URI in a full-screen react-native-webview Modal.
//   3. WebView.onShouldStartLoadWithRequest catches SnapTrade's redirect back
//      to onspaceapp://snaptrade?status=…&connection_id=…, returns false so
//      the WebView doesn't try to load the custom scheme, and hands the URL
//      to our callback handler.
//   4. On SUCCESS → close modal → set phase='syncing' → invoke
//      snaptrade-sync-accounts → flip to 'connected' with real data.
//      On ERROR → surface actual SnapTrade error_code + status_code.
//
// The only chrome we render over the SnapTrade portal is a tiny circular ×
// button in the top-right corner as an escape hatch — NOT a bar, NOT a
// TradeSight header. SnapTrade's own portal owns the visual experience.
//
// SECURITY: no SnapTrade credentials in the client — the mobile app only ever
// sees an ephemeral redirectURI plus normalized snapshots returned by our
// Edge Functions.
// =============================================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal,
  Platform, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useApp } from '../contexts/AppContext';
import { getSupabaseClient, useAlert } from '@/template';
import { triggerBrokerRefresh } from '../services/brokerConnectionBus';

const supabase = getSupabaseClient();

// Deep-link that SnapTrade redirects to when the Connection Portal finishes.
// MUST match:
//   • the customRedirect our backend sends to snaptrade-connect
//   • the "scheme" declared in app.json
const REDIRECT_SCHEME = 'onspaceapp://snaptrade';

// ---------------------------------------------------------------------------
// Callback parsing — deliberately avoids URLSearchParams because it's
// unreliable on React Native. We read the query string manually.
// ---------------------------------------------------------------------------
function parseCallbackParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q = url.split('?')[1]?.split('#')[0] ?? '';
  if (!q) return out;
  for (const part of q.split('&')) {
    const [rawKey, ...rest] = part.split('=');
    if (!rawKey) continue;
    try {
      out[decodeURIComponent(rawKey.replace(/\+/g, ' '))] = decodeURIComponent(rest.join('=').replace(/\+/g, ' '));
    } catch { /* ignore malformed segment */ }
  }
  return out;
}

function isSnapTradeCallback(url: string): boolean {
  return url.startsWith(REDIRECT_SCHEME) || url.startsWith('onspaceapp://snaptrade-callback');
}

interface EdgeErrorInfo {
  message: string; code?: string;
  snapTradeCode?: string | number; snapTradeStatus?: number;
  raw?: any;
}
async function extractEdgeErrorInfo(error: unknown, fallback: string): Promise<EdgeErrorInfo> {
  try {
    if (error instanceof FunctionsHttpError) {
      const status = (error as any).context?.status;
      let bodyText = '';
      try { bodyText = await (error as any).context.text(); } catch {}
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText);
          const msg = parsed?.message ?? parsed?.error ?? parsed?.detail;
          return {
            message: typeof msg === 'string' && msg.length > 0 ? msg : (status ? `${fallback} (HTTP ${status})` : fallback),
            code: parsed?.error,
            snapTradeCode: parsed?.snapTradeCode,
            snapTradeStatus: parsed?.snapTradeStatus,
            raw: parsed,
          };
        } catch { return { message: bodyText.slice(0, 300) }; }
      }
      return { message: status ? `${fallback} (HTTP ${status})` : fallback };
    }
    if (error && typeof error === 'object' && 'message' in (error as any)) {
      const m = (error as any).message;
      if (typeof m === 'string' && m.length > 0 && !m.includes('non-2xx')) return { message: m };
    }
  } catch {}
  return { message: fallback };
}

interface BrokerAccount {
  id: string;
  name?: string;
  number?: string;
  institution_name?: string;
  status?: string;
  sync_status?: any;
}
interface BrokerPosition {
  ticker: string;
  quantity: number;
  averagePrice?: number | null;
  currentPrice?: number | null;
  accountId: string;
  currency?: string | null;
}
interface BrokerAuthorization {
  id: string;
  brokerage?: { name?: string; slug?: string; display_name?: string };
  name?: string;
  disabled?: boolean;
}

type Phase =
  | 'loading'          // reading persisted state
  | 'not_connected'    // no broker linked
  | 'preparing'        // requesting portal URL from backend
  | 'portal_open'      // WebView modal is visible
  | 'syncing'          // portal returned SUCCESS, pulling accounts/positions
  | 'connected'        // done — real broker data is displayed
  | 'needs_reconnect'  // broker authorization expired
  | 'error';           // fatal error the user must acknowledge

// Session 173 — doSync now returns the fully-normalized sync result so
// downstream callers (handlePortalCallback in particular) can use the
// freshly-synced accounts / positions / balances / authorizations WITHOUT
// performing another Supabase round-trip for the same data.
interface SyncResult {
  success: boolean;
  accounts: BrokerAccount[];
  positions: BrokerPosition[];
  authorizations: BrokerAuthorization[];
  balances: Record<string, any[]>;
  status?: string;
  error?: string;
}

// __DEV__-only perf logging helper. Timestamps every stage of the
// onboarding broker-connection flow so we can measure it end-to-end.
function perfLog(tag: string, ...args: any[]) {
  if (__DEV__) console.log('[perf brokerage]', performance.now().toFixed(0), 'ms', tag, ...args);
}

export default function ConnectBrokerageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const { currentTheme: t, isLoggedIn, isSubscribed } = useApp();
  // Session 133 — onboarding flag. When the paywall routes here after a
  // fresh purchase, the URL is /connect-brokerage?onboarding=1. In that
  // mode we show a Skip for now button (instead of the X back button) that
  // sends the user straight into Home. Otherwise, this screen behaves as
  // the normal Settings > Brokerage screen with a back button.
  const params = useLocalSearchParams<{ onboarding?: string; autoOpen?: string }>();
  const isOnboarding = params.onboarding === '1';
  // Session 141 — the brokerage screen is now ONLY reachable via explicit
  // ?autoOpen=1 (from Put in Trade / Settings when the user asked to
  // connect). When autoOpen is set AND the user has no active connection
  // we render a plain black loader while the portal URL is being fetched
  // — no "Link Your Broker" card flashes before the SnapTrade WebView
  // opens. When the user IS connected, this screen shows account details
  // (the "connected" hero) and does not auto-open anything.
  const autoOpenFlag = params.autoOpen === '1';
  const autoOpenAttemptedRef = useRef(false);
  // Session 142 — when the user reached this screen via ?autoOpen=1
  // (from Put in Trade, from the paywall, or any other auto-open path),
  // as soon as SnapTrade reports a successful connection we route them
  // straight back into the app (/(tabs)) so they land on the stock list.
  // The brokerage details screen is only shown when the user explicitly
  // taps Connect Brokerage in Settings (no autoOpen flag).
  const autoReturnFiredRef = useRef(false);

  // Core state
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [positions, setPositions] = useState<BrokerPosition[]>([]);
  const [authorizations, setAuthorizations] = useState<BrokerAuthorization[]>([]);
  const [balancesByAccount, setBalancesByAccount] = useState<Record<string, any[]>>({});
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  // Portal / WebView state
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const callbackHandledRef = useRef(false); // guard against duplicate onShouldStartLoadWithRequest fires

  // Session 194 — SnapTrade connection URL PREFETCH refs. When the user
  // arrives on this screen without a connected broker, we speculatively
  // fetch a portal URL in the background so the SnapTrade WebView can
  // open INSTANTLY when they tap Connect Brokerage. See the effect below
  // that triggers the prefetch and the doConnect() branch that consumes
  // it. SnapTrade login URLs are valid for ~15–30 minutes; we treat any
  // URL older than 10 min as stale to stay safely under that window.
  const prefetchPromiseRef = useRef<Promise<string | null> | null>(null);
  const prefetchedUrlRef = useRef<{ url: string; at: number } | null>(null);
  const prefetchTriggeredRef = useRef(false);

  // Diagnostic modal state
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResult, setDiagResult] = useState<{ checks: Record<string, any>; conclusion: string; nextAction: string } | null>(null);

  // -------------------------------------------------------------------
  // Session 152 — safe exit from autoOpen flows. The paywall reaches
  // this screen via router.replace(), so router.back() no-ops during
  // onboarding and strands the user on the "Opening secure brokerage
  // link…" loader when they close the SnapTrade portal without linking
  // an account. During onboarding we route to /welcome (matching the
  // "Skip for now" button); otherwise we fall back to /(tabs) whenever
  // the history stack is empty.
  // -------------------------------------------------------------------
  const exitAutoOpenScreen = useCallback(() => {
    try {
      if (isOnboarding) {
        router.replace('/welcome' as any);
        return;
      }
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace('/(tabs)' as any);
    } catch {
      try { router.replace('/(tabs)' as any); } catch { /* swallow */ }
    }
  }, [isOnboarding, router]);

  // -------------------------------------------------------------------
  // Load persisted connection snapshot on mount so the UI is instant.
  // -------------------------------------------------------------------
  const loadConnection = useCallback(async () => {
    if (!isLoggedIn) { setPhase('not_connected'); return; }
    setPhase('loading');
    console.log('[SnapTrade Client] loading persisted connection…');
    try {
      const { data } = await supabase
        .from('user_broker_connections')
        .select('status, accounts_snapshot, positions_snapshot, balances_snapshot, last_synced_at')
        .maybeSingle();
      if (!data) {
        console.log('[SnapTrade Client] no persisted connection');
        setPhase('not_connected');
        setAccounts([]); setPositions([]); setAuthorizations([]); setBalancesByAccount({});
        return;
      }
      const status = data.status as string;
      const nextAccounts = Array.isArray(data.accounts_snapshot) ? data.accounts_snapshot : [];
      const nextPositions = Array.isArray(data.positions_snapshot) ? data.positions_snapshot : [];
      setAccounts(nextAccounts);
      setPositions(nextPositions);
      setBalancesByAccount(typeof data.balances_snapshot === 'object' && data.balances_snapshot ? data.balances_snapshot : {});
      setLastSynced(data.last_synced_at ?? null);
      console.log(`[SnapTrade Client] loaded status=${status} accounts=${nextAccounts.length} positions=${nextPositions.length}`);
      if (status === 'active') setPhase('connected');
      else if (status === 'needs_reconnect') setPhase('needs_reconnect');
      else if (status === 'pending_connection' || status === 'disconnected') setPhase('not_connected');
      else setPhase(nextAccounts.length > 0 ? 'connected' : 'not_connected');
    } catch (e: any) {
      console.log('[SnapTrade Client] load error', e?.message ?? e);
      setPhase('not_connected');
    }
  }, [isLoggedIn]);

  useEffect(() => { loadConnection(); }, [loadConnection]);

  // -------------------------------------------------------------------
  // Sync — pulls latest accounts/positions/balances from SnapTrade.
  // The single centralized sync path — everything (connect success,
  // Refresh button, hook consumers) routes through this.
  // -------------------------------------------------------------------
  const doSync = useCallback(async (): Promise<SyncResult> => {
    perfLog('sync-start');
    console.log('[SnapTrade Client] sync started');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');
      const { data, error } = await supabase.functions.invoke('snaptrade-sync-accounts', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) {
        const info = await extractEdgeErrorInfo(error, 'Sync failed');
        throw new Error(info.message);
      }
      if (data?.success === false) throw new Error(data.message ?? data.error ?? 'Sync failed');

      const nextAccounts: BrokerAccount[] = Array.isArray(data?.accounts) ? data.accounts : [];
      const nextPositions: BrokerPosition[] = Array.isArray(data?.positions) ? data.positions : [];
      const nextAuths: BrokerAuthorization[] = Array.isArray(data?.authorizations) ? data.authorizations : [];
      const nextBalances: Record<string, any[]> = data?.balances ?? {};

      // Never wipe positions to empty on a transient partial sync. If SnapTrade
      // returned zero positions AND zero accounts but we previously had some,
      // keep the last-known snapshot so active positions don't briefly
      // disappear during a network glitch.
      const hasAnyPayload = nextAccounts.length > 0 || nextPositions.length > 0;
      if (hasAnyPayload || (nextAccounts.length === 0 && positions.length === 0)) {
        setAccounts(nextAccounts);
        setPositions(nextPositions);
        setBalancesByAccount(nextBalances);
      } else {
        setAccounts(nextAccounts);
      }
      setAuthorizations(nextAuths);
      setLastSynced(data?.syncedAt ?? new Date().toISOString());
      const overall = data?.status as string | undefined;
      // Session 148 — a brokerage is only considered CONNECTED when the sync
      // returned at least one actual account. If SnapTrade returns zero
      // accounts (e.g. user exited the portal without linking anything, or
      // linked an unsupported broker), the app must NOT flip to 'connected'.
      if (overall === 'needs_reconnect') {
        setPhase('needs_reconnect');
      } else if (nextAccounts.length > 0) {
        setPhase('connected');
      } else {
        setPhase('not_connected');
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      perfLog('sync-ok', { accounts: nextAccounts.length, positions: nextPositions.length });
      console.log(`[SnapTrade Client] sync ok accounts=${nextAccounts.length} positions=${nextPositions.length}`);
      // Session 164 — INSTANT broker-state fan-out to every consumer of
      // useBrokerConnection. Fires triggerBrokerRefresh() so Portfolio Value,
      // Active Trades, and every other broker-derived UI element updates
      // instantly — no waiting for the hook's 60-second polling interval.
      try { triggerBrokerRefresh(); } catch { /* swallow */ }
      // Session 173 — return the normalized sync payload so callers can use
      // the fresh data without another DB round-trip.
      return {
        success: nextAccounts.length > 0,
        accounts: nextAccounts,
        positions: nextPositions,
        authorizations: nextAuths,
        balances: nextBalances,
        status: overall,
      };
    } catch (e: any) {
      console.log('[SnapTrade Client] sync failed', e?.message ?? e);
      setErrorMessage(e.message ?? 'Unable to sync brokerage.');
      setPhase(accounts.length > 0 ? 'connected' : 'error');
      return {
        success: false,
        accounts: [],
        positions: [],
        authorizations: [],
        balances: {},
        error: e.message ?? 'Sync failed',
      };
    }
  }, [positions.length, accounts.length]);

  const refreshData = useCallback(async () => {
    setPhase('syncing');
    Haptics.selectionAsync();
    // Session 173 — doSync now returns a SyncResult; we don't need the
    // return value here so we simply await.
    await doSync();
  }, [doSync]);

  // -------------------------------------------------------------------
  // Diagnostic — proves which step of the auth chain is failing.
  // -------------------------------------------------------------------
  const runDiagnostic = useCallback(async () => {
    setDiagRunning(true);
    Haptics.selectionAsync();
    console.log('[SnapTrade Client] running diagnostic');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');
      const { data, error } = await supabase.functions.invoke('snaptrade-diagnostic', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) {
        const info = await extractEdgeErrorInfo(error, 'Diagnostic failed');
        showAlert('Diagnostic Failed', info.message);
        return;
      }
      setDiagResult({
        checks: data?.checks ?? {},
        conclusion: data?.conclusion ?? 'No conclusion returned.',
        nextAction: data?.nextAction ?? 'none',
      });
    } catch (e: any) {
      showAlert('Diagnostic Failed', e.message ?? 'Unable to run diagnostic.');
    } finally {
      setDiagRunning(false);
    }
  }, [showAlert]);

  // -------------------------------------------------------------------
  // Session 194 — SnapTrade connection URL PREFETCH. Speculatively
  // generates a SnapTrade login URL in the background while the user is
  // still reading the Connect Brokerage screen. When they eventually tap
  // Connect Brokerage, doConnect() consumes this cached URL and opens
  // the WebView Modal INSTANTLY — no ~500-1000ms round-trip wait for the
  // edge function to authenticate, look up the user, and hit SnapTrade.
  //
  // Called by two paths:
  //   1. The prefetch trigger useEffect below (fires once on mount for
  //      `not_connected` state, non-autoOpen, subscribed, logged in).
  //   2. doConnect's fallback branch — if a prefetch is already in flight
  //      when the user taps, we await IT instead of starting a duplicate
  //      edge-function call. Guarantees one active connection-link
  //      request per tap, no matter how many rapid taps happen.
  //
  // Uses the same authenticated snaptrade-connect edge function as the
  // normal flow, so security is unchanged (JWT-authenticated, secrets
  // stay server-side, correct-user isolation preserved).
  // -------------------------------------------------------------------
  const prefetchConnectionUrl = useCallback(async (): Promise<string | null> => {
    if (prefetchPromiseRef.current) return prefetchPromiseRef.current;
    const promise = (async () => {
      try {
        perfLog('PREFETCH_STARTED');
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return null;
        const { data, error } = await supabase.functions.invoke('snaptrade-connect', {
          body: {
            customRedirect: REDIRECT_SCHEME,
            forceReset: false,
            replaceExisting: false,
            connectionType: 'trade-if-available',
          },
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (error || (data && data.success === false)) {
          perfLog('PREFETCH_FAILED');
          return null;
        }
        const uri: string | undefined = data?.redirectURI ?? data?.redirectUri;
        if (typeof uri !== 'string' || !uri) return null;
        prefetchedUrlRef.current = { url: uri, at: Date.now() };
        perfLog('PREFETCH_READY');
        return uri;
      } catch {
        perfLog('PREFETCH_FAILED');
        return null;
      } finally {
        prefetchPromiseRef.current = null;
      }
    })();
    prefetchPromiseRef.current = promise;
    return promise;
  }, []);

  // -------------------------------------------------------------------
  // Portal callback processing — called from the WebView when SnapTrade
  // redirects to our deep-link scheme. Idempotent via callbackHandledRef.
  // -------------------------------------------------------------------
  const handlePortalCallback = useCallback(async (callbackUrl: string) => {
    if (callbackHandledRef.current) return;
    callbackHandledRef.current = true;
    perfLog('CONNECTION_CALLBACK');
    console.log('[SnapTrade Client] callback received', callbackUrl.slice(0, 120));

    const params = parseCallbackParams(callbackUrl);
    const status = (params.status ?? '').toUpperCase();
    const connectionId = params.connection_id ?? params.connectionId ?? null;
    const errorCode = params.error_code ?? params.errorCode ?? null;
    const statusCode = params.status_code ?? params.statusCode ?? null;
    console.log('[SnapTrade Client] parsed', { status, connectionId, errorCode, statusCode });

    // Close the WebView modal first — user should never see it lingering
    // after SnapTrade finishes.
    setPortalUrl(null);

    if (status === 'ERROR' || errorCode) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const suffix = errorCode ? ` [code ${errorCode}${statusCode ? `, HTTP ${statusCode}` : ''}]` : '';
      // Session 136 — user closed the portal without a successful connection.
      // Do NOT flip any connected/pending state. Return to not_connected so
      // Sight cannot mistakenly show the user as connected.
      setPhase('not_connected');
      setAccounts([]); setPositions([]); setAuthorizations([]); setBalancesByAccount({});
      setErrorMessage(`SnapTrade reported an error${suffix}.`);
      // Session 151 — in autoOpen flows, don't strand the user on the
      // "Opening secure brokerage link..." loader. Route them back to the
      // originating screen so they can retry or continue.
      if (autoOpenFlag) {
        showAlert('Brokerage Connection Cancelled', `The brokerage connection did not complete${suffix}.`);
        exitAutoOpenScreen();
        return;
      }
      showAlert(
        'Brokerage Connection Failed',
        `SnapTrade returned an error${suffix}.\n\nRun a diagnostic to see exactly where the flow failed.`,
        [
          { text: 'OK', style: 'cancel' },
          { text: 'Run Diagnostic', onPress: () => runDiagnostic() },
        ],
      );
      return;
    }

    if (status !== 'SUCCESS') {
      // Some brokerages redirect without an explicit status. Treat any
      // non-error callback as an attempt to sync — the sync itself will
      // reveal whether a connection was actually established.
      console.log('[SnapTrade Client] non-SUCCESS callback, attempting sync anyway');
    }

    // Session 148/151 — only proceed with sync if SnapTrade explicitly
    // reported SUCCESS. When the user cancels the portal (no status param)
    // we must NOT treat that as a successful connection, AND we must not
    // leave them stuck on the "Opening secure brokerage link" loader in
    // autoOpen flows — route back so they land where they came from.
    if (status !== 'SUCCESS') {
      setPhase('not_connected');
      setAccounts([]); setPositions([]); setAuthorizations([]); setBalancesByAccount({});
      if (autoOpenFlag) {
        exitAutoOpenScreen();
      }
      return;
    }

    // SUCCESS — clear any residual state from a previous brokerage BEFORE
    // syncing so the UI cannot show stale accounts / positions / portfolio
    // value during the transition to the new broker.
    setAccounts([]);
    setPositions([]);
    setAuthorizations([]);
    setBalancesByAccount({});
    setLastSynced(null);
    setPhase('syncing');
    perfLog('portal-success-callback');
    const syncResult = await doSync();
    if (!syncResult.success) {
      // Session 148 — no accounts came back. Treat as NOT connected rather
      // than showing a false-positive "connected" state.
      setPhase('not_connected');
      setAccounts([]); setPositions([]); setAuthorizations([]); setBalancesByAccount({});
      showAlert(
        'No Accounts Linked',
        'No brokerage accounts were linked. If you closed the SnapTrade window without selecting a broker, please try again.',
      );
    } else {
      // Session 173 — read-only detection now uses the JUST-RETURNED
      // accounts data from doSync() instead of performing a redundant
      // Supabase round-trip for the same information. Removes ~150-400ms
      // of latency after a successful connection.
      try {
        const linkedAccounts: any[] = syncResult.accounts;
        const readOnlyAccounts = linkedAccounts.filter((a: any) => {
          const type = String(a?.connection_type ?? 'unknown').toLowerCase();
          const allowsTrading = a?.connection_allows_trading === true;
          return type === 'read' || (!allowsTrading && type !== 'trade');
        });
        if (readOnlyAccounts.length > 0 && linkedAccounts.length > 0) {
          const brokerName = readOnlyAccounts[0]?.institution_name ?? 'This brokerage';
          const msg = readOnlyAccounts.length === linkedAccounts.length
            ? `${brokerName} connected in READ-ONLY mode. You can view your portfolio and account information, but this brokerage does not allow Sight to place trades for this account.`
            : `Some of your linked accounts are READ-ONLY. You can view their portfolio and account information, but Sight cannot place trades for those accounts.`;
          showAlert('Read-Only Connection', msg);
        }
      } catch { /* swallow */ }
    }
  }, [showAlert, runDiagnostic, doSync, autoOpenFlag, exitAutoOpenScreen])

  // -------------------------------------------------------------------
  // Connect flow: backend → portal URL → open in-app WebView modal.
  // -------------------------------------------------------------------
  const doConnect = useCallback(async (forceReset: boolean, replaceExisting: boolean = false, reconnectAuthorizationId?: string, connectionType: 'trade' | 'trade-if-available' | 'read' = 'trade-if-available') => {
    perfLog('CONNECT_TAP', { forceReset, replaceExisting, hasReconnect: !!reconnectAuthorizationId, connectionType });
    setErrorMessage(null);
    callbackHandledRef.current = false;
    Haptics.selectionAsync();
    // Broker-switch: immediately wipe local state so the previous broker's
    // accounts/positions/balances cannot render in the UI while the new
    // portal is open or the new brokerage is syncing.
    if (replaceExisting) {
      setAccounts([]);
      setPositions([]);
      setAuthorizations([]);
      setBalancesByAccount({});
      setLastSynced(null);
    }
    // Session 194 — SPEED PATH: consume the prefetched SnapTrade portal
    // URL when one is available for this exact tap shape. Only reused
    // for a plain Connect Brokerage tap (no reset, no broker-switch, no
    // read-only-upgrade reconnect) so every code path that requires
    // side-effects at the edge function (credential reset, snapshot
    // wipe, reconnect targeting) still goes through the normal flow.
    const canUsePrefetch = !forceReset && !replaceExisting && !reconnectAuthorizationId && connectionType === 'trade-if-available';
    if (canUsePrefetch) {
      const cached = prefetchedUrlRef.current;
      const isCacheFresh = !!cached && (Date.now() - cached.at) < 10 * 60 * 1000;
      if (cached && isCacheFresh) {
        perfLog('CONNECT_USING_PREFETCHED_URL');
        prefetchedUrlRef.current = null; // consume — single-use
        setPortalUrl(cached.url);
        setPhase('portal_open');
        return;
      }
      // If a prefetch is currently in flight, await it — faster than
      // starting a duplicate identical edge-function call from scratch.
      // Also gives the user immediate loading feedback while it lands.
      if (prefetchPromiseRef.current) {
        perfLog('CONNECT_AWAITING_INFLIGHT_PREFETCH');
        setPhase('preparing');
        try {
          const url = await prefetchPromiseRef.current;
          if (typeof url === 'string' && url) {
            prefetchedUrlRef.current = null;
            perfLog('CONNECT_PREFETCH_LANDED');
            setPortalUrl(url);
            setPhase('portal_open');
            return;
          }
        } catch { /* fall through to normal flow */ }
      }
    }
    setPhase('preparing');
    console.log(`[SnapTrade Client] connect forceReset=${forceReset} replaceExisting=${replaceExisting} reconnect=${reconnectAuthorizationId ?? 'no'} type=${connectionType}`);
    try {
      perfLog('LINK_REQUEST_STARTED');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('snaptrade-connect', {
        body: { customRedirect: REDIRECT_SCHEME, forceReset, replaceExisting, reconnectAuthorizationId, connectionType },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      perfLog('LINK_RESPONSE_RECEIVED', { hasError: !!error, success: data?.success !== false });
      if (error) {
        const info = await extractEdgeErrorInfo(error, 'Failed to start brokerage connection');
        const suffix = info.snapTradeCode ? ` [SnapTrade code ${info.snapTradeCode}]` : (info.code ? ` [${info.code}]` : '');
        const detailed = `${info.message}${suffix}`;
        console.log('[SnapTrade Client] connect failed', detailed);
        const authLike =
          info.code === 'SNAPTRADE_LOGIN_FAILED' ||
          info.code === 'SNAPTRADE_REGISTER_FAILED' ||
          String(info.snapTradeCode ?? '') === '1076' ||
          String(info.snapTradeCode ?? '') === '1083' ||
          String(info.snapTradeCode ?? '') === '0000';
        setPhase('not_connected');
        // Session 150 — in autoOpen mode, when the portal request fails we
        // must NOT strand the user on the plain full-screen loader. Route
        // them back to where they came from so they can retry or explore
        // the rest of the app.
        if (autoOpenFlag) {
          showAlert('Brokerage Unavailable', detailed);
          exitAutoOpenScreen();
          return;
        }
        if (authLike && !forceReset) {
          // Session 198 — SnapTrade error code 1083 ("Invalid clientId
          // provided") means the SNAPTRADE_CLIENT_ID configured in the
          // OnSpace Cloud secrets is not recognized by SnapTrade's
          // servers. This is a SERVER-SIDE credential mismatch, NOT a
          // client-side reset issue — forcing a user reset will not
          // help. When we detect 1083 specifically, present a clearer
          // message pointing operators at the configuration.
          if (String(info.snapTradeCode ?? '') === '1083') {
            showAlert(
              'SnapTrade Configuration Issue',
              `${detailed}\n\nThis clientId is not recognized by SnapTrade. The SNAPTRADE_CLIENT_ID stored in the OnSpace Cloud secrets does not match a valid registered SnapTrade partner. Please verify the exact clientId value in the SnapTrade dashboard and update the secret — no user action can fix this.`,
              [
                { text: 'OK', style: 'cancel' },
                { text: 'Run Diagnostic', onPress: () => runDiagnostic() },
              ],
            );
          } else {
            showAlert('Connection Failed', `${detailed}\n\nThis usually means the stored SnapTrade credentials are out of sync. Reset them and try again?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Run Diagnostic', onPress: () => runDiagnostic() },
              { text: 'Reset & Retry', style: 'destructive', onPress: () => doConnect(true) },
            ]);
          }
        } else {
          showAlert('Connection Failed', `${detailed}\n\nRun a diagnostic to see exactly which step failed.`, [
            { text: 'OK', style: 'cancel' },
            { text: 'Run Diagnostic', onPress: () => runDiagnostic() },
          ]);
        }
        return;
      }
      if (data?.success === false) {
        const suffix = data.snapTradeCode ? ` [SnapTrade code ${data.snapTradeCode}]` : '';
        setPhase('not_connected');
        if (autoOpenFlag) {
          showAlert('Brokerage Unavailable', `${data.message ?? data.error ?? 'Unknown error'}${suffix}`);
          exitAutoOpenScreen();
          return;
        }
        showAlert('Connection Failed', `${data.message ?? data.error ?? 'Unknown error'}${suffix}`);
        return;
      }
      const uri: string | undefined = data?.redirectURI ?? data?.redirectUri;
      if (!uri) throw new Error('SnapTrade did not return a login URL');
      console.log('[SnapTrade Client] portal URL received, opening WebView');

      // Open the SnapTrade Connection Portal in an in-app full-screen WebView.
      // The Modal presentation gives us the "lives inside the app" feel the
      // user asked for — no external Safari, no TradeSight chrome above it.
      setPortalUrl(uri);
      setPhase('portal_open');
    } catch (e: any) {
      console.log('[SnapTrade Client] connect exception', e?.message ?? e);
      setPhase('not_connected');
      // Session 150 — same autoOpen rescue as above for unexpected
      // exceptions (network drop, JSON parse error, etc.). Don't leave
      // the user stranded on the loader.
      if (autoOpenFlag) {
        showAlert('Brokerage Unavailable', e.message ?? 'Unable to start brokerage connection.');
        exitAutoOpenScreen();
        return;
      }
      showAlert('Connection Failed', e.message ?? 'Unable to start brokerage connection.');
    }
  }, [showAlert, runDiagnostic, autoOpenFlag, router]);

  // Session 136/149/173 — auto-open SnapTrade WebView the moment the user
  // arrives on ?autoOpen=1. Fires doConnect() IMMEDIATELY on mount for the
  // onboarding path — does NOT wait for loadConnection to finish reading
  // the persisted connection snapshot. Portal URL generation and the
  // persisted-connection DB fetch run CONCURRENTLY, so the SnapTrade
  // WebView opens as soon as snaptrade-connect returns. If loadConnection
  // subsequently reveals we're already connected, its phase update to
  // 'connected' wins and the in-flight portal request is discarded via
  // autoOpenAttemptedRef (idempotent).
  useEffect(() => {
    if (!autoOpenFlag) return;
    if (autoOpenAttemptedRef.current) return;
    if (!isLoggedIn) return;
    // Skip only if we already KNOW we're connected. Do NOT gate on 'loading'
    // — the whole point of this optimization is to run portal generation in
    // parallel with the persisted-connection fetch.
    if (phase === 'connected' || phase === 'needs_reconnect' || accounts.length > 0) return;
    if (phase === 'preparing' || phase === 'portal_open') return;
    autoOpenAttemptedRef.current = true;
    perfLog('auto-open-fire');
    doConnect(false);
  }, [autoOpenFlag, phase, accounts.length, isLoggedIn, doConnect]);

  // Session 194 — SnapTrade connection URL PREFETCH TRIGGER. Fires ONCE
  // per component mount when we reach the `not_connected` state via the
  // normal (non-autoOpen) path. Speculatively requests a SnapTrade
  // portal URL so the WebView can open INSTANTLY when the user taps
  // Connect Brokerage, instead of waiting for the ~500-1000ms edge
  // function round-trip.
  //
  // Deliberately skipped for:
  //   • autoOpen paths — those already fire doConnect() immediately on
  //     mount, so a parallel prefetch adds no benefit and wastes a call.
  //   • Free users — the button is a paywall trigger, not a real connect.
  //   • Non-logged-in — no session to authenticate the edge function.
  //   • Already-connected states — no Connect Brokerage tap will happen.
  //
  // Uses the same authenticated snaptrade-connect edge function as the
  // normal manual-tap flow — same security profile, same JWT check,
  // same server-side credential handling, secrets never touch the client.
  useEffect(() => {
    if (autoOpenFlag) return;
    if (!isLoggedIn || !isSubscribed) return;
    if (phase !== 'not_connected') return;
    if (prefetchTriggeredRef.current) return;
    prefetchTriggeredRef.current = true;
    const timer = setTimeout(() => {
      prefetchConnectionUrl().catch(() => {});
    }, 100);
    return () => clearTimeout(timer);
  }, [autoOpenFlag, isLoggedIn, isSubscribed, phase, prefetchConnectionUrl]);

  // Session 194 — WEBVIEW_MOUNTED perf timing. Fires exactly once per
  // portal URL transition (portalUrl null → non-null) so we can measure
  // how much of the CONNECT_TAP → SnapTrade portal open latency comes
  // from the WebView mounting itself vs. the URL request round-trip.
  useEffect(() => {
    if (portalUrl) perfLog('WEBVIEW_MOUNTED');
  }, [portalUrl]);


  // Session 143/173 — auto-return: after a successful connection via the
  // autoOpen path, drop the user back into the app. During onboarding
  // (onboarding=1) we route to /welcome ("The Future of Stock Intelligence")
  // so the introductory brand page is shown after the broker step. For a
  // normal autoOpen entry (e.g. Put in Trade) we return to /(tabs).
  //
  // The previous 700ms setTimeout was purely cosmetic (autoOpen never
  // renders the CONNECTED hero — see hideChromeForAutoOpen below) and
  // has been REMOVED. Navigation fires as soon as the sync confirms the
  // connection succeeded.
  useEffect(() => {
    if (!autoOpenFlag) return;
    if (autoReturnFiredRef.current) return;
    if (phase !== 'connected') return;
    autoReturnFiredRef.current = true;
    const dest = isOnboarding ? '/welcome' : '/(tabs)';
    perfLog('auto-return', { dest, isOnboarding });
    try { router.replace(dest as any); } catch {}
  }, [autoOpenFlag, phase, router, isOnboarding]);

  // Session 150 — autoOpen watchdog. If the user reached this screen via
  // ?autoOpen=1 and we've been sitting in `preparing` for more than 15
  // seconds without a portal URL, treat the connection request as failed
  // and route back so they aren't stuck on the loader.
  useEffect(() => {
    if (!autoOpenFlag) return;
    if (phase !== 'preparing') return;
    const timer = setTimeout(() => {
      if (portalUrl) return; // portal opened; nothing to do
      console.log('[SnapTrade Client] autoOpen watchdog fired — backing out');
      showAlert('Brokerage Unavailable', 'The secure brokerage link is taking too long to open. Please try again in a moment.');
      exitAutoOpenScreen();
    }, 15000);
    return () => clearTimeout(timer);
  }, [autoOpenFlag, phase, portalUrl, router, showAlert]);

  const startSwitchBrokerage = useCallback(() => {
    if (!isSubscribed) {
      showAlert('Pro Required', 'Brokerage integration is a Pro feature.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Upgrade', onPress: () => router.push('/subscription') },
      ]);
      return;
    }
    showAlert(
      'Switch Brokerage?',
      'Your current brokerage authorization will be removed and its cached portfolio value, accounts, positions and cash will be cleared. The new brokerage you connect will become your active portfolio source.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch', style: 'destructive', onPress: () => doConnect(false, true) },
      ],
    );
  }, [isSubscribed, router, showAlert, doConnect]);

  const startConnect = useCallback(() => {
    if (!isSubscribed) {
      showAlert('Pro Required', 'Brokerage integration is a Pro feature.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Upgrade', onPress: () => router.push('/subscription') },
      ]);
      return;
    }
    doConnect(false);
  }, [isSubscribed, router, showAlert, doConnect]);

  // -------------------------------------------------------------------
  // WebView navigation interceptor. Catches SnapTrade's deep-link
  // redirect BEFORE the WebView tries to load the custom scheme.
  // -------------------------------------------------------------------
  const onShouldStartLoadWithRequest = useCallback((req: WebViewNavigation): boolean => {
    if (isSnapTradeCallback(req.url)) {
      // Fire-and-forget; setState inside will close the modal.
      handlePortalCallback(req.url);
      return false; // don't try to load onspaceapp:// in the WebView
    }
    return true;
  }, [handlePortalCallback]);

  // On some Android WebViews the shouldStart hook doesn't fire for custom
  // schemes; onNavigationStateChange is a belt-and-braces backup.
  const onNavigationStateChange = useCallback((state: WebViewNavigation) => {
    if (isSnapTradeCallback(state.url)) handlePortalCallback(state.url);
  }, [handlePortalCallback]);

  const cancelPortal = useCallback(() => {
    console.log('[SnapTrade Client] portal cancelled by user');
    setPortalUrl(null);
    callbackHandledRef.current = true; // suppress any late-firing navigation events
    // Session 149 — seamless exit for autoOpen flows. If the user
    // arrived here via ?autoOpen=1 (Put in Trade / paywall) and closed
    // the SnapTrade portal without connecting, don't strand them on
    // this screen — just return them to where they came from.
    if (autoOpenFlag && accounts.length === 0) {
      exitAutoOpenScreen();
      return;
    }
    setPhase(accounts.length > 0 ? 'connected' : 'not_connected');
  }, [accounts.length, autoOpenFlag, router]);

  // -------------------------------------------------------------------
  // Disconnect — removes each brokerage authorization; keeps SnapTrade
  // user so re-connect doesn't require re-registration.
  // -------------------------------------------------------------------
  const disconnect = useCallback(() => {
    showAlert(
      'Disconnect Brokerage?',
      'This will disconnect Sight from this brokerage and remove the brokerage connection from Sight. Your manual trade journal is preserved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect', style: 'destructive',
          onPress: async () => {
            console.log('[SnapTrade Client] disconnect requested');
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (!session?.access_token) return;
              const { error } = await supabase.functions.invoke('snaptrade-disconnect', {
                headers: { Authorization: `Bearer ${session.access_token}` },
              });
              if (error) {
                const info = await extractEdgeErrorInfo(error, 'Disconnect failed');
                showAlert('Disconnect Failed', info.message);
                return;
              }
              setPhase('not_connected');
              setAccounts([]); setPositions([]); setAuthorizations([]); setBalancesByAccount({}); setLastSynced(null);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              // Session 167 — INSTANT broker-state fan-out on disconnect.
              // Fires triggerBrokerRefresh() so the Home tab's Portfolio
              // Value, Active Trades, account picker, and every other
              // broker-derived UI element clears immediately — no waiting
              // for the 60-second polling interval.
              try { triggerBrokerRefresh(); } catch { /* swallow */ }
              console.log('[SnapTrade Client] disconnect complete');
            } catch (e: any) {
              showAlert('Disconnect Failed', e?.message ?? 'Unable to disconnect.');
            }
          },
        },
      ],
    );
  }, [showAlert]);

  // -------------------------------------------------------------------
  // Derived values for the "Connected" hero.
  //
  // Portfolio Value = sum(positions × currentPrice) + total cash. Note that
  // SnapTrade returns positions and cash separately — the market_value
  // returned per-position does NOT include cash — so summing both is
  // correct and does NOT double-count.
  // -------------------------------------------------------------------
  const summary = useMemo(() => {
    let positionsValue = 0;
    for (const p of positions) {
      const q = Number(p.quantity ?? 0);
      const px = Number(p.currentPrice ?? 0);
      if (q > 0 && px > 0) positionsValue += q * px;
    }
    let cash = 0;
    for (const acctBalances of Object.values(balancesByAccount)) {
      if (!Array.isArray(acctBalances)) continue;
      for (const b of acctBalances) {
        const amt = Number((b as any)?.cash ?? (b as any)?.amount ?? 0);
        if (!isNaN(amt)) cash += amt;
      }
    }
    const brokerNames = Array.from(new Set(
      accounts.map(a => a.institution_name).filter(Boolean) as string[]
    ));
    return { positionsValue, cash, portfolioValue: positionsValue + cash, brokerNames };
  }, [positions, balancesByAccount, accounts]);

  const isConnected = phase === 'connected' || phase === 'needs_reconnect' || (phase === 'syncing' && accounts.length > 0);
  const isBusy = phase === 'preparing' || phase === 'portal_open' || phase === 'syncing';

  // Session 144 — when routed here with ?autoOpen=1 (from the paywall
  // success flow or from Put in Trade), we NEVER show the brokerage
  // chrome. The user sees only a plain full-screen spinner while the
  // portal URL is being fetched, while the SnapTrade WebView is open,
  // AND while the post-connection sync completes. As soon as the sync
  // finishes, `autoReturnFiredRef` routes them out of this screen
  // entirely so the brokerage details page is never seen during the
  // onboarding flow. The dedicated Brokerage screen with a Skip for now
  // header is only reachable from Settings (autoOpen not set).
  const hideChromeForAutoOpen = autoOpenFlag;

  // ============================ RENDER ============================
  if (hideChromeForAutoOpen) {
    const loaderCaption = phase === 'syncing'
      ? 'Syncing your portfolio…'
      : phase === 'connected'
        ? 'Almost done…'
        : 'Opening secure brokerage link…';
    const loaderSub = phase === 'syncing'
      ? 'Fetching your accounts, positions and cash balance from your broker.'
      : phase === 'connected'
        ? 'Returning you to Sight now.'
        : 'SnapTrade is generating a one-time connection URL for your broker.';
    return (
      <View style={{ flex: 1, backgroundColor: t.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={t.primary} />
        <Text style={{ marginTop: 14, fontSize: 14, fontWeight: '600', color: t.textPrimary }}>{loaderCaption}</Text>
        <Text style={{ marginTop: 4, fontSize: 12, color: t.textSecondary, paddingHorizontal: 40, textAlign: 'center' }}>
          {loaderSub}
        </Text>
        <Modal
          visible={!!portalUrl}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={cancelPortal}
          statusBarTranslucent={false}
        >
          <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
            {Platform.OS === 'android' ? <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" /> : null}
            {portalUrl ? (
              <WebView
                source={{ uri: portalUrl }}
                style={{ flex: 1, marginTop: insets.top }}
                originWhitelist={['*']}
                javaScriptEnabled
                domStorageEnabled
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                startInLoadingState
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                setSupportMultipleWindows={false}
                mixedContentMode="always"
                onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
                onNavigationStateChange={onNavigationStateChange}
                onLoadEnd={() => perfLog('SNAPTRADE_FIRST_LOAD')}
                renderLoading={() => (
                  <View style={styles.webviewLoader}>
                    <ActivityIndicator size="large" color={t.primary} />
                    <Text style={{ marginTop: 12, fontSize: 13, color: '#4B5563' }}>Loading SnapTrade…</Text>
                  </View>
                )}
              />
            ) : null}
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: t.background }]}>
      <View style={styles.header}>
        {isOnboarding ? (
          <View style={styles.headerBtn} />
        ) : (
          <Pressable
            onPress={() => { Haptics.selectionAsync(); router.back(); }}
            style={[styles.headerBtn, { backgroundColor: t.surface, borderColor: t.border }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialIcons name="arrow-back" size={22} color={t.textPrimary} />
          </Pressable>
        )}
        <Text style={[styles.title, { color: t.textPrimary }]}>{isOnboarding ? 'Connect Your Brokerage' : 'Brokerage'}</Text>
        {isOnboarding ? (
          <Pressable
            onPress={() => { Haptics.selectionAsync(); router.replace((isOnboarding ? '/welcome' : '/(tabs)') as any); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ paddingHorizontal: 8, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: t.textSecondary }}>Skip for now</Text>
          </Pressable>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40, paddingHorizontal: 16 }}>
        {/* Hero card — shape changes with phase */}
        {phase === 'loading' ? (
          <View style={[styles.heroCard, { backgroundColor: t.surface, borderColor: t.border, alignItems: 'center', paddingVertical: 40 }]}>
            <ActivityIndicator color={t.primary} />
            <Text style={{ marginTop: 12, fontSize: 13, color: t.textSecondary }}>Loading brokerage status…</Text>
          </View>
        ) : phase === 'preparing' ? (
          <View style={[styles.heroCard, { backgroundColor: t.surface, borderColor: t.border, alignItems: 'center', paddingVertical: 40 }]}>
            <ActivityIndicator color={t.primary} size="large" />
            <Text style={{ marginTop: 14, fontSize: 16, fontWeight: '700', color: t.textPrimary }}>Preparing connection…</Text>
            <Text style={{ marginTop: 6, fontSize: 13, color: t.textSecondary, textAlign: 'center' }}>
              SnapTrade is generating a secure connection link.
            </Text>
          </View>
        ) : phase === 'syncing' && accounts.length === 0 ? (
          <View style={[styles.heroCard, { backgroundColor: t.surface, borderColor: t.border, alignItems: 'center', paddingVertical: 40 }]}>
            <ActivityIndicator color={t.primary} size="large" />
            <Text style={{ marginTop: 14, fontSize: 16, fontWeight: '700', color: t.textPrimary }}>Syncing your portfolio…</Text>
            <Text style={{ marginTop: 6, fontSize: 13, color: t.textSecondary, textAlign: 'center', paddingHorizontal: 20 }}>
              Fetching your accounts, cash balance and positions from your broker.
            </Text>
          </View>
        ) : isConnected ? (
          <View style={[styles.heroCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <View style={[styles.statusDot, { backgroundColor: phase === 'needs_reconnect' ? '#F59E0B' : t.bullish }]} />
              <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 1, color: phase === 'needs_reconnect' ? '#F59E0B' : t.bullish }}>
                {phase === 'needs_reconnect' ? 'NEEDS RECONNECT' : 'CONNECTED'}
              </Text>
              {phase === 'syncing' ? <ActivityIndicator size="small" color={t.primary} style={{ marginLeft: 4 }} /> : null}
            </View>
            <Text style={[styles.heroTitle, { color: t.textPrimary }]}>Brokerage Connected</Text>
            {summary.brokerNames.length > 0 ? (
              <Text style={{ fontSize: 14, fontWeight: '600', color: t.textSecondary, marginBottom: 12 }}>
                {summary.brokerNames.join(' · ')}
              </Text>
            ) : null}

            {/* Portfolio Value hero */}
            <View style={[styles.portfolioValueTile, { backgroundColor: t.primary + '12', borderColor: t.primary + '40' }]}>
              <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: t.primary }}>PORTFOLIO VALUE</Text>
              <Text style={{ fontSize: 32, fontWeight: '800', color: t.textPrimary, letterSpacing: -1, marginTop: 2 }}>
                ${summary.portfolioValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
              <Text style={{ fontSize: 12, color: t.textSecondary, marginTop: 4 }}>
                Positions ${summary.positionsValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}  ·  Cash ${summary.cash.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </Text>
            </View>

            <View style={styles.summaryGrid}>
              <View style={[styles.summaryTile, { backgroundColor: t.background, borderColor: t.border }]}>
                <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: t.textTertiary }}>ACCOUNTS</Text>
                <Text style={{ fontSize: 20, fontWeight: '800', color: t.textPrimary, marginTop: 2 }}>{accounts.length}</Text>
              </View>
              <View style={[styles.summaryTile, { backgroundColor: t.background, borderColor: t.border }]}>
                <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: t.textTertiary }}>POSITIONS</Text>
                <Text style={{ fontSize: 20, fontWeight: '800', color: t.textPrimary, marginTop: 2 }}>{positions.length}</Text>
              </View>
              <View style={[styles.summaryTile, { backgroundColor: t.background, borderColor: t.border }]}>
                <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: t.textTertiary }}>CASH</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', color: t.textPrimary, marginTop: 2 }} numberOfLines={1}>
                  ${summary.cash.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </Text>
              </View>
            </View>

            {phase === 'needs_reconnect' ? (
              <View style={[styles.warningBanner, { backgroundColor: '#F59E0B22', borderColor: '#F59E0B' }]}>
                <MaterialIcons name="warning" size={18} color="#F59E0B" />
                <Text style={{ flex: 1, fontSize: 12, color: t.textPrimary, lineHeight: 18 }}>
                  Your broker's authorization has expired. Reconnect to keep positions synced.
                </Text>
              </View>
            ) : null}

            <View style={{ marginTop: 14, flexDirection: 'row', gap: 8 }}>
              {phase === 'needs_reconnect' ? (
                <Pressable
                  onPress={startConnect} disabled={isBusy}
                  style={({ pressed }) => [styles.primaryBtn, { backgroundColor: t.primary, opacity: pressed || isBusy ? 0.85 : 1 }]}
                >
                  <MaterialIcons name="link" size={18} color="#FFF" />
                  <Text style={styles.primaryBtnText}>Reconnect</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={refreshData} disabled={isBusy}
                  style={({ pressed }) => [styles.primaryBtn, { backgroundColor: t.primary, opacity: pressed || isBusy ? 0.85 : 1 }]}
                >
                  {isBusy ? <ActivityIndicator size="small" color="#FFF" /> : <MaterialIcons name="sync" size={18} color="#FFF" />}
                  <Text style={styles.primaryBtnText}>Refresh Data</Text>
                </Pressable>
              )}
              <Pressable
                onPress={disconnect}
                style={({ pressed }) => [styles.secondaryBtn, { borderColor: t.bearish, opacity: pressed ? 0.85 : 1 }]}
              >
                <MaterialIcons name="link-off" size={18} color={t.bearish} />
                <Text style={[styles.secondaryBtnText, { color: t.bearish }]}>Disconnect</Text>
              </Pressable>
            </View>

            {phase !== 'needs_reconnect' ? (
              <View style={{ marginTop: 8 }}>
                <Pressable
                  onPress={startSwitchBrokerage}
                  disabled={isBusy}
                  style={({ pressed }) => [styles.switchBtn, { borderColor: t.primary, backgroundColor: t.primary + '12', opacity: pressed || isBusy ? 0.85 : 1 }]}
                >
                  <MaterialIcons name="swap-horiz" size={18} color={t.primary} />
                  <Text style={{ fontSize: 14, fontWeight: '700', color: t.primary }}>Switch Brokerage</Text>
                </Pressable>
              </View>
            ) : null}

            {lastSynced ? (
              <Text style={{ fontSize: 11, color: t.textTertiary, marginTop: 10 }}>
                Last synced {new Date(lastSynced).toLocaleString()}
              </Text>
            ) : null}
          </View>
        ) : (
          <View>
            {/* Session 164 — the "What is a Brokerage Connection?" info
                card has been REMOVED per user request. Users now go
                directly to the Link Your Broker hero card + Connect
                Brokerage CTA without the intermediary explainer. */}
          <View style={[styles.heroCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={[styles.heroIcon, { backgroundColor: t.primary + '18' }]}>
              <MaterialIcons name="account-balance" size={28} color={t.primary} />
            </View>
            <Text style={[styles.heroTitle, { color: t.textPrimary }]}>Link Your Broker</Text>
            <Text style={[styles.heroBody, { color: t.textSecondary }]}>
              Connect a supported broker to sync positions and balances automatically. Sight uses SnapTrade — an SOC 2 Type II certified aggregator — so your broker credentials are handled by SnapTrade and never touch this app.
            </Text>
            {errorMessage ? (
              <View style={[styles.warningBanner, { backgroundColor: t.bearishBg ?? '#EF444422', borderColor: t.bearish }]}>
                <MaterialIcons name="error-outline" size={18} color={t.bearish} />
                <Text style={{ flex: 1, fontSize: 12, color: t.textPrimary, lineHeight: 18 }}>{errorMessage}</Text>
              </View>
            ) : null}
            <View style={{ marginTop: 14 }}>
              <Pressable
                onPress={startConnect}
                disabled={isBusy}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: t.primary, opacity: pressed || isBusy ? 0.85 : 1 }]}
              >
                {isBusy ? <ActivityIndicator size="small" color="#FFF" /> : <MaterialIcons name="link" size={18} color="#FFF" />}
                <Text style={styles.primaryBtnText}>{isBusy ? 'Preparing…' : 'Connect Brokerage'}</Text>
              </Pressable>
            </View>
          </View>
          </View>
        )}

        {/* Accounts list — with per-connection trading capability badges */}
        {isConnected && accounts.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>ACCOUNTS ({accounts.filter((a: any) => a?.connection_allows_trading === true && a?.connection_disabled !== true).length})</Text>
            {accounts
              .filter((acc: any) => {
                // Session 134 — only show accounts on trading-enabled
                // connections. Uses the live SnapTrade brokerage
                // authorization fields we captured at sync time —
                // never a hardcoded broker list.
                const allowsTrading: boolean = acc?.connection_allows_trading === true;
                const disabled: boolean = acc?.connection_disabled === true;
                return allowsTrading && !disabled;
              })
              .map((acc: any) => {
              const connType: string = String(acc?.connection_type ?? 'unknown').toLowerCase();
              const allowsTrading: boolean = acc?.connection_allows_trading === true;
              const tradingEnabled: boolean = acc?.trading_enabled === true;
              const readOnly = connType === 'read' || (connType === 'unknown' && !allowsTrading);
              const badgeColor = tradingEnabled ? t.bullish : (readOnly ? t.bearish : '#F59E0B');
              const badgeBg = tradingEnabled ? t.bullishBg ?? (t.bullish + '22') : (readOnly ? (t.bearishBg ?? (t.bearish + '22')) : '#F59E0B22');
              const badgeLabel = tradingEnabled ? 'TRADING' : (readOnly ? 'READ-ONLY' : 'LIMITED');
              return (
                <View key={acc.id} style={[styles.rowCard, { backgroundColor: t.surface, borderColor: t.border, flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <MaterialIcons name="account-balance-wallet" size={22} color={t.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: t.textPrimary }} numberOfLines={1}>
                        {acc.institution_name ?? 'Brokerage'}{acc.name ? ` · ${acc.name}` : ''}
                      </Text>
                      {acc.number ? (
                        <Text style={{ fontSize: 12, color: t.textSecondary, marginTop: 2 }}>Account {acc.number}</Text>
                      ) : null}
                    </View>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: badgeBg }}>
                      <Text style={{ fontSize: 9, fontWeight: '800', color: badgeColor, letterSpacing: 0.5 }}>{badgeLabel}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: t.background, borderWidth: 1, borderColor: t.border }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: t.textTertiary, letterSpacing: 0.3 }}>
                        TYPE: {String(connType).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: t.background, borderWidth: 1, borderColor: t.border }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: t.textTertiary, letterSpacing: 0.3 }}>
                        ALLOWS_TRADING: {allowsTrading ? 'YES' : 'NO'}
                      </Text>
                    </View>
                    {acc?.connection_maintenance_mode ? (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#F59E0B22' }}>
                        <Text style={{ fontSize: 9, fontWeight: '800', color: '#F59E0B', letterSpacing: 0.3 }}>MAINTENANCE</Text>
                      </View>
                    ) : null}
                    {acc?.connection_is_degraded ? (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#F59E0B22' }}>
                        <Text style={{ fontSize: 9, fontWeight: '800', color: '#F59E0B', letterSpacing: 0.3 }}>DEGRADED</Text>
                      </View>
                    ) : null}
                    {acc?.is_paper ? (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: t.primary + '22' }}>
                        <Text style={{ fontSize: 9, fontWeight: '800', color: t.primary, letterSpacing: 0.3 }}>PAPER</Text>
                      </View>
                    ) : null}
                  </View>
                  {readOnly && acc?.brokerage_authorization ? (
                    <Pressable
                      onPress={() => doConnect(false, false, acc.brokerage_authorization, 'trade')}
                      style={({ pressed }) => ({
                        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                        height: 40, borderRadius: 10, backgroundColor: t.primary,
                        opacity: pressed ? 0.85 : 1,
                      })}
                    >
                      <MaterialIcons name="lock-open" size={16} color="#FFF" />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFF' }}>Enable Trading for This Connection</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Positions list */}
        {isConnected && positions.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>POSITIONS ({positions.length})</Text>
            {positions.map((p, i) => {
              const qty = Number(p.quantity ?? 0);
              const cur = Number(p.currentPrice ?? 0);
              const avg = Number(p.averagePrice ?? 0);
              const value = qty * cur;
              const pnl = avg > 0 ? (cur - avg) * qty : 0;
              const win = pnl >= 0;
              return (
                <View key={`${p.accountId}-${p.ticker}-${i}`} style={[styles.rowCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                  <View style={[styles.tickerBadge, { backgroundColor: t.primary + '18' }]}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: t.primary }}>{p.ticker || '—'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: t.textPrimary }}>{qty} shares</Text>
                    <Text style={{ fontSize: 11, color: t.textSecondary, marginTop: 1 }}>
                      Avg ${avg > 0 ? avg.toFixed(2) : '—'} · Now ${cur > 0 ? cur.toFixed(2) : '—'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: t.textPrimary }}>
                      ${value > 0 ? value.toFixed(2) : '—'}
                    </Text>
                    {avg > 0 ? (
                      <Text style={{ fontSize: 11, fontWeight: '700', color: win ? t.bullish : t.bearish }}>
                        {win ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : isConnected ? (
          <View style={[styles.emptyPositionsCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            <MaterialIcons name="pie-chart-outline" size={22} color={t.textTertiary} />
            <Text style={{ flex: 1, fontSize: 13, color: t.textSecondary, lineHeight: 19 }}>
              No open positions at your broker right now. Cash-only accounts show here too.
            </Text>
          </View>
        ) : null}

        {/* Security info */}
        <View style={[styles.infoCard, { backgroundColor: t.surface, borderColor: t.border }]}>
          <MaterialIcons name="shield" size={18} color={t.primary} />
          <Text style={{ flex: 1, fontSize: 12, color: t.textSecondary, lineHeight: 18 }}>
            Sight never sees your broker password. SnapTrade handles login on your broker's site and returns a scoped connection token to our backend. Orders require explicit tap-to-confirm — nothing executes automatically.
          </Text>
        </View>

        {/* Diagnostic — always available for support */}
        <Pressable
          onPress={runDiagnostic}
          disabled={diagRunning}
          style={({ pressed }) => [styles.diagBtn, { borderColor: t.border, opacity: pressed || diagRunning ? 0.7 : 1, marginTop: 12 }]}
        >
          {diagRunning ? <ActivityIndicator size="small" color={t.primary} /> : <MaterialIcons name="health-and-safety" size={16} color={t.primary} />}
          <Text style={{ fontSize: 13, fontWeight: '600', color: t.primary }}>
            {diagRunning ? 'Running diagnostic…' : 'Run Connection Diagnostic'}
          </Text>
        </Pressable>
      </ScrollView>

      {/* ============================================================
          SNAPTRADE CONNECTION PORTAL — full-screen in-app WebView.
          No TradeSight header. No back-nav bar. The only chrome we
          render is a small floating × button as an escape hatch —
          SnapTrade's own portal owns everything else.
          ============================================================ */}
      <Modal
        visible={!!portalUrl}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={cancelPortal}
        statusBarTranslucent={false}
      >
        <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
          {Platform.OS === 'android' ? <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" /> : null}
          {/* Session 134 — the floating close X was removed per user
              request. Users close the SnapTrade portal by completing (or
              cancelling) the flow within SnapTrade's own UI, or via the
              hardware back button on Android / native Modal dismissal. */}
          {portalUrl ? (
            <WebView
              source={{ uri: portalUrl }}
              style={{ flex: 1, marginTop: insets.top }}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              startInLoadingState
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              setSupportMultipleWindows={false}
              mixedContentMode="always"
              onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
              onNavigationStateChange={onNavigationStateChange}
              onLoadEnd={() => perfLog('SNAPTRADE_FIRST_LOAD')}
              renderLoading={() => (
                <View style={styles.webviewLoader}>
                  <ActivityIndicator size="large" color={t.primary} />
                  <Text style={{ marginTop: 12, fontSize: 13, color: '#4B5563' }}>Loading SnapTrade…</Text>
                </View>
              )}
            />
          ) : null}

        </View>
      </Modal>

      {/* Diagnostic Results Modal */}
      <Modal
        visible={!!diagResult}
        animationType="fade"
        transparent
        onRequestClose={() => setDiagResult(null)}
      >
        <View style={styles.diagOverlay}>
          <View style={[styles.diagCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <MaterialIcons name="health-and-safety" size={22} color={t.primary} />
              <Text style={{ flex: 1, fontSize: 18, fontWeight: '800', color: t.textPrimary }}>SnapTrade Diagnostic</Text>
              <Pressable onPress={() => setDiagResult(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={22} color={t.textSecondary} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {diagResult ? (
                <>
                  <DiagRow ok={diagResult.checks.clientIdConfigured} label="1. Commercial clientId configured" t={t} />
                  <DiagRow ok={diagResult.checks.consumerKeyConfigured} label="2. Commercial consumerKey configured" t={t} />
                  <DiagRow ok={diagResult.checks.hasUserRecord} label="3. Sight user has SnapTrade userId" t={t} />
                  <DiagRow ok={diagResult.checks.hasUserSecret} label="4. Sight user has SnapTrade userSecret" t={t} />
                  <DiagRow ok={diagResult.checks.existsInSnapTrade} label="5. userId exists in SnapTrade" t={t} />
                  <DiagRow ok={diagResult.checks.loginOk} label="6. /snapTrade/login authenticates user" t={t} />
                  <DiagRow ok={diagResult.checks.redirectURIReturned} label="7. SnapTrade returned redirectURI" t={t} />
                  {diagResult.checks.loginErrorMessage ? (
                    <View style={{ marginTop: 8, padding: 10, backgroundColor: t.bearishBg ?? '#EF444422', borderRadius: 8 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: t.bearish, letterSpacing: 0.5 }}>SNAPTRADE ERROR</Text>
                      <Text style={{ fontSize: 12, color: t.textPrimary, marginTop: 4 }}>
                        {diagResult.checks.loginErrorCode ? `Code ${diagResult.checks.loginErrorCode}: ` : ''}{String(diagResult.checks.loginErrorMessage)}
                      </Text>
                    </View>
                  ) : null}
                  <View style={{ marginTop: 14, padding: 12, backgroundColor: t.background, borderRadius: 10, borderWidth: 1, borderColor: t.border }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: t.textTertiary, letterSpacing: 0.5, marginBottom: 6 }}>CONCLUSION</Text>
                    <Text style={{ fontSize: 13, color: t.textPrimary, lineHeight: 19 }}>{diagResult.conclusion}</Text>
                  </View>
                </>
              ) : null}
            </ScrollView>
            {diagResult?.nextAction === 'reset_credentials' ? (
              <Pressable
                onPress={() => { setDiagResult(null); doConnect(true); }}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: t.primary, marginTop: 12, opacity: pressed ? 0.85 : 1 }]}
              >
                <MaterialIcons name="restart-alt" size={18} color="#FFF" />
                <Text style={styles.primaryBtnText}>Reset SnapTrade Credentials</Text>
              </Pressable>
            ) : diagResult?.nextAction === 'register_fresh' ? (
              <Pressable
                onPress={() => { setDiagResult(null); doConnect(false); }}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: t.primary, marginTop: 12, opacity: pressed ? 0.85 : 1 }]}
              >
                <MaterialIcons name="link" size={18} color="#FFF" />
                <Text style={styles.primaryBtnText}>Connect Brokerage</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function DiagRow({ ok, label, t }: { ok: boolean | null | undefined; label: string; t: any }) {
  const passed = ok === true;
  const failed = ok === false;
  const iconName = passed ? 'check-circle' : failed ? 'cancel' : 'help-outline';
  const color = passed ? t.bullish : failed ? t.bearish : t.textTertiary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border }}>
      <MaterialIcons name={iconName as any} size={18} color={color} />
      <Text style={{ flex: 1, fontSize: 13, color: t.textPrimary }}>{label}</Text>
      <Text style={{ fontSize: 11, fontWeight: '700', color, letterSpacing: 0.5 }}>
        {passed ? 'PASS' : failed ? 'FAIL' : 'N/A'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  headerBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  heroCard: { borderRadius: 18, padding: 18, borderWidth: 1, marginTop: 12 },
  heroIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  heroTitle: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  heroBody: { fontSize: 13, lineHeight: 19 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  portfolioValueTile: { borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 4, marginBottom: 10 },
  summaryGrid: { flexDirection: 'row', gap: 8, marginTop: 6 },
  summaryTile: { flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 12 },
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, padding: 10, marginTop: 12 },
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 12 },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14 },
  secondaryBtnText: { fontSize: 14, fontWeight: '700' },
  switchBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 12, borderWidth: 1.5 },
  diagBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 38, borderRadius: 10, borderWidth: 1 },
  diagOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  diagCard: { width: '100%', maxWidth: 440, borderRadius: 16, borderWidth: 1, padding: 18 },
  section: { marginTop: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  tickerBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, minWidth: 54, alignItems: 'center' },
  emptyPositionsCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, padding: 14, marginTop: 20 },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 12, borderWidth: 1, padding: 14, marginTop: 20 },
  webviewLoader: { ...StyleSheet.absoluteFillObject, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  portalCloseBtn: {
    position: 'absolute', right: 12,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4 },
      android: { elevation: 4 },
      default: {},
    }),
  },
});
