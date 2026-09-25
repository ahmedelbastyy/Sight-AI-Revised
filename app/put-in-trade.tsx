
// Put in Trade — Session 131 (Multi-Account Rebuild)
// =============================================================================
// Flow (with explicit account selection):
//
//   Ticker → Configure (with account picker showing every eligible account
//            + its broker total + cash) → tap Put in Trade
//          → LOCAL validation only
//          → Confirm Trade page (labels the exact account the order goes to)
//          → Swipe Up → snaptrade-place-order (validates account ownership)
//          → SnapTrade /trade/place → Brokerage → status → account refresh
//
// Multi-account: if the user has multiple SnapTrade accounts across multiple
// connections, every eligible investment account is listed with its
// institution name, account name/number, broker-authoritative total value,
// and available cash. There is no hidden default; the user must choose
// (with the first eligible account preselected only as a UI convenience).
//
// Explicit account_id is sent to the backend, which also validates that the
// selected account belongs to this user, is INVESTMENT, and is on a
// connection that hasn't been disabled.
//
// Absolutely NO Trade Impact anywhere.
// =============================================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput,
  KeyboardAvoidingView, Platform, Animated, PanResponder, LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabaseClient, useAlert } from '@/template';
import { useApp } from '../contexts/AppContext';
import { fetchMultipleQuotes } from '../services/stockService';
import { useBrokerConnection } from '../hooks/useBrokerConnection';

const supabase = getSupabaseClient();

type OrderType = 'Market' | 'Limit' | 'Stop' | 'StopLimit';
type TimeInForce = 'Day' | 'GTC';
type Phase =
  | 'loading_accounts'
  | 'configure'
  | 'review'
  | 'submitting'
  | 'submitted'
  | 'rejected';
type FinalStatus = 'PENDING' | 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED' | 'CANCELED' | 'SUBMITTED';

function generateClientOrderId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function extractEdgeError(error: unknown, fallback: string): Promise<{ message: string; code?: string | number }> {
  // Session 148 — translate raw broker / edge function errors into plain-English
  // messages users can actually act on. Falls back to a friendly generic string
  // when we can't recognise the error.
  const friendly = (raw: string, code?: string | number): { message: string; code?: string | number } => {
    const r = String(raw ?? '').toLowerCase();
    if (!raw) return { message: fallback, code };
    if (r.includes('insufficient') || r.includes('not enough cash') || r.includes('buying power')) {
      return { message: 'Not enough cash in this brokerage account to place this order.', code };
    }
    if (r.includes('market closed') || r.includes('market is closed')) {
      return { message: 'The US market is currently closed. Try again during market hours.', code };
    }
    if (r.includes('symbol not found') || r.includes('unknown symbol') || r.includes('not tradeable')) {
      return { message: 'This ticker is not tradeable through your broker right now.', code };
    }
    if (r.includes('read-only') || r.includes('read only')) {
      return { message: 'This brokerage connection is read-only. Reconnect with trading enabled in Settings.', code };
    }
    if (r.includes('disabled') || r.includes('needs_reconnect') || r.includes('reconnect')) {
      return { message: 'Your brokerage connection has expired. Please reconnect in Settings.', code };
    }
    if (r.includes('maintenance')) {
      return { message: 'Your broker is currently in maintenance mode. Please try again shortly.', code };
    }
    if (r.includes('rejected')) {
      return { message: `Your broker rejected this order: ${raw}`, code };
    }
    if (r.includes('unauthorized') || r.includes('not authenticated')) {
      return { message: 'You need to sign in again to place a trade.', code };
    }
    // Otherwise return the raw message but trimmed and capitalised so it reads
    // cleanly in the UI.
    return { message: raw.length > 200 ? raw.slice(0, 200) + '…' : raw, code };
  };

  try {
    if (error instanceof FunctionsHttpError) {
      let bodyText = '';
      try { bodyText = await (error as any).context.text(); } catch (e) { /* swallow error to return empty bodyText */ }
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText);
          const msg = parsed?.message ?? parsed?.error ?? parsed?.detail;
          return friendly(
            typeof msg === 'string' && msg ? msg : fallback,
            parsed?.snapTradeCode ?? parsed?.error,
          );
        } catch (e) { return friendly(bodyText.slice(0, 300)); }
      }
    }
    if ((error as any)?.message) return friendly((error as any).message);
  } catch (e) { /* swallow error to return fallback */ }
  return friendly(fallback);
}

// ---------------------------------------------------------------------------
// SwipeToConfirm — must drag thumb ≥85% of the track to fire onConfirm.
// ---------------------------------------------------------------------------
function SwipeToConfirm({
  label, color, textColor, onConfirm, disabled, resetKey,
}: {
  label: string;
  color: string;
  textColor: string;
  onConfirm: () => void;
  disabled: boolean;
  resetKey: number;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const [committed, setCommitted] = useState(false);
  const thumbSize = 56;
  const maxTranslate = Math.max(0, trackWidth - thumbSize - 8);
  const thresholdRef = useRef(0);
  // Session 151/153 — 40% threshold with velocity-aware early-latch.
  // The instant the user drags past 40% of the track the thumb LOCKS
  // into the confirmed position, AND a fast forward flick past 25% will
  // also commit even on release. Below-threshold releases spring back
  // gently rather than snapping so a slow drag never feels punished.
  thresholdRef.current = maxTranslate * 0.4;
  const committedRef = useRef(false);
  committedRef.current = committed;

  useEffect(() => {
    setCommitted(false);
    committedRef.current = false;
    Animated.timing(translateX, { toValue: 0, duration: 180, useNativeDriver: false }).start();
  }, [resetKey, translateX]);

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    setCommitted(true);
    Animated.timing(translateX, { toValue: maxTranslate, duration: 140, useNativeDriver: false }).start(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onConfirm();
    });
  }, [maxTranslate, translateX, onConfirm]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled && !committed,
    onMoveShouldSetPanResponder: (_, g) => !disabled && !committed && Math.abs(g.dx) > 1,
    onPanResponderGrant: () => {
      if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    },
    onPanResponderMove: (_, g) => {
      if (disabled || committedRef.current) return;
      const dx = Math.max(0, Math.min(g.dx, maxTranslate));
      translateX.setValue(dx);
      // Latch as soon as we cross the 40% threshold — no waiting for release.
      if (dx >= thresholdRef.current && thresholdRef.current > 0) {
        commit();
      }
    },
    onPanResponderRelease: (_, g) => {
      if (disabled || committedRef.current) return;
      // Session 153 — velocity-based commit. A quick forward flick past
      // 25% of the track commits even if the user lifted before hitting
      // the 40% latch point. Makes the interaction dramatically more
      // forgiving to slow / shaky fingers.
      if (g.vx > 0.5 && g.dx > maxTranslate * 0.25) {
        commit();
        return;
      }
      // Below threshold on release — spring back gently (softer than
      // before) so a partial drag doesn't feel like the whole gesture
      // was rejected.
      Animated.spring(translateX, { toValue: 0, useNativeDriver: false, tension: 18, friction: 6 }).start();
    },
    onPanResponderTerminate: () => {
      if (committedRef.current) return;
      Animated.spring(translateX, { toValue: 0, useNativeDriver: false, tension: 18, friction: 6 }).start();
    },
  }), [disabled, committed, maxTranslate, translateX, commit]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  return (
    <View
      onLayout={onLayout}
      style={[styles.swipeTrack, { backgroundColor: color, opacity: disabled ? 0.5 : 1 }]}
      accessible
      accessibilityLabel={label}
      accessibilityRole="adjustable"
    >
      <Text style={[styles.swipeLabel, { color: textColor }]} numberOfLines={1}>
        {committed ? 'Submitting…' : label}
      </Text>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.swipeThumb,
          { backgroundColor: '#FFFFFF', width: thumbSize, height: thumbSize, transform: [{ translateX }] },
        ]}
      >
        <MaterialIcons name={committed ? 'check' : 'chevron-right'} size={28} color={color} />
      </Animated.View>
    </View>
  );
}

