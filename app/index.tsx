import React, { useEffect, useState, useRef } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApp } from '../contexts/AppContext';
import { useLaunchState } from '../contexts/LaunchContext';
import { hasCompletedOnboarding as checkDeviceOnboarding } from './onboarding';

/**
 * Sight Launch Route (Session 212 rewrite)
 * =============================================================================
 * This component runs UNDER the LaunchSplashOverlay in _layout.tsx. The
 * overlay stays mounted until BOTH the animation is done AND this file
 * calls markRoutingComplete(). That means the user only ever sees the
 * animated Sight eye until the destination screen has actually router
 * replaced \u2014 the blank/blue "in-between" screen users used to see is
 * eliminated entirely.
 *
 * Fast-path strategy:
 *   1. Load ALL AsyncStorage inputs in a SINGLE Promise.all so we don't
 *      pay for staggered React state updates.
 *   2. Compute destination the moment inputs are known; do NOT wait for
 *      Supabase / RevenueCat / userFlagsLoaded when a cached "last user
 *      id" tells us we can safely assume the same signed-in user is
 *      returning. Server-side flags refresh in the background after the
 *      user is already on their destination screen.
 *   3. Call markRoutingComplete() only after router.replace() has been
 *      invoked so the overlay is dismissed at the exact moment the
 *      destination is on screen.
 * =============================================================================
 */
