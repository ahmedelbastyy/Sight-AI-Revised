import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Switch, Platform, AppState, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useRouter, useFocusEffect } from 'expo-router';
import { useApp } from '../contexts/AppContext';
import { useAlert } from '@/template';
import {
  NotificationPrefs, DEFAULT_PREFS,
  getNotificationPrefs, saveNotificationPrefs,
  requestNotificationPermissions, scheduleDailySummary,
  cancelDailySummary, cancelAllNotifications,
  scheduleMarketOpenClose, cancelMarketOpenClose,
  scheduleAIMovesReminders, cancelAIMovesReminders,
} from '../services/notificationService';

// Session 214 — Price Movement notification category REMOVED per user
// request. The toggle row and the price alert threshold selector are no
// longer rendered. THRESHOLD_OPTIONS is intentionally left in the file
// as an empty array so any external reference cannot crash, but the
// selector UI has been dropped entirely.
const THRESHOLD_OPTIONS: number[] = [];

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { currentTheme: t, isSubscribed } = useApp();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);

  useEffect(() => {
    loadPrefs();
    checkPermissionAndReconcile();
  }, []);

  // Session 188 - Re-check iOS notification authorization every time the
  // page regains focus AND every time the app returns to foreground. If
  // the user revoked notifications externally (iOS Settings > Sight),
  // this catches the change immediately and forces the master toggle OFF
  // both locally and server-side so no future push is delivered.
  useFocusEffect(
    useCallback(() => {
      checkPermissionAndReconcile();
    }, []),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkPermissionAndReconcile();
    });
    return () => sub.remove();
  }, []);

  const loadPrefs = async () => {
    const saved = await getNotificationPrefs();
    setPrefs(saved);
  };

  const checkPermission = async () => {
    if (Platform.OS === 'web') { setPermissionGranted(false); return; }
    const { status } = await Notifications.getPermissionsAsync();
    setPermissionGranted(status === 'granted');
  };

  // Session 188 - Authoritative permission reconciliation. When iOS
  // authorization is not granted, ALL toggles must reflect OFF and the
  // server-side prefs must be updated so background workers never send
  // pushes to a device that has been revoked. Runs on mount, on focus,
  // and on app foreground.
  const checkPermissionAndReconcile = useCallback(async () => {
    if (Platform.OS === 'web') { setPermissionGranted(false); return; }
    let granted = false;
    try {
      const { status } = await Notifications.getPermissionsAsync();
      granted = status === 'granted';
    } catch { granted = false; }
    setPermissionGranted(granted);
    if (!granted) {
      // Force ALL local toggles OFF and mirror to backend so the
      // send-push-notification edge function drops any pending push.
      try {
        const current = await getNotificationPrefs();
        if (current.enabled) {
          const updated: NotificationPrefs = { ...current, enabled: false };
          setPrefs(updated);
          await saveNotificationPrefs(updated);
          await cancelAllNotifications().catch(() => {});
          // Session 189 — also purge Sight's local AI Moves reminders when
          // iOS revokes notification authorization. Without this the AI
          // Moves schedule set in AsyncStorage would still contain the
          // (now-dead) pending notification IDs, and re-enabling
          // notifications later would appear to keep the cancelled
          // schedule alive.
          await cancelAIMovesReminders().catch(() => {});
        }
      } catch { /* swallow */ }
    }
  }, []);

  const handleRequestPermission = async () => {
    Haptics.selectionAsync();
    const granted = await requestNotificationPermissions();
    setPermissionGranted(granted);
    if (!granted) {
      // Session 188 - Denied. Explain and route to iOS Settings so the
      // user can enable authorization at the OS level. Sight cannot
      // force iOS to re-prompt after a denial.
      showAlert(
        'Enable Notifications in Settings',
        'Notifications are disabled at the iOS level. Open Settings, then Notifications, then Sight and turn on Allow Notifications.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => { try { Linking.openURL('app-settings:'); } catch { /* swallow */ } } },
        ],
      );
    }
  };

  const updatePref = useCallback(async (key: keyof NotificationPrefs, value: any) => {
    Haptics.selectionAsync();
    // Session 188 - When enabling ANY category, require real iOS
    // permission first. Prevents the misleading state where the master
    // toggle or a category toggle is ON in-app but no push can ever
    // physically be delivered because iOS authorization was denied.
    if (typeof value === 'boolean' && value === true && Platform.OS !== 'web') {
      let statusGranted = permissionGranted === true;
      if (!statusGranted) {
        try {
          const { status } = await Notifications.getPermissionsAsync();
          statusGranted = status === 'granted';
        } catch { statusGranted = false; }
      }
      if (!statusGranted) {
        const granted = await requestNotificationPermissions();
        setPermissionGranted(granted);
        if (!granted) {
          showAlert(
            'Enable Notifications in Settings',
            'Notifications are disabled at the iOS level. Open Settings, then Notifications, then Sight and turn on Allow Notifications.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => { try { Linking.openURL('app-settings:'); } catch { /* swallow */ } } },
            ],
          );
          // Refuse to store this toggle as ON because there is no way
          // for the push to actually be delivered.
          return;
        }
      }
    }
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    await saveNotificationPrefs(updated);

    // Handle daily summary scheduling
    if (key === 'dailySummary') {
      if (value) await scheduleDailySummary();
      else await cancelDailySummary();
    }
    // Session 189 — Stock Market Open / Close is a single category. When
    // the user toggles it, schedule (or cancel) BOTH the open and the
    // close local notifications together so they stay in sync. The
    // close notification correctly picks the early-close time on early-
    // close days rather than a hardcoded 4pm.
    if (key === 'marketOpen') {
      if (value) await scheduleMarketOpenClose(14);
      else await cancelMarketOpenClose();
    }
    // Session 189 — AI Signal Alerts now schedules three generic AI Moves
    // reminders per U.S. trading day using local expo-notifications DATE
    // triggers (same mechanism as Daily Summary + Market Open). Per-signal
    // pushes are permanently disabled server-side. Turning the toggle off
    // cancels every pending AI Moves reminder locally.
    // Session 191 — rolling 10-trading-day window (30 pending slots max).
    if (key === 'aiSignals') {
      if (value) await scheduleAIMovesReminders(10);
      else await cancelAIMovesReminders();
    }
    if (key === 'enabled' && !value) {
      await cancelAllNotifications();
      await cancelAIMovesReminders();
    }
    if (key === 'enabled' && value) {
      // Rebuild every enabled category from scratch when master flips on.
      if (updated.dailySummary) await scheduleDailySummary();
      if (updated.marketOpen !== false) await scheduleMarketOpenClose(14);
      if (updated.aiSignals) await scheduleAIMovesReminders(10);
    }
  }, [prefs, permissionGranted, showAlert]);

  const proGated = !isSubscribed;

  // Session 170 \u2014 backfill: existing users on the old prefs schema may not
  // have `marketOpen` set. Default to enabled so market-open alerts fire
  // for everyone unless they explicitly opt out.
  const marketOpenValue = prefs.marketOpen !== false;

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: t.background }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Pressable style={[styles.backBtn, { backgroundColor: t.surface, borderColor: t.border }]}
          onPress={() => { Haptics.selectionAsync(); router.back(); }}>
          <MaterialIcons name="arrow-back" size={22} color={t.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.textPrimary }]}>Notifications</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="always" keyboardDismissMode="on-drag">
        {/* Permission Banner */}
        {permissionGranted === false ? (
          <Animated.View entering={FadeInDown.duration(400)}>
            <Pressable style={[styles.permissionBanner, { backgroundColor: t.warning + '18', borderColor: t.warning + '40' }]}
              onPress={handleRequestPermission}>
              <View style={[styles.permBannerIcon, { backgroundColor: t.warning + '20' }]}>
                <MaterialIcons name="notifications-off" size={24} color={t.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.permBannerTitle, { color: t.textPrimary }]}>Notifications Disabled</Text>
                <Text style={{ fontSize: 13, color: t.textSecondary, lineHeight: 18 }}>
                  Tap to enable notifications for AI signals, price movements, and market open alerts.
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={t.warning} />
            </Pressable>
          </Animated.View>
        ) : null}

        {/* Master Toggle */}
        <Animated.View entering={FadeInDown.duration(400).delay(50)}>
          <View style={[styles.masterToggle, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={[styles.masterIcon, { backgroundColor: t.primary + '15' }]}>
              <MaterialIcons name="notifications-active" size={24} color={t.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.masterLabel, { color: t.textPrimary }]}>Push Notifications</Text>
              <Text style={{ fontSize: 12, color: t.textSecondary }}>Receive alerts on your device</Text>
            </View>
            <Switch
              value={prefs.enabled}
              onValueChange={(v) => updatePref('enabled', v)}
              trackColor={{ false: t.border, true: t.primary + '60' }}
              thumbColor={prefs.enabled ? t.primary : t.textTertiary}
            />
          </View>
        </Animated.View>

        {/* Alert Types */}
        <Animated.View entering={FadeInDown.duration(400).delay(100)}>
          <Text style={[styles.sectionTitle, { color: t.textTertiary }]}>ALERT TYPES</Text>
          <View style={[styles.sectionCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            {/* Session 170 \u2014 Breakout Alerts REMOVED. Replaced with
                Stock Market Open notification which is toggleable. */}
            <ToggleRow
              icon="schedule"
              iconColor="#F59E0B"
              label="Stock Market Open / Close"
              description="Alerts when the US stock market opens and closes"
              value={marketOpenValue}
              onChange={(v) => updatePref('marketOpen', v)}
              disabled={!prefs.enabled}
              theme={t}
            />
            <View style={[styles.divider, { backgroundColor: t.border }]} />
            {/* Session 214 — Price Movements toggle REMOVED per user
                request. Watchlist price-change alerts are no longer a
                notification category in Sight. */}
            <ToggleRow
              icon="psychology"
              iconColor="#8B5CF6"
              label="AI Signal Alerts"
              description="Get notified when new AI trading opportunities are available"
              value={prefs.aiSignals}
              onChange={(v) => updatePref('aiSignals', v)}
              disabled={!prefs.enabled || proGated}
              theme={t}
              premium={proGated}
            />
            <View style={[styles.divider, { backgroundColor: t.border }]} />
            <ToggleRow
              icon="today"
              iconColor="#3B82F6"
              label="Daily Market Summary"
              description="Morning briefing at 8:30 AM"
              value={prefs.dailySummary}
              onChange={(v) => updatePref('dailySummary', v)}
              disabled={!prefs.enabled}
              theme={t}
            />
          </View>
        </Animated.View>

        {/* Session 214 — PRICE ALERT THRESHOLD section REMOVED per user
            request. The percent-move threshold selector was tied to the
            Price Movements toggle above (also removed), so both are
            gone as a unit. Notifications no longer include any watchlist
            price-change alerts at all. */}

        {/* Info */}
        <Animated.View entering={FadeInDown.duration(400).delay(300)}>
          <View style={[styles.infoCard, { backgroundColor: t.primary + '08', borderColor: t.primary + '20' }]}>
            <MaterialIcons name="info-outline" size={18} color={t.primary} />
            <Text style={{ flex: 1, fontSize: 13, color: t.textSecondary, lineHeight: 18 }}>
              AI Signal alerts fire at intervals throughout market hours. Turn on Stock Market Open / Close to be notified when the US market opens or closes each trading day, and Daily Market Summary for an 8:30 AM morning briefing.
            </Text>
          </View>
        </Animated.View>

        {proGated ? (
          <Animated.View entering={FadeInDown.duration(400).delay(350)}>
            <View style={[styles.proCard, { backgroundColor: 'rgba(255,215,0,0.08)', borderColor: 'rgba(255,215,0,0.25)' }]}>
              <MaterialIcons name="workspace-premium" size={20} color="#FFD700" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: t.textPrimary }}>Pro Alerts</Text>
                <Text style={{ fontSize: 12, color: t.textSecondary, marginTop: 2 }}>AI signal alerts require Pro subscription.</Text>
              </View>
              <Pressable
                style={[styles.proBtn, { backgroundColor: t.primary }]}
                onPress={() => { Haptics.selectionAsync(); router.push('/subscription'); }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFF' }}>Upgrade</Text>
              </Pressable>
            </View>
          </Animated.View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

interface ToggleRowProps {
  icon: string;
  iconColor: string;
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  theme: any;
  premium?: boolean;
}

function ToggleRow({ icon, iconColor, label, description, value, onChange, disabled, theme: t, premium }: ToggleRowProps) {
  return (
    <View style={[styles.toggleRow, disabled && { opacity: 0.5 }]}>
      <View style={[styles.toggleIcon, { backgroundColor: iconColor + '15' }]}>
        <MaterialIcons name={icon as any} size={20} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.toggleLabel, { color: t.textPrimary }]}>{label}</Text>
          {premium ? (
            <View style={{ backgroundColor: 'rgba(255,215,0,0.15)', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 3 }}>
              <Text style={{ fontSize: 9, fontWeight: '700', color: '#FFD700' }}>PRO</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ fontSize: 12, color: t.textSecondary, marginTop: 1 }}>{description}</Text>
      </View>
      <Switch
        value={value && !premium}
        onValueChange={onChange}
        disabled={disabled || premium}
        trackColor={{ false: t.border, true: iconColor + '60' }}
        thumbColor={value && !premium ? iconColor : t.textTertiary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  permissionBanner: { marginHorizontal: 16, marginTop: 16, borderRadius: 14, padding: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  permBannerIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  permBannerTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  masterToggle: { marginHorizontal: 16, marginTop: 16, borderRadius: 14, padding: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  masterIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  masterLabel: { fontSize: 16, fontWeight: '700' },
  sectionTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: 16, marginTop: 24, marginBottom: 8 },
  sectionCard: { marginHorizontal: 16, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  toggleIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  toggleLabel: { fontSize: 15, fontWeight: '600' },
  divider: { height: 1, marginLeft: 64 },
  thresholdRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 14, flexWrap: 'wrap' },
  thresholdChip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 9999, borderWidth: 1 },
  thresholdText: { fontSize: 14, fontWeight: '600' },
  infoCard: { marginHorizontal: 16, marginTop: 20, borderRadius: 12, padding: 14, borderWidth: 1, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  proCard: { marginHorizontal: 16, marginTop: 12, borderRadius: 12, padding: 14, borderWidth: 1, flexDirection: 'row', gap: 10, alignItems: 'center' },
  proBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  testBtn: { marginHorizontal: 16, marginTop: 12, borderRadius: 14, padding: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  testIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
