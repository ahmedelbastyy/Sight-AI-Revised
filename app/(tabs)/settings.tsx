import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, TextInput, Modal, KeyboardAvoidingView, Platform, Keyboard, Pressable, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import * as Haptics from 'expo-haptics';
import { config } from '../../constants/config';
import { useRouter } from 'expo-router';
import { useApp } from '../../contexts/AppContext';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';

const supabase = getSupabaseClient();

interface SettingItemProps {
  icon: string;
  label: string;
  description?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  danger?: boolean;
}

function SettingItem({ icon, label, description, onPress, rightElement, danger }: SettingItemProps) {
  const { currentTheme: t } = useApp();
  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.6 : 1}
      style={[styles.settingItem, { borderBottomColor: t.border }]}
      onPress={onPress}
      disabled={!onPress && !rightElement}
    >
      <View style={[styles.settingIconCircle, { backgroundColor: danger ? t.bearishBg : t.primary + '15' }]}>
        <MaterialIcons name={icon as any} size={20} color={danger ? t.bearish : t.primary} />
      </View>
      <View style={styles.settingText}>
        <Text style={[styles.settingLabel, { color: danger ? t.bearish : t.textPrimary }]}>{label}</Text>
        {description ? <Text style={[styles.settingDesc, { color: t.textSecondary }]}>{description}</Text> : null}
      </View>
      {rightElement || (onPress ? <MaterialIcons name="chevron-right" size={22} color={t.textTertiary} /> : null)}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const {
    isSubscribed, subscriptionEnd, userName, userEmail, userId, cancelAtPeriodEnd,
    logout, toggleTheme, themeMode, currentTheme: t,
    checkSubscription, subscriptionLoading,
  } = useApp();
  // Session 177 — surface a brokerage-connected banner in the Delete
  // Account confirmation so the user is honestly informed that deleting
  // the Sight account does NOT close, sell, or affect any position at
  // their brokerage. The connection is fetched lazily when the modal
  // opens; if the fetch fails the banner simply does not render.
  const [hasBrokerConnection, setHasBrokerConnection] = useState(false);
  const [subRefreshing, setSubRefreshing] = useState(false);
  const displayIdentifier = userEmail || 'Not set';

  // Trading password management (DB-backed)
  const [showPwModal, setShowPwModal] = useState(false);
  const [pwMode, setPwMode] = useState<'set' | 'change'>('set');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  const handleTradingPassword = async () => {
    Haptics.selectionAsync();
    setPwLoading(true);
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('trading_password')
        .eq('id', userId)
        .single();
      if (data?.trading_password) {
        setPwMode('change');
      } else {
        setPwMode('set');
      }
    } catch {
      setPwMode('set');
    }
    setPwLoading(false);
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
    setShowCurrentPw(false);
    setShowNewPw(false);
    setShowConfirmPw(false);
    setShowPwModal(true);
  };

  const handleSaveTradingPassword = async () => {
    Keyboard.dismiss();
    if (pwMode === 'change') {
      setPwLoading(true);
      const { data } = await supabase
        .from('user_profiles')
        .select('trading_password')
        .eq('id', userId)
        .single();
      setPwLoading(false);
      if (data?.trading_password && data.trading_password !== currentPw) {
        showAlert('Incorrect', 'Current password is incorrect.');
        return;
      }
    }
    if (newPw.length < 4) {
      showAlert('Too Short', 'Trading password must be at least 4 characters.');
      return;
    }
    if (newPw !== confirmPw) {
      showAlert('Mismatch', 'Passwords do not match.');
      return;
    }
    setPwLoading(true);
    await supabase.from('user_profiles').update({ trading_password: newPw }).eq('id', userId);
    setPwLoading(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert('Success', pwMode === 'set' ? 'Trading password has been set. It will be required when you open the app.' : 'Trading password has been updated.');
    setShowPwModal(false);
  };

  const handleRemoveTradingPassword = async () => {
    showAlert('Remove Trading Password', 'Are you sure you want to remove the trading password?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          await supabase.from('user_profiles').update({ trading_password: null }).eq('id', userId);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          showAlert('Removed', 'Trading password has been removed.');
        },
      },
    ]);
  };

  const handleLogout = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    showAlert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => { logout(); router.replace('/login'); } },
    ]);
  };

  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const handleDeleteAccount = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setDeleteConfirmText('');
    // Lazy broker-connection check so the modal can show an accurate
    // banner about broker positions remaining at the brokerage.
    try {
      const { data } = await supabase
        .from('user_broker_connections')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();
      setHasBrokerConnection(!!data);
    } catch {
      setHasBrokerConnection(false);
    }
    setShowDeleteModal(true);
  };

  const confirmDeleteAccount = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') return;
    Keyboard.dismiss();
    setDeleteLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No active session. Please log in again.');
      }
      const { data, error } = await supabase.functions.invoke('delete-account', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) {
        let errMsg = error.message || 'Unknown error';
        try {
          if ((error as any).context?.text) {
            const textContent = await (error as any).context.text();
            if (textContent) errMsg = textContent;
          }
        } catch {}
        // FAIL-CLOSED: do NOT sign the user out on failure. Show retryable
        // error and keep the modal state so the user can try again or
        // contact support without losing context.
        throw new Error(errMsg);
      }
      // Server confirmed success — safe to clear local data + sign out.
      try {
        const allKeys = await AsyncStorage.getAllKeys();
        if (allKeys.length > 0) await AsyncStorage.multiRemove(allKeys);
      } catch {}
      await logout();
      setDeleteLoading(false);
      setShowDeleteModal(false);
      router.replace('/login');
      const appleReminder = (data as any)?.appleSubscriptionReminder;
      setTimeout(() => {
        showAlert(
          'Account Deleted',
          appleReminder
            ? `Your Sight account and all associated data have been permanently deleted.\n\n${appleReminder}`
            : 'Your Sight account and all associated data have been permanently deleted.',
        );
      }, 500);
    } catch (e: any) {
      setDeleteLoading(false);
      // Modal stays open on failure so the user can retry. Only close it
      // after they explicitly cancel or the delete actually succeeds.
      showAlert(
        'Deletion Failed',
        `${e.message || 'Failed to delete account'}. Your account has NOT been deleted. Please check your connection and try again, or contact contact@onspace.ai for help.`,
      );
    }
  };

  const handleRefreshSub = async () => {
    Haptics.selectionAsync();
    setSubRefreshing(true);
    await checkSubscription();
    setSubRefreshing(false);
    showAlert('Subscription Status', isSubscribed ? 'Your Pro subscription is active.' : 'No active subscription found.');
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: t.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.textPrimary }]}>Settings</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
        delaysContentTouches={false}
        onScrollBeginDrag={Keyboard.dismiss}
      >
        <View>
          <TouchableOpacity activeOpacity={0.7} style={[styles.subscriptionCard, { borderColor: t.border }]}
            onPress={() => { Haptics.selectionAsync(); router.push('/subscription'); }}>
            <Image source={require('../../assets/images/stock-banner.jpg')} style={styles.premiumImage} contentFit="cover" />
            <View style={styles.subOverlay}>
              <View style={styles.subBadge}>
                <MaterialIcons name="workspace-premium" size={16} color="#FFD700" />
                <Text style={styles.subBadgeText}>PRO</Text>
              </View>
              <Text style={styles.subTitle}>Sight Pro</Text>
              <Text style={styles.subPrice}>Pro Subscription</Text>
              <Text style={styles.subTrial}>
                {isSubscribed
                  ? `Active${subscriptionEnd ? ` · Renews ${new Date(subscriptionEnd).toLocaleDateString()}` : ''}`
                  : 'Unlock AI-powered trading signals'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <View>
          <Text style={[styles.sectionTitle, { color: t.textTertiary }]}>ACCOUNT</Text>
          <View style={[styles.sectionContainer, { backgroundColor: t.surface, borderColor: t.border }]}>
            <SettingItem icon="person" label="Profile" description={`${userName || 'Trader'} · ${displayIdentifier}`}
              onPress={() => { Haptics.selectionAsync(); router.push('/profile'); }} />
            <SettingItem icon="credit-card" label="Subscription" description={isSubscribed ? (cancelAtPeriodEnd ? 'Pro Plan - Cancelling' : 'Pro Plan - Active') : 'Free Plan'}
              onPress={() => { Haptics.selectionAsync(); router.push('/subscription'); }} />
            <SettingItem icon="refresh" label="Refresh Subscription Status" description="Check if your payment went through"
              onPress={handleRefreshSub}
              rightElement={(subscriptionLoading || subRefreshing) ? <ActivityIndicator size="small" color={t.primary} /> : undefined}
            />
          </View>
        </View>

        <View>
          <Text style={[styles.sectionTitle, { color: t.textTertiary }]}>BROKERAGE</Text>
          <View style={[styles.sectionContainer, { backgroundColor: t.surface, borderColor: t.border }]}>
            <SettingItem
              icon="account-balance"
              label="Connect Brokerage"
              description="Link your broker via SnapTrade to sync positions and place orders"
              onPress={() => { Haptics.selectionAsync(); router.push('/connect-brokerage'); }}
            />
          </View>
        </View>

        <View>
          <Text style={[styles.sectionTitle, { color: t.textTertiary }]}>PREFERENCES</Text>
          <View style={[styles.sectionContainer, { backgroundColor: t.surface, borderColor: t.border }]}>
            <SettingItem icon="notifications" label="Push Notifications" description="AI signals, market open & price alerts"
              onPress={() => { Haptics.selectionAsync(); router.push('/notifications'); }} />
            <SettingItem icon={themeMode === 'dark' ? 'dark-mode' : 'light-mode'} label={themeMode === 'dark' ? 'Dark Mode' : 'Light Mode'} description="Toggle appearance"
              rightElement={
                // Session 198 — iOS 17+ Switch behavior. Newer iOS versions
                // sometimes render the Switch thumb color inconsistently
                // when trackColor.true uses an alpha channel. Locking the
                // ON track to solid t.primary and the thumb to solid #FFF
                // (dark) or #F4F4F5 (light) matches Apple's native
                // rendering and eliminates the perceived lag on newer
                // iPhones. The theme state update itself is synchronous
                // (see toggleTheme in AppContext).
                <Switch value={themeMode === 'dark'} onValueChange={() => { Haptics.selectionAsync(); toggleTheme(); }}
                  trackColor={{ false: Platform.OS === 'ios' ? '#39393D' : t.border, true: t.primary }}
                  thumbColor={Platform.OS === 'ios' ? '#FFFFFF' : (themeMode === 'dark' ? t.primary : t.textTertiary)}
                  ios_backgroundColor={Platform.OS === 'ios' ? '#39393D' : t.border} />
              } />
            <SettingItem icon="lock" label="Trading Password"
              description="Set or change your app lock password (syncs across devices)"
              onPress={handleTradingPassword} />
          </View>
        </View>

        <View>
          <Text style={[styles.sectionTitle, { color: t.textTertiary }]}>ABOUT</Text>
          <View style={[styles.sectionContainer, { backgroundColor: t.surface, borderColor: t.border }]}>
            <SettingItem icon="language" label="Sight Website" description="Visit our website"
              onPress={() => {
                Haptics.selectionAsync();
                router.push({ pathname: '/news-webview', params: { url: 'https://sightt.app', title: 'Sight' } });
              }} />
            <SettingItem icon="gavel" label="Disclaimer" description="Important legal information"
              onPress={() => {
                Haptics.selectionAsync();
                showAlert('Legal Disclaimer', 'Sight provides analysis for informational purposes only. This is not financial advice. Trading involves risk. Always consult a qualified financial advisor before making investment decisions.');
              }} />
            <SettingItem icon="privacy-tip" label="Privacy Policy" onPress={() => { Haptics.selectionAsync(); router.push('/privacy'); }} />
            <SettingItem icon="description" label="Terms of Service" onPress={() => { Haptics.selectionAsync(); router.push('/terms'); }} />
          </View>
        </View>

        <View>
          <Text style={[styles.sectionTitle, { color: t.textTertiary }]}>DANGER ZONE</Text>
          <View style={[styles.sectionContainer, { backgroundColor: t.surface, borderColor: t.border }]}>
            <SettingItem icon="logout" label="Sign Out" danger onPress={handleLogout} />
            <SettingItem icon="delete-forever" label="Delete Account" danger onPress={handleDeleteAccount}
              rightElement={deleteLoading ? <ActivityIndicator size="small" color="#EF4444" /> : undefined} />
          </View>
        </View>

        <View style={styles.appInfo}>
          <Text style={{ fontSize: 12, color: t.textTertiary }}>{config.appName} v{config.appVersion}</Text>
        </View>
      </ScrollView>

      {/* Trading Password Modal — Premium Redesign */}
      <Modal
        visible={showPwModal}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => !pwLoading && setShowPwModal(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.pwModalOverlay}
          onPress={() => { Keyboard.dismiss(); if (!pwLoading) setShowPwModal(false); }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ width: '100%', alignItems: 'center' }}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={Keyboard.dismiss}
              style={{ width: '100%', maxWidth: 420 }}
            >
              <View style={[styles.pwModalContent, { backgroundColor: t.surface, borderColor: t.border }]}>
                {/* Close button */}
                <TouchableOpacity
                  activeOpacity={0.6}
                  style={[styles.pwCloseBtn, { backgroundColor: t.background, borderColor: t.border }]}
                  onPress={() => { Haptics.selectionAsync(); setShowPwModal(false); }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  disabled={pwLoading}
                >
                  <MaterialIcons name="close" size={18} color={t.textSecondary} />
                </TouchableOpacity>

                {/* Premium lock icon */}
                <View style={[styles.pwIconWrap, { backgroundColor: t.primary + '15', borderColor: t.primary + '30' }]}>
                  <MaterialIcons name={pwMode === 'set' ? 'lock' : 'lock-reset'} size={26} color={t.primary} />
                </View>

                {/* Title + subtitle */}
                <Text style={[styles.pwTitle, { color: t.textPrimary }]}>
                  {pwMode === 'set' ? 'Secure Your App' : 'Change Password'}
                </Text>
                <Text style={[styles.pwSubtitle, { color: t.textSecondary }]}>
                  {pwMode === 'set'
                    ? 'Set a password required to open the app on every device.'
                    : 'Update your password — changes sync across all your devices.'}
                </Text>

                {/* Form */}
                <View style={styles.pwForm}>
                  {pwMode === 'change' ? (
                    <View style={[styles.pwInputWrap, { backgroundColor: t.background, borderColor: t.border }]}>
                      <MaterialIcons name="lock-outline" size={18} color={t.textTertiary} />
                      <TextInput
                        style={[styles.pwInputField, { color: t.textPrimary }]}
                        placeholder="Current password"
                        placeholderTextColor={t.textTertiary}
                        value={currentPw}
                        onChangeText={setCurrentPw}
                        secureTextEntry={!showCurrentPw}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <TouchableOpacity
                        onPress={() => { setShowCurrentPw(!showCurrentPw); Haptics.selectionAsync(); }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <MaterialIcons name={showCurrentPw ? 'visibility' : 'visibility-off'} size={18} color={t.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  <View style={[styles.pwInputWrap, { backgroundColor: t.background, borderColor: t.border }]}>
                    <MaterialIcons name="lock-outline" size={18} color={t.textTertiary} />
                    <TextInput
                      style={[styles.pwInputField, { color: t.textPrimary }]}
                      placeholder={pwMode === 'set' ? 'Create password' : 'New password'}
                      placeholderTextColor={t.textTertiary}
                      value={newPw}
                      onChangeText={setNewPw}
                      secureTextEntry={!showNewPw}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoFocus={pwMode === 'set'}
                    />
                    <TouchableOpacity
                      onPress={() => { setShowNewPw(!showNewPw); Haptics.selectionAsync(); }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <MaterialIcons name={showNewPw ? 'visibility' : 'visibility-off'} size={18} color={t.textTertiary} />
                    </TouchableOpacity>
                  </View>

                  <View style={[
                    styles.pwInputWrap,
                    {
                      backgroundColor: t.background,
                      borderColor: confirmPw.length > 0 && newPw !== confirmPw ? t.bearish + '60' : t.border,
                    },
                  ]}>
                    <MaterialIcons name="lock-outline" size={18} color={t.textTertiary} />
                    <TextInput
                      style={[styles.pwInputField, { color: t.textPrimary }]}
                      placeholder="Confirm password"
                      placeholderTextColor={t.textTertiary}
                      value={confirmPw}
                      onChangeText={setConfirmPw}
                      secureTextEntry={!showConfirmPw}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      onPress={() => { setShowConfirmPw(!showConfirmPw); Haptics.selectionAsync(); }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <MaterialIcons name={showConfirmPw ? 'visibility' : 'visibility-off'} size={18} color={t.textTertiary} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Live validation indicators */}
                <View style={styles.pwValidationRow}>
                  <View style={styles.pwValidationItem}>
                    <MaterialIcons
                      name={newPw.length >= 4 ? 'check-circle' : 'radio-button-unchecked'}
                      size={13}
                      color={newPw.length >= 4 ? t.bullish : t.textTertiary}
                    />
                    <Text style={{ fontSize: 11, color: newPw.length >= 4 ? t.bullish : t.textTertiary, fontWeight: '500' }}>
                      Min 4 characters
                    </Text>
                  </View>
                  {confirmPw.length > 0 ? (
                    <View style={styles.pwValidationItem}>
                      <MaterialIcons
                        name={newPw === confirmPw && newPw.length > 0 ? 'check-circle' : 'cancel'}
                        size={13}
                        color={newPw === confirmPw && newPw.length > 0 ? t.bullish : t.bearish}
                      />
                      <Text style={{ fontSize: 11, color: newPw === confirmPw && newPw.length > 0 ? t.bullish : t.bearish, fontWeight: '500' }}>
                        {newPw === confirmPw && newPw.length > 0 ? 'Passwords match' : 'No match'}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Save button */}
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[
                    styles.pwSaveBtn,
                    { backgroundColor: t.primary },
                    (newPw.length < 4 || newPw !== confirmPw || pwLoading) && { opacity: 0.45 },
                  ]}
                  onPress={handleSaveTradingPassword}
                  disabled={pwLoading || newPw.length < 4 || newPw !== confirmPw}
                >
                  {pwLoading ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialIcons name="check" size={20} color="#FFF" />
                      <Text style={styles.pwSaveBtnText}>
                        {pwMode === 'set' ? 'Set Password' : 'Update Password'}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

                {/* Remove section — only in change mode */}
                {pwMode === 'change' ? (
                  <TouchableOpacity
                    activeOpacity={0.6}
                    style={[styles.pwRemoveBtn, { borderTopColor: t.border }]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setShowPwModal(false);
                      handleRemoveTradingPassword();
                    }}
                    disabled={pwLoading}
                  >
                    <MaterialIcons name="lock-open" size={15} color={t.bearish} />
                    <Text style={{ fontSize: 13, fontWeight: '600', color: t.bearish }}>
                      Remove Password
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>
      {/* Premium Delete Account Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => !deleteLoading && setShowDeleteModal(false)}
      >
        <View style={styles.deleteModalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ width: '100%', alignItems: 'center' }}
          >
            <Pressable onPress={Keyboard.dismiss} style={{ width: '100%', maxWidth: 400 }}>
              <View style={[styles.deleteModalContent, { backgroundColor: t.surface, borderColor: t.bearish + '40' }]}>
                {/* Warning Icon */}
                <View style={[styles.deleteModalIconWrap, { backgroundColor: t.bearishBg }]}>
                  <MaterialIcons name="warning-amber" size={36} color={t.bearish} />
                </View>
                <Text style={[styles.deleteModalTitle, { color: t.textPrimary }]}>Delete Account?</Text>
                <Text style={[styles.deleteModalSubtitle, { color: t.textSecondary }]}>
                  This action is permanent and cannot be undone.
                </Text>

                {/* Consequences List — honest about what deletion actually
                    does. Apple App Store subscriptions are managed by
                    Apple, not Sight, so we DO NOT claim we cancel them.
                    Broker positions remain at the brokerage untouched. */}
                <View style={[styles.deleteModalList, { backgroundColor: t.background, borderColor: t.border }]}>
                  <DeleteListItem icon="delete-outline" text="All your Sight data will be erased permanently" t={t} />
                  <DeleteListItem icon="logout" text="You will be signed out on every device" t={t} />
                  <DeleteListItem icon="alternate-email" text="Your email will be released for re-use" t={t} last={!isSubscribed && !hasBrokerConnection} />
                  {isSubscribed ? (
                    <DeleteListItem
                      icon="info-outline"
                      text="Your App Store subscription is billed by Apple and continues until you cancel it in Settings > Apple ID > Subscriptions."
                      t={t}
                      last={!hasBrokerConnection}
                    />
                  ) : null}
                  {hasBrokerConnection ? (
                    <DeleteListItem
                      icon="account-balance"
                      text="Your brokerage account, cash, and open positions stay at your brokerage. Sight only revokes its access."
                      t={t}
                      last
                    />
                  ) : null}
                </View>

                {isSubscribed ? (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                      paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10,
                      borderWidth: 1, borderColor: t.primary + '55',
                      backgroundColor: t.primary + '15',
                      marginBottom: 14,
                    }}
                    onPress={() => {
                      Haptics.selectionAsync();
                      const { Linking } = require('react-native');
                      if (Platform.OS === 'ios') Linking.openURL('itms-apps://apps.apple.com/account/subscriptions');
                      else if (Platform.OS === 'android') Linking.openURL('https://play.google.com/store/account/subscriptions');
                    }}
                  >
                    <MaterialIcons name="open-in-new" size={16} color={t.primary} />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: t.primary }}>
                      Manage Apple Subscription First
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {/* Typed Confirmation */}
                <Text style={[styles.deleteModalLabel, { color: t.textTertiary }]}>
                  To confirm, type <Text style={{ color: t.bearish, fontWeight: '800', letterSpacing: 1 }}>DELETE</Text> below
                </Text>
                <TextInput
                  style={[
                    styles.deleteModalInput,
                    {
                      backgroundColor: t.background,
                      borderColor: deleteConfirmText.trim().toUpperCase() === 'DELETE' ? t.bearish : t.border,
                      color: t.textPrimary,
                    },
                  ]}
                  value={deleteConfirmText}
                  onChangeText={setDeleteConfirmText}
                  placeholder="DELETE"
                  placeholderTextColor={t.textTertiary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  spellCheck={false}
                  editable={!deleteLoading}
                />

                {/* Action Buttons */}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={[styles.deleteModalBtn, { borderColor: t.border, backgroundColor: t.background }]}
                    onPress={() => { if (!deleteLoading) { setShowDeleteModal(false); setDeleteConfirmText(''); } }}
                    disabled={deleteLoading}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '600', color: t.textPrimary }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={[
                      styles.deleteModalBtn,
                      { backgroundColor: t.bearish, borderColor: t.bearish },
                      (deleteConfirmText.trim().toUpperCase() !== 'DELETE' || deleteLoading) && { opacity: 0.4 },
                    ]}
                    onPress={confirmDeleteAccount}
                    disabled={deleteConfirmText.trim().toUpperCase() !== 'DELETE' || deleteLoading}
                  >
                    {deleteLoading ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <ActivityIndicator size="small" color="#FFF" />
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>Deleting...</Text>
                      </View>
                    ) : (
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFF' }}>Delete Forever</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {deleteLoading ? (
                  <Text style={{ fontSize: 11, color: t.textTertiary, textAlign: 'center', marginTop: 12 }}>
                    Erasing your Sight data · Releasing email
                  </Text>
                ) : null}
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// Helper for the delete modal consequence list
function DeleteListItem({ icon, text, t, last }: { icon: string; text: string; t: any; last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.border }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.bearishBg, alignItems: 'center', justifyContent: 'center' }}>
        <MaterialIcons name={icon as any} size={16} color={t.bearish} />
      </View>
      <Text style={{ flex: 1, fontSize: 13, color: t.textSecondary, lineHeight: 18 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  subscriptionCard: { marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', height: 140, marginBottom: 20, borderWidth: 1 },
  premiumImage: { width: '100%', height: '100%', position: 'absolute', borderRadius: 16 },
  subOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', padding: 16, justifyContent: 'center' },
  subBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,215,0,0.2)', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, marginBottom: 8 },
  subBadgeText: { color: '#FFD700', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  subTitle: { fontSize: 20, fontWeight: '700', color: '#FFF', marginBottom: 2 },
  subPrice: { fontSize: 16, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  subTrial: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  sectionTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: 16, marginBottom: 8, marginTop: 4 },
  sectionContainer: { marginHorizontal: 16, borderRadius: 12, borderWidth: 1, marginBottom: 20, overflow: 'hidden' },
  settingItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 1, gap: 12 },
  settingIconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  settingText: { flex: 1 },
  settingLabel: { fontSize: 15, fontWeight: '600' },
  settingDesc: { fontSize: 12, marginTop: 1 },
  appInfo: { alignItems: 'center', paddingVertical: 20, gap: 2 },
  // Trading Password Modal — Compact Premium Redesign (fits all devices)
  pwModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  pwModalContent: {
    width: '100%',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    alignItems: 'stretch',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.35, shadowRadius: 24 },
      android: { elevation: 14 },
      default: {},
    }),
  },
  pwCloseBtn: { position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, zIndex: 10 },
  pwIconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 2, marginBottom: 10, borderWidth: 1 },
  pwTitle: { fontSize: 19, fontWeight: '700', textAlign: 'center', letterSpacing: -0.3 },
  pwSubtitle: { fontSize: 12, textAlign: 'center', marginTop: 4, marginBottom: 14, lineHeight: 17, paddingHorizontal: 6 },
  pwForm: { gap: 8 },
  pwInputWrap: { flexDirection: 'row', alignItems: 'center', height: 44, borderRadius: 10, paddingHorizontal: 12, borderWidth: 1.5, gap: 8 },
  pwInputField: { flex: 1, fontSize: 14, fontWeight: '500' },
  pwValidationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8, paddingHorizontal: 2, minHeight: 16 },
  pwValidationItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pwSaveBtn: { alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: 10, marginTop: 12 },
  pwSaveBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  pwRemoveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 10, marginTop: 10, borderTopWidth: 1 },
  // Premium Delete Account Modal
  deleteModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  deleteModalContent: {
    width: '100%',
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    alignItems: 'stretch',
    ...Platform.select({
      ios: { shadowColor: '#EF4444', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 20 },
      android: { elevation: 12 },
      default: {},
    }),
  },
  deleteModalIconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 14 },
  deleteModalTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center', letterSpacing: -0.3 },
  deleteModalSubtitle: { fontSize: 14, textAlign: 'center', marginTop: 6, marginBottom: 18, lineHeight: 20 },
  deleteModalList: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, marginBottom: 18 },
  deleteModalLabel: { fontSize: 13, textAlign: 'center', marginBottom: 8 },
  deleteModalInput: { height: 52, borderRadius: 12, paddingHorizontal: 16, fontSize: 17, borderWidth: 1.5, fontWeight: '700', textAlign: 'center', letterSpacing: 1.5 },
  deleteModalBtn: { flex: 1, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
