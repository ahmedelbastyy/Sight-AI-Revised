import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Platform,
  ScrollView, Dimensions, NativeScrollEvent, NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, FadeIn,
  withRepeat, withSequence,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useApp } from '../contexts/AppContext';
import { useAlert } from '@/template';
import {
  getOfferings, purchasePackage, restorePurchases, RCPackage,
} from '../services/revenueCatService';

// =============================================================================
// PAYWALL — Session 201 rewrite (scrollable info page + anchored buttons)
// =============================================================================
// The paywall now has TWO scroll positions:
//   1. Top: full-screen looping video with plan buttons anchored at the
//      bottom and a small "scroll for details" arrow indicator underneath.
//   2. Scrolled: an info page slides up over the video with rounded top
//      corners, animated fade-in, and detailed subscription information
//      formatted in clean rows. Plan buttons remain anchored at the bottom
//      even on the info page. Legal links (Privacy, Terms, Restore) move
//      from their initial position under the buttons to the very bottom
//      of the info page as the user scrolls.
//
// During ACTIVE scroll, the anchored plan buttons fade to a subtle 0.15
// opacity so the reader can see the info content beneath them. When scroll
// stops (via onMomentumScrollEnd + a 200ms debounce), they smoothly fade
// back to full opacity so tapping either plan is always one gesture away.
//
// The video player itself is UNCHANGED — it continues to loop forever
// behind everything. The 9-second reveal timer for the plan buttons is
// UNCHANGED. Only the layout and scroll behavior are new.
// =============================================================================

const PAYWALL_VIDEO_URL =
  'https://lkfasgjjsuadnxhencbt.supabase.co/storage/v1/object/sign/Sight/0823.mov?token=eyJraWQiOiIxMzRhMjNhZi1iMWQ3LTQyZWItYTY4My1iOGIzNWY0YjdjNmUiLCJhbGciOiJIUzUxMiJ9.eyJ1cmwiOiJTaWdodC8wODIzLm1vdiIsInNjb3BlIjoiZG93bmxvYWQiLCJpYXQiOjE3ODkxNzY1MDcsImV4cCI6MTA0MjkxNzY1MDd9.J-hTn3HPpO81qHXkVVP-8NWA-KnopOtCWBuM_4v_ePizHOeAlyb7NJZ6che_WRgc919d_6_eI3gan7SQQG4Q6Q';

function perfLog(tag: string, ...args: any[]) {
  if (__DEV__) console.log('[perf sub]', performance.now().toFixed(0), 'ms', tag, ...args);
}

interface PaywallVideoBackgroundProps {
  onFirstFrame?: () => void;
}

function PaywallVideoBackground({ onFirstFrame }: PaywallVideoBackgroundProps) {
  const firstFrameFiredRef = useRef(false);
  const player = useVideoPlayer({ uri: PAYWALL_VIDEO_URL }, (p) => {
    try {
      p.loop = true;
      p.muted = false;
      p.volume = 1.0;
      p.play();
    } catch (e) {
      if (__DEV__) console.log('[paywall] video player setup error (non-fatal)', String(e));
    }
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      if (firstFrameFiredRef.current) return;
      firstFrameFiredRef.current = true;
      try { onFirstFrame?.(); } catch { /* swallow */ }
    }, 180);
    return () => clearTimeout(timer);
  }, [onFirstFrame]);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#050B1F' }]} pointerEvents="none">
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture={false}
      />
    </View>
  );
}

