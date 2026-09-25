import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApp } from '../../contexts/AppContext';
import { config } from '../../constants/config';
import type { NewsItem } from '../../services/stockService';
import { SentimentIndicator } from './RecommendationBadge';
import * as Haptics from 'expo-haptics';

interface NewsCardProps {
  item: NewsItem;
  onPress?: () => void;
}

export function NewsCard({ item, onPress }: NewsCardProps) {
  const { currentTheme: t } = useApp();
  const router = useRouter();

  const handlePress = () => {
    Haptics.selectionAsync();
    if (onPress) {
      onPress();
    } else if (item.url) {
      router.push({ pathname: '/news-webview', params: { url: item.url, title: item.title } });
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.container, { backgroundColor: t.surface, borderColor: t.border }, pressed && { opacity: 0.85, backgroundColor: t.surfaceElevated }]}
      onPress={handlePress}
    >
      <View style={styles.header}>
        <View style={styles.sourceRow}>
          <Text style={[styles.source, { color: t.primaryLight }]}>{item.source}</Text>
          <Text style={{ color: t.textTertiary, fontSize: 12 }}>·</Text>
          <Text style={{ fontSize: 11, color: t.textTertiary }}>{item.time}</Text>
        </View>
        <SentimentIndicator sentiment={item.sentiment} />
      </View>
      <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={2}>{item.title}</Text>
      <Text style={[styles.summary, { color: t.textSecondary }]} numberOfLines={2}>{item.summary}</Text>
      <View style={styles.footer}>
        <View style={styles.tickersRow}>
          {item.tickers.map(tk => (
            <View key={tk} style={[styles.tickerBadge, { backgroundColor: t.primaryDark + '30' }]}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: t.primaryLight }}>${tk}</Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <MaterialIcons name="open-in-new" size={12} color={t.primary} />
          <Text style={{ fontSize: 12, color: t.primary, fontWeight: '500' }}>Read</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  source: { fontSize: 12, fontWeight: '600' },
  title: { fontSize: 15, fontWeight: '600', lineHeight: 20, marginBottom: 6 },
  summary: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tickersRow: { flexDirection: 'row', gap: 6 },
  tickerBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
});
