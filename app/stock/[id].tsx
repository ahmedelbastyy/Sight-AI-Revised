import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TouchableOpacity, Dimensions, ActivityIndicator, Keyboard,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Image } from 'expo-image';

import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '../../contexts/AppContext';
import { config } from '../../constants/config';
import { getStockNews, fetchChartForPeriod, fetchMultipleQuotes, fetchChartData, analyzeStock, AVAILABLE_STOCKS, NewsItem, RealTimeQuote } from '../../services/stockService';
import { computeTradeStatus } from '../../services/tradeService';
import { useAlert } from '@/template';
import { LargeChart } from '../../components/ui/MiniChart';

// Session 206 — AI verdict card renderer. Broken into distinct visual
// sections (verdict badge, headline, what we see, what it means, next
// steps) so the recommendation is easy to scan. Verdict color coded so
// exits are red, positive recommendations green, cautionary amber, and
// insufficient-data neutral.
function verdictMeta(verdict: string) {
  switch (verdict) {
    case 'continue_holding':
      return { label: 'CONTINUE HOLDING', color: '#10B981', icon: 'check-circle' as const };
    case 'consider_taking_profit':
      return { label: 'CONSIDER TAKING PROFIT', color: '#F59E0B', icon: 'flag' as const };
    case 'consider_exiting':
      return { label: 'WARRANTING AN EXIT', color: '#EF4444', icon: 'warning' as const };
    case 'setup_weakening':
      return { label: 'SETUP WEAKENING', color: '#F59E0B', icon: 'trending-down' as const };
    case 'setup_strengthened':
      return { label: 'SETUP STRENGTHENED', color: '#10B981', icon: 'trending-up' as const };
    case 'info_changed':
      return { label: 'INFORMATION CHANGED', color: '#8B5CF6', icon: 'insights' as const };
    case 'insufficient_data':
    default:
      return { label: 'NOT ENOUGH CONFIDENCE', color: '#9CA3AF', icon: 'help-outline' as const };
  }
}

function renderVerdictCard(result: any, t: any) {
  const meta = verdictMeta(String(result?.verdict ?? 'insufficient_data'));
  const confidence = Number(result?.confidence);
  const showConfidence = Number.isFinite(confidence) && confidence > 0;
  const isInsufficient = result?.verdict === 'insufficient_data';
  const summaryParagraphs = String(result?.summary ?? '')
    .split(/\n{2,}/)
    .map((p: string) => p.trim())
    .filter((p: string) => p.length > 0);
  return (
    <View style={{ marginTop: 12, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1, borderColor: meta.color + '55', overflow: 'hidden' }}>
      {/* Verdict header — large color-coded label */}
      <View style={{ paddingHorizontal: 14, paddingVertical: 12, backgroundColor: meta.color + '14', borderBottomWidth: 1, borderBottomColor: meta.color + '33', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <MaterialIcons name={meta.icon} size={20} color={meta.color} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: meta.color, letterSpacing: 1.2 }}>{meta.label}</Text>
          {showConfidence ? (
            <Text style={{ fontSize: 11, color: t.textTertiary, marginTop: 2 }}>
              AI confidence: <Text style={{ fontWeight: '700', color: meta.color }}>{confidence}%</Text>
            </Text>
          ) : null}
        </View>
      </View>

      {/* Headline */}
      {result?.headline ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: meta.color, lineHeight: 22 }}>{result.headline}</Text>
        </View>
      ) : null}

      {/* Summary — broken into paragraph sections */}
      {summaryParagraphs.length > 0 ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 10 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: t.textTertiary, marginBottom: 4 }}>WHAT WE SEE</Text>
          {summaryParagraphs.map((p: string, i: number) => (
            <Text key={i} style={{ fontSize: 13, color: t.textSecondary, lineHeight: 19, marginBottom: i === summaryParagraphs.length - 1 ? 0 : 8 }}>{p}</Text>
          ))}
        </View>
      ) : null}

      {/* Key factors */}
      {Array.isArray(result?.factors) && result.factors.length > 0 ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: t.textTertiary, marginBottom: 6 }}>KEY FACTORS</Text>
          {result.factors.map((f: string, i: number) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: meta.color, marginTop: 7 }} />
              <Text style={{ flex: 1, fontSize: 12, color: t.textSecondary, lineHeight: 17 }}>{f}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Next steps */}
      {Array.isArray(result?.nextSteps) && result.nextSteps.length > 0 ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: t.textTertiary, marginBottom: 6 }}>NEXT STEPS</Text>
          {result.nextSteps.map((s: string, i: number) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
              <MaterialIcons name="east" size={13} color={meta.color} style={{ marginTop: 3 }} />
              <Text style={{ flex: 1, fontSize: 12, color: t.textSecondary, lineHeight: 17 }}>{s}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={{ paddingBottom: 14 }} />
      )}

      {isInsufficient ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
          <View style={{ padding: 10, borderRadius: 10, backgroundColor: t.background, borderWidth: 1, borderColor: t.border }}>
            <Text style={{ fontSize: 11, color: t.textTertiary, lineHeight: 16 }}>
              Sight AI requires at least 85% confidence before recommending an action. Right now the signal isn't strong enough either way — wait for clearer confirmation from price, volume, or fresh news before making changes.
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
import { SentimentIndicator } from '../../components/ui/RecommendationBadge';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBrokerConnection } from '../../hooks/useBrokerConnection';

const NEWS_CACHE_KEY = 'ts_daily_news_cache';

