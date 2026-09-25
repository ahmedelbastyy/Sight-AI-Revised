import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useApp } from '../../contexts/AppContext';
import { config } from '../../constants/config';

interface RecommendationBadgeProps {
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  size?: 'small' | 'large';
}

export function RecommendationBadge({ signal, confidence, size = 'small' }: RecommendationBadgeProps) {
  const { currentTheme: t } = useApp();
  const signalConfig = config.signalTypes[signal];
  const isLarge = size === 'large';
  const iconName = signal === 'BUY' ? 'trending-up' : signal === 'SELL' ? 'trending-down' : 'trending-flat';

  return (
    <View style={[styles.container, { backgroundColor: t.surface, borderColor: signalConfig.color + '40' }, isLarge && styles.containerLarge]}>
      <View style={[styles.iconCircle, { backgroundColor: signalConfig.color + '20' }]}>
        <MaterialIcons name={iconName} size={isLarge ? 28 : 18} color={signalConfig.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.signalLabel, { color: signalConfig.color }, isLarge && { fontSize: 24 }]}>{signalConfig.label}</Text>
        <Text style={[styles.confidence, { color: t.textSecondary }, isLarge && { fontSize: 14 }]}>{confidence}% confidence</Text>
      </View>
    </View>
  );
}

interface SentimentIndicatorProps {
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

export function SentimentIndicator({ sentiment }: SentimentIndicatorProps) {
  const sentimentConfig = config.sentimentTypes[sentiment];

  return (
    <View style={[styles.sentimentContainer, { backgroundColor: sentimentConfig.color + '15' }]}>
      <MaterialIcons name={sentimentConfig.icon as any} size={14} color={sentimentConfig.color} />
      <Text style={[styles.sentimentText, { color: sentimentConfig.color }]}>{sentimentConfig.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12, borderWidth: 1, gap: 12 },
  containerLarge: { padding: 16, borderRadius: 16 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  signalLabel: { fontSize: 16, fontWeight: '700' },
  confidence: { fontSize: 12, marginTop: 2 },
  sentimentContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, gap: 4 },
  sentimentText: { fontSize: 12, fontWeight: '600' },
});
