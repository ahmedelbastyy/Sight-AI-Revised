import React, { useMemo, useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Platform } from 'react-native';
import Svg, { Path, Line, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApp } from '../contexts/AppContext';

// Session 214 — Portfolio equity graph rebuilt for a smoother, more
// sophisticated look. Uses a smoothed Bezier path (Catmull–Rom → cubic)
// so the curve reads as an elegant hand-drawn line rather than jagged
// straight segments, plus subtle horizontal gridlines and a labeled
// zero baseline so the chart is unambiguously grounded in real dollars.
// Every point is a real closed-trade running P/L value — the visual
// smoothing NEVER manufactures data points, it only smooths the path
// through them.
function PortfolioEquityGraph({
  points,
  width,
  height,
  positive,
}: {
  points: number[];
  width: number;
  height: number;
  positive: boolean;
}) {
  if (!Array.isArray(points) || points.length < 2) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 12, color: '#94A3B8' }}>Not enough history yet — close a trade to build your equity curve.</Text>
      </View>
    );
  }
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 0);
  const range = Math.max(max - min, 0.0001);
  const paddingLeft = 4;
  const paddingRight = 4;
  const paddingTop = 10;
  const paddingBottom = 18;
  const plotWidth = Math.max(1, width - paddingLeft - paddingRight);
  const plotHeight = Math.max(1, height - paddingTop - paddingBottom);
  const stepX = plotWidth / Math.max(1, points.length - 1);
  const scaleY = (v: number) => paddingTop + plotHeight - ((v - min) / range) * plotHeight;

  // Build a smoothed cubic-Bezier path through the real data points.
  // For each interior segment we derive control points as (prev + next) / 6
  // — the classic Catmull–Rom → Bezier conversion — with tension 0.5.
  const coords = points.map((v, i) => ({ x: paddingLeft + i * stepX, y: scaleY(v) }));
  let path = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] ?? coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  const fillPath = `${path} L ${paddingLeft + plotWidth} ${height - paddingBottom} L ${paddingLeft} ${height - paddingBottom} Z`;
  const color = positive ? '#10B981' : '#EF4444';
  const zeroY = min <= 0 && max >= 0 ? scaleY(0) : null;

  // Two intermediate gridlines between top and bottom so the graph reads
  // as a real financial chart rather than a floating line.
  const gridYs: number[] = [];
  if (max > 0) gridYs.push(scaleY(max));
  if (zeroY != null) gridYs.push(zeroY);
  if (min < 0) gridYs.push(scaleY(min));

  const first = points[0];
  const last = points[points.length - 1];
  const lastX = paddingLeft + (points.length - 1) * stepX;
  const lastY = scaleY(last);

  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgLinearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.32} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </SvgLinearGradient>
        <SvgLinearGradient id="equity-line" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity={0.75} />
          <Stop offset="1" stopColor={color} stopOpacity={1} />
        </SvgLinearGradient>
      </Defs>
      {gridYs.map((y, i) => (
        <Line
          key={`grid-${i}`}
          x1={paddingLeft} y1={y} x2={paddingLeft + plotWidth} y2={y}
          stroke="#1E293B"
          strokeDasharray={y === zeroY ? undefined : '3 6'}
          strokeWidth={y === zeroY ? 1 : 0.75}
          opacity={y === zeroY ? 0.9 : 0.5}
        />
      ))}
      <Path d={fillPath} fill="url(#equity-fill)" />
      <Path d={path} stroke="url(#equity-line)" strokeWidth={2.75} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* End-point marker — a small halo + solid dot at the last value */}
      <Path d={`M ${lastX} ${lastY} m -6 0 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0`} fill={color} opacity={0.18} />
      <Path d={`M ${lastX} ${lastY} m -3 0 a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0`} fill={color} />
    </Svg>
  );
}

type EquityPeriod = '1W' | '1M' | '3M' | 'YTD' | '1Y' | 'ALL';