function ReviewCell({ label, value, valueColor, t }: { label: string; value: string; valueColor?: string; t: any }) {
  return (
    <View style={{ flexBasis: '48%', paddingVertical: 8 }}>
      <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: t.textTertiary }}>{label.toUpperCase()}</Text>
      <Text style={{ fontSize: 16, fontWeight: '800', color: valueColor ?? t.textPrimary, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------
export default function PutInTradeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { currentTheme: t, markSignalTaken, isLoggedIn, closeTradeManually, addManualClosedTrade } = useApp();
  const brokerConn = useBrokerConnection();

  const params = useLocalSearchParams<{
    ticker?: string;
    action?: string;
    entry?: string;
    takeProfit?: string;
    stopLoss?: string;
    shares?: string;
    signalId?: string;
    tradeType?: string;
    accountId?: string;    // optional pre-selection
    source?: string;
  }>();

  const ticker = String(params.ticker ?? '').toUpperCase();
  const directionRaw = String(params.action ?? 'buy').toLowerCase();
  // Session 155 — explicit BUY / SELL / SHORT tracking, with SELL and
  // SHORT treated as fundamentally different intents:
  //   BUY   = open a long position — broker action='BUY',  position='long'.
  //   SELL  = close an existing long by selling owned shares — broker
  //           action='SELL',  position='long' (the trade is CLOSING a long).
  //   SHORT = open a new short position — broker action='SELL' (this is
  //           how shorting is submitted at the broker level) but
  //           position='short' so Sight books it correctly in Active
  //           Trades and the Journal.
  const initialManualAction: 'BUY' | 'SELL' | 'SHORT' =
    directionRaw === 'short' ? 'SHORT'
    : directionRaw === 'sell' ? 'SELL'
    : 'BUY';
  const [manualAction, setManualAction] = useState<'BUY' | 'SELL' | 'SHORT'>(initialManualAction);
  const action: 'BUY' | 'SELL' = manualAction === 'BUY' ? 'BUY' : 'SELL';
  const position: 'long' | 'short' = manualAction === 'SHORT' ? 'short' : 'long';
  const isSellingOwnedShares = manualAction === 'SELL';
  const suggestedEntry = Number(params.entry) || 0;
  const suggestedTP = Number(params.takeProfit) || 0;
  const suggestedSL = Number(params.stopLoss) || 0;
  const signalId = (params.signalId as string) || undefined;
  const tradeType = (params.tradeType as string) || undefined;
  const preSelectedAccountId = (params.accountId as string) || undefined;
  // Session 147 — when the flow is invoked from the Stock Details "I Have
  // Sold" button we tag the source as `close_trade`. All CTAs / headers in
  // this screen switch to "I Have Sold" wording so the user sees the same
  // action label from Stock Details straight through to broker submission.
  const source = (params.source as string) || undefined;
  const isCloseTrade = source === 'close_trade';
  // Session 151 — close-trade parameters used to log the sale into the
  // Journal after a successful broker order. tradeId is present when the
  // user came from a Sight-tracked trade; entryPrice + position are used
  // when the position exists only at the broker.
  const closeTradeId = (params.tradeId as string) || undefined;
  const closeEntryPrice = Number(params.entryPrice ?? 0) || 0;
  const closePosition: 'long' | 'short' = (String(params.position ?? '').toLowerCase() === 'short') ? 'short' : 'long';

  // --- Phase & configuration ---
  const [phase, setPhase] = useState<Phase>('loading_accounts');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [connectionActive, setConnectionActive] = useState(false);
  // Session 176 — Trading defaults to Market. Chart Scan sends NO order
  // type (uses this Market default). AI Moves pass suggested entry / TP /
  // SL as informational context but the actual order type still starts
  // Market unless the user explicitly selects Limit / Stop / StopLimit.
  // For a close-trade flow (Sell / I Have Sold) Market is also the
  // default so users close positions quickly rather than accidentally
  // resting a limit that never fills.
  const [orderType, setOrderType] = useState<OrderType>('Market');
  const [timeInForce, setTimeInForce] = useState<TimeInForce>('Day');
  // Session 197 — default share quantity is 1 (per user request). Callers
  // that pass an explicit `shares` param (AI Moves, close-trade, etc.)
  // still control the initial value; only the manual entry default was
  // changed from '10' to '1' so brand-new orders feel intentional rather
  // than accidentally large.
  const [shares, setShares] = useState<string>(params.shares ? String(params.shares) : '1');
  const [limitPrice, setLimitPrice] = useState<string>(suggestedEntry ? suggestedEntry.toFixed(2) : '');
  const [stopPrice, setStopPrice] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>(suggestedTP ? suggestedTP.toFixed(2) : '');
  const [stopLoss, setStopLoss] = useState<string>(suggestedSL ? suggestedSL.toFixed(2) : '');

  // Session 132 — readiness diagnostic result from snaptrade-trade-readiness.
  const [readinessChecking, setReadinessChecking] = useState(false);
  const [readinessReport, setReadinessReport] = useState<any>(null);

  const [submittedResponse, setSubmittedResponse] = useState<any>(null);
  const [finalStatus, setFinalStatus] = useState<FinalStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | number | null>(null);
  const [swipeResetKey, setSwipeResetKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Session 152 — animated success checkmark for the submitted phase.
  // Springs in the instant `phase` transitions to 'submitted' so the user
  // gets an unambiguous visual confirmation that the broker accepted the
  // order. Uses RN Animated (already imported) with useNativeDriver:true.
  const submitSuccessScale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (phase === 'submitted') {
      submitSuccessScale.setValue(0);
      Animated.spring(submitSuccessScale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 5,
        tension: 60,
      }).start();
    }
  }, [phase, submitSuccessScale]);

  const clientOrderIdRef = useRef<string>(generateClientOrderId());
  const rotateClientOrderId = useCallback(() => { clientOrderIdRef.current = generateClientOrderId(); }, []);
  // Session 167 — guard against duplicate router.replace() to
  // /connect-brokerage?autoOpen=1. Previously the initial-load useEffect
  // could re-run before its state transition landed, opening the
  // "Opening secure brokerage link..." loader TWICE. This ref ensures we
  // redirect exactly once per mount.
  const redirectedToConnectRef = useRef(false);

  // --- Live quote polling (10s) ---
  const [liveQuote, setLiveQuote] = useState<number | null>(null);
  const [liveChangePercent, setLiveChangePercent] = useState<number>(0);
  const initialLimitSetRef = useRef(false);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    const fetchQuote = async () => {
      try {
        const quotes = await fetchMultipleQuotes([ticker]);
        const q = quotes.get(ticker);
        if (!cancelled && q && q.price > 0) {
          setLiveQuote(q.price);
          setLiveChangePercent(q.changePercent);
          if (!initialLimitSetRef.current) {
            initialLimitSetRef.current = true;
            setLimitPrice(prev => (prev && prev.length > 0) ? prev : q.price.toFixed(2));
          }
        }
      } catch (e) { /* swallow quote fetch error */ }
    };
    fetchQuote();
    const iv = setInterval(fetchQuote, 10000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [ticker]);

  // --- Load and select from broker connection ---
  //
  // We consume useBrokerConnection so this screen always reflects the same
  // multi-account structure the rest of the app uses. Only INVESTMENT
  // accounts on a live connection are eligible for placing orders.
  //
  // CRITICAL: dep uses brokerConn.investmentAccountViews (which is memoized
  // inside the hook on [accounts, positions]) instead of the full brokerConn
  // object literal. Depending on the whole hook return made this filter
  // recompute on every parent render, which cascaded into the initial-load
  // effect below firing on every render and clobbering the user's
  // phase='review' transition (the flash bug).
  const eligibleAccountViews = useMemo(() => {
    if (!brokerConn?.investmentAccountViews) return [];
    // Session 134 — filter to accounts where the live SnapTrade brokerage
    // authorization actually supports trading (allows_trading === true and
    // not disabled). Read-only / disabled connections are hidden entirely
    // so users can't select an account they'd be unable to trade through.
    return brokerConn.investmentAccountViews.filter(v =>
      v.account.connection_disabled !== true &&
      v.account.connection_allows_trading === true,
    );
  }, [brokerConn.investmentAccountViews]);

  // Initial-load effect. Runs ONLY while phase === 'loading_accounts'. Once
  // we transition out of that phase (to 'configure' with data, or to any
  // subsequent phase driven by the user like 'review' / 'submitting'), this
  // effect no longer fires — so nothing here can silently reset the user
  // back to the configure screen after they tap Put in Trade.
  //
  // Session 156 — If the broker has already resolved as inactive by the
  // time this effect runs (e.g. because useBrokerConnection cached
  // state from a previous session), we immediately router.replace() BEFORE
  // ANY visible render of the Order screen. Combined with the phase=='loading_accounts'
  // early return that renders a plain black loader below, this eliminates
  // the Place Order page flashing before the connect page.
  useEffect(() => {
    if (phase !== 'loading_accounts') return;
    if (brokerConn.loading) return; // still fetching; wait

    if (brokerConn.status === 'needs_reconnect') {
      setConnectionActive(false);
      setLoadError('Your brokerage connection needs to be refreshed. Please reconnect in Settings.');
      setPhase('configure');
      return;
    }
    if (brokerConn.status !== 'active' || brokerConn.accounts.length === 0) {
      // Session 136/156/167 — no brokerage connected. Redirect INSTANTLY
      // into the SnapTrade portal loader. redirectedToConnectRef prevents
      // this useEffect from firing router.replace() more than once even
      // if it re-runs before phase actually transitions.
      if (redirectedToConnectRef.current) return;
      redirectedToConnectRef.current = true;
      Haptics.selectionAsync().catch(() => {});
      router.replace('/connect-brokerage?autoOpen=1' as any);
      return;
    }
    if (eligibleAccountViews.length === 0) {
      setConnectionActive(false);
      setLoadError('No eligible investment accounts were returned from your brokerage. Deposit / cash-only accounts cannot place equity orders.');
      setPhase('configure');
      return;
    }

    setConnectionActive(true);
    setLoadError(null);
    const pre = preSelectedAccountId && eligibleAccountViews.find(v => v.account.id === preSelectedAccountId);
    setSelectedAccountId(prev => prev ?? (pre ? pre.account.id : eligibleAccountViews[0]?.account.id ?? null)); // Added null coalescing for safety
    setPhase('configure');
  }, [phase, brokerConn.loading, brokerConn.status, brokerConn.accounts.length, eligibleAccountViews, preSelectedAccountId]);

  const selectedView = useMemo(
    () => eligibleAccountViews.find(v => v.account.id === selectedAccountId),
    [eligibleAccountViews, selectedAccountId],
  );
  const selectedAccount = selectedView?.account;

  // Session 164 — open positions across every eligible account for the
  // current ticker. Rendered as a clickable list ONLY when the user has
  // switched to the SELL action so they can pick a specific position to
  // close (auto-fills the account + quantity + limit price). Positions
  // are never merged across accounts — each brokerage account’s holding
  // is exposed as its own row so users can close the exact position they
  // want to sell.
  const openPositionsForTicker = useMemo(() => {
    if (manualAction !== 'SELL') return [];
    const results: Array<{
      accountId: string;
      accountLabel: string;
      qty: number;
      avgPrice: number;
      currentPrice: number;
    }> = [];
    for (const view of eligibleAccountViews) {
      for (const p of view.positions ?? []) {
        const posTicker = (p.ticker || '').toUpperCase();
        if (posTicker !== ticker.toUpperCase()) continue;
        const qty = Math.abs(Number(p.quantity) || 0);
        if (qty <= 0) continue;
        results.push({
          accountId: view.account.id,
          accountLabel: `${view.account.institution_name ?? 'Brokerage'}${view.account.name ? ' · ' + view.account.name : ''}${view.account.number ? ' ••••' + String(view.account.number).slice(-4) : ''}`,
          qty,
          avgPrice: Number(p.averagePrice) || 0,
          currentPrice: Number(p.currentPrice) || 0,
        });
      }
    }
    return results;
  }, [manualAction, eligibleAccountViews, ticker]);

  // Post-submit account sync polling (every 5 s for 60 s).
  useEffect(() => {
    if (phase !== 'submitted') return;
    let attempts = 0;
    const maxAttempts = 12;
    const doPoll = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        await supabase.functions.invoke('snaptrade-sync-accounts', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        try { await brokerConn.refresh(); } catch (e) { /* swallow refresh error */ }
      } catch (e) { /* swallow poll error */ }
    };
    doPoll();
    const iv = setInterval(() => {
      attempts++;
      doPoll();
      if (attempts >= maxAttempts) clearInterval(iv);
    }, 5000);
    return () => clearInterval(iv);
  }, [phase, brokerConn]);

  // --- Local validation (no SnapTrade call) ---
  const validationError = useMemo(() => {
    if (!isLoggedIn) return 'You must be signed in to place a trade.';
    if (!connectionActive) return loadError ?? 'Your brokerage is not currently connected. Reconnect in Settings.';
    if (!selectedAccount) return 'Please select a brokerage account.';
    if (selectedAccount.connection_disabled) return "The selected account's brokerage connection is disabled. Reconnect in Settings.";
    // Session 155 — explicit read-only check. If the connection is not a
    // trading connection (or does not report allows_trading), refuse the
    // order outright before we ever reach the readiness diagnostic.
    const connType = String(selectedAccount.connection_type ?? 'unknown').toLowerCase();
    const allowsTrading = selectedAccount.connection_allows_trading === true;
    if (connType === 'read' || !allowsTrading) {
      return `${selectedAccount.institution_name ?? 'This brokerage'} is connected in READ-ONLY mode. You can view your portfolio and account information, but Sight cannot place trades for this account. Reconnect the account with trading enabled to place orders.`;
    }
    const cat = String(selectedAccount.account_category ?? 'INVESTMENT').toUpperCase();
    if (cat !== 'INVESTMENT' && cat !== 'UNKNOWN' && cat !== '') {
      return `The selected account is categorized as ${cat}. Only investment accounts can place equity orders.`;
    }
    if (!ticker) return 'No ticker selected.';
    if (action !== 'BUY' && action !== 'SELL') return 'Order side must be Buy or Sell.';
    const qty = Number(shares);
    if (!Number.isFinite(qty) || qty <= 0) return 'Enter a positive share quantity.';
    if (!Number.isInteger(qty)) return 'Enter a whole number of shares.';
    if (!['Market', 'Limit', 'Stop', 'StopLimit'].includes(orderType)) return 'Choose a valid order type.';
    if (!['Day', 'GTC'].includes(timeInForce)) return 'Choose a valid time in force.';
    if (orderType === 'Limit' || orderType === 'StopLimit') {
      const px = Number(limitPrice);
      if (!Number.isFinite(px) || px <= 0) return 'Enter a valid limit price.';
    }
    if (orderType === 'Stop' || orderType === 'StopLimit') {
      const sp = Number(stopPrice);
      if (!Number.isFinite(sp) || sp <= 0) return 'Enter a valid stop trigger price.';
    }
    const referencePx = (orderType === 'Limit' || orderType === 'StopLimit')
      ? Number(limitPrice)
      : (liveQuote ?? suggestedEntry);
    const tp = Number(takeProfit);
    const sl = Number(stopLoss);
    // Session 155 — TP/SL validation is direction-specific. For SELL
    // (closing owned shares) we don't require TP/SL at all; the trade is
    // an exit. For BUY and SHORT the levels must sit on the correct side
    // of the reference price.
    if (!isSellingOwnedShares) {
      if (Number.isFinite(tp) && tp > 0 && Number.isFinite(referencePx) && referencePx > 0) {
        if (position === 'long' && tp <= referencePx) return 'For a long position, Take Profit must be ABOVE the entry price.';
        if (position === 'short' && tp >= referencePx) return 'For a short position, Take Profit must be BELOW the entry price.';
      }
      if (Number.isFinite(sl) && sl > 0 && Number.isFinite(referencePx) && referencePx > 0) {
        if (position === 'long' && sl >= referencePx) return 'For a long position, Stop Loss must be BELOW the entry price.';
        if (position === 'short' && sl <= referencePx) return 'For a short position, Stop Loss must be ABOVE the entry price.';
      }
    }
    // Cash warning (non-fatal): flagged only for BUY market/limit at estimated cost.
    if (action === 'BUY' && selectedView) {
      const estCost = qty * (Number.isFinite(referencePx) ? Number(referencePx) : 0);
      if (Number.isFinite(estCost) && estCost > 0 && selectedView.cash > 0 && estCost > selectedView.cash * 1.05) {
        return `Estimated order value $${estCost.toFixed(2)} exceeds available cash in this account ($${selectedView.cash.toFixed(2)}). Adjust shares or select a different account.`;
      }
    }
    // Session 155 — SELL guardrail: ensure the user actually holds enough
    // shares in the selected account to sell. Prevents Sell from being
    // silently re-interpreted as a short by the broker when the user has
    // no position to close.
    if (isSellingOwnedShares && selectedView) {
      const ownedInAccount = (selectedView.positions ?? [])
        .filter((p) => (p.ticker || '').toUpperCase() === (ticker || '').toUpperCase() && Number(p.quantity) > 0)
        .reduce((sum, p) => sum + Math.abs(Number(p.quantity) || 0), 0);
      if (ownedInAccount <= 0) {
        return `You do not currently own ${ticker} in this account. To open a short position, choose SHORT instead of SELL.`;
      }
      if (qty > ownedInAccount) {
        return `You only own ${ownedInAccount} shares of ${ticker} in this account. Reduce the quantity or choose a different account.`;
      }
    }
    return null;
  }, [isLoggedIn, connectionActive, loadError, selectedAccount, selectedView, ticker, action, shares, orderType, timeInForce,
      limitPrice, stopPrice, takeProfit, stopLoss, position, liveQuote, suggestedEntry, isSellingOwnedShares]);

  // Put in Trade button handler — this NEVER submits the order. It runs
  // local validation, then a diagnostic snaptrade-trade-readiness call to
  // confirm THIS connection + account (+ symbol) is authorized to trade
  // right now (connection.type === 'trade', allows_trading === true,
  // connection not disabled / in maintenance, symbol tradeable). Only if
  // the diagnostic passes do we open the Confirm Trade page.
  const goToConfirmTrade = useCallback(async () => {
    console.log('[PutInTrade] PUT_IN_TRADE_CLICKED');
    console.log('[PutInTrade] ACCOUNT_VALIDATION_STARTED');
    console.log('[PutInTrade] ACCOUNT_ID =', selectedAccount?.id ?? 'none');
    console.log('[PutInTrade] ORDER_VALIDATION_STARTED', {
      ticker, action, orderType, shares, timeInForce,
      hasLimit: !!limitPrice, hasStop: !!stopPrice, hasTP: !!takeProfit, hasSL: !!stopLoss,
    });

    if (!selectedAccount?.id) {
      const msg = 'Please select a brokerage account before continuing.';
      console.log('[PutInTrade] PUT_IN_TRADE_ERROR', { error_code: 'MISSING_ACCOUNT_ID', error_message: msg });
      setErrorMsg(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    if (validationError) {
      console.log('[PutInTrade] ORDER_VALIDATION_RESULT = failed');
      console.log('[PutInTrade] PUT_IN_TRADE_ERROR', { error_code: 'LOCAL_VALIDATION_FAILED', error_message: validationError });
      setErrorMsg(validationError);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }

    // ------------------ Trade Readiness diagnostic ------------------
    // This is the key gate. It inspects the LIVE brokerage authorization
    // (type / allows_trading / disabled / maintenance / degraded), the
    // account, and the symbol against SnapTrade. If any layer is not
    // authorized to trade, we surface the exact reason instead of letting
    // the user swipe and get a mysterious broker rejection.
    setReadinessChecking(true);
    setErrorMsg(null); setErrorCode(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');
      const { data, error } = await supabase.functions.invoke('snaptrade-trade-readiness', {
        body: { accountId: selectedAccount.id, ticker },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) {
        const info = await extractEdgeError(error, 'Trade readiness check failed');
        console.log('[PutInTrade] READINESS_ERROR', info);
        setErrorMsg(info.message);
        setErrorCode(info.code ?? null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return;
      }
      setReadinessReport(data ?? null);
      console.log('[PutInTrade] READINESS_REPORT', data);
      if (data && data.ready !== true) {
        const reason: string = data?.reason ?? 'INVALID_ORDER';
        const message: string = data?.message ?? 'This order is not currently permitted by your broker.';
        console.log('[PutInTrade] PUT_IN_TRADE_ERROR', { error_code: reason, error_message: message });
        setErrorMsg(message);
        setErrorCode(reason);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return;
      }
    } catch (e: any) {
      console.log('[PutInTrade] READINESS_EXCEPTION', e?.message ?? e);
      setErrorMsg(e?.message ?? 'Trade readiness check failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    } finally {
      setReadinessChecking(false);
    }

    console.log('[PutInTrade] ORDER_VALIDATION_RESULT = ok');
    console.log('[PutInTrade] CONFIRM_PAGE_NAVIGATION');
    setErrorMsg(null); setErrorCode(null);
    setPhase('review');
    setSwipeResetKey(k => k + 1);
    Haptics.selectionAsync().catch(() => {});
  }, [validationError, selectedAccount, ticker, action, orderType, shares, timeInForce,
      limitPrice, stopPrice, takeProfit, stopLoss]);

  const submitOrder = useCallback(async () => {
    // Biometric gate.
    try {
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (hasHw && isEnrolled) {
        const res = await LocalAuthentication.authenticateAsync({
          promptMessage: `Confirm ${action} ${shares} ${ticker}`,
          cancelLabel: 'Cancel',
          fallbackLabel: 'Use Passcode',
          disableDeviceFallback: false,
        });
        if (!res.success) {
          setSwipeResetKey(k => k + 1);
          Haptics.selectionAsync().catch(() => {});
          return;
        }
      }
    } catch (e) { /* swallow biometric error */ }

    setPhase('submitting');
    setErrorMsg(null); setErrorCode(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('snaptrade-place-order', {
        body: {
          clientOrderId: clientOrderIdRef.current,
          accountId: selectedAccount?.id,
          ticker,
          action,
          orderType,
          quantity: Number(shares),
          timeInForce,
          ...(orderType === 'Limit' || orderType === 'StopLimit' ? { price: Number(limitPrice) } : {}),
          ...(orderType === 'Stop' || orderType === 'StopLimit' ? { stopPrice: Number(stopPrice) } : {}),
          takeProfit: takeProfit ? Number(takeProfit) : undefined,
          stopLoss: stopLoss ? Number(stopLoss) : undefined,
          signalId,
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) {
        const info = await extractEdgeError(error, 'Order submission failed');
        setErrorMsg(info.message); setErrorCode(info.code ?? null);
        setFinalStatus('REJECTED');
        setPhase('rejected');
        setSwipeResetKey(k => k + 1);
        rotateClientOrderId();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return;
      }
      if (data?.success === false) {
        setErrorMsg(data.message ?? data.error ?? 'Order rejected');
        setErrorCode(data.snapTradeCode ?? data.error ?? null);
        setFinalStatus('REJECTED');
        setPhase('rejected');
        setSwipeResetKey(k => k + 1);
        rotateClientOrderId();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return;
      }

      setSubmittedResponse(data);
      const st = (data?.status ?? 'SUBMITTED') as FinalStatus;
      setFinalStatus(st);
      if (st === 'REJECTED' || st === 'CANCELED') {
        setPhase('rejected');
        setSwipeResetKey(k => k + 1);
        rotateClientOrderId();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      } else {
        setPhase('submitted');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        try { if (signalId) markSignalTaken(signalId); } catch (e) { /* swallow markSignalTaken error */ }

        // Session 151 — log the sale to the Journal when this was a close
        // trade ("I Have Sold" or the Sell button from Stock Details).
        // Prefer closeTradeManually when we have a tradeId (Sight trade);
        // otherwise fall back to addManualClosedTrade using the broker's
        // known average price for the position.
        if (isCloseTrade) {
          const fillPrice = Number(data?.filledPrice ?? limitPrice ?? liveQuote ?? suggestedEntry ?? 0);
          try {
            if (closeTradeId) {
              closeTradeManually(closeTradeId, fillPrice);
            } else if (closeEntryPrice > 0) {
              addManualClosedTrade({
                ticker,
                shares: Number(shares) || 0,
                entryPrice: closeEntryPrice,
                exitPrice: fillPrice,
                position: closePosition,
                tradeType: 'Broker Close',
                source: 'manual',
              });
            }
          } catch { /* swallow logging error */ }
        }

        // Session 192 - StoreReview after a successful trade has been
        // REMOVED. Apple limits Sight to ~3 review prompts per year per
        // user; the scanner shutter path is Sight's authoritative single
        // review trigger (see services/storeReviewService.ts). Firing an
        // additional prompt after a successful broker order spent one
        // of Apple's rare slots at a moment the user is focused on
        // reading the fill status, not rating an app.
      }

      supabase.functions.invoke('snaptrade-sync-accounts', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).catch((e) => { /* swallow sync accounts error */ });
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Order submission failed');
      setFinalStatus('REJECTED');
      setPhase('rejected');
      setSwipeResetKey(k => k + 1);
      rotateClientOrderId();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }, [selectedAccount, ticker, action, orderType, shares, timeInForce, limitPrice,
      stopPrice, takeProfit, stopLoss, signalId, markSignalTaken, rotateClientOrderId,
      isCloseTrade, closeTradeId, closeEntryPrice, closePosition, liveQuote, suggestedEntry,
      closeTradeManually, addManualClosedTrade]);

  const referencePrice = useMemo(() => {
    if (orderType === 'Limit' || orderType === 'StopLimit') return Number(limitPrice) || 0;
    return liveQuote ?? suggestedEntry ?? 0;
  }, [orderType, limitPrice, liveQuote, suggestedEntry]);

  const estimatedValue = useMemo(() => {
    const qty = Number(shares);
    if (!Number.isFinite(qty) || !Number.isFinite(referencePrice)) return 0;
    return qty * referencePrice;
  }, [shares, referencePrice]);

  const actionColor = action === 'BUY' ? t.bullish : t.bearish;
  const canProceed = phase === 'configure' && !!selectedAccount && !!ticker && !validationError;

  // Session 205 — the "I Have Sold" close-trade wording has been REMOVED
  // per user request. The Manage Trade page is now identical to the normal
  // Trade page: the header always reads "Trade", the confirmation reads
  // "Confirm Trade", the swipe reads "Swipe to Confirm Trade", and the
  // success banner reads "Trade Placed". Users pick BUY / SELL / SHORT via
  // the action toggle exactly the same way whether they land here from a
  // Manage-Trade button, a Trade button, or any other entry point.
  const headerTitle =
    phase === 'review' ? 'Confirm Trade'
    : phase === 'submitted' ? 'Order Status'
    : phase === 'rejected' ? 'Order Rejected'
    : phase === 'submitting' ? 'Submitting'
    : 'Trade';

  const accountLabel = selectedAccount
    ? `${selectedAccount.institution_name ?? 'Brokerage'}${selectedAccount.name ? ` · ${selectedAccount.name}` : ''}${selectedAccount.number ? ` ••••${String(selectedAccount.number).slice(-4)}` : ''}`
    : 'No account selected';

  // Session 156 — while broker check is in flight OR we're about to
  // redirect to Connect Brokerage, render an instant plain full-screen
  // loader instead of the Order chrome. This kills the "Place Order page
  // flash" bug entirely: users tapping Put in Trade without a broker see
  // only a spinner until the SnapTrade WebView opens.
  if (
    phase === 'loading_accounts' &&
    (brokerConn.loading || (brokerConn.status !== 'active' || brokerConn.accounts.length === 0))
  ) {
    return (
      <View style={{ flex: 1, backgroundColor: t.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={t.primary} />
        <Text style={{ marginTop: 14, fontSize: 14, fontWeight: '600', color: t.textPrimary }}>Preparing your trade…</Text>
        <Text style={{ marginTop: 4, fontSize: 12, color: t.textSecondary, paddingHorizontal: 40, textAlign: 'center' }}>
          {brokerConn.loading ? 'Checking your brokerage connection…' : 'Opening secure brokerage link…'}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.background }}>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            if (phase === 'review') {
              setPhase('configure');
              setSwipeResetKey(k => k + 1);
              Haptics.selectionAsync().catch(() => {});
              return;
            }
            Haptics.selectionAsync().catch(() => {});
            router.back();
          }}
          disabled={phase === 'submitting'}
          style={[styles.headerBtn, { backgroundColor: t.surface, borderColor: t.border, opacity: phase === 'submitting' ? 0.5 : 1 }]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialIcons name="arrow-back" size={22} color={t.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: t.textPrimary }]}>{headerTitle}</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={phase !== 'submitting'}
        >
          {/* HERO BANNER */}
          <View style={[styles.banner, { backgroundColor: actionColor + '18', borderColor: actionColor + '55' }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: actionColor, letterSpacing: 1 }}>
                {action} · {tradeType ?? 'ORDER'}
              </Text>
              <Text style={{ fontSize: 26, fontWeight: '800', color: t.textPrimary, marginTop: 2 }}>{ticker || '—'}</Text>
              {liveQuote !== null ? (
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: t.textPrimary }}>${liveQuote.toFixed(2)}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: liveChangePercent >= 0 ? t.bullish : t.bearish }}>
                    {liveChangePercent >= 0 ? '+' : ''}{liveChangePercent.toFixed(2)}%
                  </Text>
                  <View style={{ backgroundColor: t.bullish + '22', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3, marginLeft: 2 }}>
                    <Text style={{ fontSize: 9, fontWeight: '800', color: t.bullish, letterSpacing: 0.5 }}>LIVE</Text>
                  </View>
                </View>
              ) : (
                <Text style={{ fontSize: 11, color: t.textTertiary, marginTop: 4 }}>Fetching live quote…</Text>
              )}
            </View>
            <MaterialIcons name={action === 'BUY' ? 'trending-up' : 'trending-down'} size={44} color={actionColor} />
          </View>

          {/* CONFIGURE PHASE */}
          {(phase === 'configure' || phase === 'loading_accounts') ? (
            <>
              {/* Session 153 — BUY / SELL / SHORT action toggle. Only
                  shown for genuinely manual orders (no signalId, not a
                  close-trade flow), so AI Move / Chart Scan / I Have
                  Sold entries keep their locked direction. */}
              {!isCloseTrade && !signalId ? (
                <View style={styles.section}>
                  <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>ACTION</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {(['BUY', 'SELL', 'SHORT'] as const).map(opt => {
                      const selected = manualAction === opt;
                      const optColor = opt === 'BUY' ? t.bullish : t.bearish;
                      const optIcon = opt === 'BUY' ? 'trending-up' : opt === 'SELL' ? 'sell' : 'trending-down';
                      return (
                        <Pressable
                          key={opt}
                          onPress={() => { setManualAction(opt); Haptics.selectionAsync().catch(() => {}); }}
                          style={({ pressed }) => [
                            styles.chipBtn,
                            {
                              backgroundColor: selected ? optColor : t.surface,
                              borderColor: selected ? optColor : t.border,
                              opacity: pressed ? 0.85 : 1,
                              flex: 1,
                              flexDirection: 'row',
                              gap: 6,
                            },
                          ]}
                        >
                          <MaterialIcons name={optIcon as any} size={16} color={selected ? '#FFF' : optColor} />
                          <Text style={{ fontSize: 13, fontWeight: '800', color: selected ? '#FFF' : t.textPrimary, letterSpacing: 0.5 }}>
                            {opt}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={{ fontSize: 11, color: t.textTertiary, marginTop: 8, lineHeight: 16 }}>
                    {manualAction === 'BUY'
                      ? 'Open a long position. Broker submits a BUY order.'
                      : manualAction === 'SELL'
                        ? 'Close an existing long position. Broker submits a SELL order.'
                        : 'Open a new short position. Broker submits a SELL order. Requires a margin-enabled account.'}
                  </Text>
                </View>
              ) : null}

              {/* Session 164 — On the SELL tab, show the user's OPEN
                  positions in this ticker across every eligible account.
                  Clicking a position auto-selects its account, sets the
                  quantity to the full position size, prefills the limit
                  price with the live quote, and clears TP/SL (a sell is
                  closing an existing position, not opening one). If the
                  user has no open positions they see a friendly explainer
                  suggesting SHORT or BUY instead. This section is
                  intentionally NOT shown on BUY or SHORT so users placing
                  fresh orders aren’t distracted by irrelevant data. */}
              {manualAction === 'SELL' ? (
                <View style={styles.section}>
                  <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>
                    YOUR OPEN {ticker} POSITIONS · {openPositionsForTicker.length} FOUND
                  </Text>
                  {openPositionsForTicker.length === 0 ? (
                    <View style={[styles.warningBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                      <MaterialIcons name="info-outline" size={18} color={t.textTertiary} />
                      <Text style={{ flex: 1, fontSize: 13, color: t.textSecondary, lineHeight: 19 }}>
                        You don’t have any open {ticker} positions in your connected accounts. Switch to SHORT to open a new short, or BUY to open a long.
                      </Text>
                    </View>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {openPositionsForTicker.map((pos, i) => {
                        const isSelected = pos.accountId === selectedAccountId && Number(shares) === pos.qty;
                        const pnlPct = pos.avgPrice > 0 && pos.currentPrice > 0
                          ? ((pos.currentPrice - pos.avgPrice) / pos.avgPrice) * 100
                          : null;
                        const pnlColor = pnlPct === null ? t.textTertiary : (pnlPct >= 0 ? t.bullish : t.bearish);
                        return (
                          <Pressable
                            key={`${pos.accountId}-${i}`}
                            onPress={() => {
                              setSelectedAccountId(pos.accountId);
                              setShares(String(pos.qty));
                              if (pos.currentPrice > 0) setLimitPrice(pos.currentPrice.toFixed(2));
                              setTakeProfit('');
                              setStopLoss('');
                              Haptics.selectionAsync().catch(() => {});
                            }}
                            style={({ pressed }) => [
                              styles.rowCard,
                              {
                                backgroundColor: isSelected ? t.bearish + '18' : t.surface,
                                borderColor: isSelected ? t.bearish : t.border,
                                opacity: pressed ? 0.85 : 1,
                              },
                            ]}
                          >
                            <MaterialIcons name={isSelected ? 'radio-button-checked' : 'account-balance-wallet'} size={20} color={isSelected ? t.bearish : t.textTertiary} />
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 15, fontWeight: '700', color: t.textPrimary }}>
                                Sell {pos.qty} share{pos.qty === 1 ? '' : 's'}
                              </Text>
                              <Text style={{ fontSize: 12, color: t.textSecondary, marginTop: 2 }} numberOfLines={1}>
                                {pos.accountLabel}
                              </Text>
                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                                <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: t.background }}>
                                  <Text style={{ fontSize: 10, fontWeight: '700', color: t.textTertiary }}>
                                    AVG ${pos.avgPrice > 0 ? pos.avgPrice.toFixed(2) : '—'}
                                  </Text>
                                </View>
                                <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: t.background }}>
                                  <Text style={{ fontSize: 10, fontWeight: '700', color: t.textTertiary }}>
                                    NOW ${pos.currentPrice > 0 ? pos.currentPrice.toFixed(2) : '—'}
                                  </Text>
                                </View>
                                {pnlPct !== null ? (
                                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: pnlColor + '22' }}>
                                    <Text style={{ fontSize: 10, fontWeight: '800', color: pnlColor }}>
                                      {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                                    </Text>
                                  </View>
                                ) : null}
                              </View>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              ) : null}

              {/* Account picker — every eligible investment account with its
                  authoritative broker total AND cash. First eligible account
                  is preselected as a convenience but the user must confirm. */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>
                  BROKERAGE ACCOUNT · {eligibleAccountViews.length} ELIGIBLE
                </Text>
                {phase === 'loading_accounts' ? (
                  <View style={[styles.loaderBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                    <ActivityIndicator color={t.primary} />
                    <Text style={{ marginLeft: 10, color: t.textSecondary, fontSize: 13 }}>Loading brokerage accounts…</Text>
                  </View>
                ) : eligibleAccountViews.length === 0 ? (
                  <View style={[styles.warningBox, { backgroundColor: t.surface, borderColor: t.bearish + '55' }]}>
                    <MaterialIcons name="error-outline" size={20} color={t.bearish} />
                    <Text style={{ flex: 1, color: t.textPrimary, fontSize: 13, lineHeight: 19 }}>
                      {loadError ?? 'No brokerage accounts available.'}
                    </Text>
                  </View>
                ) : (
                  eligibleAccountViews.map((view) => {
                    const acc = view.account;
                    const selected = acc.id === selectedAccountId;
                    return (
                      <Pressable
                        key={acc.id}
                        onPress={() => { setSelectedAccountId(acc.id); Haptics.selectionAsync().catch(() => {}); }}
                        style={({ pressed }) => [
                          styles.rowCard,
                          {
                            backgroundColor: selected ? t.primary + '18' : t.surface,
                            borderColor: selected ? t.primary : t.border,
                            opacity: pressed ? 0.85 : 1,
                          },
                        ]}
                      >
                        <MaterialIcons name={selected ? 'radio-button-checked' : 'radio-button-unchecked'} size={20} color={selected ? t.primary : t.textTertiary} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 15, fontWeight: '700', color: t.textPrimary }} numberOfLines={1}>
                            {acc.institution_name ?? 'Brokerage'}{acc.name ? ` · ${acc.name}` : ''}
                          </Text>
                          <Text style={{ fontSize: 11, color: t.textSecondary, marginTop: 2 }}>
                            {acc.number ? `Account ••••${String(acc.number).slice(-4)}` : 'Account'}
                            {acc.is_paper ? ' · PAPER' : ''}
                          </Text>
                          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                            <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: t.background }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: t.textTertiary }}>
                                TOTAL ${view.totalValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                              </Text>
                            </View>
                            <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: t.background }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: t.textTertiary }}>
                                CASH ${view.cash.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </Pressable>
                    );
                  })
                )}
                {eligibleAccountViews.length === 0 && !connectionActive ? (
                  <View style={{ marginTop: 12, gap: 8 }}>
                    <Pressable
                      onPress={() => { Haptics.selectionAsync().catch(() => {}); router.replace('/connect-brokerage' as any); }}
                      style={({ pressed }) => [styles.primaryBtn, { backgroundColor: t.primary, opacity: pressed ? 0.85 : 1 }]}
                    >
                      <MaterialIcons name="link" size={20} color="#FFF" />
                      <Text style={styles.primaryBtnText}>Connect Brokerage</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { Haptics.selectionAsync().catch(() => {}); router.back(); }}
                      style={({ pressed }) => [styles.secondaryBtn, { borderColor: t.border, opacity: pressed ? 0.85 : 1 }]}
                    >
                      <Text style={[styles.secondaryBtnText, { color: t.textPrimary }]}>Maybe Later</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>

              {eligibleAccountViews.length > 0 ? (
                <>
                  <View style={styles.section}>
                    <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>ORDER TYPE</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {(['Market', 'Limit', 'Stop', 'StopLimit'] as OrderType[]).map(opt => {
                        const selected = orderType === opt;
                        return (
                          <Pressable
                            key={opt}
                            onPress={() => { setOrderType(opt); Haptics.selectionAsync().catch(() => {}); }}
                            style={({ pressed }) => [
                              styles.chipBtn,
                              {
                                backgroundColor: selected ? t.primary : t.surface,
                                borderColor: selected ? t.primary : t.border,
                                opacity: pressed ? 0.85 : 1,
                              },
                            ]}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '700', color: selected ? '#FFF' : t.textPrimary }}>
                              {opt === 'StopLimit' ? 'Stop-Limit' : opt}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {orderType === 'Market' ? (
                      <Text style={{ fontSize: 11, color: t.textTertiary, marginTop: 8, lineHeight: 17 }}>
                        Market orders execute at the best available price. The final fill price may differ from the current quote shown.
                      </Text>
                    ) : orderType === 'Limit' ? (
                      <Text style={{ fontSize: 11, color: t.textTertiary, marginTop: 8, lineHeight: 17 }}>
                        Limit orders only fill at your specified price or better. If the market never reaches your price, the order stays open until it expires or you cancel it.
                      </Text>
                    ) : orderType === 'Stop' ? (
                      <Text style={{ fontSize: 11, color: t.textTertiary, marginTop: 8, lineHeight: 17 }}>
                        Stop orders trigger a market order once the stop price is reached. Once triggered, the order will execute at the next available price — which may differ from the stop trigger.
                      </Text>
                    ) : orderType === 'StopLimit' ? (
                      <Text style={{ fontSize: 11, color: t.textTertiary, marginTop: 8, lineHeight: 17 }}>
                        Stop-Limit orders trigger a limit order at your specified price once the stop trigger price is reached. Best for controlling fill price but may not execute if the market moves past your limit quickly.
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.section}>
                    <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>TIME IN FORCE</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {(['Day', 'GTC'] as TimeInForce[]).map(opt => {
                        const selected = timeInForce === opt;
                        return (
                          <Pressable
                            key={opt}
                            onPress={() => { setTimeInForce(opt); Haptics.selectionAsync().catch(() => {}); }}
                            style={({ pressed }) => [
                              styles.chipBtn,
                              {
                                backgroundColor: selected ? t.primary : t.surface,
                                borderColor: selected ? t.primary : t.border,
                                opacity: pressed ? 0.85 : 1,
                                flex: 1,
                              },
                            ]}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '700', color: selected ? '#FFF' : t.textPrimary }}>
                              {opt === 'Day' ? 'Day' : 'Good Til Canceled'}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <View style={styles.section}>
                    <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>SHARES</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: t.surface, borderColor: t.border, color: t.textPrimary }]}
                      keyboardType="numeric"
                      value={shares}
                      onChangeText={(v) => setShares(v.replace(/[^0-9]/g, ''))}
                      placeholder="Number of shares"
                      placeholderTextColor={t.textTertiary}
                    />
                  </View>

                  {(orderType === 'Limit' || orderType === 'StopLimit') ? (
                    <View style={styles.section}>
                      <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>LIMIT PRICE (USD)</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: t.surface, borderColor: t.border, color: t.textPrimary }]}
                        keyboardType="decimal-pad"
                        value={limitPrice}
                        onChangeText={setLimitPrice}
                        placeholder={suggestedEntry ? `Suggested: $${suggestedEntry.toFixed(2)}` : '$0.00'}
                        placeholderTextColor={t.textTertiary}
                      />
                    </View>
                  ) : null}

                  {(orderType === 'Stop' || orderType === 'StopLimit') ? (
                    <View style={styles.section}>
                      <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>STOP TRIGGER PRICE (USD)</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: t.surface, borderColor: t.border, color: t.textPrimary }]}
                        keyboardType="decimal-pad"
                        value={stopPrice}
                        onChangeText={setStopPrice}
                        placeholder="Trigger price"
                        placeholderTextColor={t.textTertiary}
                      />
                    </View>
                  ) : null}

                  {/* Session 205 — TP / SL is meaningless for a SELL that
                      closes an existing position, so we hide the entire
                      section when the user has chosen SELL. BUY and SHORT
                      still show TP / SL because those actions OPEN new
                      positions and benefit from protective exits. */}
                  {manualAction !== 'SELL' ? (
                  <View style={styles.section}>
                    <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>TAKE PROFIT & STOP LOSS (OPTIONAL)</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: t.bullish, marginBottom: 4 }}>TAKE PROFIT</Text>
                        <TextInput
                          style={[styles.input, { backgroundColor: t.surface, borderColor: t.bullish + '55', color: t.textPrimary }]}
                          keyboardType="decimal-pad"
                          value={takeProfit}
                          onChangeText={setTakeProfit}
                          placeholder={position === 'long' ? 'Above entry' : 'Below entry'}
                          placeholderTextColor={t.textTertiary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: t.bearish, marginBottom: 4 }}>STOP LOSS</Text>
                        <TextInput
                          style={[styles.input, { backgroundColor: t.surface, borderColor: t.bearish + '55', color: t.textPrimary }]}
                          keyboardType="decimal-pad"
                          value={stopLoss}
                          onChangeText={setStopLoss}
                          placeholder={position === 'long' ? 'Below entry' : 'Above entry'}
                          placeholderTextColor={t.textTertiary}
                        />
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: t.primary + '10', borderRadius: 10, borderWidth: 1, borderColor: t.primary + '55' }}>
                      <MaterialIcons name="shield" size={16} color={t.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: t.primary, marginBottom: 3, letterSpacing: 0.3 }}>HOW TP/SL WORKS</Text>
                        <Text style={{ fontSize: 11, color: t.textSecondary, lineHeight: 16 }}>
                          <Text style={{ fontWeight: '700', color: t.textPrimary }}>1. Broker-native bracket:</Text> Sight first asks your broker to attach TP/SL directly to your order.{'\n'}
                          <Text style={{ fontWeight: '700', color: t.textPrimary }}>2. Separate resting orders:</Text> If your broker doesn’t accept bracket orders, Sight submits TP/SL as separate SnapTrade resting orders.{'\n'}
                          <Text style={{ fontWeight: '700', color: t.textPrimary }}>3. Sight-managed exit:</Text> If neither is possible for this account, Sight monitors the price and places a closing order automatically when TP or SL is reached. You’ll see the method used on the confirmation page.
                        </Text>
                      </View>
                    </View>
                  </View>
                  ) : null}

                  {validationError ? (
                    <View style={[styles.warningBox, { backgroundColor: t.bearishBg ?? (t.bearish + '18'), borderColor: t.bearish + '55', marginTop: 8 }]}>
                      <MaterialIcons name="warning" size={18} color={t.bearish} />
                      <Text style={{ flex: 1, fontSize: 12, color: t.textPrimary, lineHeight: 18 }}>{validationError}</Text>
                    </View>
                  ) : null}

                  {errorMsg && !validationError ? (
                    <View style={[styles.warningBox, { backgroundColor: t.bearishBg ?? (t.bearish + '18'), borderColor: t.bearish + '55', marginTop: 8 }]}>
                      <MaterialIcons name="error-outline" size={18} color={t.bearish} />
                      <Text style={{ flex: 1, fontSize: 12, color: t.textPrimary, lineHeight: 18 }}>
                        {errorMsg}{errorCode ? `  [${errorCode}]` : ''}
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : null}

              {eligibleAccountViews.length > 0 ? (
                <Pressable
                  onPress={goToConfirmTrade}
                  disabled={!canProceed || readinessChecking}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    {
                      backgroundColor: actionColor, marginTop: 20,
                      opacity: (!canProceed || pressed || readinessChecking) ? 0.7 : 1,
                    },
                  ]}
                >
                  {readinessChecking ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <MaterialIcons name="arrow-forward" size={20} color="#FFF" />
                  )}
                  <Text style={styles.primaryBtnText}>{readinessChecking ? 'Checking with broker…' : 'Trade'}</Text>
                </Pressable>
              ) : null}

              {/* Read-only connection escape hatch — if the readiness check
                  reported CONNECTION_READ_ONLY, offer a shortcut back to
                  Settings so the user can reconnect with trading enabled. */}
              {readinessReport && readinessReport.ready === false &&
                (readinessReport.reason === 'CONNECTION_READ_ONLY' || readinessReport.reason === 'BROKER_TRADING_UNAVAILABLE') ? (
                <Pressable
                  onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push('/connect-brokerage' as any); }}
                  style={({ pressed }) => [styles.secondaryBtn, { borderColor: t.primary, marginTop: 10, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Text style={[styles.secondaryBtnText, { color: t.primary }]}>Enable Trading in Settings</Text>
                </Pressable>
              ) : null}

              <View style={[styles.infoCard, { backgroundColor: t.surface, borderColor: t.border, marginTop: 20 }]}>
                <MaterialIcons name="shield" size={18} color={t.primary} />
                <Text style={{ flex: 1, fontSize: 12, color: t.textSecondary, lineHeight: 18 }}>
                  Orders go through SnapTrade to the exact brokerage account you selected. Sight never sees your broker credentials. Tapping Put in Trade only opens the confirmation page — nothing is submitted until you complete the swipe on the next screen.
                </Text>
              </View>
            </>
          ) : null}

          {/* REVIEW PHASE */}
          {phase === 'review' ? (
            <>
              <View style={[styles.reviewCard, { borderColor: actionColor + '55', backgroundColor: t.surface, marginTop: 16 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <MaterialIcons name="assignment" size={18} color={actionColor} />
                  <Text style={{ fontSize: 12, fontWeight: '800', color: actionColor, letterSpacing: 1 }}>CONFIRM TRADE</Text>
                </View>
                <Text style={{ fontSize: 13, color: t.textSecondary, lineHeight: 19, marginBottom: 12 }}>
                  Review every detail below. Swipe the control to send this order to <Text style={{ fontWeight: '700', color: t.textPrimary }}>{accountLabel}</Text>. Nothing is submitted until the swipe completes.
                </Text>

                <View style={styles.reviewGrid}>
                  <ReviewCell label="Action" value={action} valueColor={actionColor} t={t} />
                  <ReviewCell label="Ticker" value={ticker} t={t} />
                  <ReviewCell label="Shares" value={String(shares)} t={t} />
                  <ReviewCell label="Order Type" value={orderType === 'StopLimit' ? 'Stop-Limit' : orderType} t={t} />
                  {orderType === 'Limit' || orderType === 'StopLimit' ? (
                    <ReviewCell label="Limit Price" value={`$${Number(limitPrice).toFixed(2)}`} t={t} />
                  ) : null}
                  {orderType === 'Stop' || orderType === 'StopLimit' ? (
                    <ReviewCell label="Stop Trigger" value={`$${Number(stopPrice).toFixed(2)}`} t={t} />
                  ) : null}
                  {orderType === 'Market' ? (
                    <ReviewCell label="Est. Fill" value={liveQuote ? `~$${liveQuote.toFixed(2)}` : '—'} t={t} />
                  ) : null}
                  <ReviewCell label="Time in Force" value={timeInForce} t={t} />
                  <ReviewCell label="Est. Value" value={`$${estimatedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} t={t} />
                  {takeProfit ? <ReviewCell label="Take Profit" value={`$${Number(takeProfit).toFixed(2)}`} valueColor={t.bullish} t={t} /> : null}
                  {stopLoss ? <ReviewCell label="Stop Loss" value={`$${Number(stopLoss).toFixed(2)}`} valueColor={t.bearish} t={t} /> : null}
                </View>

                <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.border }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: t.textTertiary, marginBottom: 4 }}>BROKERAGE ACCOUNT</Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: t.textPrimary }}>
                    {selectedAccount?.institution_name ?? 'Brokerage'}
                    {selectedAccount?.name ? ` · ${selectedAccount.name}` : ''}
                  </Text>
                  {selectedAccount?.number ? (
                    <Text style={{ fontSize: 12, color: t.textSecondary, marginTop: 2 }}>Account ••••{String(selectedAccount.number).slice(-4)}</Text>
                  ) : null}
                  {selectedView ? (
                    <Text style={{ fontSize: 11, color: t.textTertiary, marginTop: 2 }}>
                      Total ${selectedView.totalValue.toLocaleString('en-US', { maximumFractionDigits: 2 })} · Cash ${selectedView.cash.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </Text>
                  ) : null}
                </View>
              </View>

              {(takeProfit || stopLoss) ? (
                <View style={[styles.infoCard, { backgroundColor: t.surface, borderColor: t.border, marginTop: 12 }]}>
                  <MaterialIcons name="shield" size={18} color={t.primary} />
                  <Text style={{ flex: 1, fontSize: 12, color: t.textSecondary, lineHeight: 18 }}>
                    <Text style={{ fontWeight: '700', color: t.textPrimary }}>TP/SL protection active.</Text> Sight will try your broker's native bracket first, then a SnapTrade resting order, and finally Sight-managed monitoring as a fallback. Every trade is logged to your Sight Journal the moment it closes — winners and losers alike.
                  </Text>
                </View>
              ) : null}

              <View style={[styles.infoCard, { backgroundColor: t.primary + '10', borderColor: t.primary + '55', marginTop: 12 }]}>
                <MaterialIcons name="warning" size={18} color={t.primary} />
                <Text style={{ flex: 1, fontSize: 12, color: t.textPrimary, lineHeight: 18, fontWeight: '600' }}>
                  Once you swipe below, this order is sent directly to the brokerage and cannot be undone from Sight. Cancel or modify from your broker's app if needed.
                </Text>
              </View>

              <View style={{ marginTop: 20 }}>
                <SwipeToConfirm
                  label="Swipe to Confirm Trade"
                  color={actionColor}
                  textColor="#FFFFFF"
                  onConfirm={submitOrder}
                  disabled={phase !== 'review'}
                  resetKey={swipeResetKey}
                />
              </View>

              <Pressable
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setPhase('configure');
                  setSwipeResetKey(k => k + 1);
                }}
                style={({ pressed }) => [styles.secondaryBtn, { borderColor: t.border, marginTop: 12, opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={[styles.secondaryBtnText, { color: t.textPrimary }]}>Edit Order</Text>
              </Pressable>
            </>
          ) : null}

          {/* SUBMITTING */}
          {phase === 'submitting' ? (
            <View style={[styles.reviewCard, { borderColor: t.primary + '55', backgroundColor: t.surface, marginTop: 16, alignItems: 'center', paddingVertical: 32 }]}>
              <ActivityIndicator size="large" color={t.primary} />
              <Text style={{ fontSize: 16, fontWeight: '700', color: t.textPrimary, marginTop: 16 }}>Submitting Order…</Text>
              <Text style={{ fontSize: 12, color: t.textSecondary, marginTop: 4, textAlign: 'center', lineHeight: 18 }}>
                Sending {action} {shares} {ticker} to {accountLabel}.
              </Text>
            </View>
          ) : null}

          {/* SUBMITTED */}
          {phase === 'submitted' ? (
            <>
              {/* Session 152 — prominent animated success checkmark. Springs
                  in when the broker accepts the order so the user sees an
                  unmistakable confirmation before the details card. */}
              <Animated.View
                style={{
                  alignItems: 'center',
                  marginTop: 20,
                  marginBottom: 4,
                  transform: [{ scale: submitSuccessScale }],
                }}
              >
                <View
                  style={[
                    styles.successCircle,
                    {
                      backgroundColor: t.bullish,
                      ...Platform.select({
                        ios: { shadowColor: t.bullish, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
                        android: { elevation: 12 },
                        default: {},
                      }),
                    },
                  ]}
                >
                  <MaterialIcons name="check" size={64} color="#FFFFFF" />
                </View>
                <Text style={{ fontSize: 22, fontWeight: '800', color: t.bullish, marginTop: 14, textAlign: 'center' }}>
                  Trade Placed
                </Text>
                <Text style={{ fontSize: 13, color: t.textSecondary, marginTop: 4, textAlign: 'center', paddingHorizontal: 40, lineHeight: 18 }}>
                  Your broker has accepted the order.
                </Text>
              </Animated.View>
              <View style={[styles.reviewCard, { borderColor: t.bullish + '55', backgroundColor: t.surface, marginTop: 16 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <MaterialIcons
                    name={finalStatus === 'FILLED' ? 'check-circle' : finalStatus === 'PARTIALLY_FILLED' ? 'hourglass-top' : 'schedule'}
                    size={22}
                    color={finalStatus === 'FILLED' ? t.bullish : t.primary}
                  />
                  <Text style={{ fontSize: 12, fontWeight: '800', color: finalStatus === 'FILLED' ? t.bullish : t.primary, letterSpacing: 1 }}>
                    {finalStatus === 'FILLED' ? 'TRADE EXECUTED'
                     : finalStatus === 'PARTIALLY_FILLED' ? 'ORDER PARTIALLY FILLED'
                     : finalStatus === 'PENDING' ? 'ORDER PENDING'
                     : 'ORDER SUBMITTED'}
                  </Text>
                </View>
                <Text style={{ fontSize: 14, color: t.textSecondary, lineHeight: 20 }}>
                  {submittedResponse?.message ??
                    (finalStatus === 'FILLED'
                      ? `Your ${action} order for ${shares} ${ticker} was filled by the brokerage.`
                      : finalStatus === 'PARTIALLY_FILLED'
                      ? `Your ${action} order for ${shares} ${ticker} was partially filled. The remainder is still working.`
                      : `Your ${action} order for ${shares} ${ticker} was submitted to ${accountLabel}. Sight will update Active Trades once the broker confirms execution.`)}
                </Text>
                {submittedResponse?.providerOrderId ? (
                  <Text style={{ marginTop: 8, fontSize: 11, color: t.textTertiary }}>
                    Broker order ID: {submittedResponse.providerOrderId}
                  </Text>
                ) : null}
                {submittedResponse?.filledQuantity ? (
                  <Text style={{ marginTop: 4, fontSize: 12, color: t.textPrimary }}>
                    Filled: {submittedResponse.filledQuantity}{submittedResponse.filledPrice ? ` @ $${Number(submittedResponse.filledPrice).toFixed(2)}` : ''}
                  </Text>
                ) : null}
              </View>

              <Pressable
                onPress={() => { Haptics.selectionAsync().catch(() => {}); router.replace('/(tabs)' as any); }}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: t.primary, marginTop: 16, opacity: pressed ? 0.85 : 1 }]}
              >
                <MaterialIcons name="home" size={20} color="#FFF" />
                <Text style={styles.primaryBtnText}>Back to Portfolio</Text>
              </Pressable>
            </>
          ) : null}

          {/* REJECTED */}
          {phase === 'rejected' ? (
            <>
              <View style={[styles.reviewCard, { borderColor: t.bearish + '55', backgroundColor: t.surface, marginTop: 16 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <MaterialIcons name="cancel" size={22} color={t.bearish} />
                  <Text style={{ fontSize: 12, fontWeight: '800', color: t.bearish, letterSpacing: 1 }}>ORDER REJECTED</Text>
                </View>
                <Text style={{ fontSize: 14, color: t.textSecondary, lineHeight: 20 }}>
                  {errorMsg ?? 'The broker rejected this order.'}{errorCode ? `  [${errorCode}]` : ''}
                </Text>
                <Text style={{ marginTop: 8, fontSize: 12, color: t.textTertiary, lineHeight: 18 }}>
                  No position was created. You can adjust the order and try again.
                </Text>
              </View>

              <Pressable
                onPress={() => {
                  setPhase('configure');
                  setErrorMsg(null); setErrorCode(null); setFinalStatus(null);
                  setSwipeResetKey(k => k + 1);
                  Haptics.selectionAsync().catch(() => {});
                }}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: t.primary, marginTop: 16, opacity: pressed ? 0.85 : 1 }]}
              >
                <MaterialIcons name="refresh" size={20} color="#FFF" />
                <Text style={styles.primaryBtnText}>Adjust Order</Text>
              </Pressable>
              <Pressable
                onPress={() => { Haptics.selectionAsync().catch(() => {}); router.back(); }}
                style={({ pressed }) => [styles.secondaryBtn, { borderColor: t.border, marginTop: 10, opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={[styles.secondaryBtnText, { color: t.textPrimary }]}>Cancel</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  headerBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', textAlign: 'center' },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 8,
  },

  section: { marginTop: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  loaderBox: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 16, borderRadius: 12, borderWidth: 1 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  chipBtn: { paddingHorizontal: 16, height: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  input: { height: 48, borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, fontSize: 15, fontWeight: '600' },

  warningBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, padding: 12 },

  reviewCard: { borderRadius: 16, borderWidth: 1.5, padding: 16 },
  reviewGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },

  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 14 },
  primaryBtnText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  secondaryBtn: { height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontSize: 14, fontWeight: '700' },

  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 12, borderWidth: 1, padding: 14 },

  successCircle: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center',
  },

  swipeTrack: {
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    paddingHorizontal: 4,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 6 },
      default: {},
    }),
  },
  swipeLabel: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  swipeThumb: {
    position: 'absolute',
    left: 4,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 4 },
      default: {},
    }),
  },
});