// Session 201 — one row in the "What's included" list on the info page.
function FeatureRow({ icon, title, body, iconColor }: { icon: string; title: string; body: string; iconColor?: string }) {
  return (
    <View style={styles.featureRow}>
      <View style={[styles.featureIconWrap, { backgroundColor: (iconColor ?? '#3B82F6') + '20' }]}>
        <MaterialIcons name={icon as any} size={20} color={iconColor ?? '#3B82F6'} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureBody}>{body}</Text>
      </View>
    </View>
  );
}

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ onboarding?: string }>();
  const isFromOnboarding = params.onboarding === '1';
  const [dims, setDims] = useState(() => Dimensions.get('window'));
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setDims(window));
    return () => sub?.remove();
  }, []);
  const isTablet = dims.width >= 600;
  const isCompactPhone = dims.width < 340;
  const paywallSheetMaxWidth = isTablet ? 480 : 520;
  const paywallSheetHPad = isCompactPhone ? 16 : 20;
  const { showAlert } = useAlert();
  const {
    isSubscribed, subscriptionEnd, cancelAtPeriodEnd,
    checkSubscription, currentTheme: t, markSubPromptSeen, setJustUpgradedToPro,
  } = useApp();
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [purchasing, setPurchasing] = useState<null | 'weekly' | 'pro'>(null);
  const [restoring, setRestoring] = useState(false);
  const [offerings, setOfferings] = useState<{ monthly: RCPackage | null; proMonthly: RCPackage | null; weekly: RCPackage | null }>({
    monthly: null, proMonthly: null, weekly: null,
  });
  const [showUI, setShowUI] = useState(false);
  const mountedRef = useRef(true);
  const subCheckStarted = useRef(false);
  const purchaseInFlightRef = useRef(false);
  const purchaseNavigationStartedRef = useRef(false);

  // Session 208 — button entrance animation. Buttons start 80pt below
  // their final position AND fully invisible, then slide up while fading
  // in over 750ms with a spring-out ease so the arrival feels premium
  // rather than snapped.
  const uiOpacity = useSharedValue(0);
  const uiTranslate = useSharedValue(80);
  const uiAnimStyle = useAnimatedStyle(() => ({
    opacity: uiOpacity.value,
    transform: [{ translateY: uiTranslate.value }],
  }));

  // Session 201 — plan buttons anchored at bottom. Fade to 0.15 opacity
  // during active scroll (so info content is readable underneath), fade
  // back to 1 when scroll stops.
  const buttonsOpacity = useSharedValue(1);
  const buttonsAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonsOpacity.value,
  }));

  // Session 201 — the small "scroll down for details" arrow that lives
  // above the buttons on the video view. Fades out completely once the
  // user has scrolled more than a few pixels.
  const arrowOpacity = useSharedValue(0);
  const arrowAnimStyle = useAnimatedStyle(() => ({
    opacity: arrowOpacity.value,
    transform: [{ translateY: withTiming(0, { duration: 200 }) }],
  }));

  // Session 201 — the initial-position legal-link row (visible on the
  // video view). Fades out as the info page slides up.
  const initialLinksOpacity = useSharedValue(1);
  const initialLinksStyle = useAnimatedStyle(() => ({
    opacity: initialLinksOpacity.value,
  }));

  // Session 201 — Sight Pro card subtle shake, unchanged from earlier
  // sessions. Only runs while showUI is true.
  const proShake = useSharedValue(0);
  useEffect(() => {
    if (!showUI) return;
    proShake.value = withRepeat(
      withSequence(
        withTiming(1.2, { duration: 90, easing: Easing.inOut(Easing.quad) }),
        withTiming(-1.2, { duration: 90, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.0, { duration: 80, easing: Easing.inOut(Easing.quad) }),
        withTiming(-1.0, { duration: 80, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 60, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 2400 }),
      ),
      -1,
      false,
    );
  }, [showUI]);
  const proShakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: proShake.value }],
  }));

  useEffect(() => {
    perfLog('mount');
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (subCheckStarted.current) return;
    subCheckStarted.current = true;
    (async () => {
      try {
        const o = await getOfferings();
        if (mountedRef.current) setOfferings({ monthly: o.monthly, proMonthly: o.proMonthly, weekly: o.weekly });
        perfLog('offerings-loaded', {
          hasWeekly: !!o.weekly,
          hasProMonthly: !!o.proMonthly,
          hasMonthly: !!o.monthly,
        });
      } catch (e) {
        perfLog('offerings-failed', (e as any)?.message);
      }
      checkSubscription().catch(() => {});
    })();
  }, []);

  const revealUI = useCallback(() => {
    if (!mountedRef.current) return;
    if (showUI) return;
    perfLog('reveal-ui');
    setShowUI(true);
    // Session 208 — slower, longer slide-up so the buttons feel like they
    // rise elegantly rather than pop in. Fade + translate finish together.
    uiOpacity.value = withTiming(1, { duration: 750, easing: Easing.out(Easing.cubic) });
    uiTranslate.value = withTiming(0, { duration: 750, easing: Easing.out(Easing.cubic) });
    arrowOpacity.value = withTiming(1, { duration: 750, easing: Easing.out(Easing.cubic) });
  }, [showUI, uiOpacity, uiTranslate, arrowOpacity]);

  useEffect(() => {
    const timer = setTimeout(() => {
      revealUI();
    }, 9000);
    return () => clearTimeout(timer);
  }, [revealUI]);

  const handleFirstFrame = useCallback(() => {
    perfLog('first-frame');
  }, []);

  const handleClose = () => {
    markSubPromptSeen();
    if (isFromOnboarding) router.replace('/(tabs)');
    else if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const handlePurchase = async (plan: 'weekly' | 'pro') => {
    if (purchasing) return;
    if (purchaseNavigationStartedRef.current) return;
    setPurchasing(plan);
    purchaseInFlightRef.current = true;
    Haptics.selectionAsync();
    perfLog('purchase-start', plan);
    try {
      let pkgId: string;
      if (plan === 'weekly') {
        pkgId = offerings.weekly?.identifier ?? '$rc_weekly';
      } else {
        pkgId = offerings.proMonthly?.identifier ?? offerings.monthly?.identifier ?? '$rc_monthly';
      }
      const result = await purchasePackage(pkgId);
      if (result.cancelled) {
        purchaseInFlightRef.current = false;
        setPurchasing(null);
        perfLog('purchase-cancelled');
        return;
      }
      if (result.success) {
        perfLog('purchase-success-callback');
        setJustUpgradedToPro(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        checkSubscription().catch(() => {});
        purchaseNavigationStartedRef.current = true;
        perfLog('success-alert-shown');
        showAlert(
          'Success',
          plan === 'pro'
            ? 'Your Sight Pro 3-day free trial has started.'
            : 'Welcome to Sight — your weekly plan is active.',
          [{
            text: 'Continue',
            onPress: () => {
              perfLog('continue-tapped -> connect-brokerage');
              router.replace('/connect-brokerage?onboarding=1&autoOpen=1' as any);
            },
          }],
        );
      } else if (result.error) {
        purchaseInFlightRef.current = false;
        purchaseNavigationStartedRef.current = false;
        showAlert('Purchase Failed', result.error);
      }
    } catch (e: any) {
      purchaseInFlightRef.current = false;
      purchaseNavigationStartedRef.current = false;
      showAlert('Error', e.message ?? 'Purchase failed. Please try again.');
    } finally {
      if (mountedRef.current) setPurchasing(null);
    }
  };

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    Haptics.selectionAsync();
    try {
      const result = await restorePurchases();
      if (result.isSubscribed) {
        purchaseInFlightRef.current = true;
        setJustUpgradedToPro(true);
        await checkSubscription();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showAlert('Restored', 'Your Sight subscription has been restored.', [{
          text: 'Continue',
          onPress: () => {
            if (isFromOnboarding) {
              purchaseNavigationStartedRef.current = true;
              router.replace('/connect-brokerage?onboarding=1&autoOpen=1' as any);
            }
          },
        }]);
      } else {
        showAlert('No Subscription Found', 'No active subscription was found for this Apple ID.');
      }
    } catch (e: any) {
      showAlert('Restore Failed', e.message ?? 'Could not restore purchases.');
    } finally {
      if (mountedRef.current) setRestoring(false);
    }
  };

  const handleManageSubscription = () => {
    Haptics.selectionAsync();
    const { Linking } = require('react-native');
    if (Platform.OS === 'ios') Linking.openURL('itms-apps://apps.apple.com/account/subscriptions');
    else if (Platform.OS === 'android') Linking.openURL('https://play.google.com/store/account/subscriptions');
  };

  const endDate = subscriptionEnd ? new Date(subscriptionEnd) : null;
  const formattedEnd = endDate
    ? endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  const weeklyPrice = offerings.weekly?.priceString ?? '$2.99';
  const proPrice = offerings.proMonthly?.priceString ?? offerings.monthly?.priceString ?? '$17.99';

  // Session 201 — scroll handling for the paywall page. Tracks scroll
  // position and active-scroll state to drive:
  //   - buttonsOpacity  (dim during scroll, restore on stop)
  //   - arrowOpacity    (hide once user scrolls even a little)
  //   - initialLinksOpacity (fade out as info page rises)
  const scrollRef = useRef<ScrollView>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Session 204 — track whether the anchored buttons should accept taps.
  // Reset to true when scroll y ≤ 60pt so the initial-position buttons
  // work. Flipped to false once scroll depth exceeds 60pt so the anchored
  // area doesn't intercept taps on info-page content underneath.
  const [anchoredButtonsInteractable, setAnchoredButtonsInteractable] = useState(true);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    // Session 207 — Arrow + "Scroll for details" text disappear
    // INSTANTLY the moment scroll begins (2pt threshold, 80ms fade).
    arrowOpacity.value = y > 2 ? withTiming(0, { duration: 80 }) : withTiming(1, { duration: 80 });
    // Session 207 — Anchored plan buttons over the video vanish very
    // quickly (0→30pt) so the info page below can pop up cleanly with
    // no overlap. Below 2pt: buttons fully visible. Above 30pt: buttons
    // fully hidden and pointer events off so info-page content is tappable.
    const scrollT = Math.max(0, Math.min(1, y / 30));
    buttonsOpacity.value = withTiming(1 - scrollT, { duration: 80 });
    initialLinksOpacity.value = withTiming(1 - scrollT, { duration: 80 });
    const shouldBeInteractable = scrollT < 0.5;
    if (shouldBeInteractable !== anchoredButtonsInteractable) {
      setAnchoredButtonsInteractable(shouldBeInteractable);
    }
  }, [arrowOpacity, buttonsOpacity, initialLinksOpacity, anchoredButtonsInteractable]);

  const handleScrollBeginDrag = useCallback(() => {}, []);
  const handleScrollEndDrag = useCallback(() => {}, []);
  const handleMomentumScrollEnd = useCallback(() => {}, []);

  useEffect(() => () => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
  }, []);

  const handleArrowTap = useCallback(() => {
    Haptics.selectionAsync();
    scrollRef.current?.scrollTo({ y: dims.height * 0.7, animated: true });
  }, [dims.height]);

  // ============================================================
  // Subscribed users: management view (unchanged from Session 184).
  // ============================================================
  if (isSubscribed && !isFromOnboarding && !purchaseInFlightRef.current) {
    const nowMs = Date.now();
    const endMs = endDate ? endDate.getTime() : 0;
    const expired = endMs > 0 && endMs < nowMs;
    const statusLabel = expired
      ? 'Expired'
      : cancelAtPeriodEnd
        ? 'Cancelling'
        : 'Active';
    const statusColor = expired
      ? '#EF4444'
      : cancelAtPeriodEnd
        ? '#F59E0B'
        : '#10B981';
    const dateLabel = cancelAtPeriodEnd || expired ? 'Access Until' : 'Next Billing';
    const nextStatusTitle = expired
      ? 'Subscription Expired'
      : cancelAtPeriodEnd
        ? 'What happens next'
        : 'Subscription Active';
    const nextStatusBody = expired
      ? 'Your Sight Pro subscription has ended. Re-subscribe from the App Store to restore Pro features.'
      : cancelAtPeriodEnd && formattedEnd
        ? `You can keep using Sight Pro until ${formattedEnd}. Your subscription will not renew after that date.`
        : 'Your Sight Pro subscription is active and will renew automatically. You can cancel anytime in the App Store.';
    return (
      <View style={[styles.container, { backgroundColor: t.background, paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Pressable style={[styles.closeBtn, { backgroundColor: t.surface, borderColor: t.border }]} onPress={handleClose}>
            <MaterialIcons name="close" size={22} color={t.textSecondary} />
          </Pressable>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.manageScrollContent, { paddingBottom: 48 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          bounces={false}
          keyboardShouldPersistTaps="handled"
          overScrollMode="never"
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          scrollEnabled={false}
        >
            <View style={styles.manageInner}>
              <Image
                source={require('../assets/images/launch-eye-transparent.png')}
                style={styles.manageEyeLogo}
                contentFit="contain"
                cachePolicy="memory-disk"
                priority="high"
              />
              <Text style={[styles.manageTitle, { color: t.textPrimary }]}>Sight Pro</Text>
              <View style={[styles.statusPill, { backgroundColor: statusColor + '18', borderColor: statusColor + '55' }]}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: statusColor, letterSpacing: 0.4 }}>{statusLabel}</Text>
              </View>
              <View style={[styles.detailsCard, { backgroundColor: t.surface, borderColor: t.border, marginTop: 22 }]}>
                <View style={styles.detailRow}>
                  <View style={styles.detailLeft}>
                    <MaterialIcons name="credit-card" size={18} color={t.textTertiary} />
                    <Text style={[styles.detailLabel, { color: t.textSecondary }]} numberOfLines={1}>Plan</Text>
                  </View>
                  <View style={styles.detailRight}>
                    <Text style={[styles.detailValue, { color: t.textPrimary }]} numberOfLines={2}>Sight Pro</Text>
                  </View>
                </View>
                <View style={[styles.detailDivider, { backgroundColor: t.border }]} />
                <View style={styles.detailRow}>
                  <View style={styles.detailLeft}>
                    <MaterialIcons name="event" size={18} color={t.textTertiary} />
                    <Text style={[styles.detailLabel, { color: t.textSecondary }]} numberOfLines={1}>{dateLabel}</Text>
                  </View>
                  <View style={styles.detailRight}>
                    <Text style={[styles.detailValue, { color: expired ? '#EF4444' : t.textPrimary }]} numberOfLines={2}>
                      {formattedEnd ?? '—'}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={[styles.statusExplainCard, { backgroundColor: t.surface, borderColor: t.border, marginTop: 12 }]}>
                <View style={styles.statusExplainHeaderRow}>
                  <MaterialIcons
                    name={expired ? 'error-outline' : cancelAtPeriodEnd ? 'schedule' : 'verified'}
                    size={18}
                    color={statusColor}
                  />
                  <Text style={[styles.statusExplainTitle, { color: t.textPrimary }]} numberOfLines={2}>{nextStatusTitle}</Text>
                </View>
                <Text style={[styles.statusExplainBody, { color: t.textSecondary }]}>{nextStatusBody}</Text>
              </View>
              <View style={styles.manageCtaWrap}>
                <Text style={[styles.manageCtaHint, { color: t.textTertiary }]}>
                  Changes and cancellations are managed through your Apple ID subscriptions.
                </Text>
                <Pressable style={[styles.manageBtn, { backgroundColor: t.primary }]} onPress={handleManageSubscription}>
                  <MaterialIcons name="settings" size={20} color="#FFF" />
                  <Text style={styles.manageBtnText}>Manage in App Store</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
      </View>
    );
  }

  // ============================================================
  // Free users: video-first paywall with scrollable info page.
  // ============================================================
  // Session 207 — anchored plan-button area. Info page uses this as bottom
  // padding so the last content row isn't hidden underneath the buttons.
  // Session 208 — buttons are duplicated at the bottom of the info page, so
  // the info page itself only needs modest safe-area padding rather than
  // reserving the entire anchor block (which was causing a large blank
  // gap at the bottom of the scrolled info page).
  const anchorAreaHeight = 260 + insets.bottom;
  const infoPagePaddingBottom = insets.bottom + 32;
  // Spacer over the video is FULL viewport height so the info page begins
  // completely off-screen (below the visible area). No rounded corners of
  // the info page ever peek out under the anchored buttons before scroll.
  const videoScreenHeight = dims.height;
  return (
    <View style={styles.paywallRoot}>
      <StatusBar style="light" />
      <PaywallVideoBackground onFirstFrame={handleFirstFrame} />

      {/* Touch blocker during intro (before showUI). Removed once plans reveal. */}
      {!showUI ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="auto" />
      ) : null}

      {/* Session 201 — SCROLLVIEW covers the whole screen. First "screen"
          is transparent so the video shows through; second "screen" is
          the info page with rounded top and translucent dark surface. */}
      {showUI ? (
        <ScrollView
          ref={scrollRef}
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollEndDrag={handleScrollEndDrag}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          scrollEventThrottle={16}
          bounces={false}
          overScrollMode="never"
          alwaysBounceVertical={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Session 207 — Section 1: full-viewport transparent spacer over
              the video. Info page below starts completely OFF-SCREEN so
              users only see video + anchored buttons initially. As the
              user scrolls, buttons disappear (~30pt) and then the info
              page slides up from the bottom of the screen. */}
          <View style={{ height: videoScreenHeight, backgroundColor: 'transparent' }} />

          {/* Section 2: info page with rounded top corners. Slides up into
              view as the user scrolls. Semi-opaque #050B1F so the video
              can hint through the top edge but the content is clearly
              legible. */}
          <View style={[styles.infoPage, { paddingBottom: infoPagePaddingBottom, paddingTop: 20 }]}>
            <LinearGradient
              colors={['rgba(15,23,42,0.92)', 'rgba(5,11,31,0.98)']}
              locations={[0, 1]}
              style={StyleSheet.absoluteFill}
            />
            {/* Grabber pill so the panel reads as a bottom sheet */}
            <View style={styles.grabber} />
            <View style={styles.infoInner}>
              <Text style={styles.infoTitle}>What&apos;s included</Text>
              <Text style={styles.infoSubtitle}>Sight is a free download. All AI features listed below require an In-App Purchase subscription and unlock the moment your subscription starts.</Text>
              <Text style={styles.iapPlainText}>Requires In-App Purchase</Text>

              <View style={styles.featuresGroup}>
                <FeatureRow
                  icon="auto-awesome"
                  iconColor="#60A5FA"
                  title="AI Moves"
                  body="High-confidence BUY / SHORT setups from a dual-model S&P 500 scan, refreshed continuously during market hours."
                />
                <FeatureRow
                  icon="visibility"
                  iconColor="#3B82F6"
                  title="Chart Scanner"
                  body="Point your camera at any chart to run instant AI pattern detection."
                />
                <FeatureRow
                  icon="menu-book"
                  iconColor="#10B981"
                  title="Trade Journal"
                  body="Every closed trade lands here automatically — winners, losers, and manual sells — with full P/L, exit reason, and history."
                />
                <FeatureRow
                  icon="notifications-active"
                  iconColor="#F59E0B"
                  title="Live Alerts"
                  body="Price move alerts, breakout alerts, daily market open / close notifications, and personalized signal pushes."
                />
                <FeatureRow
                  icon="account-balance"
                  iconColor="#8B5CF6"
                  title="Brokerage Sync"
                  body="Connect Robinhood, Fidelity, Schwab, Alpaca and 30+ brokers via SnapTrade. See real positions, balances, and pending orders inside Sight."
                />
              </View>

              <View style={styles.pricingCard}>
                <Text style={styles.pricingTitle}>Simple pricing</Text>
                <View style={styles.pricingRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pricingRowTitle}>Sight Weekly</Text>
                    <Text style={styles.pricingRowSub}>Billed weekly · Cancel anytime</Text>
                  </View>
                  <Text style={styles.pricingRowPrice}>{weeklyPrice}<Text style={styles.pricingRowUnit}> /wk</Text></Text>
                </View>
                <View style={styles.pricingDivider} />
                <View style={styles.pricingRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.pricingRowTitle}>Sight Pro</Text>
                      <View style={styles.trialInlineTag}>
                        <Text style={styles.trialInlineTagText}>3-DAY TRIAL</Text>
                      </View>
                    </View>
                    <Text style={styles.pricingRowSub}>Free for 3 days, then billed monthly. Cancel anytime.</Text>
                  </View>
                  <Text style={styles.pricingRowPrice}>{proPrice}<Text style={styles.pricingRowUnit}> /mo</Text></Text>
                </View>
              </View>

              <Text style={styles.disclosureTitle}>How the free trial works</Text>
              <Text style={styles.disclosureBody}>
                Your 3-day free trial starts the moment you tap Sight Pro. You will not be charged during the trial period. If you don&apos;t cancel before the trial ends, your Apple ID will be charged {proPrice} and the subscription will renew monthly until you cancel. You can cancel anytime through your Apple ID subscription settings.
              </Text>

              <Text style={styles.disclosureTitle}>How your subscription works</Text>
              <Text style={styles.disclosureBody}>
                Payment is charged to your Apple ID at confirmation of purchase. Your subscription automatically renews unless auto-renew is turned off at least 24 hours before the end of the current period. Your account will be charged for renewal within 24 hours prior to the end of the current period. You can manage and cancel your subscription by going to your Apple ID account settings after purchase.
              </Text>

              {/* Session 204 — second set of plan buttons rendered at the
                  BOTTOM of the info page. This is the ONE set the user
                  interacts with once they've scrolled to read the details.
                  The anchored set at the top of the screen fades to 0 as
                  the user scrolls the info page in. */}
              <View style={{ gap: 12, marginTop: 24, marginBottom: 8 }}>
                <Pressable
                  onPress={() => handlePurchase('weekly')}
                  disabled={!!purchasing}
                  style={({ pressed }) => [
                    styles.planCard,
                    styles.planCardBasic,
                    { opacity: pressed || purchasing === 'weekly' ? 0.85 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Subscribe to Sight Weekly"
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planTitle}>Sight Weekly</Text>
                    <Text style={styles.planSub}>Billed weekly · Cancel anytime</Text>
                  </View>
                  {purchasing === 'weekly' ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.planPrice}>{weeklyPrice}</Text>
                      <Text style={styles.planPriceSub}>per week</Text>
                    </View>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => handlePurchase('pro')}
                  disabled={!!purchasing}
                  style={({ pressed }) => [
                    styles.planCard,
                    styles.planCardPro,
                    { opacity: pressed || purchasing === 'pro' ? 0.85 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Subscribe to Sight Pro — 3-day free trial"
                >
                  <View style={styles.trialTag}>
                    <MaterialIcons name="local-fire-department" size={10} color="#FFFFFF" />
                    <Text style={styles.trialTagText}>3-DAY FREE TRIAL</Text>
                  </View>
                  <View style={{ flex: 1, marginTop: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.planTitle}>Sight Pro</Text>
                      <MaterialIcons name="workspace-premium" size={16} color="#FFD700" />
                    </View>
                    <Text style={styles.planSub}>Free for 3 days · then {proPrice}/mo</Text>
                  </View>
                  {purchasing === 'pro' ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <View style={{ alignItems: 'flex-end', marginTop: 12 }}>
                      <Text style={styles.planPrice}>{proPrice}</Text>
                      <Text style={styles.planPriceSub}>after trial</Text>
                    </View>
                  )}
                </Pressable>
              </View>

              {/* Legal / restore links at the bottom of the info page */}
              <View style={styles.bottomLinksRow}>
                <Pressable
                  onPress={handleRestore}
                  disabled={restoring}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={[styles.bottomLinkText, restoring && { opacity: 0.5 }]}>
                    {restoring ? 'Restoring…' : 'Restore Purchases'}
                  </Text>
                </Pressable>
                <View style={styles.bottomLinkDot} />
                <Pressable
                  onPress={() => router.push('/privacy')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.bottomLinkText}>Privacy Policy</Text>
                </Pressable>
                <View style={styles.bottomLinkDot} />
                <Pressable
                  onPress={() => router.push('/terms')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.bottomLinkText}>Terms of Use</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </ScrollView>
      ) : null}

      {/* Session 209 — The bottom darkening gradient has been REMOVED
          per user request. The user reported that during scroll the
          purchase buttons on the info page were being darkened by the
          gradient overlay, which felt cloudy and unpolished. Since the
          info page has its own semi-opaque background (LinearGradient
          from rgba(15,23,42,0.92) to rgba(5,11,31,0.98)) that provides
          plenty of text/button contrast on its own, the separate anchor
          gradient shim was redundant. Removing it produces a cleaner
          scroll experience with fully-visible buttons. */}

      {/* Session 208 — "Scroll for details" indicator is now positioned
          IMMEDIATELY above the Sight Weekly button with a small gap so
          the visual anchor sits right on top of the first CTA (per user
          request). Fades out the moment the user scrolls. */}
      {showUI ? (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.arrowIndicator, { bottom: anchorAreaHeight - 12 }, arrowAnimStyle]}
        >
          <Pressable onPress={handleArrowTap} hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }} style={{ alignItems: 'center' }}>
            <Text style={styles.arrowLabel}>Scroll for details</Text>
            <MaterialIcons name="keyboard-arrow-down" size={22} color="rgba(255,255,255,0.9)" />
          </Pressable>
        </Animated.View>
      ) : null}

      {/* Session 201 — ANCHORED PLAN BUTTONS. Position: absolute at bottom.
          Fades to 0.15 during active scroll, restores to 1 when scroll
          stops. Sits above the arrow indicator and info page. */}
      {showUI ? (
        <Animated.View
          pointerEvents={anchoredButtonsInteractable ? 'box-none' : 'none'}
          style={[
            styles.anchoredButtons,
            {
              paddingBottom: insets.bottom + 20,
              paddingHorizontal: paywallSheetHPad,
            },
            buttonsAnimStyle,
            uiAnimStyle,
          ]}
        >
          <View style={{ maxWidth: paywallSheetMaxWidth, alignSelf: 'center', width: '100%', gap: 12 }}>
            <Pressable
              onPress={() => handlePurchase('weekly')}
              disabled={!!purchasing}
              style={({ pressed }) => [
                styles.planCard,
                styles.planCardBasic,
                { opacity: pressed || purchasing === 'weekly' ? 0.85 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Subscribe to Sight Weekly"
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.planTitle}>Sight Weekly</Text>
                <Text style={styles.planSub}>Billed weekly · Cancel anytime</Text>
              </View>
              {purchasing === 'weekly' ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.planPrice}>{weeklyPrice}</Text>
                  <Text style={styles.planPriceSub}>per week</Text>
                </View>
              )}
            </Pressable>

            <Animated.View style={proShakeStyle}>
              <Pressable
                onPress={() => handlePurchase('pro')}
                disabled={!!purchasing}
                style={({ pressed }) => [
                  styles.planCard,
                  styles.planCardPro,
                  { opacity: pressed || purchasing === 'pro' ? 0.85 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Subscribe to Sight Pro — 3-day free trial"
              >
                <View style={styles.trialTag}>
                  <MaterialIcons name="local-fire-department" size={10} color="#FFFFFF" />
                  <Text style={styles.trialTagText}>3-DAY FREE TRIAL</Text>
                </View>
                <View style={{ flex: 1, marginTop: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.planTitle}>Sight Pro</Text>
                    <MaterialIcons name="workspace-premium" size={16} color="#FFD700" />
                  </View>
                  <Text style={styles.planSub}>Free for 3 days · then {proPrice}/mo</Text>
                </View>
                {purchasing === 'pro' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <View style={{ alignItems: 'flex-end', marginTop: 12 }}>
                    <Text style={styles.planPrice}>{proPrice}</Text>
                    <Text style={styles.planPriceSub}>after trial</Text>
                  </View>
                )}
              </Pressable>
            </Animated.View>

            {/* Initial-position legal links — fade out as user scrolls */}
            <Animated.View style={[styles.linkRow, initialLinksStyle]} pointerEvents="box-none">
              <Pressable
                onPress={handleRestore}
                disabled={restoring}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={[styles.linkText, restoring && { opacity: 0.5 }]}>
                  {restoring ? 'Restoring…' : 'Restore Purchases'}
                </Text>
              </Pressable>
              <View style={styles.linkDot} />
              <Pressable
                onPress={() => router.push('/privacy')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.linkText}>Privacy Policy</Text>
              </Pressable>
              <View style={styles.linkDot} />
              <Pressable
                onPress={() => router.push('/terms')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.linkText}>Terms of Use</Text>
              </Pressable>
            </Animated.View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  // Subscribed / management view
  // Session 210 — eye logo restored to the smaller 72×72 size the user
  // originally had (from Session 209's 108×108). Combined with the
  // Animated.View wrapper removal above (now plain View) and
  // bounces={false} on the ScrollView, the subscription management page
  // now opens with zero jitter and a properly-proportioned Sight eye.
  manageEyeLogo: { width: 72, height: 72, marginTop: 4, marginBottom: 16 },
  manageInner: { width: '100%', maxWidth: 480, alignItems: 'center' },
  manageTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 9999, borderWidth: 1, marginTop: 10,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  detailsCard: { width: '100%', borderRadius: 14, padding: 16, borderWidth: 1 },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 16 },
  detailLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1, minWidth: 0 },
  detailRight: { flex: 1, alignItems: 'flex-end', minWidth: 0 },
  detailLabel: { fontSize: 14, fontWeight: '500' },
  detailValue: { fontSize: 14, fontWeight: '600', textAlign: 'right' },
  detailDivider: { height: 1 },
  statusExplainCard: { width: '100%', borderRadius: 14, padding: 16, borderWidth: 1 },
  statusExplainHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  statusExplainTitle: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2, flexShrink: 1 },
  statusExplainBody: { fontSize: 13, lineHeight: 20 },
  manageScrollContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 48, alignItems: 'center' },
  manageCtaWrap: { width: '100%', marginTop: 28, gap: 12 },
  manageCtaHint: { fontSize: 12, textAlign: 'center', lineHeight: 18, paddingHorizontal: 8 },
  manageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 52, borderRadius: 12, gap: 8 },
  manageBtnText: { fontSize: 17, fontWeight: '700', color: '#FFF' },

  // Paywall (video-first)
  paywallRoot: { flex: 1, backgroundColor: '#050B1F' },
  anchoredButtons: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    zIndex: 20,
  },
  planCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    minHeight: 76, borderRadius: 16,
    paddingHorizontal: 18, paddingVertical: 14,
    borderWidth: 1.5, position: 'relative', overflow: 'hidden',
  },
  planCardBasic: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderColor: 'rgba(255,255,255,0.16)',
  },
  planCardPro: {
    backgroundColor: 'rgba(29, 78, 216, 0.90)',
    borderColor: 'rgba(96,165,250,0.55)',
  },
  trialTag: {
    // Session 214 — trial ribbon background changed from full orange
    // (#F97316) to the same dark navy the Pro card uses (rgba(15,23,42,0.98)),
    // so the ONLY orange element is the flame icon itself per user
    // request. A subtle orange border+shadow keeps the ribbon prominent
    // without turning the whole tag orange.
    position: 'absolute', top: 0, left: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.98)',
    borderWidth: 1,
    borderColor: '#F97316',
    borderTopWidth: 0,
    borderLeftWidth: 0,
    paddingHorizontal: 10, paddingVertical: 4,
    borderBottomRightRadius: 10, borderTopLeftRadius: 14,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  trialTagText: { fontSize: 9, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.6 },
  planTitle: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  planSub: { fontSize: 11, color: 'rgba(255,255,255,0.78)', marginTop: 3 },
  planPrice: { fontSize: 22, fontWeight: '900', color: '#FFFFFF' },
  planPriceSub: { fontSize: 10, color: 'rgba(255,255,255,0.7)', marginTop: 1 },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, marginTop: 6, flexWrap: 'wrap',
  },
  linkText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  linkDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.45)' },

  // Session 201 — arrow indicator + info page + feature rows
  arrowIndicator: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
    zIndex: 15,
  },
  arrowLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  infoPage: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    overflow: 'hidden',
    minHeight: 640,
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
    marginBottom: 20,
  },
  infoInner: {
    maxWidth: 520,
    alignSelf: 'center',
    width: '100%',
  },
  infoTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  infoSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.75)',
    marginBottom: 24,
  },
  featuresGroup: {
    gap: 16,
    marginBottom: 28,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  featureIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  featureBody: {
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.7)',
  },
  pricingCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    padding: 16,
    marginBottom: 20,
  },
  pricingTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  pricingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  pricingRowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pricingRowSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 2,
  },
  pricingRowPrice: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  pricingRowUnit: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },
  pricingDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 6,
  },
  trialInlineTag: {
    // Session 214 — same treatment as trialTag: dark navy fill with a
    // thin orange outline so the flame icon (rendered next to it in
    // trialTagText) reads as the only truly orange element.
    backgroundColor: 'rgba(15, 23, 42, 0.98)',
    borderWidth: 1,
    borderColor: '#F97316',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
  },
  trialInlineTagText: {
    fontSize: 9, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.6,
  },
  disclosureTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 4,
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  disclosureBody: {
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.65)',
    marginBottom: 18,
  },
  bottomLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 20,
  },
  bottomLinkText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
  },
  bottomLinkDot: {
    width: 3, height: 3, borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  iapPlainText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: -14,
    marginBottom: 22,
    letterSpacing: 0.2,
  },
});