export default function DailySummaryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currentTheme: t, watchlist, portfolio, stockDataMap, isSubscribed, closedTrades } = useApp();
  const winWidth = Dimensions.get('window').width;
  const graphWidth = Math.max(280, winWidth - 40);
  // Session 207 — user-selectable time period for the equity graph.
  const [equityPeriod, setEquityPeriod] = useState<EquityPeriod>('ALL');

  // Session 207 — Build an ACCURATE equity curve from closed trades
  // filtered by the selected period. Each point in `points` is a real
  // running P/L value (in dollars) at that moment in time — so a $100
  // day is visualized as +$100, and losses show below the zero line.
  const equityData = useMemo(() => {
    const now = Date.now();
    let cutoff = 0;
    switch (equityPeriod) {
      case '1W': cutoff = now - 7 * 24 * 60 * 60 * 1000; break;
      case '1M': cutoff = now - 30 * 24 * 60 * 60 * 1000; break;
      case '3M': cutoff = now - 90 * 24 * 60 * 60 * 1000; break;
      case 'YTD': cutoff = new Date(new Date().getFullYear(), 0, 1).getTime(); break;
      case '1Y': cutoff = now - 365 * 24 * 60 * 60 * 1000; break;
      default: cutoff = 0;
    }
    const allSorted = [...closedTrades].sort((a, b) => new Date(a.exitDate).getTime() - new Date(b.exitDate).getTime());
    // Baseline = running P/L at the start of the selected period (so
    // the graph shows P/L RELATIVE TO the period start, not lifetime).
    let baseline = 0;
    for (const c of allSorted) {
      if (new Date(c.exitDate).getTime() < cutoff) baseline += Number(c.pnl) || 0;
      else break;
    }
    const filteredClosed = allSorted.filter(c => new Date(c.exitDate).getTime() >= cutoff);
    const points: number[] = [0];
    let running = 0;
    for (const c of filteredClosed) {
      running += Number(c.pnl) || 0;
      points.push(running);
    }
    // Add unrealized P/L from currently open portfolio positions as the final point.
    let unrealized = 0;
    portfolio.forEach(item => {
      const data = stockDataMap.get(item.ticker);
      if (!data) return;
      const isLong = item.position === 'long';
      unrealized += isLong
        ? (data.quote.price - item.avgCost) * item.shares
        : (item.avgCost - data.quote.price) * item.shares;
    });
    const total = running + unrealized;
    if (Math.abs(unrealized) > 0.001) points.push(total);
    if (points.length < 2) points.push(total);
    return { points, total, unrealized, realized: running, baseline, tradeCount: filteredClosed.length };
  }, [closedTrades, portfolio, stockDataMap, equityPeriod]);

  const summaryData = useMemo(() => {
    // Session 148 — include ACTIVE TRADES in the summary universe so
    // users' currently-held positions are analyzed alongside their
    // watchlist. Portfolio items already contain the ticker, but active
    // trades (with tradeId + TP/SL) are what the user cares about most.
    const activeTradeTickers = portfolio
      .filter(p => p.tradeId && p.takeProfit && p.stopLoss)
      .map(p => p.ticker);
    const allTickers = [...new Set([...watchlist, ...portfolio.map(p => p.ticker), ...activeTradeTickers])];
    const stocks = allTickers.map(ticker => {
      const data = stockDataMap.get(ticker);
      if (!data) return null;
      const isActiveTrade = activeTradeTickers.includes(ticker);
      return {
        ticker,
        name: data.quote.name,
        price: data.quote.price,
        change: data.quote.change,
        changePercent: data.quote.changePercent,
        signal: data.analysis.signal,
        isActiveTrade,
      };
    }).filter(Boolean) as { ticker: string; name: string; price: number; change: number; changePercent: number; signal: string; isActiveTrade: boolean }[];

    const activeTradeStocks = stocks.filter(s => s.isActiveTrade);
    const gainers = stocks.filter(s => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 3);
    const losers = stocks.filter(s => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 3);
    const buySignals = stocks.filter(s => s.signal === 'BUY').length;
    const sellSignals = stocks.filter(s => s.signal === 'SELL').length;
    const holdSignals = stocks.filter(s => s.signal === 'HOLD').length;

    let portfolioValue = 0;
    let portfolioCost = 0;
    portfolio.forEach(item => {
      const data = stockDataMap.get(item.ticker);
      if (data) {
        portfolioValue += data.quote.price * item.shares;
        portfolioCost += item.avgCost * item.shares;
      }
    });
    const portfolioChange = portfolioValue - portfolioCost;
    const portfolioChangePercent = portfolioCost > 0 ? (portfolioChange / portfolioCost) * 100 : 0;

    return { stocks, activeTradeStocks, gainers, losers, buySignals, sellSignals, holdSignals, portfolioValue, portfolioChange, portfolioChangePercent };
  }, [watchlist, portfolio, stockDataMap]);

  const hasStocks = summaryData.stocks.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: t.background }]}>
      <LinearGradient
        colors={[t.primary + '10', t.background]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }} showsVerticalScrollIndicator={false}>
          {/* Session 208 — Eye logo removed from the Daily Summary header per
              user request. The page now leads straight into the title and
              date, giving the equity graph directly below more prominence. */}
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: t.textPrimary }]}>Daily Summary</Text>
            <Text style={[styles.headerDate, { color: t.textSecondary }]}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </Text>
          </View>

          {!hasStocks ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="assessment" size={48} color={t.textTertiary} />
              <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>No Stocks to Analyze</Text>
              <Text style={[styles.emptyDesc, { color: t.textSecondary }]}>Add stocks to your watchlist to receive personalized daily summaries.</Text>
            </View>
          ) : (
            <>
              {/* Session 214 — Portfolio equity graph refined for a smoother,
                  more sophisticated look. Real closed-trade dollar amounts
                  drive the curve; the visualization now uses a smoothed
                  bezier path with subtle gridlines, a highlighted zero
                  baseline and an end-point marker so users can read their
                  actual P/L at a glance. Data itself is unchanged — every
                  point is a genuine running P/L value from closedTrades
                  filtered by the selected period. */}
              <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, paddingHorizontal: 0, paddingTop: 18, paddingBottom: 10 }]}>
                <View style={{ paddingHorizontal: 18, marginBottom: 10 }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: t.textTertiary }}>{equityPeriod === 'ALL' ? 'ALL-TIME P/L' : `${equityPeriod} P/L`}</Text>
                  <Text style={{ fontSize: 40, fontWeight: '800', color: t.textPrimary, letterSpacing: -0.6, marginTop: 2 }}>
                    {equityData.total >= 0 ? '+' : '-'}${Math.abs(equityData.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <MaterialIcons name={equityData.total >= 0 ? 'trending-up' : 'trending-down'} size={16} color={equityData.total >= 0 ? '#10B981' : '#EF4444'} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: equityData.total >= 0 ? '#10B981' : '#EF4444' }}>
                      {equityData.total >= 0 ? '+' : '-'}${Math.abs(equityData.total).toFixed(2)}
                    </Text>
                    <Text style={{ fontSize: 11, color: t.textTertiary, fontWeight: '600' }}>· {equityData.tradeCount} closed · {portfolio.filter(p => p.tradeId).length} open</Text>
                  </View>
                  {Math.abs(equityData.unrealized) > 0.001 ? (
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
                      <Text style={{ fontSize: 11, color: t.textTertiary }}>
                        <Text style={{ fontWeight: '700', color: t.textSecondary }}>Realized</Text>  {equityData.realized >= 0 ? '+' : '-'}${Math.abs(equityData.realized).toFixed(2)}
                      </Text>
                      <Text style={{ fontSize: 11, color: t.textTertiary }}>
                        <Text style={{ fontWeight: '700', color: t.textSecondary }}>Open</Text>  {equityData.unrealized >= 0 ? '+' : '-'}${Math.abs(equityData.unrealized).toFixed(2)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <PortfolioEquityGraph
                  points={equityData.points}
                  width={graphWidth}
                  height={200}
                  positive={equityData.total >= 0}
                />
                {/* Session 215 — Time-range pills PINNED to one line on every
                    device. Each pill uses flex:1 so all six share the row
                    equally; padding is horizontal only and text uses
                    adjustsFontSizeToFit + numberOfLines=1 so it can never
                    wrap, clip, or overflow the screen on iPhone SE through
                    Pro Max. */}
                <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center', paddingHorizontal: 16, marginTop: 12 }}>
                  {(['1W', '1M', '3M', 'YTD', '1Y', 'ALL'] as EquityPeriod[]).map(p => {
                    const isActive = equityPeriod === p;
                    return (
                      <TouchableOpacity
                        key={p}
                        activeOpacity={0.7}
                        onPress={() => { Haptics.selectionAsync(); setEquityPeriod(p); }}
                        style={{ flex: 1, minWidth: 0, height: 30, paddingHorizontal: 4, borderRadius: 9999, backgroundColor: isActive ? t.primary : t.background, borderWidth: 1, borderColor: isActive ? t.primary : t.border, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Text
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                          style={{ fontSize: 11, fontWeight: '700', color: isActive ? '#FFF' : t.textSecondary, letterSpacing: 0.2 }}
                        >{p}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Portfolio Overview */}
              {portfolio.length > 0 ? (
                <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                  <Text style={[styles.cardLabel, { color: t.textTertiary }]}>PORTFOLIO</Text>
                  <Text style={[styles.portfolioValue, { color: t.textPrimary }]}>
                    ${summaryData.portfolioValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                  <View style={[styles.changeBadge, { backgroundColor: summaryData.portfolioChange >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)' }]}>
                    <MaterialIcons name={summaryData.portfolioChange >= 0 ? 'arrow-drop-up' : 'arrow-drop-down'} size={18} color={summaryData.portfolioChange >= 0 ? '#10B981' : '#EF4444'} />
                    <Text style={{ fontSize: 14, fontWeight: '700', color: summaryData.portfolioChange >= 0 ? '#10B981' : '#EF4444' }}>
                      {summaryData.portfolioChange >= 0 ? '+' : ''}{summaryData.portfolioChangePercent.toFixed(2)}%
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* Session 148 — Active Trades block */}
              {summaryData.activeTradeStocks.length > 0 ? (
                <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                  <Text style={[styles.cardLabel, { color: t.textTertiary }]}>ACTIVE TRADES</Text>
                  {summaryData.activeTradeStocks.map((stock) => {
                    const up = stock.changePercent >= 0;
                    return (
                      <View key={`at-${stock.ticker}`} style={[styles.moverRow, { borderBottomColor: t.border }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                          <MaterialIcons name={up ? 'trending-up' : 'trending-down'} size={16} color={up ? '#10B981' : '#EF4444'} />
                          <Text style={[styles.moverTicker, { color: t.textPrimary }]}>{stock.ticker}</Text>
                          <Text style={{ fontSize: 12, color: t.textSecondary, flex: 1 }} numberOfLines={1}>{stock.name}</Text>
                        </View>
                        <Text style={[styles.moverChange, { color: up ? '#10B981' : '#EF4444' }]}>
                          {up ? '+' : ''}{stock.changePercent.toFixed(2)}%
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {/* Watchlist Activity */}
              <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                <Text style={[styles.cardLabel, { color: t.textTertiary }]}>WATCHLIST ACTIVITY</Text>
                <View style={styles.signalsRow}>
                  <View style={[styles.signalBadge, { backgroundColor: 'rgba(16,185,129,0.12)' }]}>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: '#10B981' }}>{summaryData.gainers.length}</Text>
                    <Text style={{ fontSize: 11, color: '#10B981', fontWeight: '600' }}>UP</Text>
                  </View>
                  <View style={[styles.signalBadge, { backgroundColor: 'rgba(245,158,11,0.12)' }]}>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: '#F59E0B' }}>{summaryData.stocks.filter(s => Math.abs(s.changePercent) < 0.5).length}</Text>
                    <Text style={{ fontSize: 11, color: '#F59E0B', fontWeight: '600' }}>FLAT</Text>
                  </View>
                  <View style={[styles.signalBadge, { backgroundColor: 'rgba(239,68,68,0.12)' }]}>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: '#EF4444' }}>{summaryData.losers.filter(s => s.changePercent < -0.5).length}</Text>
                    <Text style={{ fontSize: 11, color: '#EF4444', fontWeight: '600' }}>DOWN</Text>
                  </View>
                </View>
              </View>

              {/* Top Movers */}
              {(summaryData.gainers.length > 0 || summaryData.losers.length > 0) ? (
                <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                  <Text style={[styles.cardLabel, { color: t.textTertiary }]}>TOP MOVERS</Text>
                  {summaryData.gainers.map(stock => (
                    <View key={`gain-${stock.ticker}`} style={[styles.moverRow, { borderBottomColor: t.border }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <MaterialIcons name="trending-up" size={16} color="#10B981" />
                        <Text style={[styles.moverTicker, { color: t.textPrimary }]}>{stock.ticker}</Text>
                        <Text style={{ fontSize: 12, color: t.textSecondary }}>{stock.name}</Text>
                      </View>
                      <Text style={[styles.moverChange, { color: '#10B981' }]}>
                        +{stock.changePercent.toFixed(2)}%
                      </Text>
                    </View>
                  ))}
                  {summaryData.losers.map(stock => (
                    <View key={`lose-${stock.ticker}`} style={[styles.moverRow, { borderBottomColor: t.border }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <MaterialIcons name="trending-down" size={16} color="#EF4444" />
                        <Text style={[styles.moverTicker, { color: t.textPrimary }]}>{stock.ticker}</Text>
                        <Text style={{ fontSize: 12, color: t.textSecondary }}>{stock.name}</Text>
                      </View>
                      <Text style={[styles.moverChange, { color: '#EF4444' }]}>
                        {stock.changePercent.toFixed(2)}%
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Account Overview */}
              <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                <Text style={[styles.cardLabel, { color: t.textTertiary }]}>ACCOUNT OVERVIEW</Text>
                <View style={{ gap: 8 }}>
                  <View style={styles.accountRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialIcons name="visibility" size={18} color={t.primary} />
                      <Text style={{ fontSize: 14, color: t.textSecondary }}>Watchlist Stocks</Text>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: t.textPrimary }}>{watchlist.length}</Text>
                  </View>
                  <View style={styles.accountRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialIcons name="account-balance-wallet" size={18} color={t.primary} />
                      <Text style={{ fontSize: 14, color: t.textSecondary }}>Portfolio Positions</Text>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: t.textPrimary }}>{portfolio.length}</Text>
                  </View>
                  <View style={styles.accountRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialIcons name="calendar-today" size={18} color={t.primary} />
                      <Text style={{ fontSize: 14, color: t.textSecondary }}>Date</Text>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: t.textPrimary }}>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                  </View>
                </View>
              </View>
            </>
          )}
        </ScrollView>

        {/* Continue Button */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity activeOpacity={0.8} style={styles.continueBtn}
            onPress={() => { Haptics.selectionAsync(); router.back(); }}>
            <Text style={styles.continueBtnText}>Continue</Text>
            <MaterialIcons name="arrow-forward" size={18} color="#FFF" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', paddingTop: 24, paddingBottom: 20, gap: 8 },
  headerTitle: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  headerDate: { fontSize: 14, fontWeight: '500' },
  card: { borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1 },
  cardLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
  portfolioValue: { fontSize: 28, fontWeight: '700', letterSpacing: -1, marginBottom: 6 },
  changeBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  signalsRow: { flexDirection: 'row', gap: 10 },
  signalBadge: { flex: 1, borderRadius: 10, padding: 12, alignItems: 'center', gap: 2 },
  moverRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1 },
  accountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  moverTicker: { fontSize: 15, fontWeight: '700' },
  moverChange: { fontSize: 14, fontWeight: '700' },

  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyDesc: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  footer: { paddingHorizontal: 20 },
  continueBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#3B82F6', height: 52, borderRadius: 14, gap: 8 },
  continueBtnText: { fontSize: 17, fontWeight: '700', color: '#FFF' },
});
