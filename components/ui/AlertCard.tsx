import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useApp } from '../../contexts/AppContext';
import { config } from '../../constants/config';
import { AIAlert } from '../../services/stockService';

interface AlertCardProps {
  alert: AIAlert;
  onPress?: () => void;
}

const typeConfig: Record<string, { icon: string; color: string }> = {
  BREAKOUT: { icon: 'flash-on', color: '#F59E0B' },
  BUY_SIGNAL: { icon: 'trending-up', color: '#10B981' },
  SELL_SIGNAL: { icon: 'trending-down', color: '#EF4444' },
  SUPPORT: { icon: 'horizontal-rule', color: '#3B82F6' },
  RESISTANCE: { icon: 'vertical-align-top', color: '#8B5CF6' },
  TREND_REVERSAL: { icon: 'swap-vert', color: '#EC4899' },
};

const priorityConfig: Record<string, { label: string; color: string }> = {
  HIGH: { label: 'HIGH', color: '#EF4444' },
  MEDIUM: { label: 'MED', color: '#F59E0B' },
  LOW: { label: 'LOW', color: '#6B7280' },
};

import { Pressable } from 'react-native';

export function AlertCard({ alert, onPress }: AlertCardProps) {
  const { currentTheme: t } = useApp();
  const tConfig = typeConfig[alert.type] || typeConfig.BREAKOUT;
  const pConfig = priorityConfig[alert.priority];

  return (
    <Pressable
      style={({ pressed }) => [styles.container, { backgroundColor: t.surface, borderColor: t.border }, pressed && { opacity: 0.85, backgroundColor: t.surfaceElevated }]}
      onPress={onPress}
    >
      <View style={styles.header}>
        <View style={[styles.iconCircle, { backgroundColor: tConfig.color + '20' }]}>
          <MaterialIcons name={tConfig.icon as any} size={20} color={tConfig.color} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.tickerRow}>
            <Text style={[styles.ticker, { color: t.textPrimary }]}>{alert.ticker}</Text>
            <View style={[styles.priorityBadge, { backgroundColor: pConfig.color + '20' }]}>
              <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: pConfig.color }}>{pConfig.label}</Text>
            </View>
          </View>
          <Text style={{ fontSize: 13, color: t.textSecondary, marginTop: 1 }} numberOfLines={1}>{alert.title}</Text>
        </View>
        <Text style={{ fontSize: 11, color: t.textTertiary }}>{alert.time}</Text>
      </View>
      <Text style={{ fontSize: 13, color: t.textSecondary, lineHeight: 18, marginBottom: 10 }} numberOfLines={2}>{alert.description}</Text>
      <View style={styles.footer}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, height: 4, backgroundColor: t.border, borderRadius: 2, overflow: 'hidden' }}>
            <View style={{ height: 4, borderRadius: 2, width: `${alert.confidence}%`, backgroundColor: tConfig.color }} />
          </View>
          <Text style={{ fontSize: 11, fontWeight: '600', color: t.textSecondary, minWidth: 30 }}>{alert.confidence}%</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ticker: { fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  priorityBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  footer: { flexDirection: 'row', alignItems: 'center' },
});
