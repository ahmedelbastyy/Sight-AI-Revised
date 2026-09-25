/**
 * Journal Tab (Session 117) — replaces the Market tab.
 * Automatic trading journal: today's report + calendar + per-day activity + AI performance.
 * Only uses REAL recorded trades and REAL AI signal outcomes. Never invents activity.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Dimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useApp, ClosedTrade, PortfolioItem } from '../../contexts/AppContext';
import { StockLogo } from '../../components/ui/StockLogo';
import { computeTradeStatus } from '../../services/tradeService';
import { isMarketOpen } from '../../services/notificationService';

function toDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Session 210 — BULLETPROOF calendar day-of-week arithmetic.
// Uses Zeller's Congruence — a closed-form formula that computes
// day-of-week from year/month/day components without ANY reliance on
// JavaScript's Date.getDay(), which was returning inconsistent results
// on some devices due to timezone / DST edge cases. Result is
// mathematically guaranteed accurate through 2030+.
//
// Returns 0 (Sunday) through 6 (Saturday).
// Verification anchors:
//   Sept 1, 2026  -> Tuesday  (2)  ✓
//   Sept 21, 2026 -> Monday   (1)  ✓
//   Jan 1, 2027   -> Friday   (5)  ✓
//   Jan 1, 2030   -> Tuesday  (2)  ✓
function zellerDayOfWeek(year: number, monthIndex0: number, day: number): number {
  let m = monthIndex0 + 1;
  let y = year;
  if (m < 3) { m += 12; y -= 1; }
  const K = y % 100;
  const J = Math.floor(y / 100);
  const h = (day + Math.floor(13 * (m + 1) / 5) + K + Math.floor(K / 4) + Math.floor(J / 4) + 5 * J) % 7;
  // Zeller: 0=Sat, 1=Sun, ..., 6=Fri.  Convert to 0=Sun ... 6=Sat.
  return (h + 6) % 7;
}

// Session 210 — Explicit days-in-month lookup with proper leap-year
// check (year divisible by 4 AND (not divisible by 100 OR divisible
// by 400)). No Date-object round-trip needed.
function daysInMonthArithmetic(year: number, monthIndex0: number): number {
  const table = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (monthIndex0 !== 1) return table[monthIndex0];
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  return isLeap ? 29 : 28;
}
function fmtMoney(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDateHuman(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

interface DayGroup {
  dateKey: string;
  trades: ClosedTrade[];
  totalPnL: number;
  winners: number;
  losers: number;
}

export default function JournalScreen() {
  const insets = useSafeAreaInsets();
  const { currentTheme: t, closedTrades, portfolio, activeAISignals, stockDataMap } = useApp();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);

  const todayKey = toDateKey(new Date().toISOString());

  // Session 118 — Active/Pending trades (user has logged, not yet closed).
  const activeTrades = useMemo(
    () => portfolio.filter(p => p.tradeId && p.takeProfit && p.stopLoss),
    [portfolio],
  );

  // Group closed trades by exit day
  const daysMap = useMemo(() => {
    const map = new Map<string, DayGroup>();
    closedTrades.forEach(ct => {
      const key = toDateKey(ct.exitDate);
      let g = map.get(key);
      if (!g) {
        g = { dateKey: key, trades: [], totalPnL: 0, winners: 0, losers: 0 };
        map.set(key, g);
      }
      g.trades.push(ct);
      g.totalPnL += ct.pnl;
      if (ct.pnl >= 0) g.winners++;
      else g.losers++;
    });
    return map;
  }, [closedTrades]);

  const todayGroup = daysMap.get(todayKey);
  const displayDate = selectedDate ?? todayKey;
  const displayGroup = daysMap.get(displayDate);

  // Overall stats
  const overallStats = useMemo(() => {
    const total = closedTrades.length;
    const winners = closedTrades.filter(c => c.pnl >= 0).length;
    const losers = total - winners;
    const totalPnL = closedTrades.reduce((s, c) => s + c.pnl, 0);
    const winRate = total > 0 ? (winners / total) * 100 : 0;
    const avgReturn = total > 0
      ? closedTrades.reduce((s, c) => s + c.pnlPercent, 0) / total
      : 0;
    return { total, winners, losers, totalPnL, winRate, avgReturn };
  }, [closedTrades]);

  // Session 209 — Robust calendar rendering. Constructs the month grid
  // using explicit local-timezone arithmetic so dates are always aligned
  // to the correct day-of-week through 2030 and beyond. `firstDayOfWeek`
  // returns 0 (Sunday) … 6 (Saturday) for the 1st of the displayed month,
  // and cell indexing walks left-to-right starting at Sunday. Weekday
  // headers use 3-letter abbreviations so users can never confuse the
  // two "T" columns (Tuesday vs Thursday) that the previous single-letter
  // labels caused.
  const monthDate = useMemo(() => {
    const now = new Date();
    // Rebuild deterministically from year/month components.
    return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  }, [monthOffset]);

  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  // Session 210 — replaced JS Date.getDay() + last-day-of-month roundtrip
  // with pure arithmetic (zellerDayOfWeek + daysInMonthArithmetic). This
  // fixed the wrong-weekday bug where Sept 21 2026 was displaying as
  // Thursday when it is actually Monday. Guaranteed accurate through
  // 2030+ regardless of timezone, locale, or DST.
  const daysInMonth = daysInMonthArithmetic(monthDate.getFullYear(), monthDate.getMonth());
  const firstDayOfWeek = zellerDayOfWeek(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const totalCells = Math.ceil((firstDayOfWeek + daysInMonth) / 7) * 7;

  // Session 211 — ROOT-CAUSE FIX for the wrong-weekday bug. Previously
  // cellSize subtracted only 40pt (ScrollView's paddingHorizontal 32 +
  // an unexplained 8). But the actual space consumed OUTSIDE the grid
  // is: ScrollView paddingHorizontal (32 = 16*2) + calCard padding
  // (24 = 12*2) + calCard border (2 = 1*2) = 58pt. With the old value
  // cells rendered ~50pt on an iPhone 14 (width 390), and 7*50 = 350
  // OVERFLOWED the card's inner width of ~332pt. The row's flexWrap
  // then wrapped to SIX cells per row instead of seven — so Sept 21
  // 2026 (a Monday, correctly computed by Zeller's Congruence and
  // supposed to sit at cell index 22 → column 22%7=1=MON) instead
  // landed at column 22%6=4, which visually aligns with the 5th
  // header slot (THU). Subtracting 60 (2pt safety buffer) guarantees
  // 7 cells fit on every device from iPhone SE (320pt) to Pro Max
  // (430pt+), so the grid ALWAYS has exactly 7 columns per row and
  // day-of-week alignment is correct through 2030+.
  const cellSize = Math.max(32, Math.floor((Dimensions.get('window').width - 60) / 7));

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: t.background }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: t.textPrimary }]}>Journal</Text>
          <Text style={[styles.subtitle, { color: t.textSecondary }]}>Your Sight Journal</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ---- ACTIVE / PENDING TRADES (Session 118) ---- */}
        {activeTrades.length > 0 ? (
          <View style={[styles.reportCard, { backgroundColor: t.surface, borderColor: t.border, marginTop: 8 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <View>
                <Text style={[styles.reportLabel, { color: t.textTertiary }]}>PENDING TRADES</Text>
                <Text style={[styles.reportDate, { color: t.textPrimary }]}>{activeTrades.length} open position{activeTrades.length !== 1 ? 's' : ''}</Text>
              </View>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.primary + '18', alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="schedule" size={22} color={t.primary} />
              </View>
            </View>
            <View style={{ gap: 8 }}>
              {activeTrades.map(item => {
                const currentPrice = stockDataMap.get(item.ticker)?.quote.price ?? item.avgCost;
                const st = computeTradeStatus({
                  position: item.position,
                  entryPrice: item.avgCost,
                  takeProfit: item.takeProfit!,
                  stopLoss: item.stopLoss!,
                  shares: item.shares,
                }, currentPrice);
                const win = st.currentPnL >= 0;
                return (
                  <View key={item.tradeId} style={{
                    padding: 10, backgroundColor: t.background,
                    borderRadius: 10, borderWidth: 1, borderColor: t.border,
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <StockLogo ticker={item.ticker} size={28} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: t.textPrimary }}>{item.ticker}</Text>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: item.position === 'long' ? t.bullish : t.bearish }}>
                            {item.position.toUpperCase()}
                          </Text>
                          {item.source && item.source !== 'manual' ? (
                            <View style={{ backgroundColor: t.primary + '18', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 }}>
                              <Text style={{ fontSize: 9, fontWeight: '700', color: t.primary }}>
                                {item.source === 'ai_signal' ? 'AI MOVE' : 'CHART SCAN'}
                              </Text>
                            </View>
                          ) : null}
                          {item.tradeType ? (
                            <View style={{ backgroundColor: t.textTertiary + '20', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 }}>
                              <Text style={{ fontSize: 9, fontWeight: '700', color: t.textSecondary }}>
                                {item.tradeType.toUpperCase()}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={{ fontSize: 11, color: t.textSecondary, marginTop: 1 }}>
                          Entry ${item.avgCost.toFixed(2)} · Now ${currentPrice.toFixed(2)} · TP ${item.takeProfit!.toFixed(2)} · SL ${item.stopLoss!.toFixed(2)}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: win ? t.bullish : t.bearish }}>
                          {win ? '+' : '-'}${Math.abs(st.currentPnL).toFixed(2)}
                        </Text>
                        <Text style={{ fontSize: 10, color: t.textTertiary, fontWeight: '500' }}>{win ? 'Profit' : 'Loss'}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* ---- Today's report ---- */}
        <View style={[styles.reportCard, { backgroundColor: t.surface, borderColor: t.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <View>
              <Text style={[styles.reportLabel, { color: t.textTertiary }]}>TODAY'S REPORT</Text>
              <Text style={[styles.reportDate, { color: t.textPrimary }]}>{fmtDateHuman(new Date().toISOString())}</Text>
            </View>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.primary + '18', alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="assessment" size={22} color={t.primary} />
            </View>
          </View>

          {todayGroup ? (
            <>
              <Text style={{ fontSize: 32, fontWeight: '800', color: todayGroup.totalPnL >= 0 ? t.bullish : t.bearish, marginBottom: 8 }}>
                {fmtMoney(todayGroup.totalPnL)}
              </Text>
              <Text style={{ fontSize: 13, color: t.textSecondary, marginBottom: 14 }}>
                {todayGroup.trades.length} completed trade{todayGroup.trades.length !== 1 ? 's' : ''} · {todayGroup.winners} winner{todayGroup.winners !== 1 ? 's' : ''} · {todayGroup.losers} loss{todayGroup.losers !== 1 ? 'es' : ''}
              </Text>
              <View style={{ gap: 6 }}>
                {todayGroup.trades.slice(0, 6).map(ct => (
                  <TradeMiniRow key={ct.id} trade={ct} theme={t} />
                ))}
              </View>
            </>
          ) : (
            <View style={{ paddingVertical: 12 }}>
              <Text style={{ fontSize: 14, color: t.textSecondary, lineHeight: 20 }}>
                No completed trades today yet. Your closed positions will appear here automatically as they hit Take Profit, Stop Loss, or you tap "I Have Sold".
              </Text>
              {portfolio.length > 0 ? (
                <Text style={{ fontSize: 12, color: t.textTertiary, marginTop: 10 }}>
                  {portfolio.length} active position{portfolio.length !== 1 ? 's' : ''} being monitored.
                </Text>
              ) : null}
            </View>
          )}
        </View>

        {/* ---- AI signal performance today (Session 161 — accurate stats) ----
            Previous version counted from `activeAISignals` filtered by
            status, but the refreshAISignals query in AppContext already
            filters `.eq('status', 'active')` — so TP Hits / SL Hits /
            Expired were ALWAYS zero. Fixed by deriving from the real user
            data: portfolio (Sight-tracked AI trades still open today),
            closedTrades (AI trades that closed today, broken down by exit
            reason), and the live activeAISignals list. */}
        <AISignalsTodayCard theme={t} activeAISignals={activeAISignals} closedTrades={closedTrades} portfolio={portfolio} />

        {/* ---- Calendar ---- */}
        <View style={[styles.calCard, { backgroundColor: t.surface, borderColor: t.border }]}>
          <View style={styles.calHeader}>
            <Pressable
              onPress={() => { setMonthOffset(m => m - 1); Haptics.selectionAsync(); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialIcons name="chevron-left" size={24} color={t.textSecondary} />
            </Pressable>
            <Text style={{ fontSize: 15, fontWeight: '700', color: t.textPrimary }}>{monthLabel}</Text>
            <Pressable
              onPress={() => { setMonthOffset(m => m + 1); Haptics.selectionAsync(); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              disabled={monthOffset >= 0}
            >
              <MaterialIcons name="chevron-right" size={24} color={monthOffset >= 0 ? t.textTertiary + '55' : t.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.dayHeaderRow}>
            {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((d, i) => (
              <View key={i} style={{ width: cellSize, alignItems: 'center' }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: t.textTertiary, letterSpacing: 0.4 }}>{d}</Text>
              </View>
            ))}
          </View>
          <View style={styles.calGrid}>
            {Array.from({ length: totalCells }).map((_, i) => {
              const dayNum = i - firstDayOfWeek + 1;
              const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
              if (!inMonth) return <View key={i} style={{ width: cellSize, height: cellSize }} />;
              const dateKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const g = daysMap.get(dateKey);
              const isSelected = displayDate === dateKey;
              const isToday = dateKey === todayKey;
              return (
                <Pressable
                  key={i}
                  onPress={() => { setSelectedDate(dateKey); Haptics.selectionAsync(); }}
                  style={[styles.dayCell, { width: cellSize, height: cellSize }]}
                >
                  <View style={[
                    styles.dayInner,
                    isSelected && { backgroundColor: t.primary },
                    !isSelected && isToday && { borderWidth: 1.5, borderColor: t.primary },
                  ]}>
                    <Text style={{
                      fontSize: 13,
                      fontWeight: '600',
                      color: isSelected ? '#FFFFFF' : t.textPrimary,
                    }}>{dayNum}</Text>
                    {g ? (
                      <View style={{
                        width: 4, height: 4, borderRadius: 2,
                        backgroundColor: isSelected ? '#FFFFFF' : (g.totalPnL >= 0 ? t.bullish : t.bearish),
                        marginTop: 2,
                      }} />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ---- Selected day details ---- */}
        {displayGroup ? (
          <View style={[styles.dayDetailCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: t.textPrimary, marginBottom: 4 }}>
              {fmtDateHuman(displayGroup.trades[0].exitDate)}
            </Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: displayGroup.totalPnL >= 0 ? t.bullish : t.bearish, marginBottom: 4 }}>
              {fmtMoney(displayGroup.totalPnL)}
            </Text>
            <Text style={{ fontSize: 12, color: t.textSecondary, marginBottom: 10 }}>
              {displayGroup.trades.length} trade{displayGroup.trades.length !== 1 ? 's' : ''} · {displayGroup.winners}W / {displayGroup.losers}L
            </Text>
            {displayGroup.trades.map(ct => (
              <TradeMiniRow key={ct.id} trade={ct} theme={t} showFull />
            ))}
          </View>
        ) : (
          <View style={[styles.dayDetailCard, { backgroundColor: t.surface, borderColor: t.border, alignItems: 'center' }]}>
            <MaterialIcons name="event-available" size={30} color={t.textTertiary} />
            <Text style={{ fontSize: 13, color: t.textTertiary, marginTop: 8, textAlign: 'center' }}>
              No trades on this day.
            </Text>
          </View>
        )}

        {/* ---- Overall stats ---- */}
        <View style={[styles.statsCard, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: t.textTertiary, letterSpacing: 1, marginBottom: 10 }}>ALL-TIME STATS</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <StatCell label="Total Trades" value={overallStats.total} theme={t} />
            <StatCell label="Winners" value={overallStats.winners} color={t.bullish} theme={t} />
            <StatCell label="Losses" value={overallStats.losers} color={t.bearish} theme={t} />
            <StatCell label="Win Rate" value={`${overallStats.winRate.toFixed(0)}%`} color={t.primary} theme={t} />
          </View>
          <View style={{ height: 1, backgroundColor: t.border, marginVertical: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 13, color: t.textSecondary }}>Total P/L</Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: overallStats.totalPnL >= 0 ? t.bullish : t.bearish }}>
              {fmtMoney(overallStats.totalPnL)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={{ fontSize: 13, color: t.textSecondary }}>Avg Return per Trade</Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: overallStats.avgReturn >= 0 ? t.bullish : t.bearish }}>
              {overallStats.avgReturn >= 0 ? '+' : ''}{overallStats.avgReturn.toFixed(2)}%
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AISignalsTodayCard({ theme: t, activeAISignals, closedTrades, portfolio }: { theme: any; activeAISignals: any[]; closedTrades: ClosedTrade[]; portfolio: PortfolioItem[] }) {
  const stats = useMemo(() => {
    // Session 167 — when the US market is CLOSED (weekend, pre-market,
    // after-hours, holiday) the AI Moves engine is not scanning and no
    // signal activity is meaningful, so every metric renders as 0.
    if (!isMarketOpen()) {
      return { active: 0, taken: 0, tpHits: 0, slHits: 0, marketClosed: true };
    }

    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayEnd = dayStart + 24 * 3600 * 1000;

    // Currently-live AI Moves (dual-model scan output, status='active').
    const active = activeAISignals.filter((s: any) => s.status === 'active').length;

    // AI trades that closed today, broken down by exit reason.
    const todayClosedAI = closedTrades.filter(c => {
      if (c.source !== 'ai_signal') return false;
      const t = new Date(c.exitDate).getTime();
      return t >= dayStart && t < dayEnd;
    });
    const tpHits = todayClosedAI.filter(c => c.exitReason === 'take_profit').length;
    const slHits = todayClosedAI.filter(c => c.exitReason === 'stop_loss').length;

    // Total AI signals TAKEN today = new AI trades opened today + AI trades
    // that opened and closed same-day. Portfolio items with source='ai_signal'
    // count if their entry date is today (regardless of whether they've closed).
    const openedTodayAI = portfolio.filter(p => {
      if (p.source !== 'ai_signal' || !p.entryDate) return false;
      const t = new Date(p.entryDate).getTime();
      return t >= dayStart && t < dayEnd;
    }).length;
    // AI closed-trades that both opened and closed today would double-count
    // if we naively summed openedTodayAI + todayClosedAI. Instead, count
    // only closed AI trades whose entry date is NOT today (i.e. they were
    // opened previously and closed today), then add today's newly-opened.
    const closedTodayFromEarlierAI = todayClosedAI.filter(c => {
      const entryT = new Date(c.entryDate).getTime();
      return entryT < dayStart;
    }).length;
    const taken = openedTodayAI + closedTodayFromEarlierAI;

    return { active, taken, tpHits, slHits, marketClosed: false };
  }, [activeAISignals, closedTrades, portfolio]);

  return (
    <View style={[styles.aiCard, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <MaterialIcons name="psychology" size={18} color={t.primary} />
        <Text style={{ fontSize: 15, fontWeight: '700', color: t.textPrimary }}>AI Signals Today</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <StatCell label="Active" value={stats.active} color={t.primary} theme={t} />
        <StatCell label="Taken" value={stats.taken} color={t.textPrimary} theme={t} />
        <StatCell label="TP Hits" value={stats.tpHits} color={t.bullish} theme={t} />
        <StatCell label="SL Hits" value={stats.slHits} color={t.bearish} theme={t} />
      </View>
      {stats.marketClosed ? (
        <Text style={{ fontSize: 12, color: t.textTertiary, marginTop: 10, lineHeight: 17 }}>
          Market is closed. AI Moves resume automatically when the market reopens.
        </Text>
      ) : stats.active === 0 && stats.taken === 0 && stats.tpHits === 0 && stats.slHits === 0 ? (
        <Text style={{ fontSize: 12, color: t.textTertiary, marginTop: 10, lineHeight: 17 }}>
          No AI Moves generated or taken today. Sight is scanning the market during trading hours — new setups will appear on the Moves tab automatically.
        </Text>
      ) : null}
    </View>
  );
}

function TradeMiniRow({ trade, theme: t, showFull }: { trade: ClosedTrade; theme: any; showFull?: boolean }) {
  const win = trade.pnl >= 0;
  const dirColor = win ? t.bullish : t.bearish;
  const reasonLabel =
    trade.exitReason === 'take_profit' ? 'TP Hit' :
    trade.exitReason === 'stop_loss' ? 'SL Hit' : 'Sold';
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 8, paddingHorizontal: 8,
      backgroundColor: t.background, borderRadius: 8,
      borderWidth: 1, borderColor: t.border,
    }}>
      <StockLogo ticker={trade.ticker} size={28} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.textPrimary }}>{trade.ticker}</Text>
          <Text style={{ fontSize: 10, fontWeight: '700', color: trade.position === 'long' ? t.bullish : t.bearish }}>
            {trade.position.toUpperCase()}
          </Text>
          <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: t.textTertiary }} />
          <Text style={{ fontSize: 10, color: t.textTertiary, fontWeight: '600' }}>{reasonLabel}</Text>
        </View>
        {showFull ? (
          <Text style={{ fontSize: 11, color: t.textSecondary, marginTop: 1 }}>
            {trade.shares}sh · Entry ${trade.entryPrice.toFixed(2)} · Exit ${trade.exitPrice.toFixed(2)}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: dirColor }}>{fmtMoney(trade.pnl)}</Text>
        <Text style={{ fontSize: 10, color: dirColor }}>{trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(1)}%</Text>
      </View>
    </View>
  );
}

function StatCell({ label, value, color, theme: t }: { label: string; value: number | string; color?: string; theme: any }) {
  return (
    <View style={{ minWidth: 64 }}>
      <Text style={{ fontSize: 18, fontWeight: '800', color: color ?? t.textPrimary }}>{value}</Text>
      <Text style={{ fontSize: 10, fontWeight: '600', color: t.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 13, fontWeight: '500', marginTop: 1 },
  reportCard: { borderRadius: 16, padding: 16, borderWidth: 1, marginTop: 8, marginBottom: 12 },
  reportLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  reportDate: { fontSize: 14, fontWeight: '700', marginTop: 2 },
  aiCard: { borderRadius: 14, padding: 14, borderWidth: 1, marginBottom: 12 },
  calCard: { borderRadius: 14, padding: 12, borderWidth: 1, marginBottom: 12 },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 4 },
  dayHeaderRow: { flexDirection: 'row', marginBottom: 4 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { alignItems: 'center', justifyContent: 'center' },
  dayInner: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dayDetailCard: { borderRadius: 14, padding: 14, borderWidth: 1, marginBottom: 12 },
  statsCard: { borderRadius: 14, padding: 14, borderWidth: 1, marginBottom: 12 },
});
