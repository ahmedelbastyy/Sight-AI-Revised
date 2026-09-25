import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApp } from '../../contexts/AppContext';
import { MiniChart, useDayChartData } from './MiniChart';
import { StockLogo } from './StockLogo';
import { getStockLogoUrl, getAlternateLogoUrl } from '../../services/logoService';
import { config } from '../../constants/config';

interface StockCardProps {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  chartData: number[];
  isSubscribed: boolean;
}

export const StockCard = React.memo(StockCardInner, (prev, next) => {
  return (
    prev.ticker === next.ticker &&
    prev.price === next.price &&
    prev.change === next.change &&
    prev.changePercent === next.changePercent &&
    prev.signal === next.signal &&
    prev.confidence === next.confidence &&
    prev.isSubscribed === next.isSubscribed &&
    prev.chartData === next.chartData
  );
});

function StockCardInner({ ticker, name, price, change, changePercent, signal, confidence, chartData, isSubscribed }: StockCardProps) {
  const router = useRouter();
  const { currentTheme: t } = useApp();
  const isPositive = change >= 0;
  const dayChart = useDayChartData(ticker);
  const displayChart = dayChart.length > 2 ? dayChart : chartData;

  // Session 153 — proactively prefetch this ticker's logo(s) as soon as
  // the card mounts so the image is decoded and in memory-disk cache
  // before the user can even see it appear. Combined with StockLogo's
  // priority='high' + cachePolicy='memory-disk' + transition={0} the
  // logos now pop in instantly on the list.
  useEffect(() => {
    if (!ticker) return;
    const urls = [getStockLogoUrl(ticker), getAlternateLogoUrl(ticker)].filter(Boolean);
    Image.prefetch(urls).catch(() => {});
  }, [ticker]);

  return (
    <Pressable
      style={({ pressed }) => [styles.container, { backgroundColor: t.surface, borderColor: t.border }, pressed && { opacity: 0.85, backgroundColor: t.surfaceElevated }]}
      onPress={() => { Haptics.selectionAsync(); router.push(`/stock/${ticker}`); }}
    >
      <View style={styles.logoSection}>
        {/* Session 175 — bumped from 40 to 46 so watchlist / stock list
            rows show the brand mark at a proper size. Combined with the
            new 90% inner ratio in StockLogo, the logo now fills the
            visual space cleanly without dominating the row. */}
        <StockLogo ticker={ticker} size={46} />
      </View>
      <View style={styles.leftSection}>
        <View style={styles.tickerRow}>
          <Text style={[styles.ticker, { color: t.textPrimary }]}>{ticker}</Text>
        </View>
        <Text style={[styles.name, { color: t.textSecondary }]} numberOfLines={1}>{name}</Text>
      </View>
      <View style={styles.chartSection}>
        <MiniChart data={displayChart} width={60} height={28} />
      </View>
      <View style={styles.rightSection}>
        <Text style={[styles.price, { color: t.textPrimary }]}>${price.toFixed(2)}</Text>
        <View style={[styles.changeBadge, { backgroundColor: isPositive ? t.bullishBg : t.bearishBg }]}>
          <MaterialIcons name={isPositive ? 'arrow-drop-up' : 'arrow-drop-down'} size={16} color={isPositive ? t.bullish : t.bearish} />
          <Text style={{ fontSize: 12, fontWeight: '600', color: isPositive ? t.bullish : t.bearish }}>
            {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1 },
  logoSection: { marginRight: 10 },
  leftSection: { flex: 1, marginRight: 6 },
  tickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticker: { fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  signalBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  signalText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  name: { fontSize: 12, marginTop: 2, maxWidth: 110 },
  confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  confidence: { fontSize: 11, fontWeight: '500' },
  chartSection: { marginHorizontal: 4 },
  rightSection: { alignItems: 'flex-end', minWidth: 82 },
  price: { fontSize: 16, fontWeight: '700' },
  changeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6, marginTop: 4 },
});