export default function Index() {
  const router = useRouter();
  const {
    isLoggedIn, authLoading,
    hasAcceptedDisclaimer, hasCompletedOnboarding,
    hasSeenIntroOffer, userFlagsLoaded, isSubscribed,
  } = useApp();
  const { markRoutingComplete } = useLaunchState();

  const [deviceOnboardingChecked, setDeviceOnboardingChecked] = useState(false);
  const [deviceOnboardingDone, setDeviceOnboardingDone] = useState(false);
  const [deviceIntroChecked, setDeviceIntroChecked] = useState(false);
  const [deviceAlreadySawIntro, setDeviceAlreadySawIntro] = useState(false);
  const [imageIntroChecked, setImageIntroChecked] = useState(true);

  const [pendingDailySummary, setPendingDailySummary] = useState(false);
  const [pendingStockDeeplink, setPendingStockDeeplink] = useState<string | null>(null);
  const [deeplinksChecked, setDeeplinksChecked] = useState(false);

  const [recentSignupAt, setRecentSignupAt] = useState<number | null>(null);
  const [recentSignupChecked, setRecentSignupChecked] = useState(false);

  const [cachedSubStatus, setCachedSubStatus] = useState<boolean | null>(null);
  const [cachedSubChecked, setCachedSubChecked] = useState(false);

  const hasNavigatedRef = useRef(false);

  // Session 212 \u2014 batched AsyncStorage read. Everything the router needs
  // is fetched in ONE Promise.all so the destination decision doesn't
  // stall on staggered state updates. Cached subscription status lets us
  // skip the paywall gate for known-Pro accounts even before RevenueCat
  // has responded.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [
          deviceOnbDone,
          introUsed,
          pendingSummary,
          stockTicker,
          _stockType,
          recentSignup,
          cachedSub,
        ] = await Promise.all([
          checkDeviceOnboarding().catch(() => false),
          AsyncStorage.getItem('ts_device_intro_offer_used'),
          AsyncStorage.getItem('ts_pending_daily_summary'),
          AsyncStorage.getItem('ts_pending_stock_deeplink'),
          AsyncStorage.getItem('ts_pending_stock_deeplink_type'),
          AsyncStorage.getItem('ts_recent_signup_at'),
          AsyncStorage.getItem('ts_is_subscribed'),
        ]);
        if (cancelled) return;

        setDeviceOnboardingDone(!!deviceOnbDone);
        setDeviceOnboardingChecked(true);
        setDeviceAlreadySawIntro(introUsed === 'true');
        setDeviceIntroChecked(true);
        setImageIntroChecked(true);

        if (pendingSummary === 'true') {
          setPendingDailySummary(true);
          AsyncStorage.removeItem('ts_pending_daily_summary').catch(() => {});
        }
        if (stockTicker) {
          setPendingStockDeeplink(stockTicker);
          AsyncStorage.removeItem('ts_pending_stock_deeplink').catch(() => {});
          AsyncStorage.removeItem('ts_pending_stock_deeplink_type').catch(() => {});
        }
        setDeeplinksChecked(true);

        if (recentSignup) {
          const ts = parseInt(recentSignup, 10);
          if (!isNaN(ts)) setRecentSignupAt(ts);
          if (isNaN(ts) || Date.now() - ts > 10 * 60 * 1000) {
            AsyncStorage.removeItem('ts_recent_signup_at').catch(() => {});
          }
        }
        setRecentSignupChecked(true);

        setCachedSubStatus(cachedSub === 'true');
        setCachedSubChecked(true);
      } catch {
        if (cancelled) return;
        setDeviceOnboardingChecked(true);
        setDeviceIntroChecked(true);
        setImageIntroChecked(true);
        setDeeplinksChecked(true);
        setRecentSignupChecked(true);
        setCachedSubChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Compute destination and navigate IMMEDIATELY as soon as ready.
  useEffect(() => {
    if (authLoading) return;
    if (!deviceOnboardingChecked) return;
    if (!deeplinksChecked) return;
    if (!recentSignupChecked) return;
    if (!cachedSubChecked) return;
    if (hasNavigatedRef.current) return;

    let destination: string | null = null;
    let pendingStockRoute: string | null = null;
    let pendingDailySummaryFollowUp = false;

    // Effective subscription status: use whichever source has flipped
    // true first (live RC state OR cached AsyncStorage value). This lets
    // us skip the paywall for known-Pro accounts even before RevenueCat
    // has finished verifying \u2014 the background verification still runs
    // and will correct any mismatch after the user is on their
    // destination screen.
    const effectiveSubscribed = isSubscribed || (cachedSubStatus === true);

    if (!isLoggedIn) {
      if (recentSignupAt && Date.now() - recentSignupAt < 60 * 1000) return;
      destination = deviceOnboardingDone ? '/login' : '/onboarding';
    } else {
      if (recentSignupAt) AsyncStorage.removeItem('ts_recent_signup_at').catch(() => {});
      // Only wait for userFlagsLoaded for BRAND NEW users (no cached sub
      // status). Returning subscribed users route immediately based on
      // cached state; server-side flags refresh in the background.
      if (!effectiveSubscribed && !userFlagsLoaded) return;
      if (!deviceIntroChecked || !imageIntroChecked) return;

      if (pendingStockDeeplink && effectiveSubscribed) {
        pendingStockRoute = pendingStockDeeplink;
        destination = '/(tabs)';
      } else if (effectiveSubscribed) {
        if (!hasAcceptedDisclaimer && userFlagsLoaded) {
          destination = '/disclaimer';
        } else if (pendingDailySummary) {
          pendingDailySummaryFollowUp = true;
          destination = '/(tabs)';
        } else {
          destination = '/(tabs)';
        }
      } else if (!hasAcceptedDisclaimer) {
        destination = '/disclaimer';
      } else if (!hasSeenIntroOffer && !deviceAlreadySawIntro) {
        destination = '/intro-offer';
      } else if (!isSubscribed) {
        destination = '/subscription?onboarding=1';
      } else if (!hasCompletedOnboarding) {
        destination = '/welcome';
      } else {
        if (pendingDailySummary) pendingDailySummaryFollowUp = true;
        destination = '/(tabs)';
      }
    }

    if (!destination) return;
    hasNavigatedRef.current = true;
    try {
      router.replace(destination as any);
      // Session 212 \u2014 signal to the launch overlay that routing has
      // fired. The overlay will unmount on the next frame so the user
      // sees a seamless handoff from the animated eye to the destination
      // screen with zero blank/blue frame.
      requestAnimationFrame(() => {
        try { markRoutingComplete(); } catch {}
      });
      if (pendingStockRoute) {
        setTimeout(() => {
          try { router.push(`/stock/${pendingStockRoute}` as any); } catch {}
        }, 300);
      }
      if (pendingDailySummaryFollowUp) {
        setTimeout(() => {
          try { router.push('/daily-summary' as any); } catch {}
        }, 300);
      }
    } catch {}
  }, [
    authLoading, isLoggedIn, userFlagsLoaded, deviceIntroChecked, imageIntroChecked,
    deeplinksChecked, deviceOnboardingChecked, deviceOnboardingDone,
    hasAcceptedDisclaimer, hasCompletedOnboarding, hasSeenIntroOffer,
    deviceAlreadySawIntro, pendingDailySummary, pendingStockDeeplink,
    isSubscribed, cachedSubStatus, cachedSubChecked,
    recentSignupChecked, recentSignupAt, router, markRoutingComplete,
  ]);

  // Safety net: fallback if destination stalls > 3.5s (was 8s).
  // The launch overlay itself has a 4s hard cap so this is intentionally
  // slightly shorter \u2014 by the time the overlay is forced to unmount,
  // this fallback has already picked a destination.
  useEffect(() => {
    const t = setTimeout(() => {
      if (hasNavigatedRef.current) return;
      if (!isLoggedIn && recentSignupAt && Date.now() - recentSignupAt < 60 * 1000) return;
      hasNavigatedRef.current = true;
      let destination = '/login';
      const effectiveSubscribed = isSubscribed || (cachedSubStatus === true);
      if (isLoggedIn) {
        if (effectiveSubscribed) {
          destination = hasAcceptedDisclaimer ? '/(tabs)' : '/disclaimer';
        } else if (!hasAcceptedDisclaimer) destination = '/disclaimer';
        else if (!hasSeenIntroOffer && !deviceAlreadySawIntro) destination = '/intro-offer';
        else if (!isSubscribed) destination = '/subscription?onboarding=1';
        else if (!hasCompletedOnboarding) destination = '/welcome';
        else destination = '/(tabs)';
      } else if (deviceOnboardingDone) {
        destination = '/login';
      } else {
        destination = '/onboarding';
      }
      try {
        router.replace(destination as any);
        requestAnimationFrame(() => {
          try { markRoutingComplete(); } catch {}
        });
      } catch {}
    }, 3500);
    return () => clearTimeout(t);
  }, [
    isLoggedIn, recentSignupAt, router,
    hasAcceptedDisclaimer, hasCompletedOnboarding, hasSeenIntroOffer,
    deviceAlreadySawIntro, isSubscribed, cachedSubStatus, deviceOnboardingDone,
    markRoutingComplete,
  ]);

  return <View style={{ flex: 1, backgroundColor: '#050B1F' }} />;
}
