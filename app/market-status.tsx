import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useApp } from '../contexts/AppContext';

type MarketSession = 'PRE_MARKET' | 'OPEN' | 'AFTER_HOURS' | 'CLOSED';

function getMarketStatus(): { session: MarketSession; label: string; nextOpen: Date | null } {
  const now = new Date();
  const nyOffset = -4;
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const nyHours = ((utcHours + nyOffset) % 24 + 24) % 24;
  const day = now.getUTCDay();
  const isWeekday = day >= 1 && day <= 5;

  if (!isWeekday) {
    const daysUntilMonday = day === 0 ? 1 : 8 - day;
    const nextMon = new Date(now);
    nextMon.setUTCDate(nextMon.getUTCDate() + daysUntilMonday);
    nextMon.setUTCHours(9 - nyOffset, 30, 0, 0);
    return { session: 'CLOSED', label: 'Market Closed - Weekend', nextOpen: nextMon };
  }

  const totalMinutes = nyHours * 60 + utcMinutes;
  if (totalMinutes >= 4 * 60 && totalMinutes < 9 * 60 + 30) {
    const nextOpenDate = new Date(now);
    nextOpenDate.setUTCHours(9 - nyOffset, 30, 0, 0);
    return { session: 'PRE_MARKET', label: 'Pre-Market Trading', nextOpen: nextOpenDate };
  }
  if (totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60) {
    // Market is open - skip this screen entirely, go straight through
    return { session: 'OPEN', label: 'Market Open', nextOpen: null };
  }
  if (totalMinutes >= 16 * 60 && totalMinutes < 20 * 60) {
    const nextOpenDate = new Date(now);
    const addDays = day === 5 ? 3 : 1;
    nextOpenDate.setUTCDate(nextOpenDate.getUTCDate() + addDays);
    nextOpenDate.setUTCHours(9 - nyOffset, 30, 0, 0);
    return { session: 'AFTER_HOURS', label: 'After-Hours Trading', nextOpen: nextOpenDate };
  }

  const nextOpenDate = new Date(now);
  if (totalMinutes >= 20 * 60) {
    const addDays = day === 5 ? 3 : 1;
    nextOpenDate.setUTCDate(nextOpenDate.getUTCDate() + addDays);
  }
  nextOpenDate.setUTCHours(9 - nyOffset, 30, 0, 0);
  return { session: 'CLOSED', label: 'Market Closed', nextOpen: nextOpenDate };
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function MarketStatusScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currentTheme: t, markSubPromptSeen } = useApp();
  const [status, setStatus] = useState(getMarketStatus);
  const [countdown, setCountdown] = useState('');
  const [dims, setDims] = useState(Dimensions.get('window'));

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setDims(window));
    return () => sub?.remove();
  }, []);

  // This screen is a fallback - primary flow goes through home tab banner
  useEffect(() => {
    markSubPromptSeen();
    router.replace('/(tabs)');
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const newStatus = getMarketStatus();
      setStatus(newStatus);
      if (newStatus.nextOpen) {
        setCountdown(formatCountdown(newStatus.nextOpen.getTime() - Date.now()));
      } else {
        setCountdown('');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Removed auto-subscription push - users navigate to subscription page manually

  const handleProceed = () => {
    Haptics.selectionAsync();
    markSubPromptSeen();
    router.replace('/(tabs)');
  };

  const sessionIcon = status.session === 'PRE_MARKET' ? 'wb-twilight'
    : status.session === 'AFTER_HOURS' ? 'nightlight-round'
    : 'schedule';

  const statusColor = status.session === 'PRE_MARKET' ? t.neutral
    : status.session === 'AFTER_HOURS' ? t.primaryLight : t.textTertiary;

  const isSmall = dims.width < 375;
  const hasTimer = status.nextOpen && countdown;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.container, { backgroundColor: t.background }]}>
      <View style={styles.content}>
        <Animated.View entering={FadeIn.duration(600)} style={styles.imageContainer}>
          <View style={[styles.statusIconCircle, { backgroundColor: statusColor + '15' }]}>
            <MaterialIcons name={sessionIcon as any} size={isSmall ? 52 : 64} color={statusColor} />
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(500).delay(200)} style={styles.statusSection}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <MaterialIcons name={sessionIcon as any} size={18} color={statusColor} />
            <Text style={[styles.statusLabel, { color: statusColor }]}>{status.label}</Text>
          </View>

          <Text style={[styles.closedMessage, { color: t.textSecondary }]}>
            {status.session === 'CLOSED'
              ? 'The US stock market is currently closed.\nPrices shown reflect the last trading session.'
              : status.session === 'PRE_MARKET'
              ? 'Pre-market trading is active.\nLimited volume - prices may vary at market open.'
              : 'After-hours trading is active.\nExtended hours can show higher volatility.'}
          </Text>
        </Animated.View>

        {hasTimer ? (
          <Animated.View entering={FadeInDown.duration(500).delay(400)} style={styles.countdownSection}>
            <Text style={[styles.countdownLabel, { color: t.textTertiary }]}>MARKET OPENS IN</Text>
            <View style={styles.countdownRow}>
              {countdown.split(':').map((unit, i) => (
                <React.Fragment key={i}>
                  {i > 0 ? <Text style={[styles.countdownSep, { color: t.textTertiary }]}>:</Text> : null}
                  <View style={[styles.countdownBlock, { backgroundColor: t.surface, borderColor: t.border, minWidth: isSmall ? 60 : 72 }]}>
                    <Text style={[styles.countdownValue, { color: t.textPrimary, fontSize: isSmall ? 26 : 32 }]}>{unit}</Text>
                    <Text style={[styles.countdownUnit, { color: t.textTertiary }]}>
                      {i === 0 ? 'hrs' : i === 1 ? 'min' : 'sec'}
                    </Text>
                  </View>
                </React.Fragment>
              ))}
            </View>
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeInDown.duration(500).delay(600)} style={[styles.ctaSection, { paddingBottom: insets.bottom + 16, marginTop: 'auto' }]}>
          <TouchableOpacity activeOpacity={0.7} style={[styles.proceedBtn, { backgroundColor: t.primary }]}
            onPress={handleProceed}>
            <Text style={styles.proceedText}>Proceed</Text>
            <MaterialIcons name="arrow-forward" size={18} color="#FFF" />
          </TouchableOpacity>
          <Text style={[styles.noteText, { color: t.textTertiary }]}>
            Data from last session is still available for analysis
          </Text>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24 },
  imageContainer: { alignItems: 'center', marginTop: 32 },
  statusIconCircle: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center' },
  statusSection: { alignItems: 'center', marginTop: 24 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 9999, marginBottom: 16 },
  statusLabel: { fontSize: 16, fontWeight: '700' },
  closedMessage: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  countdownSection: { alignItems: 'center', marginTop: 36 },
  countdownLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 1, marginBottom: 12 },
  countdownRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countdownBlock: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', borderWidth: 1 },
  countdownValue: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  countdownUnit: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  countdownSep: { fontSize: 28, fontWeight: '700' },
  ctaSection: { paddingTop: 20 },
  proceedBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 52, borderRadius: 12, gap: 8 },
  proceedText: { fontSize: 17, fontWeight: '700', color: '#FFF' },
  noteText: { fontSize: 12, textAlign: 'center', marginTop: 12 },
});
