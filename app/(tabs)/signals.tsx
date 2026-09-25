
/**
 * Moves Tab — Session 120 redesign
 * =============================================================================
 * • AI Move cards start COLLAPSED — only levels, confidence, trade type,
 *   expected duration visible. Tap card to expand reasoning.
 * • Expanded reasoning is broken into structured sections:
 *   Price Action / GEX / Order Flow / Volume / News / Fundamentals / Overall.
 *   Empty sections are omitted (never fabricated).
 * • Every Move shows Expected Duration ("Today", "1-2 days", etc.)
 * • Smooth expand via LayoutAnimation.
 * • Log Trade → prefilled modal → addTradeWithTPSL → signal disappears.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform, LayoutAnimation, UIManager } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay, Easing, cancelAnimation } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useApp, AISignal } from '../../contexts/AppContext';
import { validateTrade } from '../../services/tradeService';
import { StockLogo } from '../../components/ui/StockLogo';
import { useBrokerConnection } from '../../hooks/useBrokerConnection';
import { useAlert } from '@/template';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SECTION_META: Array<{ key: string; title: string; icon: string }> = [
  { key: 'priceAction',   title: 'Price Action',    icon: 'timeline' },
  { key: 'gexOptions',    title: 'GEX / Options',   icon: 'insights' },
  { key: 'orderFlow',     title: 'Order Flow',      icon: 'swap-vert' },
  { key: 'volume',        title: 'Volume',          icon: 'bar-chart' },
  { key: 'news',          title: 'News',            icon: 'article' },
  { key: 'fundamentals',  title: 'Fundamentals',    icon: 'business-center' },
  { key: 'overallSetup',  title: 'Overall Setup',   icon: 'flag' },
];

function useShake() {
  const tx = useSharedValue(0);
  useEffect(() => {
    const ease = Easing.inOut(Easing.sin);
    tx.value = withRepeat(
      withSequence(
        withDelay(5000, withTiming(-3, { duration: 90, easing: ease })),
        withTiming(3, { duration: 90, easing: ease }),
        withTiming(-3, { duration: 90, easing: ease }),
        withTiming(3, { duration: 90, easing: ease }),
        withTiming(0, { duration: 90, easing: ease }),
      ), -1, false,
    );
  }, [tx]); // Add tx to the dependency array
  return useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
}

function MovesUnlockBlocker({ onPress, primary }: { onPress: () => void; primary: string }) {
  const shakeStyle = useShake();
  return (
    <Pressable
      style={({ pressed }) => [StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 24, opacity: pressed ? 0.92 : 1 }]}
      onPress={onPress}
    >
      <View style={[styles.lockIconCircle, { backgroundColor: 'rgba(59,130,246,0.15)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)' }]}>
        <MaterialIcons name="lock" size={32} color="#3B82F6" />
      </View>
      <Text style={{ fontSize: 24, fontWeight: '800', color: '#FFF', marginBottom: 6, letterSpacing: -0.5 }}>AI Moves</Text>
      <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 20, marginBottom: 24, paddingHorizontal: 16 }}>
        Actionable BUY / SHORT setups from a continuous multi-model scan — 85% confidence minimum.
      </Text>
      <Animated.View pointerEvents="none" style={[shakeStyle, styles.unlockBtn, { backgroundColor: primary }]}>
        <Text style={styles.unlockText}>Unlock Pro</Text>
      </Animated.View>
    </Pressable>
  );
}

export default function MovesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const {
    isSubscribed, currentTheme: t,
    activeAISignals, aiSignalsLoading, refreshAISignals, aiScanStats,
    aiSignalsTakenIds, aiSignalsMissedIds, markSignalTaken, markSignalMissed,
    addTradeWithTPSL, portfolio,
  } = useApp();
  // Session 127 — when a brokerage is connected, the Log Trade button on
  // each AI Move becomes a Put in Trade button that opens the real order
  // confirmation flow (SnapTrade impact check → biometric → placeOrder).
  const { hasActiveConnection: brokerConnected, refresh: refreshBroker } = useBrokerConnection();
  useEffect(() => { refreshBroker(); }, [refreshBroker]);

  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<AISignal | null>(null);
  const [addShares, setAddShares] = useState('');
  const [addEntry, setAddEntry] = useState('');
  // Session 154 — spinning animation for the header refresh button so users
  // get visual feedback while the server-side scan is running.
  const refreshSpin = useSharedValue(0);
  const refreshSpinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${refreshSpin.value}deg` }] }));

  // Session 155 — manual refresh button in the header. Only usable while
  // the market is open. When closed the button is disabled and we skip
  // the network call entirely so we never trigger a refresh on a stale
  // market state.
  const handleHeaderRefresh = async () => {
    if (refreshing || aiSignalsLoading) return;
    if (!marketIsOpen) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    setRefreshing(true);
    refreshSpin.value = 0;
    refreshSpin.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
    try {
      await refreshAISignals(true);
    } finally {
      setRefreshing(false);
      refreshSpin.value = 0;
    }
  };

  // Session 122 §2 — Client-side market-hours gate. AI Moves are strictly
  // intraday setups; the moment the US equity market closes they become
  // stale and MUST disappear from the active list. We compute this locally
  // (instead of waiting for the next aiScanStats refresh) so the state
  // change is instant when 4:00 PM ET passes, and so the very first render
  // of the Moves tab shows the correct state without any flicker of
  // yesterday's setups.
  const marketIsOpen = useMemo(() => {
    // Trust fresh server stats if we have them.
    if (aiScanStats?.marketStatus) return aiScanStats.marketStatus === 'Open';
    // Otherwise compute ET time directly (works even on cold start before
    // the first backend scan response has landed).
    try {
      const now = new Date();
      const nyStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
      const [datePart, timePart] = nyStr.split(', ');
      const [m, d, y] = datePart.split('/').map(Number);
      const [hh, mm] = (timePart || '00:00').split(':').map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      if (dow === 0 || dow === 6) return false;
      const total = hh * 60 + mm;
      return total >= 9 * 60 + 30 && total < 16 * 60;
    } catch { return false; }
  }, [aiScanStats?.marketStatus]);

  // Re-evaluate market state every 30s so the tab flips to After Hours the
  // moment 4:00 PM ET passes, even if the user is sitting on the screen.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => forceTick(t => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);

  // Session 162 — AUTO-REFRESH AI MOVES WHEN THE MARKET IS OPEN.
  //
  // CRITICAL: this useEffect MUST be declared AFTER the `marketIsOpen`
  // useMemo. The previous version placed it above the useMemo which
  // caused a Temporal Dead Zone ReferenceError at render time
  // ("Cannot access 'marketIsOpen' before initialization"), which broke
  // the entire Moves tab so no AI signals ever loaded. Do NOT move this
  // block back above the marketIsOpen declaration.
  //
  // We only auto-refresh while the market is open — signals are strictly
  // intraday setups, so pinging the edge function pre-market / after-hours
  // / on weekends would just waste credits. The client keeps showing
  // cached signals until the market opens again.
  useEffect(() => {
    if (!marketIsOpen) return;
    refreshAISignals(true).catch(() => {});
  }, [marketIsOpen, refreshAISignals]);

  const visibleSignals = useMemo(() => {
    // §2 — When the market is closed, ALL AI Moves are stale. Return
    // empty so the After Hours state renders and users are never shown
    // yesterday's intraday setups.
    if (!marketIsOpen) return [];
    const hidden = new Set([...aiSignalsTakenIds, ...aiSignalsMissedIds]);
    const filtered = activeAISignals.filter(s => !hidden.has(s.id));
    // Session 154 — deduplicate by ticker so the same stock never appears
    // more than once on the Moves list. When multiple active signals exist
    // for one ticker (e.g. legacy BUY + SHORT rows, or overlapping refreshes),
    // keep the highest-confidence entry — tie-broken by the newest.
    const byTicker = new Map<string, AISignal>();
    for (const sig of filtered) {
      const existing = byTicker.get(sig.ticker);
      if (!existing) { byTicker.set(sig.ticker, sig); continue; }
      if (sig.confidence > existing.confidence) { byTicker.set(sig.ticker, sig); continue; }
      if (sig.confidence === existing.confidence &&
          new Date(sig.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
        byTicker.set(sig.ticker, sig);
      }
    }
    return Array.from(byTicker.values()).sort((a, b) => b.confidence - a.confidence);
  }, [activeAISignals, aiSignalsTakenIds, aiSignalsMissedIds, marketIsOpen]);

  const toggleExpand = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
    setExpandedId(prev => prev === id ? null : id);
    Haptics.selectionAsync();
  };

  const openLogTrade = (sig: AISignal) => {
    Haptics.selectionAsync();
    // Session 169 — if the user has NO broker connected, route DIRECTLY to
    // /connect-brokerage?autoOpen=1 (skipping /put-in-trade entirely) so
    // the user sees exactly ONE "Opening secure brokerage link..." loader.
    // Previously we'd push /put-in-trade first, which rendered its OWN loader,
    // THEN router.replace to /connect-brokerage which slid in its own
    // identical loader from the right — creating the "loader appears twice"
    // visual bug.
    if (!brokerConnected) {
      router.push('/connect-brokerage?autoOpen=1' as any);
      return;
    }
    router.push({
      pathname: '/put-in-trade',
      params: {
        ticker: sig.ticker,
        action: sig.direction,
        entry: String(sig.entry),
        takeProfit: String(sig.takeProfit),
        stopLoss: String(sig.stopLoss),
        signalId: sig.id,
        tradeType: sig.tradeType ?? '',
        source: 'ai_signal',
      },
    } as any);
  };

  const handleConfirmLog = () => {
    if (!selectedSignal) return;
    const shares = parseFloat(addShares);
    const entry = parseFloat(addEntry);
    if (!Number.isFinite(shares) || shares <= 0) { showAlert('Missing Info', 'Enter number of shares.'); return; }
    if (!Number.isFinite(entry) || entry <= 0) { showAlert('Missing Info', 'Enter your actual entry price.'); return; }
    const err = validateTrade(
      selectedSignal.direction === 'buy' ? 'long' : 'short',
      entry, selectedSignal.takeProfit, selectedSignal.stopLoss,
    );
    if (err) { showAlert('Invalid Trade', err); return; }
    addTradeWithTPSL({
      ticker: selectedSignal.ticker,
      shares,
      entryPrice: entry,
      position: selectedSignal.direction === 'buy' ? 'long' : 'short',
      takeProfit: selectedSignal.takeProfit,
      stopLoss: selectedSignal.stopLoss,
      tradeType: selectedSignal.tradeType,
      source: 'ai_signal',
      aiContext: {
        source: 'ai_signal',
        signalId: selectedSignal.id,
        originalEntry: selectedSignal.entry,
        originalTP: selectedSignal.takeProfit,
        originalSL: selectedSignal.stopLoss,
        confidence: selectedSignal.confidence,
        reasoning: selectedSignal.reasoning,
        direction: selectedSignal.direction,
        tradeType: selectedSignal.tradeType,
        timestamp: selectedSignal.createdAt,
      },
    });
    markSignalTaken(selectedSignal.id);
    setSelectedSignal(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert('Trade Logged', `${selectedSignal.ticker} is now an Active Trade. Sight will monitor for TP/SL.`);
  };

  const handleMissed = (sig: AISignal) => {
    markSignalMissed(sig.id);
    Haptics.selectionAsync();
  };

  const ownedTickers = useMemo(() => portfolio.map(p => p.ticker), [portfolio]);

  const renderMove = (sig: AISignal) => {
    const isBuy = sig.direction === 'buy';
    const color = isBuy ? t.bullish : t.bearish;
    const expanded = expandedId === sig.id;
    const overlapsPortfolio = ownedTickers.includes(sig.ticker);
    const sections = sig.reasoningSections ?? {};
    const availableSections = SECTION_META.filter(s => {
      const v = sections[s.key];
      return typeof v === 'string' && v.trim().length > 0;
    });
    const hasStructured = availableSections.length > 0;
    return (
      <Pressable
        key={sig.id}
        onPress={() => toggleExpand(sig.id)}
        style={({ pressed }) => [styles.moveCard, { backgroundColor: t.surface, borderColor: color + '55', opacity: pressed ? 0.98 : 1 }]}
      >
        {/* Direction ribbon */}
        <LinearGradient
          colors={[color + '25', color + '05']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={styles.ribbon}
        >
          <MaterialIcons name={isBuy ? 'trending-up' : 'trending-down'} size={16} color={color} />
          <Text style={{ fontSize: 11, fontWeight: '800', color, letterSpacing: 1 }}>
            AI MOVE · {isBuy ? 'BUY' : 'SHORT'}
          </Text>
          {sig.tradeType ? (
            <View style={{ marginLeft: 'auto', backgroundColor: color + '20', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color }}>{sig.tradeType.toUpperCase()}</Text>
            </View>
          ) : null}
        </LinearGradient>

        {/* Ticker header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingTop: 12 }}>
          <StockLogo ticker={sig.ticker} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: t.textPrimary }}>{sig.ticker}</Text>
            {sig.companyName ? (
              <Text style={{ fontSize: 12, color: t.textSecondary }} numberOfLines={1}>{sig.companyName}</Text>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 24, fontWeight: '800', color }}>{sig.confidence}%</Text>
            <Text style={{ fontSize: 9, fontWeight: '700', color: t.textTertiary, letterSpacing: 0.5 }}>CONFIDENCE</Text>
          </View>
        </View>

        {/* Levels */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, marginTop: 12 }}>
          <View style={[styles.levelBox, { backgroundColor: t.background, borderColor: t.border }]}>
            <Text style={styles.levelLabel}>ENTRY</Text>
            <Text style={[styles.levelValue, { color: t.textPrimary }]}>${sig.entry.toFixed(2)}</Text>
          </View>
          <View style={[styles.levelBox, { backgroundColor: t.background, borderColor: t.bullish + '40' }]}>
            <Text style={[styles.levelLabel, { color: t.bullish }]}>TAKE PROFIT</Text>
            <Text style={[styles.levelValue, { color: t.bullish }]}>${sig.takeProfit.toFixed(2)}</Text>
          </View>
          <View style={[styles.levelBox, { backgroundColor: t.background, borderColor: t.bearish + '40' }]}>
            <Text style={[styles.levelLabel, { color: t.bearish }]}>STOP LOSS</Text>
            <Text style={[styles.levelValue, { color: t.bearish }]}>${sig.stopLoss.toFixed(2)}</Text>
          </View>
        </View>

        {/* Duration + Trade type meta row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, marginTop: 10 }}>
          {sig.expectedDuration ? (
            <View style={[styles.metaChip, { backgroundColor: t.primary + '15' }]}>
              <MaterialIcons name="schedule" size={12} color={t.primary} />
              <Text style={[styles.metaChipText, { color: t.primary }]}>Expected: {sig.expectedDuration}</Text>
            </View>
          ) : null}
          {sig.tradeType && !sig.expectedDuration ? (
            <View style={[styles.metaChip, { backgroundColor: color + '15' }]}>
              <MaterialIcons name="local-offer" size={12} color={color} />
              <Text style={[styles.metaChipText, { color }]}>{sig.tradeType}</Text>
            </View>
          ) : null}
        </View>

        {overlapsPortfolio ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 10, padding: 10, backgroundColor: t.primary + '15', borderRadius: 8 }}>
            <MaterialIcons name="info" size={16} color={t.primary} />
            <Text style={{ flex: 1, fontSize: 12, color: t.textSecondary, lineHeight: 17 }}>
              May be relevant to your existing {sig.ticker} position.
            </Text>
          </View>
        ) : null}

        {/* Collapsed hint OR expanded structured reasoning */}
        {!expanded ? (
          <View style={styles.tapHint}>
            <Text style={{ fontSize: 12, color: t.textTertiary, fontStyle: 'italic' }}>
              Tap to see why this Move was generated
            </Text>
            <MaterialIcons name="expand-more" size={16} color={t.textTertiary} />
          </View>
        ) : (
          <View style={{ paddingHorizontal: 14, paddingTop: 14 }}>
            <View style={styles.reasoningHeader}>
              <MaterialIcons name="psychology" size={14} color={t.primary} />
              <Text style={{ fontSize: 11, fontWeight: '800', color: t.primary, letterSpacing: 1 }}>WHY THIS MOVE?</Text>
            </View>
            {hasStructured ? (
              availableSections.map(sec => (
                <View key={sec.key} style={[styles.sectionBox, { backgroundColor: t.background, borderColor: t.border }]}>
                  <View style={styles.sectionTitleRow}>
                    <MaterialIcons name={sec.icon as any} size={14} color={t.primary} />
                    <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>{sec.title}</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: t.textSecondary, lineHeight: 18 }}>{sections[sec.key]}</Text>
                </View>
              ))
            ) : sig.reasoning ? (
              <View style={[styles.sectionBox, { backgroundColor: t.background, borderColor: t.border }]}>
                <View style={styles.sectionTitleRow}>
                  <MaterialIcons name="flag" size={14} color={t.primary} />
                  <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>Overall Setup</Text>
                </View>
                <Text style={{ fontSize: 12, color: t.textSecondary, lineHeight: 18 }}>{sig.reasoning}</Text>
              </View>
            ) : null}
            <Pressable
              onPress={() => toggleExpand(sig.id)}
              style={styles.collapseHint}
            >
              <MaterialIcons name="expand-less" size={16} color={t.textTertiary} />
              <Text style={{ fontSize: 11, color: t.textTertiary, fontStyle: 'italic' }}>Tap to collapse</Text>
            </Pressable>
          </View>
        )}

        {/* Actions */}
        <View style={{ flexDirection: 'row', gap: 8, padding: 14 }}>
          <Pressable
            style={[styles.logBtn, { backgroundColor: color }]}
            onPress={(e) => { e.stopPropagation?.(); openLogTrade(sig); }}
          >
            <MaterialIcons name="flash-on" size={18} color="#FFF" />
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>Trade</Text>
          </Pressable>
          <Pressable
            style={[styles.missBtn, { borderColor: t.border, backgroundColor: t.background }]}
            onPress={(e) => { e.stopPropagation?.(); handleMissed(sig); }}
            accessibilityRole="button"
            accessibilityLabel="Skip this AI Move"
          >
            {/* Session 189 — renamed "I Missed It" → "Skip" per product spec.
                Behavior is unchanged: tapping dismisses the Move for the user
                (markSignalMissed) without creating a trade or altering broker
                state. Skip is NOT treated as a loss or a completed trade. */}
            <Text style={{ fontSize: 13, fontWeight: '600', color: t.textSecondary }}>Skip</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: t.background }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialIcons name="auto-awesome" size={22} color={t.primary} />
            <Text style={[styles.title, { color: t.textPrimary }]}>Moves</Text>
          </View>
          <Text style={[styles.subtitle, { color: t.textSecondary, marginTop: 2 }]}>Sight AI market scan</Text>
        </View>
        {isSubscribed ? (
          <Pressable
            onPress={handleHeaderRefresh}
            disabled={refreshing || aiSignalsLoading || !marketIsOpen}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={({ pressed }) => [
              styles.refreshBtn,
              {
                backgroundColor: t.surface,
                borderColor: (marketIsOpen ? t.primary : t.textTertiary) + '55',
                opacity: pressed || refreshing || aiSignalsLoading || !marketIsOpen ? 0.4 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={marketIsOpen ? 'Refresh AI Moves' : 'Refresh disabled while market closed'}
          >
            <Animated.View style={refreshSpinStyle}>
              <MaterialIcons name="refresh" size={22} color={marketIsOpen ? t.primary : t.textTertiary} />
            </Animated.View>
          </Pressable>
        ) : null}
      </View>

      {!isSubscribed ? (
        <View style={{ flex: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }} pointerEvents="none" showsVerticalScrollIndicator={false}>
            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              {[1, 2, 3].map(i => (
                <View key={i} style={[styles.moveCard, { backgroundColor: t.surface, borderColor: t.border, opacity: 0.6, height: 200 }]} />
              ))}
            </View>
          </ScrollView>
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <BlurView intensity={80} tint="dark" style={{ flex: 1 }} />
          </View>
          <MovesUnlockBlocker onPress={() => { Haptics.selectionAsync(); router.push('/subscription'); }} primary={t.primary} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          // Session 213 — flexGrow:1 kills the jitter users saw when
          // opening the AI Moves tab while the market is closed. Without
          // flexGrow, the market-closed / "no move right now" content is
          // shorter than the visible screen so ScrollView briefly renders
          // at natural (short) height, then re-lays out to fill the
          // viewport when the after-hours state hydrates — that transition
          // was the observed jitter. flexGrow:1 guarantees the content
          // container always occupies at least the full visible height
          // from the very first frame, so the layout is stable and the
          // after-hours panel centers itself without any drift.
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 24 }}
          bounces={false}
          alwaysBounceVertical={false}
          overScrollMode="never"
          scrollEnabled={marketIsOpen || visibleSignals.length > 0}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          showsVerticalScrollIndicator={false}
        >
          {marketIsOpen ? (
            <View style={{ paddingHorizontal: 16 }}>
              <LinearGradient
                colors={[t.primary + '20', t.primary + '05']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.scanCard}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.bullish }} />
                  <Text style={{ fontSize: 11, fontWeight: '800', color: t.primary, letterSpacing: 1 }}>
                    LIVE SCAN · MARKET OPEN
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
                  <ScanStat label="Screened" value={aiScanStats?.screened ?? '—'} theme={t} />
                  <ScanStat label="Candidates" value={aiScanStats?.candidates ?? '—'} theme={t} />
                  <ScanStat label="AI Moves" value={visibleSignals.length} color={t.primary} theme={t} />
                </View>
              </LinearGradient>
            </View>
          ) : null}

          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            {aiSignalsLoading && visibleSignals.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 60, gap: 12 }}>
                <ActivityIndicator size="large" color={t.primary} />
                <Text style={{ fontSize: 14, color: t.textTertiary }}>Scanning the market…</Text>
              </View>
            ) : visibleSignals.length === 0 ? (
              !marketIsOpen ? (() => {
                // Session 137 — distinguish weekend / pre-market / after-hours
                // states from the live market-status string, and use a strong
                // locked-state visual (no moon) so the whole page communicates
                // that Moves is unavailable rather than looking like a normal
                // Moves screen with a disabled card.
                const statusStr = String(aiScanStats?.marketStatus ?? '').toLowerCase();
                let stateTitle = 'MARKET CLOSED';
                let stateBody = 'Sight AI Moves are unavailable while the market is closed. Scanning will resume automatically at the next US market open (9:30 AM ET, Mon–Fri).';
                if (statusStr.includes('pre')) {
                  stateTitle = 'PRE-MARKET';
                  stateBody = 'The regular US market session has not opened yet. Sight AI Moves resume at 9:30 AM ET.';
                } else if (statusStr.includes('after')) {
                  stateTitle = 'AFTER HOURS';
                  stateBody = 'The regular US market session has ended for today. Sight AI Moves resume at the next open (9:30 AM ET, Mon–Fri).';
                } else if (statusStr.includes('weekend')) {
                  stateTitle = 'MARKET CLOSED';
                  stateBody = 'The US market is closed for the weekend. Sight AI Moves resume Monday at 9:30 AM ET.';
                }
                return (
                  <View style={styles.afterHoursScreen}>
                    <View style={styles.lockedHeroWrap}>
                      <MaterialIcons name="lock" size={64} color={t.textTertiary} />
                    </View>
                    <Text style={[styles.afterHoursTitle, { color: t.textPrimary }]}>{stateTitle}</Text>
                    <View style={[styles.lockedPanel, { backgroundColor: t.surface, borderColor: t.border }]}>
                      <Text style={[styles.lockedHeading, { color: t.textPrimary }]}>AI Moves Unavailable</Text>
                      <Text style={[styles.lockedBody, { color: t.textSecondary }]}>{stateBody}</Text>
                      <View style={[styles.lockedStatusPill, { backgroundColor: t.background, borderColor: t.border }]}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.textTertiary }} />
                        <Text style={{ fontSize: 11, fontWeight: '700', color: t.textTertiary, letterSpacing: 0.5 }}>
                          {(aiScanStats?.marketStatus ?? 'Closed').toUpperCase()}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })() : (
                <View style={[styles.emptyCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                  <MaterialIcons name="visibility" size={40} color={t.textTertiary} />
                  <Text style={{ fontSize: 18, fontWeight: '700', color: t.textPrimary, marginTop: 12 }}>NO MOVE</Text>
                  <Text style={{ fontSize: 13, color: t.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 19, paddingHorizontal: 12 }}>
                    Sight doesn't see a sufficiently strong setup right now. We only surface Moves with 85%+ confidence and multi-source confluence — quality over quantity.
                  </Text>
                  <Text style={{ fontSize: 11, color: t.textTertiary, textAlign: 'center', marginTop: 10, paddingHorizontal: 20 }}>
                    Scanning continues in the background. New Moves will appear automatically.
                  </Text>
                </View>
              )
            ) : (
              <View>{visibleSignals.map(renderMove)}</View>
            )}
          </View>
        </ScrollView>
      )}

      {/* Log Trade Modal */}
      <Modal
        visible={selectedSignal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedSignal(null)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedSignal(null)} />
          {selectedSignal ? (
            <View style={[styles.modalCard, { backgroundColor: t.surface, borderColor: t.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <StockLogo ticker={selectedSignal.ticker} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: t.textPrimary }}>Log {selectedSignal.ticker} Trade</Text>
                  <Text style={{ fontSize: 12, color: t.textSecondary, marginTop: 1 }}>
                    {selectedSignal.direction === 'buy' ? 'Long' : 'Short'} · {selectedSignal.tradeType ?? 'Intraday'} · {selectedSignal.confidence}%
                  </Text>
                </View>
                <Pressable onPress={() => setSelectedSignal(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <MaterialIcons name="close" size={20} color={t.textSecondary} />
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <View style={[styles.tpSlBox, { backgroundColor: t.background, borderColor: t.bullish + '40' }]}>
                  <Text style={[styles.tpSlLabel, { color: t.bullish }]}>TP (locked)</Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: t.bullish }}>${selectedSignal.takeProfit.toFixed(2)}</Text>
                </View>
                <View style={[styles.tpSlBox, { backgroundColor: t.background, borderColor: t.bearish + '40' }]}>
                  <Text style={[styles.tpSlLabel, { color: t.bearish }]}>SL (locked)</Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: t.bearish }}>${selectedSignal.stopLoss.toFixed(2)}</Text>
                </View>
              </View>

              <Text style={styles.fieldLabel}>SHARES *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: t.background, borderColor: t.border, color: t.textPrimary }]}
                placeholder="e.g. 100"
                placeholderTextColor={t.textTertiary}
                keyboardType="numeric"
                value={addShares}
                onChangeText={setAddShares}
                autoFocus
              />
              <Text style={styles.fieldLabel}>YOUR ACTUAL ENTRY PRICE *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: t.background, borderColor: t.border, color: t.textPrimary }]}
                placeholder={`Suggested: $${selectedSignal.entry.toFixed(2)}`}
                placeholderTextColor={t.textTertiary}
                keyboardType="decimal-pad"
                value={addEntry}
                onChangeText={setAddEntry}
              />

              <Pressable style={[styles.confirmBtn, { backgroundColor: t.primary }]} onPress={handleConfirmLog}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFF' }}>Log Trade</Text>
              </Pressable>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function ScanStat({ label, value, color, theme: t }: { label: string; value: number | string; color?: string; theme: any }) {
  return (
    <View style={{ minWidth: 64 }}>
      <Text style={{ fontSize: 20, fontWeight: '800', color: color ?? t.textPrimary }}>{value}</Text>
      <Text style={{ fontSize: 9, fontWeight: '700', color: t.textTertiary, letterSpacing: 0.7, marginTop: 1 }}>{label.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 13, fontWeight: '500' },
  lockIconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  unlockBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 12, paddingHorizontal: 32, gap: 8 },
  unlockText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  scanCard: { borderRadius: 14, padding: 14, marginTop: 4 },
  moveCard: { borderRadius: 14, borderWidth: 1.5, marginBottom: 12, overflow: 'hidden' },
  ribbon: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 6 },
  levelBox: { flex: 1, borderRadius: 10, borderWidth: 1, padding: 10 },
  levelLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: '#9CA3AF', marginBottom: 2 },
  levelValue: { fontSize: 15, fontWeight: '800' },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  metaChipText: { fontSize: 11, fontWeight: '700' },
  tapHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12, marginTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  collapseHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, marginTop: 2 },
  reasoningHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  sectionBox: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  logBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 12 },
  missBtn: { paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  emptyCard: { borderRadius: 16, borderWidth: 1, padding: 24, marginTop: 20, alignItems: 'center' },
  refreshBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  afterHoursScreen: { alignItems: 'center', paddingTop: 24, paddingBottom: 24, paddingHorizontal: 8 },
  lockedHeroWrap: { width: 128, height: 128, borderRadius: 64, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(148,163,184,0.10)', borderWidth: 1, borderColor: 'rgba(148,163,184,0.22)', marginBottom: 20 },
  afterHoursTitle: { fontSize: 26, fontWeight: '800', letterSpacing: 4, marginBottom: 20 },
  lockedPanel: { width: '100%', borderRadius: 20, borderWidth: 1.5, padding: 28, alignItems: 'center' },
  lockedIconRing: { width: 84, height: 84, borderRadius: 42, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  lockedHeading: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginBottom: 8 },
  lockedBody: { fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 20, paddingHorizontal: 6 },
  lockedStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  modalCard: { width: '100%', maxWidth: 400, borderRadius: 16, borderWidth: 1, padding: 18 },
  tpSlBox: { flex: 1, borderRadius: 10, borderWidth: 1, padding: 8 },
  tpSlLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.5, marginBottom: 4, marginTop: 2 },
  input: { height: 46, borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, fontSize: 15, fontWeight: '600', marginBottom: 10 },
  confirmBtn: { height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
});