export default function StockDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isInWatchlist, addToWatchlist, removeStockCompletely, getStockData, isSubscribed, currentTheme: t, trackStockView, portfolio, stockDataMap, closeTradeManually, analyzePosition, analyzeBrokerPosition } = useApp();
  const { showAlert } = useAlert();
  const [dims, setDims] = useState(Dimensions.get('window'));

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setDims(window));
    return () => sub?.remove();
  }, []);

  const ticker = id || '';
  const contextData = getStockData(ticker);

  // Session 151 — eagerly fetch quote + chart when this ticker isn't in the
  // watchlist / portfolio (so `contextData` is undefined). This makes the
  // Stock Details page open the moment the user taps a stock card and it
  // populates itself immediately with LIVE data instead of showing
  // "Loading..." forever. Refreshes every 10 seconds while mounted.
  const [eagerData, setEagerData] = useState<{ quote: RealTimeQuote; chartData: number[]; analysis: any; sector: string } | null>(null);

  useEffect(() => {
    if (!ticker || contextData) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [quotes, chart] = await Promise.all([
          fetchMultipleQuotes([ticker]),
          fetchChartData(ticker, '1mo', '1d').catch(() => [] as number[]),
        ]);
        const quote = quotes.get(ticker);
        if (!quote || cancelled) return;
        const chartArr = chart.length > 2 ? chart : Array.from({ length: 20 }, (_, i) => quote.price * (0.95 + 0.005 * i));
        const analysis = analyzeStock(chartArr, quote.price, quote.change, quote.changePercent);
        const info = AVAILABLE_STOCKS.find(s => s.ticker === ticker);
        setEagerData({ quote, chartData: chartArr, analysis, sector: info?.sector ?? 'Unknown' });
      } catch { /* swallow */ }
    };
    load();
    const iv = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [ticker, contextData]);

  const data = contextData ?? eagerData;

  // Session 149 — detect when the connected broker actually holds this
  // ticker so the anchored footer can offer a Sell-only action instead of
  // the Put-in-Trade / Add-to-Watchlist split. Uses the same broker hook
  // the Home tab relies on.
  const brokerConn = useBrokerConnection();
  const brokerHeldPosition = React.useMemo(() => {
    if (!brokerConn.hasActiveConnection) return null;
    const match = brokerConn.positions.find(
      (p) => (p.ticker || '').toUpperCase() === (ticker || '').toUpperCase()
            && Math.abs(Number(p.quantity) || 0) > 0,
    );
    return match ?? null;
  }, [brokerConn.hasActiveConnection, brokerConn.positions, ticker]);

  // Helper to format time ago
  const formatTimeAgo = (publishedAt: string): string => {
    if (!publishedAt) return '';
    try {
      const pubDate = new Date(publishedAt);
      const now = new Date();
      const diffMs = now.getTime() - pubDate.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24) return `${diffHrs}h ago`;
      const diffDays = Math.floor(diffHrs / 24);
      return `${diffDays}d ago`;
    } catch {
      return '';
    }
  };

  // Track stock view for personalization
  useEffect(() => {
    if (ticker) trackStockView(ticker);
  }, [ticker, trackStockView]);

  // Session 156 — detect if the onboarding tutorial is currently running.
  // When active, we disable the "add to trade" (+) action on this page so
  // the tutorial can safely explain what the button does without letting
  // the user accidentally trigger the Order flow mid-tutorial.
  const [tutorialActive, setTutorialActive] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('ts_tutorial_active').then(v => setTutorialActive(v === 'true')).catch(() => {});
  }, []);
  const [selectedPeriod, setSelectedPeriod] = useState('1D');
  const [showReasoning, setShowReasoning] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  // Session 205 — broker-position AI analysis state. Separate from
  // analysisResult so a broker-only position can show its own verdict
  // card without colliding with a Sight-tracked userActiveTrade card.
  const [brokerAnalysisResult, setBrokerAnalysisResult] = useState<any>(null);
  const [analyzingBroker, setAnalyzingBroker] = useState(false);
  const [soldModalVisible, setSoldModalVisible] = useState(false);
  const [soldExitPrice, setSoldExitPrice] = useState('');

  // Session 119 §17 — the user's active trade in this ticker (if any).
  // Drives the "Analyze My Position" section, "I Have Sold" sticky button,
  // and trade-type badge inside the YOUR TRADE card.
  const userActiveTrade = useMemo(
    () => portfolio.find(p => p.ticker === (id || '') && p.tradeId && p.takeProfit && p.stopLoss),
    [portfolio, id],
  );

  const handleAnalyzePosition = useCallback(async () => {
    if (!userActiveTrade?.tradeId || analyzing) return;
    setAnalyzing(true);
    setAnalysisResult(null);
    Haptics.selectionAsync();
    const res = await analyzePosition(userActiveTrade.tradeId);
    if (res.error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAlert('Analysis Failed', res.error);
    } else if (res.data) {
      setAnalysisResult(res.data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setAnalyzing(false);
  }, [userActiveTrade, analyzing, analyzePosition, showAlert]);

  // Session 205 — Ask Sight AI for broker-only holdings. Uses the live
  // Yahoo quote (contextData / eagerData → stockDataMap) as currentPrice
  // and the broker's authoritative averagePrice as the entry reference so
  // the AI verdict is grounded in the same numbers the user sees on the
  // active-trade card.
  const handleAnalyzeBrokerPosition = useCallback(async () => {
    if (!brokerHeldPosition || analyzingBroker) return;
    const currentPrice = data?.quote?.price ?? 0;
    const shares = Math.abs(Number(brokerHeldPosition.quantity) || 0);
    const avgPrice = Number(brokerHeldPosition.averagePrice) || 0;
    if (shares <= 0 || avgPrice <= 0 || currentPrice <= 0) {
      showAlert('Missing Data', 'Live price or broker average price is not available yet. Please try again in a moment.');
      return;
    }
    setAnalyzingBroker(true);
    setBrokerAnalysisResult(null);
    Haptics.selectionAsync();
    const isLong = Number(brokerHeldPosition.quantity) >= 0;
    const res = await analyzeBrokerPosition({
      ticker,
      position: isLong ? 'long' : 'short',
      entryPrice: avgPrice,
      shares,
      currentPrice,
    });
    if (res.error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAlert('Analysis Failed', res.error);
    } else if (res.data) {
      setBrokerAnalysisResult(res.data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setAnalyzingBroker(false);
  }, [brokerHeldPosition, analyzingBroker, analyzeBrokerPosition, showAlert, data, ticker]);
  const [periodChartData, setPeriodChartData] = useState<number[] | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [periodChange, setPeriodChange] = useState<{ change: number; changePercent: number } | null>(null);

  // Session 152 — hoisted BEFORE the `if (!data)` early return to fix the
  // "rendered more hooks than during the previous render" React error.
  // Hooks must be called in the exact same order on every render. These
  // three used to live after the early return, so the first render (data
  // undefined) would call 24 hooks while the second render (data ready)
  // would call 27 hooks and crash.
  const [stockNews, setStockNews] = useState<NewsItem[]>([]);
  const newsLoadedRef = useRef(false);

  // Session 153 — first-open tutorial overlay explaining what users can
  // do on the Stock Details page. Persisted via AsyncStorage so it only
  // fires once per install. Also hoisted BEFORE the early return.
  const [showDetailTutorial, setShowDetailTutorial] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('ts_stock_detail_tutorial_seen').then(seen => {
      if (!seen) setShowDetailTutorial(true);
    }).catch(() => {});
  }, []);
  const dismissDetailTutorial = useCallback(() => {
    setShowDetailTutorial(false);
    AsyncStorage.setItem('ts_stock_detail_tutorial_seen', 'true').catch(() => {});
    Haptics.selectionAsync().catch(() => {});
  }, []);

  useEffect(() => {
    if (!ticker) return;
    const loadNews = async () => {
      try {
        // Try to get news from the user's saved daily news cache first
        const cached = await AsyncStorage.getItem(NEWS_CACHE_KEY);
        if (cached) {
          const { articles } = JSON.parse(cached);
          if (Array.isArray(articles)) {
            const relevantArticles = articles.filter((a: any) =>
              Array.isArray(a.tickers) && a.tickers.includes(ticker)
            );
            if (relevantArticles.length > 0) {
              const mappedNews: NewsItem[] = relevantArticles.map((a: any) => ({
                id: a.id || `cached-${Math.random().toString(36).slice(2)}`,
                title: a.title,
                source: a.source || 'Financial News',
                time: a.published_at ? formatTimeAgo(a.published_at) : 'Today',
                summary: a.summary || '',
                sentiment: a.sentiment || 'NEUTRAL',
                tickers: a.tickers || [],
                url: a.url || '',
              }));
              setStockNews(mappedNews);
              newsLoadedRef.current = true;
              return;
            }
          }
        }
      } catch {}
      // Fallback to generated news from stock service
      const news = getStockNews(ticker);
      setStockNews(news);
      newsLoadedRef.current = true;
    };
    loadNews();
  }, [ticker]);

  // Load 1D chart on mount — use cached data from AppContext if available for instant display.
  //
  // Session 214 — JITTER FIX. Previously the initial mount for an active
  // trade would:
  //   1. Show the 1-month chart from stockDataMap (instant, cached).
  //   2. Immediately fire handlePeriodChange('1D') which set
  //      loadingChart=true → the chart area collapsed to an
  //      ActivityIndicator for ~200-400ms.
  //   3. Then rendered the new 1D chart, causing a visible jump.
  // The fix: seed periodChartData synchronously from data.chartData so the
  // chart is already on-screen with real data before the 1D fetch runs, and
  // NEVER flip loadingChart=true when we already have chart data to show.
  // The fetch still runs and updates the chart to the actual 1D series once
  // ready, but the user never sees a loading state or layout shift.
  useEffect(() => {
    if (data && ticker) {
      if (data.chartData && data.chartData.length > 2 && !periodChartData) {
        setPeriodChartData(data.chartData);
      }
      handlePeriodChange('1D');
    }
  }, [!!data, ticker]);

  // Fetch chart data when period changes and compute period-specific change
  const handlePeriodChange = async (periodId: string) => {
    setSelectedPeriod(periodId);
    if (periodId !== selectedPeriod) Haptics.selectionAsync();
    // Only enter the visible loading state when we have NOTHING to show
    // yet. If we already have a chart on screen (cached from stockDataMap
    // or a prior period fetch), keep it rendered while the new period
    // data loads so there is zero visible jitter.
    const hasVisibleChart = Array.isArray(periodChartData) && periodChartData.length > 2;
    if (!hasVisibleChart) setLoadingChart(true);
    try {
      const newChartData = await fetchChartForPeriod(ticker, periodId);
      setPeriodChartData(newChartData);
      if (newChartData.length >= 2) {
        const startPrice = newChartData[0];
        const endPrice = newChartData[newChartData.length - 1];
        const ch = endPrice - startPrice;
        const chP = startPrice > 0 ? (ch / startPrice) * 100 : 0;
        setPeriodChange({ change: ch, changePercent: chP });
      } else {
        setPeriodChange(null);
      }
    } catch {
      // Preserve whatever chart is already on screen. Never wipe it back
      // to null just because the network fetch failed — that produces
      // the exact "chart disappears then reappears" flicker the user
      // was complaining about.
      setPeriodChange(null);
    }
    setLoadingChart(false);
  };

  if (!data) {
    return (
      <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: t.background }]}>
        <View style={[styles.header]}>
          <TouchableOpacity activeOpacity={0.6} style={[styles.headerBtn, { backgroundColor: t.surface, borderColor: t.border }]}
            onPress={() => { Haptics.selectionAsync(); router.back(); }}>
            <MaterialIcons name="arrow-back" size={22} color={t.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTicker, { color: t.textPrimary }]}>{ticker}</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.errorState}>
          <Image source={require('../../assets/images/app-logo.png')} style={{ width: 40, height: 40 }} contentFit="contain" />
          <Text style={[styles.errorText, { color: t.textTertiary, marginTop: 12 }]}>Loading {ticker} data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { quote, chartData, analysis } = data;
  const activeChartData = periodChartData || chartData;
  const displayChange = periodChange ? periodChange.change : quote.change;
  const displayChangePercent = periodChange ? periodChange.changePercent : quote.changePercent;
  const isPositive = displayChange >= 0;
  const inList = isInWatchlist(ticker);
  const signalConfig = config.signalTypes[analysis.signal];
  const chartWidth = Math.max(1, dims.width - 32);

  const handleToggleWatchlist = () => {
    if (inList) {
      removeStockCompletely(ticker);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      router.back();
    } else {
      addToWatchlist(ticker);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const openTradingView = () => {
    Haptics.selectionAsync();
    router.push({ pathname: '/tradingview', params: { symbol: ticker } });
  };

  const renderAnalysisContent = () => {
    // Session 118 — Stock Details now focuses on the USER'S TRADE if they
    // have one open in this ticker, instead of a generic BUY / HOLD / SELL
    // rating. The generic recommendation and target boxes were removed.
    //
    // Session 205 — Also honors broker-only positions: if the user does not
    // have a Sight-tracked userTrade but does hold shares in a connected
    // brokerage, we render a compact YOUR POSITION card and expose the same
    // "Ask Sight AI" action so the AI verdict card works for BOTH sources
    // of ownership.
    const userTrade = portfolio.find(p => p.ticker === ticker && p.tradeId && p.takeProfit && p.stopLoss);
    let tradeStatusBlock: React.ReactNode = null;
    if (userTrade) {
      const currentPrice = data.quote.price;
      const st = computeTradeStatus({
        position: userTrade.position,
        entryPrice: userTrade.avgCost,
        takeProfit: userTrade.takeProfit!,
        stopLoss: userTrade.stopLoss!,
        shares: userTrade.shares,
      }, currentPrice);
      const win = st.currentPnL >= 0;
      const dirColor = win ? t.bullish : t.bearish;

      // Session 120 §6 — polished status wording based on actual trade data.
      let statusTitle: string;
      let statusBody: string;
      let statusIcon: string;
      let statusTone: string;
      if (st.hitTP) {
        statusTitle = 'Take Profit Reached';
        statusBody = `Your position reached the $${userTrade.takeProfit!.toFixed(2)} Take Profit. Trade will close automatically.`;
        statusIcon = 'flag'; statusTone = t.bullish;
      } else if (st.hitSL) {
        statusTitle = 'Stop Loss Reached';
        statusBody = `Your position reached the $${userTrade.stopLoss!.toFixed(2)} Stop Loss. Trade will close automatically.`;
        statusIcon = 'flag'; statusTone = t.bearish;
      } else if (win && st.entryToTPProgress >= 60) {
        statusTitle = 'Trade Looking Strong';
        statusBody = `Price is continuing toward your $${userTrade.takeProfit!.toFixed(2)} Take Profit and current momentum supports the original setup.`;
        statusIcon = 'trending-up'; statusTone = t.bullish;
      } else if (win) {
        statusTitle = 'Moving Toward Take Profit';
        statusBody = `Your position is currently progressing toward the $${userTrade.takeProfit!.toFixed(2)} Take Profit.`;
        statusIcon = 'trending-up'; statusTone = t.bullish;
      } else if (st.closerTo === 'sl' && st.distancePercentToSL < 1.5) {
        statusTitle = 'Position Under Pressure';
        statusBody = `You're down $${Math.abs(st.currentPnL).toFixed(2)}. Price is close to your $${userTrade.stopLoss!.toFixed(2)} Stop Loss — setup may not recover.`;
        statusIcon = 'warning'; statusTone = t.bearish;
      } else {
        statusTitle = 'Conditions Weakening';
        statusBody = `Momentum has weakened compared with the original setup. New information may be affecting the trade.`;
        statusIcon = 'insights'; statusTone = t.bearish;
      }
      const chgToday = quote.changePercent;
      const dayAssessment = win
        ? (chgToday >= 0 ? 'Momentum aligned with your position today.' : 'Momentum has softened today — setup still valid overall.')
        : (chgToday < 0 && userTrade.position === 'long' ? 'Momentum has turned against your position today.' : 'Watch for a recovery or approach to Stop Loss.');

      tradeStatusBlock = (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>YOUR TRADE</Text>
          <View style={[styles.tradeCard, { backgroundColor: t.surface, borderColor: dirColor + '55' }]}>
            {/* Top row: direction + shares (left) | P/L (right) */}
            <View style={styles.tradeTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.tradeMetaLabel, { color: t.textTertiary }]}>DIRECTION</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <View style={[styles.dirBadge, { backgroundColor: dirColor + '18' }]}>
                    <MaterialIcons name={userTrade.position === 'long' ? 'trending-up' : 'trending-down'} size={16} color={dirColor} />
                    <Text style={{ fontSize: 14, fontWeight: '800', color: dirColor }}>
                      {userTrade.position === 'long' ? 'LONG' : 'SHORT'}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: t.textPrimary }}>
                    {userTrade.shares} shares
                  </Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.tradeMetaLabel, { color: t.textTertiary }]}>P/L</Text>
                <Text style={{ fontSize: 22, fontWeight: '800', color: win ? t.bullish : t.bearish, marginTop: 2 }}>
                  {win ? '+' : '-'}${Math.abs(st.currentPnL).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: win ? t.bullish : t.bearish }}>
                  {win ? '+' : ''}{st.currentPnLPercent.toFixed(2)}%
                </Text>
              </View>
            </View>

            {/* Levels in a proper 2x2 grid so nothing wraps awkwardly */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <View style={[styles.levelBox, { backgroundColor: t.background, borderColor: t.border }]}>
                <Text style={[styles.levelBoxLabel, { color: t.textTertiary }]}>ENTRY</Text>
                <Text style={[styles.levelBoxValue, { color: t.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>${userTrade.avgCost.toFixed(2)}</Text>
              </View>
              <View style={[styles.levelBox, { backgroundColor: t.background, borderColor: t.border }]}>
                <Text style={[styles.levelBoxLabel, { color: t.textTertiary }]}>CURRENT</Text>
                <Text style={[styles.levelBoxValue, { color: t.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>${currentPrice.toFixed(2)}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <View style={[styles.levelBox, { backgroundColor: t.background, borderColor: t.bullish + '40' }]}>
                <Text style={[styles.levelBoxLabel, { color: t.bullish }]}>TAKE PROFIT</Text>
                <Text style={[styles.levelBoxValue, { color: t.bullish }]} numberOfLines={1} adjustsFontSizeToFit>${userTrade.takeProfit!.toFixed(2)}</Text>
              </View>
              <View style={[styles.levelBox, { backgroundColor: t.background, borderColor: t.bearish + '40' }]}>
                <Text style={[styles.levelBoxLabel, { color: t.bearish }]}>STOP LOSS</Text>
                <Text style={[styles.levelBoxValue, { color: t.bearish }]} numberOfLines={1} adjustsFontSizeToFit>${userTrade.stopLoss!.toFixed(2)}</Text>
              </View>
            </View>

            {/* Session 210 — TP/SL PROGRESS BAR (rebuilt).
                Layout requested by user: SL sits on the LEFT edge,
                Entry sits at the CENTER, TP sits on the RIGHT edge.
                The live marker slides toward TP when the trade is
                winning, toward SL when the trade is losing. Handles
                three modes:
                  • Both TP + SL →  [SL | Entry | TP]  (main case)
                  • TP only     →  [Entry | TP]        (partial protection)
                  • SL only     →  [SL | Entry]        (partial protection)
                Marker color reflects direction (green = winning half,
                red = losing half). */}
            {(() => {
              const hasSL = Number.isFinite(userTrade.stopLoss) && (userTrade.stopLoss as number) > 0;
              const hasTP = Number.isFinite(userTrade.takeProfit) && (userTrade.takeProfit as number) > 0;
              const entry = userTrade.avgCost;
              const isLong = userTrade.position === 'long';
              let progress = 50;
              let leftLabel = 'STOP LOSS';
              let midLabel: string | null = 'ENTRY';
              let rightLabel = 'TAKE PROFIT';
              let leftColor = t.bearish;
              let rightColor = t.bullish;
              if (hasSL && hasTP) {
                if (isLong) {
                  if (currentPrice >= entry) {
                    const range = (userTrade.takeProfit as number) - entry;
                    progress = range > 0 ? 50 + Math.min(50, ((currentPrice - entry) / range) * 50) : 50;
                  } else {
                    const range = entry - (userTrade.stopLoss as number);
                    progress = range > 0 ? 50 - Math.min(50, ((entry - currentPrice) / range) * 50) : 50;
                  }
                } else {
                  if (currentPrice <= entry) {
                    const range = entry - (userTrade.takeProfit as number);
                    progress = range > 0 ? 50 + Math.min(50, ((entry - currentPrice) / range) * 50) : 50;
                  } else {
                    const range = (userTrade.stopLoss as number) - entry;
                    progress = range > 0 ? 50 - Math.min(50, ((currentPrice - entry) / range) * 50) : 50;
                  }
                }
              } else if (hasTP && !hasSL) {
                leftLabel = 'ENTRY';
                midLabel = null;
                rightLabel = 'TAKE PROFIT';
                leftColor = t.textTertiary;
                const range = Math.abs((userTrade.takeProfit as number) - entry);
                const dist = isLong ? Math.max(0, currentPrice - entry) : Math.max(0, entry - currentPrice);
                progress = range > 0 ? Math.min(100, (dist / range) * 100) : 0;
              } else if (hasSL && !hasTP) {
                leftLabel = 'STOP LOSS';
                midLabel = null;
                rightLabel = 'ENTRY';
                rightColor = t.textTertiary;
                const range = Math.abs(entry - (userTrade.stopLoss as number));
                const dist = isLong ? Math.max(0, entry - currentPrice) : Math.max(0, currentPrice - entry);
                progress = range > 0 ? Math.max(0, 100 - Math.min(100, (dist / range) * 100)) : 100;
              }
              progress = Math.max(0, Math.min(100, progress));
              const markerWin = progress >= 50;
              return (
                <View style={{ marginTop: 14 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <View style={{ alignItems: 'flex-start', flex: 1 }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: leftColor, letterSpacing: 0.5 }}>{leftLabel}</Text>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: leftColor, marginTop: 1 }}>
                        ${hasSL && leftLabel === 'STOP LOSS' ? (userTrade.stopLoss as number).toFixed(2) : entry.toFixed(2)}
                      </Text>
                    </View>
                    {midLabel ? (
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ fontSize: 9, fontWeight: '700', color: t.textPrimary, letterSpacing: 0.5 }}>{midLabel}</Text>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: t.textPrimary, marginTop: 1 }}>${entry.toFixed(2)}</Text>
                      </View>
                    ) : null}
                    <View style={{ alignItems: 'flex-end', flex: 1 }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: rightColor, letterSpacing: 0.5 }}>{rightLabel}</Text>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: rightColor, marginTop: 1 }}>
                        ${hasTP && rightLabel === 'TAKE PROFIT' ? (userTrade.takeProfit as number).toFixed(2) : entry.toFixed(2)}
                      </Text>
                    </View>
                  </View>
                  <View style={{ height: 10, backgroundColor: t.border, borderRadius: 5, overflow: 'hidden', position: 'relative' }}>
                    <View style={{
                      height: '100%',
                      width: `${progress}%`,
                      backgroundColor: markerWin ? t.bullish : t.bearish,
                    }} />
                    {hasSL && hasTP ? (
                      <View style={{
                        position: 'absolute',
                        left: '50%',
                        top: 0, bottom: 0,
                        width: 2,
                        marginLeft: -1,
                        backgroundColor: t.textPrimary,
                        opacity: 0.35,
                      }} />
                    ) : null}
                    <View style={{
                      position: 'absolute',
                      left: `${progress}%`,
                      top: -3,
                      width: 16, height: 16, borderRadius: 8,
                      marginLeft: -8,
                      backgroundColor: markerWin ? t.bullish : t.bearish,
                      borderWidth: 2.5,
                      borderColor: t.surface,
                    }} />
                  </View>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: t.textTertiary, marginTop: 6, textAlign: 'center' }}>
                    Live price ${currentPrice.toFixed(2)} · {progress >= 50
                      ? `${(progress - 50).toFixed(0)}% toward TP`
                      : `${(50 - progress).toFixed(0)}% toward SL`}
                  </Text>
                </View>
              );
            })()}

            {/* Polished trade status */}
            <View style={{ marginTop: 14, padding: 14, backgroundColor: statusTone + '12', borderRadius: 12, borderLeftWidth: 3, borderLeftColor: statusTone }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <MaterialIcons name={statusIcon as any} size={16} color={statusTone} />
                <Text style={{ fontSize: 14, fontWeight: '800', color: statusTone }}>{statusTitle}</Text>
              </View>
              <Text style={{ fontSize: 13, color: t.textSecondary, lineHeight: 18, marginBottom: 4 }}>{statusBody}</Text>
              <Text style={{ fontSize: 12, color: t.textTertiary, lineHeight: 16 }}>{dayAssessment}</Text>
            </View>

            {/* Session 206 — Expanded trade metadata: entry date + time,
                trade source (AI Move / Chart Scan / Manual), original AI
                confidence, and connected brokerage account when known. */}
            <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.border, gap: 6 }}>
              {userTrade.entryDate ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialIcons name="schedule" size={13} color={t.textTertiary} />
                  <Text style={{ fontSize: 11, fontWeight: '600', color: t.textTertiary }}>
                    Opened {new Date(userTrade.entryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {new Date(userTrade.entryDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name={userTrade.source === 'ai_signal' ? 'psychology' : userTrade.source === 'chart_scan' ? 'camera-alt' : 'label'} size={13} color={t.textTertiary} />
                <Text style={{ fontSize: 11, fontWeight: '600', color: t.textTertiary }}>
                  {userTrade.source === 'ai_signal' ? 'Sight AI Move' : userTrade.source === 'chart_scan' ? 'Chart Scanner' : 'Manual entry'}
                  {userTrade.tradeType ? ` · ${userTrade.tradeType}` : ''}
                </Text>
              </View>
              {userTrade.aiContext?.confidence ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialIcons name="insights" size={13} color={t.textTertiary} />
                  <Text style={{ fontSize: 11, fontWeight: '600', color: t.textTertiary }}>
                    Original AI confidence {userTrade.aiContext.confidence}%
                  </Text>
                </View>
              ) : null}
              {brokerConn.hasActiveConnection && brokerConn.brokerNames[0] ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialIcons name="account-balance-wallet" size={13} color={t.textTertiary} />
                  <Text style={{ fontSize: 11, fontWeight: '600', color: t.textTertiary }} numberOfLines={1}>
                    Account: {brokerConn.brokerNames[0]}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      );
    } else if (brokerHeldPosition) {
      // Session 206 — Broker position card: shows direction, share count,
      // entry (broker average), live current price, P/L, AND the account
      // it lives in. No TP/SL rows because broker positions don't carry
      // Sight-defined bracket levels.
      const currentPrice = data.quote.price;
      const shares = Math.abs(Number(brokerHeldPosition.quantity) || 0);
      const avgPrice = Number(brokerHeldPosition.averagePrice) || 0;
      const isLong = Number(brokerHeldPosition.quantity) >= 0;
      const pnl = isLong ? (currentPrice - avgPrice) * shares : (avgPrice - currentPrice) * shares;
      const pnlPct = avgPrice > 0 && shares > 0 ? (pnl / (avgPrice * shares)) * 100 : 0;
      const win = pnl >= 0;
      const dirColor = win ? t.bullish : t.bearish;
      const acctLabel = (brokerHeldPosition as any).institutionName
        ? `${(brokerHeldPosition as any).institutionName}${(brokerHeldPosition as any).accountName ? ' · ' + (brokerHeldPosition as any).accountName : ''}${(brokerHeldPosition as any).accountNumber ? ' ••••' + String((brokerHeldPosition as any).accountNumber).slice(-4) : ''}`
        : 'Connected brokerage';
      // Session 208 — YOUR POSITION card uses the app's primary BLUE color
      // for the outline and direction badge per user request. The P/L
      // amount and percent remain green/red so profit/loss is instantly
      // readable at a glance.
      tradeStatusBlock = (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>YOUR POSITION</Text>
          <View style={[styles.tradeCard, { backgroundColor: t.surface, borderColor: t.primary + '55' }]}>
            <View style={styles.tradeTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.tradeMetaLabel, { color: t.textTertiary }]}>DIRECTION</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                  <View style={[styles.dirBadge, { backgroundColor: t.primary + '18' }]}>
                    <MaterialIcons name={isLong ? 'trending-up' : 'trending-down'} size={16} color={t.primary} />
                    <Text style={{ fontSize: 14, fontWeight: '800', color: t.primary }}>
                      {isLong ? 'LONG' : 'SHORT'}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: t.textPrimary }}>
                    {shares} {shares === 1 ? 'share' : 'shares'}
                  </Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.tradeMetaLabel, { color: t.textTertiary }]}>P/L</Text>
                <Text style={{ fontSize: 22, fontWeight: '800', color: win ? t.bullish : t.bearish, marginTop: 2 }}>
                  {win ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: win ? t.bullish : t.bearish }}>
                  {win ? '+' : ''}{pnlPct.toFixed(2)}%
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <View style={[styles.levelBox, { backgroundColor: t.background, borderColor: t.border }]}>
                <Text style={[styles.levelBoxLabel, { color: t.textTertiary }]}>ENTRY</Text>
                <Text style={[styles.levelBoxValue, { color: t.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>${avgPrice.toFixed(2)}</Text>
              </View>
              <View style={[styles.levelBox, { backgroundColor: t.background, borderColor: t.border }]}>
                <Text style={[styles.levelBoxLabel, { color: t.textTertiary }]}>CURRENT</Text>
                <Text style={[styles.levelBoxValue, { color: t.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>${currentPrice.toFixed(2)}</Text>
              </View>
            </View>
            <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.border, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name="account-balance-wallet" size={13} color={t.textTertiary} />
                <Text style={{ fontSize: 11, fontWeight: '600', color: t.textTertiary, flex: 1 }} numberOfLines={1}>
                  Account: {acctLabel}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name="label" size={13} color={t.textTertiary} />
                <Text style={{ fontSize: 11, fontWeight: '600', color: t.textTertiary }}>
                  Source: Broker Import
                </Text>
              </View>
            </View>
          </View>
        </View>
      );
    }
    // Session 205 — resolve which AI verdict + handler to use in the shared
    // Ask Sight AI block below.
    const showAskAI = !!userTrade || !!brokerHeldPosition;
    const askAILoading = userTrade ? analyzing : analyzingBroker;
    const askAIHandler = userTrade ? handleAnalyzePosition : handleAnalyzeBrokerPosition;
    const askAIResult = userTrade ? analysisResult : brokerAnalysisResult;
    return (
    <>
      {tradeStatusBlock}

      {showAskAI ? (
        <View style={styles.section}>
          <Pressable
            onPress={askAIHandler}
            disabled={askAILoading}
            style={({ pressed }) => [
              styles.analyzeBtnOutline,
              { borderColor: t.primary, backgroundColor: pressed ? t.primary + '10' : 'transparent', opacity: askAILoading ? 0.7 : 1 },
            ]}
          >
            {askAILoading ? (
              <ActivityIndicator size="small" color={t.primary} />
            ) : null}
            <Text style={{ fontSize: 15, fontWeight: '700', color: t.primary, letterSpacing: 0.2 }}>
              {askAILoading ? 'Analyzing...' : 'Ask Sight AI'}
            </Text>
          </Pressable>
          <Text style={{ fontSize: 11, color: t.textTertiary, textAlign: 'center', marginTop: 6 }}>
            Fresh AI analysis using current market data
          </Text>
          {askAIResult ? renderVerdictCard(askAIResult, t) : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>TECHNICAL INDICATORS</Text>
        <View style={[styles.indicatorsContainer, { backgroundColor: t.surface, borderColor: t.border }]}>
          {analysis.indicators.map((ind, i) => {
            const sigColor = ind.signal === 'BUY' ? t.bullish : ind.signal === 'SELL' ? t.bearish : t.neutral;
            return (
              <View key={i} style={[styles.indicatorRow, { borderBottomColor: t.border }]}>
                <Text style={{ flex: 1, fontSize: 14, fontWeight: '500', color: t.textSecondary }}>{ind.name}</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: t.textPrimary, marginRight: 10 }}>{ind.value}</Text>
                <View style={[styles.indicatorSignal, { backgroundColor: sigColor + '20' }]}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: sigColor }}>
                    {ind.signal === 'BUY' ? 'Bull' : ind.signal === 'SELL' ? 'Bear' : 'Neutral'}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: t.background }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: t.background }}>
        <View style={styles.header}>
          <TouchableOpacity activeOpacity={0.6} style={[styles.headerBtn, { backgroundColor: t.surface, borderColor: t.border }]}
            onPress={() => { Haptics.selectionAsync(); router.back(); }}>
            <MaterialIcons name="arrow-back" size={22} color={t.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTicker, { color: t.textPrimary }]}>{ticker}</Text>
            <Text style={[styles.headerName, { color: t.textSecondary }]} numberOfLines={1}>{quote.name}</Text>
          </View>
          <TouchableOpacity activeOpacity={tutorialActive ? 1 : 0.6}
            disabled={tutorialActive}
            style={[styles.headerBtn, { backgroundColor: t.surface, borderColor: t.border, opacity: tutorialActive ? 0.4 : 1 }]}
            onPress={handleToggleWatchlist}>
            <MaterialIcons name={inList ? 'bookmark' : 'bookmark-border'} size={22} color={inList ? t.primary : t.textSecondary} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="always" keyboardDismissMode="on-drag" onScrollBeginDrag={Keyboard.dismiss}>
        <View style={styles.priceSection}>
          <Text style={[styles.price, { color: t.textPrimary }]}>${quote.price.toFixed(2)}</Text>
          <View style={[styles.priceChange, { backgroundColor: isPositive ? t.bullishBg : t.bearishBg }]}>
            <MaterialIcons name={isPositive ? 'arrow-drop-up' : 'arrow-drop-down'} size={20} color={isPositive ? t.bullish : t.bearish} />
            <Text style={{ fontSize: 15, fontWeight: '600', color: isPositive ? t.bullish : t.bearish }}>
              {isPositive ? '+' : ''}${Math.abs(displayChange).toFixed(2)} ({isPositive ? '+' : ''}{displayChangePercent.toFixed(2)}%)
            </Text>
          </View>
          {periodChange ? (
            <Text style={{ fontSize: 11, color: t.textTertiary, marginTop: 4 }}>
              {selectedPeriod} change
            </Text>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          {activeChartData.length > 2 ? (
            // Session 214 — render the chart continuously even during a
            // period-change fetch. A small opacity dim (0.55) signals the
            // background load without collapsing the chart into an
            // ActivityIndicator, which was the visible jitter source.
            <View style={{ opacity: loadingChart ? 0.55 : 1 }}>
              <LargeChart data={activeChartData} width={chartWidth} height={200} />
            </View>
          ) : (
            <View style={[styles.noChart, { backgroundColor: t.surface, borderColor: t.border }]}>
              {loadingChart
                ? <ActivityIndicator size="small" color={t.primary} />
                : <Text style={{ color: t.textTertiary }}>Chart data loading...</Text>}
            </View>
          )}

          <View style={styles.periodRow}>
            {config.chartPeriods.map(p => {
              const active = selectedPeriod === p.id;
              return (
                <TouchableOpacity key={p.id} activeOpacity={0.7}
                  style={[styles.periodChip, { backgroundColor: t.surface, borderColor: t.border }, active && { backgroundColor: t.primary, borderColor: t.primary }]}
                  onPress={() => handlePeriodChange(p.id)}>
                  <Text style={[styles.periodText, { color: t.textSecondary }, active && { color: '#FFF' }]}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity activeOpacity={0.7}
            style={[styles.tradingViewBtn, { backgroundColor: t.surface, borderColor: t.primary + '40' }]}
            onPress={openTradingView}>
            <MaterialIcons name="open-in-new" size={16} color={t.primary} />
            <Text style={[styles.tradingViewText, { color: t.primary }]}>Advanced Chart on TradingView</Text>
          </TouchableOpacity>
        </View>

        {isSubscribed ? (
          <View>
            {renderAnalysisContent()}

            <View style={styles.section}>
              <TouchableOpacity activeOpacity={0.7}
                style={[styles.reasoningHeader, { backgroundColor: t.surface, borderColor: t.border }]}
                onPress={() => { setShowReasoning(!showReasoning); Haptics.selectionAsync(); }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <MaterialIcons name="insights" size={20} color={t.neutral} />
                  <Text style={{ fontSize: 15, fontWeight: '600', color: t.textPrimary }}>Technical Reasoning</Text>
                </View>
                <MaterialIcons name={showReasoning ? 'expand-less' : 'expand-more'} size={24} color={t.textSecondary} />
              </TouchableOpacity>
              {showReasoning ? (
                <View style={[styles.reasoningContent, { backgroundColor: t.surface, borderColor: t.border }]}>
                  {analysis.reasoning.map((r, i) => (
                    <View key={i} style={{ flexDirection: 'row', marginBottom: 10, gap: 10 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.primary, marginTop: 6 }} />
                      <Text style={{ flex: 1, fontSize: 14, color: t.textSecondary, lineHeight: 20 }}>{r}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        ) : (
          <View>
            <TouchableOpacity activeOpacity={0.9} style={styles.lockedContainer}
              onPress={() => { Haptics.selectionAsync(); router.push('/subscription'); }}>
              {/* Background image */}
              <Image source={require('../../assets/images/pro-features-bg.jpg')} style={StyleSheet.absoluteFill} contentFit="cover" />
              {/* Dark overlay for text readability */}
              <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.65)' }]} />
              {/* Lock icon and upgrade CTA */}
              <View style={styles.lockedCTAOverlay}>
                <View style={[styles.lockedIconCircle, { backgroundColor: 'rgba(255,215,0,0.15)' }]}>
                  <MaterialIcons name="workspace-premium" size={36} color="#FFD700" />
                </View>
                <Text style={styles.lockedTitle}>Pro Features</Text>
                <Text style={styles.lockedSubtitle}>AI signals, trade targets, and technical analysis</Text>
                <View style={[styles.lockedUnlockBtn, { backgroundColor: t.primary }]}>
                  <MaterialIcons name="workspace-premium" size={18} color="#FFF" />
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFF' }}>Unlock Pro</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>FUNDAMENTALS</Text>
          <View style={[styles.fundamentalsGrid, { backgroundColor: t.border, borderColor: t.border }]}>
            {[
              { label: 'Market Cap', value: quote.marketCap },
              { label: 'Volume', value: quote.volume },
              { label: '52W High', value: `$${quote.high52w.toFixed(2)}` },
              { label: '52W Low', value: `$${quote.low52w.toFixed(2)}` },
              { label: 'Day High', value: `$${quote.dayHigh.toFixed(2)}` },
              { label: 'Day Low', value: `$${quote.dayLow.toFixed(2)}` },
            ].map((item, i) => (
              <View key={i} style={[styles.fundItem, { backgroundColor: t.surface }]}>
                <Text style={{ fontSize: 12, color: t.textTertiary, fontWeight: '500', marginBottom: 4 }}>{item.label}</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: t.textPrimary }}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* News section removed per Sight redesign — Stock Details focuses on
            the user's trade and technical/AI analysis only. */}
      </ScrollView>

      <View style={[styles.stickyCTA, { backgroundColor: t.backgroundSecondary, borderTopColor: t.border, paddingBottom: insets.bottom + 12 }]}>
        {userActiveTrade ? (
        // Session 204 — renamed from "I Have Sold" to "Manage Trade".
        // Routes through the same broker/close-trade flow. Add to
        // Watchlist button is kept visible next to it for owned stocks.
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity activeOpacity={0.7}
            style={[styles.ctaButtonHalf, { backgroundColor: t.primary, borderColor: t.primary }]}
            onPress={() => {
              // Session 205 — Manage Trade now routes to the NORMAL trade
              // page (defaulting to BUY) so the user can add more shares,
              // switch to SELL to close the position, or switch to SHORT.
              // Previously it forced the SELL / close-trade flow only.
              Haptics.selectionAsync();
              router.push({
                pathname: '/put-in-trade',
                params: {
                  ticker,
                  action: 'buy',
                  entry: quote.price.toFixed(2),
                },
              } as any);
            }}>
            <MaterialIcons name="tune" size={20} color="#FFF" />
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>Manage Trade</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7}
            style={[styles.ctaButtonHalf, { backgroundColor: inList ? t.surface : t.background, borderColor: t.primary }]}
            onPress={handleToggleWatchlist}>
            <MaterialIcons name={inList ? 'bookmark-remove' : 'bookmark-add'} size={20} color={t.primary} />
            <Text style={{ fontSize: 14, fontWeight: '700', color: t.primary }} numberOfLines={1}>
              {inList ? 'Remove' : 'Add to Watchlist'}
            </Text>
          </TouchableOpacity>
        </View>
        ) : brokerHeldPosition ? (
          // Session 205 — broker-held position: Manage Trade routes to the
          // NORMAL trade page (defaulting to BUY) so the user can add more
          // shares or switch to SELL / SHORT via the action toggle.
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity activeOpacity={0.7}
              style={[styles.ctaButtonHalf, { backgroundColor: t.primary, borderColor: t.primary }]}
              onPress={() => {
                Haptics.selectionAsync();
                router.push({
                  pathname: '/put-in-trade',
                  params: {
                    ticker,
                    action: 'buy',
                    entry: quote.price.toFixed(2),
                  },
                } as any);
              }}>
              <MaterialIcons name="tune" size={20} color="#FFF" />
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>Manage Trade</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.7}
              style={[styles.ctaButtonHalf, { backgroundColor: inList ? t.surface : t.background, borderColor: t.primary }]}
              onPress={handleToggleWatchlist}>
              <MaterialIcons name={inList ? 'bookmark-remove' : 'bookmark-add'} size={20} color={t.primary} />
              <Text style={{ fontSize: 14, fontWeight: '700', color: t.primary }} numberOfLines={1}>
                {inList ? 'Remove' : 'Add to Watchlist'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          // Session 148 — Split anchored footer: Put in Trade | Add to Watchlist
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity activeOpacity={0.7}
              style={[styles.ctaButtonHalf, { backgroundColor: t.primary, borderColor: t.primary }]}
              onPress={async () => {
                Haptics.selectionAsync();
                // Session 168 — if no broker is connected, route DIRECTLY
                // to connect-brokerage so the user sees exactly ONE
                // "Opening secure brokerage link…" loader (from
                // connect-brokerage itself). Previously Put in Trade
                // would mount its own broker-check loader first and
                // then router.replace() to connect-brokerage, producing
                // TWO overlapping loaders during the transition.
                if (!brokerConn.hasActiveConnection) {
                  router.push('/connect-brokerage?autoOpen=1' as any);
                  return;
                }
                router.push({
                  pathname: '/put-in-trade',
                  params: {
                    ticker,
                    action: 'buy',
                    entry: quote.price.toFixed(2),
                    source: 'manual',
                  },
                } as any);
              }}>
              <MaterialIcons name="flash-on" size={20} color="#FFF" />
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>Trade</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.7}
              style={[styles.ctaButtonHalf, { backgroundColor: inList ? t.surface : t.background, borderColor: t.primary }]}
              onPress={handleToggleWatchlist}>
              <MaterialIcons name={inList ? 'bookmark-remove' : 'bookmark-add'} size={20} color={t.primary} />
              <Text style={{ fontSize: 14, fontWeight: '700', color: t.primary }} numberOfLines={1}>
                {inList ? 'Remove' : 'Add to Watchlist'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Session 119 §19 — I Have Sold modal (moved from Home tab) */}
      <Modal
        visible={soldModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSoldModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSoldModalVisible(false)} />
          <View style={{ width: '100%', maxWidth: 380, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.border, padding: 18 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: t.textPrimary, marginBottom: 4 }}>Sell</Text>
            <Text style={{ fontSize: 13, color: t.textSecondary, marginBottom: 14 }}>What price did you sell at?</Text>
            <Text style={{ fontSize: 11, fontWeight: '600', color: t.textTertiary, marginBottom: 4 }}>EXIT PRICE *</Text>
            <TextInput
              style={{ backgroundColor: t.background, borderColor: t.border, borderWidth: 1, color: t.textPrimary, height: 46, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontWeight: '600' }}
              placeholder="Actual sale price"
              placeholderTextColor={t.textTertiary}
              keyboardType="decimal-pad"
              value={soldExitPrice}
              onChangeText={setSoldExitPrice}
              autoFocus
            />
            {(() => {
              const ep = parseFloat(soldExitPrice);
              if (!userActiveTrade || !Number.isFinite(ep) || ep <= 0) return null;
              const pnl = userActiveTrade.position === 'long'
                ? (ep - userActiveTrade.avgCost) * userActiveTrade.shares
                : (userActiveTrade.avgCost - ep) * userActiveTrade.shares;
              const pnlPct = (pnl / (userActiveTrade.avgCost * userActiveTrade.shares)) * 100;
              const win = pnl >= 0;
              return (
                <View style={{ marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: win ? t.bullishBg : t.bearishBg }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: win ? t.bullish : t.bearish, letterSpacing: 0.5, marginBottom: 2 }}>ESTIMATED P/L</Text>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: win ? t.bullish : t.bearish }}>
                    {win ? '+' : '-'}${Math.abs(pnl).toFixed(2)} ({win ? '+' : ''}{pnlPct.toFixed(2)}%)
                  </Text>
                </View>
              );
            })()}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <Pressable
                style={{ flex: 1, height: 46, borderRadius: 10, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => { setSoldModalVisible(false); setSoldExitPrice(''); }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: t.textSecondary }}>Cancel</Text>
              </Pressable>
              <Pressable
                style={{ flex: 2, height: 46, borderRadius: 10, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => {
                  const price = parseFloat(soldExitPrice);
                  if (!Number.isFinite(price) || price <= 0) {
                    showAlert('Invalid Price', 'Enter a valid exit price.');
                    return;
                  }
                  if (userActiveTrade?.tradeId) {
                    const closed = closeTradeManually(userActiveTrade.tradeId, price);
                    if (closed) {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      const sign = closed.pnl >= 0 ? '+' : '-';
                      showAlert(
                        closed.pnl >= 0 ? 'Trade Closed — Winner' : 'Trade Closed',
                        `${closed.ticker}: ${sign}$${Math.abs(closed.pnl).toFixed(2)} (${closed.pnlPercent >= 0 ? '+' : ''}${closed.pnlPercent.toFixed(2)}%). Saved to your Journal.`,
                      );
                      setTimeout(() => router.back(), 400);
                    }
                  }
                  setSoldModalVisible(false);
                  setSoldExitPrice('');
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFF' }}>Confirm Sale</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Session 153 — First-open Stock Details tutorial. Explains what
          each part of the screen does so new users know what tapping a
          stock card leads to. Persisted via AsyncStorage; shows once. */}
      <Modal
        visible={showDetailTutorial}
        transparent
        animationType="fade"
        onRequestClose={dismissDetailTutorial}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismissDetailTutorial} />
          <View style={{ width: '100%', maxWidth: 400, backgroundColor: t.surface, borderRadius: 18, borderWidth: 1.5, borderColor: t.primary + '55', padding: 20 }}>
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.primary + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                <MaterialIcons name="insights" size={30} color={t.primary} />
              </View>
              <Text style={{ fontSize: 20, fontWeight: '800', color: t.textPrimary, marginBottom: 4 }}>Stock Details</Text>
              <Text style={{ fontSize: 13, color: t.textSecondary, textAlign: 'center', lineHeight: 18 }}>
                Everything you need to research {ticker || 'this stock'} before you trade.
              </Text>
            </View>
            <View style={{ gap: 12, marginTop: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: t.bullish + '18', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  <MaterialIcons name="show-chart" size={18} color={t.bullish} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: t.textPrimary, marginBottom: 2 }}>Live Chart & Timeframes</Text>
                  <Text style={{ fontSize: 12, color: t.textSecondary, lineHeight: 17 }}>Tap 1D, 1W, 1M, 3M, 1Y, or 5Y to switch periods. Chart refreshes with live quotes every 10 seconds.</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: t.primary + '18', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  <MaterialIcons name="psychology" size={18} color={t.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: t.textPrimary, marginBottom: 2 }}>AI Analysis & Position</Text>
                  <Text style={{ fontSize: 12, color: t.textSecondary, lineHeight: 17 }}>See technical indicators, momentum, and live status of your active trade if you have one open.</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: t.bearish + '18', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  <MaterialIcons name="flash-on" size={18} color={t.bearish} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: t.textPrimary, marginBottom: 2 }}>Trade Actions</Text>
                  <Text style={{ fontSize: 12, color: t.textSecondary, lineHeight: 17 }}>Use the anchored footer to <Text style={{ fontWeight: '700' }}>Trade</Text>, <Text style={{ fontWeight: '700' }}>Add to Watchlist</Text>, or <Text style={{ fontWeight: '700' }}>Sell</Text> if you already own shares through your broker.</Text>
                </View>
              </View>
            </View>
            <Pressable
              onPress={dismissDetailTutorial}
              style={({ pressed }) => ({
                marginTop: 18,
                height: 46,
                borderRadius: 12,
                backgroundColor: t.primary,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFF' }}>Got It</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  headerBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTicker: { fontSize: 16, fontWeight: '700' },
  headerName: { fontSize: 12, marginTop: 1 },
  priceSection: { alignItems: 'center', paddingVertical: 8 },
  price: { fontSize: 42, fontWeight: '700', letterSpacing: -1 },
  priceChange: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginTop: 6 },
  noChart: { height: 200, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1 },
  periodRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  periodChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999, borderWidth: 1 },
  periodText: { fontSize: 13, fontWeight: '600' },
  tradingViewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, gap: 6 },
  tradingViewText: { fontSize: 13, fontWeight: '600' },
  section: { paddingHorizontal: 16, marginTop: 20 },
  sectionLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  recCard: { borderRadius: 16, padding: 16, borderWidth: 1 },
  recHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  recIconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  recSignal: { fontSize: 24, fontWeight: '700' },
  confBarTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  confBarFill: { height: 6, borderRadius: 3 },
  targetsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  targetCard: { flex: 1, minWidth: '46%', borderRadius: 12, padding: 14, borderWidth: 1, borderLeftWidth: 3 },
  riskRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, borderRadius: 12, padding: 14, borderWidth: 1 },
  riskBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 6 },
  indicatorsContainer: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  indicatorRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1 },
  indicatorSignal: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, minWidth: 56, alignItems: 'center' },
  reasoningHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, padding: 14, borderWidth: 1 },
  reasoningContent: { borderRadius: 12, padding: 14, marginTop: 8, borderWidth: 1 },
  lockedContainer: { borderRadius: 16, marginHorizontal: 16, overflow: 'hidden', position: 'relative', height: 280 },
  lockedCTAOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  lockedIconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  lockedTitle: { fontSize: 22, fontWeight: '700', color: '#FFF', marginBottom: 6 },
  lockedSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 16 },
  lockedUnlockBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 12, paddingHorizontal: 32, gap: 8 },
  fundamentalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 1, borderRadius: 12, overflow: 'hidden', borderWidth: 1 },
  fundItem: { width: '49.5%', padding: 14 },
  newsItem: { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1 },
  stickyCTA: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1 },
  ctaButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 52, borderRadius: 12, gap: 8, borderWidth: 1 },
  ctaButtonHalf: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 52, borderRadius: 12, gap: 6, borderWidth: 1 },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontSize: 16 },
  analyzeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 12 },
  analyzeBtnOutline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 12, borderWidth: 1.5 },
  tradeCard: { borderRadius: 16, padding: 16, borderWidth: 1.5 },
  tradeTopRow: { flexDirection: 'row', alignItems: 'flex-start' },
  tradeMetaLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  dirBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  levelBox: { flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 12, minHeight: 62, justifyContent: 'center' },
  levelBoxLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.7, marginBottom: 4 },
  levelBoxValue: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
});
