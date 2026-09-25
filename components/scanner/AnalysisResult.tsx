/**
 * AnalysisResultView (Session 119) — Chart Scan is now EDUCATIONAL.
 *
 * Displays structured chart analysis (trend, structure, patterns, key levels,
 * momentum, bullish/bearish factors, broader context). It does NOT recommend
 * a BUY or SHORT — that's the job of the AI Moves system.
 *
 * A "Log Trade" button is still provided so users can log a trade they decide
 * to take. The button opens a manual entry modal where the user provides
 * direction, shares, entry, TP, and SL themselves. Chart Scan does NOT
 * pre-fill TP/SL because Chart Scan does not decide direction or targets.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { scannerStyles as baseStyles } from './scannerStyles';
import { useApp } from '../../contexts/AppContext';
import { validateTrade } from '../../services/tradeService';
import { useAlert } from '@/template';
import { useBrokerConnection } from '../../hooks/useBrokerConnection';

export function AnalysisResultView({
  capturedUri, analyzing, result, onReset, theme: t, insets,
}: {
  capturedUri: string | null;
  analyzing: boolean;
  result: any;
  onReset: () => void;
  theme: any;
  insets: any;
}) {
  const { addTradeWithTPSL } = useApp();
  const { showAlert } = useAlert();
  const router = useRouter();
  const { hasActiveConnection: brokerConnected } = useBrokerConnection();
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [shares, setShares] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [tp, setTP] = useState('');
  const [sl, setSL] = useState('');

  const ticker = result?.ticker ?? 'Unknown';

  // Session 170 — Chart-scan review-request logic is now centralized in
  // components/scanner/ScannerContent.tsx (maybeRequestChartScanReview),
  // which increments a persisted counter ONLY after a successful capture
  // and asks StoreReview at every-other successful scan. The duplicate
  // useEffect that used to live here fired again on every result render,
  // causing double-prompt attempts per scan. It has been removed so one
  // scan can never trigger two review requests.

  // Session 176 — Chart Scan Trade CTA is CLEAN. The scanner passes ONLY
  // ticker + source: 'chart_scan'. It does NOT prefill Buy/Sell/Short,
  // entry price, limit price, TP, SL, shares, or order type. Chart
  // analysis is educational — it observes what's visible in the chart
  // image but does not decide direction or targets. When the trading
  // page opens from Chart Scan, the user chooses every field themselves
  // (Market is the default per Session 176).
  const openPutInTrade = () => {
    Haptics.selectionAsync();
    if (!ticker || ticker === 'Unknown') {
      showAlert('Ticker Missing', 'Could not identify the ticker from this chart. Please open Trade from the Home tab.');
      return;
    }
    if (!brokerConnected) {
      router.push('/connect-brokerage?autoOpen=1' as any);
      return;
    }
    router.push({
      pathname: '/put-in-trade',
      params: {
        ticker,
        source: 'chart_scan',
        // NOTE: intentionally NO action, entry, takeProfit, stopLoss,
        // shares, or orderType — Chart Scan does not decide these.
      },
    } as any);
  };

  const openLogTrade = () => {
    setDirection('long');
    setShares('');
    setEntryPrice('');
    setTP('');
    setSL('');
    setLogModalVisible(true);
    Haptics.selectionAsync();
  };

  const handleConfirmLog = () => {
    if (!ticker || ticker === 'Unknown') {
      showAlert('Ticker Missing', 'Could not identify the ticker from this chart. Please log this trade from the Home tab.');
      return;
    }
    const sh = parseFloat(shares);
    const ep = parseFloat(entryPrice);
    const tpN = parseFloat(tp);
    const slN = parseFloat(sl);
    if (!Number.isFinite(sh) || sh <= 0) { showAlert('Missing Info', 'Enter number of shares.'); return; }
    if (!Number.isFinite(ep) || ep <= 0) { showAlert('Missing Info', 'Enter your actual entry price.'); return; }
    if (!Number.isFinite(tpN) || tpN <= 0) { showAlert('Missing Info', 'Enter your Take Profit.'); return; }
    if (!Number.isFinite(slN) || slN <= 0) { showAlert('Missing Info', 'Enter your Stop Loss.'); return; }
    const err = validateTrade(direction, ep, tpN, slN);
    if (err) { showAlert('Invalid Trade', err); return; }
    addTradeWithTPSL({
      ticker, shares: sh, entryPrice: ep,
      position: direction, takeProfit: tpN, stopLoss: slN,
      tradeType: 'Chart Scan',
      source: 'chart_scan',
      aiContext: {
        source: 'chart_scan',
        reasoning: result?.summary ?? '',
        direction: direction === 'long' ? 'buy' : 'short',
        timestamp: new Date().toISOString(),
      },
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setLogModalVisible(false);
    showAlert('Trade Logged', `${ticker} is now an Active Trade in your Portfolio. Sight will monitor for TP/SL.`);
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.background }}>
      <View style={baseStyles.resultHeader}>
        <View>
          <Text style={[baseStyles.resultTitle, { color: t.textPrimary }]}>Chart Analysis</Text>
          <Text style={[baseStyles.resultSubtitle, { color: t.textSecondary }]}>
            {analyzing ? 'AI is analyzing...' : result?.isChart ? 'Educational breakdown' : 'Scan again'}
          </Text>
        </View>
        <Pressable
          style={[baseStyles.resetBtn, { backgroundColor: t.surface, borderColor: t.border }]}
          onPress={onReset} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="photo-camera" size={20} color={t.primary} />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {capturedUri ? (
          <View style={[baseStyles.chartPreview, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Image source={{ uri: capturedUri }} style={{ width: '100%', height: 240 }} contentFit="contain" transition={200} />
          </View>
        ) : null}

        {analyzing ? (
          <View style={{ alignItems: 'center', paddingVertical: 40, gap: 12 }}>
            <ActivityIndicator size="large" color={t.primary} />
            <Text style={{ fontSize: 16, fontWeight: '600', color: t.textPrimary }}>Analyzing chart...</Text>
            <Text style={{ fontSize: 13, color: t.textSecondary }}>Identifying trend, structure, and patterns</Text>
          </View>
        ) : result ? (
          <>
            {!result.isChart ? (
              <View style={[baseStyles.errorCard, { backgroundColor: t.bearishBg, borderColor: t.bearish + '40' }]}>
                <MaterialIcons name="error-outline" size={32} color={t.bearish} />
                <Text style={{ fontSize: 16, fontWeight: '700', color: t.bearish, marginTop: 8 }}>Chart Not Recognized</Text>
                <Text style={{ fontSize: 14, color: t.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>
                  {result.error ?? 'Please scan a stock or financial chart.'}
                </Text>
                <Pressable style={[baseStyles.newAnalysisBtn, { backgroundColor: t.surface, borderColor: t.primary }]} onPress={onReset}>
                  <MaterialIcons name="camera-alt" size={18} color={t.primary} />
                  <Text style={{ fontSize: 14, fontWeight: '600', color: t.primary }}>Try Again</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {result.ticker && result.ticker !== 'Unknown' ? (
                  <View style={[baseStyles.tickerBanner, { backgroundColor: t.primary + '15', borderColor: t.primary + '30' }]}>
                    <MaterialIcons name="verified" size={18} color={t.primary} />
                    <Text style={{ fontSize: 15, fontWeight: '700', color: t.primary }}>Identified: {result.ticker}</Text>
                    {result.timeframe ? (
                      <Text style={{ fontSize: 11, color: t.textSecondary, marginLeft: 6 }}>· {result.timeframe}</Text>
                    ) : null}
                  </View>
                ) : null}

                {/* Structure & summary */}
                {result.summary ? (
                  <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <MaterialIcons name="analytics" size={18} color={t.primary} />
                      <Text style={styles.sectionTitle}>Chart Overview</Text>
                      {result.structure ? (
                        <View style={[styles.pill, { backgroundColor: t.primary + '20' }]}>
                          <Text style={[styles.pillText, { color: t.primary }]}>{result.structure}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={{ fontSize: 14, color: t.textSecondary, lineHeight: 20 }}>{result.summary}</Text>
                  </View>
                ) : null}

                {/* Trend & Structure */}
                {result.trendNotes ? (
                  <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <MaterialIcons name="timeline" size={18} color={t.primary} />
                      <Text style={styles.sectionTitle}>Trend & Structure</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: t.textSecondary, lineHeight: 19 }}>{result.trendNotes}</Text>
                  </View>
                ) : null}

                {/* Key levels */}
                {Array.isArray(result.keyLevels) && result.keyLevels.length > 0 ? (
                  <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <MaterialIcons name="horizontal-rule" size={18} color={t.primary} />
                      <Text style={styles.sectionTitle}>Key Levels</Text>
                    </View>
                    {result.keyLevels.map((lvl: any, i: number) => {
                      const isRes = String(lvl.label).toLowerCase().includes('resist');
                      const color = isRes ? t.bearish : t.bullish;
                      return (
                        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: i < result.keyLevels.length - 1 ? 1 : 0, borderBottomColor: t.border }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
                          <Text style={{ flex: 1, fontSize: 13, color: t.textPrimary, fontWeight: '600' }}>{lvl.label}</Text>
                          <Text style={{ fontSize: 14, fontWeight: '800', color }}>${Number(lvl.price).toFixed(2)}</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : null}

                {/* Patterns */}
                {Array.isArray(result.patterns) && result.patterns.length > 0 ? (
                  <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <MaterialIcons name="pattern" size={18} color={t.primary} />
                      <Text style={styles.sectionTitle}>Patterns Visible</Text>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {result.patterns.map((p: string, i: number) => (
                        <View key={i} style={[styles.pill, { backgroundColor: t.background, borderWidth: 1, borderColor: t.border }]}>
                          <Text style={{ fontSize: 12, fontWeight: '600', color: t.textPrimary }}>{p}</Text>
                        </View>
                      ))}
                    </View>
                    {result.candlestickNotes ? (
                      <Text style={{ fontSize: 12, color: t.textSecondary, lineHeight: 17, marginTop: 10 }}>{result.candlestickNotes}</Text>
                    ) : null}
                  </View>
                ) : null}

                {/* Momentum */}
                {result.momentumNotes ? (
                  <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <MaterialIcons name="speed" size={18} color={t.primary} />
                      <Text style={styles.sectionTitle}>Momentum & Volume</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: t.textSecondary, lineHeight: 19 }}>{result.momentumNotes}</Text>
                  </View>
                ) : null}

                {/* What bullish/bearish traders watch */}
                {(Array.isArray(result.bullishFactors) && result.bullishFactors.length > 0) ||
                 (Array.isArray(result.bearishFactors) && result.bearishFactors.length > 0) ? (
                  <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <MaterialIcons name="visibility" size={18} color={t.primary} />
                      <Text style={styles.sectionTitle}>What Traders Are Watching</Text>
                    </View>
                    {result.bullishFactors?.map((f: string, i: number) => (
                      <View key={`b-${i}`} style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                        <MaterialIcons name="north-east" size={14} color={t.bullish} style={{ marginTop: 3 }} />
                        <Text style={{ flex: 1, fontSize: 12, color: t.textSecondary, lineHeight: 17 }}>{f}</Text>
                      </View>
                    ))}
                    {result.bearishFactors?.map((f: string, i: number) => (
                      <View key={`s-${i}`} style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                        <MaterialIcons name="south-east" size={14} color={t.bearish} style={{ marginTop: 3 }} />
                        <Text style={{ flex: 1, fontSize: 12, color: t.textSecondary, lineHeight: 17 }}>{f}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* Broader context */}
                {result.context ? (
                  <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <MaterialIcons name="public" size={18} color={t.primary} />
                      <Text style={styles.sectionTitle}>Broader Context</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: t.textSecondary, lineHeight: 19 }}>{result.context}</Text>
                  </View>
                ) : null}

                {/* Educational reminder */}
                <View style={[styles.card, { backgroundColor: t.primary + '10', borderColor: t.primary + '30' }]}>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                    <MaterialIcons name="school" size={16} color={t.primary} style={{ marginTop: 2 }} />
                    <Text style={{ flex: 1, fontSize: 12, color: t.textSecondary, lineHeight: 17 }}>
                      {result.educationalNote ?? 'This is educational analysis of what the chart is showing — not a trade recommendation. For actionable BUY/SHORT setups, see the Moves tab.'}
                    </Text>
                  </View>
                </View>

                {/* Session 147 — Put in Trade routes through the same real-broker
                    flow as Home / Moves. Ticker is passed; TP / SL are NOT
                    prefilled because Chart Scan doesn't decide direction. */}
                <Pressable style={[styles.logBtn, { backgroundColor: t.primary }]} onPress={openPutInTrade}>
                  <MaterialIcons name="flash-on" size={20} color="#FFF" />
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFF' }}>Trade</Text>
                </Pressable>

                <Pressable style={[baseStyles.newAnalysisBtn, { backgroundColor: t.surface, borderColor: t.border, marginTop: 10 }]} onPress={onReset}>
                  <MaterialIcons name="camera-alt" size={20} color={t.primary} />
                  <Text style={{ fontSize: 15, fontWeight: '700', color: t.primary }}>Scan Another Chart</Text>
                </Pressable>
              </>
            )}
          </>
        ) : null}
      </ScrollView>

      {/* Log Trade Modal — user provides direction + all levels themselves */}
      <Modal visible={logModalVisible} transparent animationType="fade" onRequestClose={() => setLogModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setLogModalVisible(false)} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, justifyContent: 'center', flexGrow: 1 }}>
            <View style={[styles.modalCard, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: t.textPrimary, marginBottom: 4 }}>Log {ticker !== 'Unknown' ? ticker : 'Trade'}</Text>
              <Text style={{ fontSize: 12, color: t.textSecondary, marginBottom: 14 }}>
                You decide the trade — Sight will monitor and track it.
              </Text>

              <Text style={styles.fieldLabel}>DIRECTION</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                <Pressable
                  style={[styles.dirBtn, { borderColor: t.border, backgroundColor: t.background }, direction === 'long' && { borderColor: t.bullish, backgroundColor: t.bullishBg }]}
                  onPress={() => { setDirection('long'); Haptics.selectionAsync(); }}>
                  <MaterialIcons name="trending-up" size={16} color={direction === 'long' ? t.bullish : t.textTertiary} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: direction === 'long' ? t.bullish : t.textSecondary }}>Long</Text>
                </Pressable>
                <Pressable
                  style={[styles.dirBtn, { borderColor: t.border, backgroundColor: t.background }, direction === 'short' && { borderColor: t.bearish, backgroundColor: t.bearishBg }]}
                  onPress={() => { setDirection('short'); Haptics.selectionAsync(); }}>
                  <MaterialIcons name="trending-down" size={16} color={direction === 'short' ? t.bearish : t.textTertiary} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: direction === 'short' ? t.bearish : t.textSecondary }}>Short</Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>SHARES *</Text>
              <TextInput style={[styles.input, { backgroundColor: t.background, borderColor: t.border, color: t.textPrimary }]}
                placeholder="e.g. 100" placeholderTextColor={t.textTertiary}
                keyboardType="numeric" value={shares} onChangeText={setShares} />

              <Text style={styles.fieldLabel}>ENTRY PRICE *</Text>
              <TextInput style={[styles.input, { backgroundColor: t.background, borderColor: t.border, color: t.textPrimary }]}
                placeholder="Your actual entry" placeholderTextColor={t.textTertiary}
                keyboardType="decimal-pad" value={entryPrice} onChangeText={setEntryPrice} />

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: t.bullish }]}>TAKE PROFIT *</Text>
                  <TextInput style={[styles.input, { backgroundColor: t.background, borderColor: t.bullish + '40', color: t.textPrimary }]}
                    placeholder={direction === 'long' ? 'Above entry' : 'Below entry'} placeholderTextColor={t.textTertiary}
                    keyboardType="decimal-pad" value={tp} onChangeText={setTP} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: t.bearish }]}>STOP LOSS *</Text>
                  <TextInput style={[styles.input, { backgroundColor: t.background, borderColor: t.bearish + '40', color: t.textPrimary }]}
                    placeholder={direction === 'long' ? 'Below entry' : 'Above entry'} placeholderTextColor={t.textTertiary}
                    keyboardType="decimal-pad" value={sl} onChangeText={setSL} />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Pressable style={[styles.cancelBtn, { borderColor: t.border }]} onPress={() => setLogModalVisible(false)}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: t.textSecondary }}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.confirmBtn, { backgroundColor: t.primary }]} onPress={handleConfirmLog}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFF' }}>Log Trade</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#F3F4F6' },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  pillText: { fontSize: 11, fontWeight: '700' },
  logBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, height: 52, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },
  modalCard: { borderRadius: 16, borderWidth: 1, padding: 18, maxWidth: 420, width: '100%', alignSelf: 'center' },
  dirBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 10, borderWidth: 1.5 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.5, marginBottom: 4, marginTop: 2 },
  input: { height: 44, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 14, fontWeight: '600', marginBottom: 10 },
  cancelBtn: { flex: 1, height: 46, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  confirmBtn: { flex: 2, height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
