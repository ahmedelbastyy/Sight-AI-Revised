import { View, StyleSheet, AppState, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AlertProvider, AuthProvider, getSupabaseClient } from '@/template';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '../contexts/AppContext';
import { LaunchContext, useLaunchState } from '../contexts/LaunchContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { WelcomeLaunch } from '../components/WelcomeLaunch';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reconcileNotifications } from '../services/notificationService';

// ============================================================================
// NATIVE SPLASH ARCHITECTURE (Session 172 rewrite)
// ============================================================================
// preventAutoHideAsync() at module init keeps the native OS splash on
// screen. The Stack mounts BENEATH LaunchSplashOverlay so routes can
// preload. LaunchSplashOverlay resolves its mode (tap for the first ever
// launch / auto afterward / single-frame bypass in dev+Expo Go) and, on
// its root View's FIRST onLayout, calls onReady(). RootLayout hides the
// native splash EXACTLY ONCE (ref-guarded) when reactLaunchReady flips
// true — no arbitrary timer. WelcomeLaunch then plays normally; on
// dismiss it sets launchSequenceComplete = true. TradingPasswordGate
// reads launchSequenceComplete via LaunchContext and defers autofocus
// so the keyboard cannot appear behind the launch overlay on any device.
//
// Anti-race invariants:
//   • ROOT_BG is #050B1F everywhere — no #000000 / #FFFFFF frame during
//     any transition.
//   • ZERO arbitrary timers control native splash hide.
//   • ONE owner (this file) of SplashScreen.hideAsync().
// ============================================================================

SplashScreen.preventAutoHideAsync().catch(() => {});
try {
  // Fade the native splash out smoothly when supported by the installed
  // expo-splash-screen version. Older SDKs simply ignore setOptions.
  (SplashScreen as any).setOptions?.({ duration: 300, fade: true });
} catch { /* no-op on older SDKs */ }

// Lock orientation to portrait on app start (dynamic import so web / test
// bundlers cannot bail out).
if (Platform.OS !== 'web') {
  import('expo-screen-orientation').then(SO => {
    SO.lockAsync(SO.OrientationLock.PORTRAIT_UP).catch(() => {});
  }).catch(() => {});
}

// Single consistent startup surface color. Every root View, Stack
// contentStyle, StatusBar and modal surface uses this so the transition
// from native splash -> React overlay -> WelcomeLaunch -> destination is
// visually seamless with no color flash of any kind.
const ROOT_BG = '#050B1F';

const FIRST_LAUNCH_KEY = 'sight_first_launch_done';
let splashShownThisSession = false;

interface LaunchSplashOverlayProps {
  onReady: () => void;
  onDismiss: () => void;
}

/**
 * LaunchSplashOverlay
 * ---------------------------------------------------------------------------
 * Event-driven native splash handoff. Resolves its mode from AsyncStorage
 * / environment, then renders either the animated WelcomeLaunch (tap /
 * auto) or a single-frame #050B1F bypass frame (dev / Expo Go / same-
 * session remount). In every path the root View calls onReady() on its
 * FIRST onLayout so the native splash can be hidden the instant the
 * React launch surface actually exists. Bypass mode additionally fires
 * onDismiss() on the next frame so nothing can hang forever.
 */
function LaunchSplashOverlay({ onReady, onDismiss }: LaunchSplashOverlayProps) {
  const [resolved, setResolved] = useState<null | { mode: 'tap' | 'auto' | 'bypass' }>(null);
  const readyFiredRef = useRef(false);
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (splashShownThisSession) {
      // Same JS session re-mount (Fast Refresh, StrictMode, tab reset):
      // bypass immediately so the second mount cannot re-play the launch
      // animation over the running app.
      setResolved({ mode: 'bypass' });
      return;
    }
    splashShownThisSession = true;
    (async () => {
      try {
        if (__DEV__) { setResolved({ mode: 'bypass' }); return; }
        const Constants = (await import('expo-constants')).default;
        const env = Constants?.executionEnvironment;
        const ownership = (Constants as any)?.appOwnership;
        if (env === 'storeClient' || ownership === 'expo') {
          setResolved({ mode: 'bypass' });
          return;
        }
        const done = await AsyncStorage.getItem(FIRST_LAUNCH_KEY);
        setResolved({ mode: done === 'true' ? 'auto' : 'tap' });
      } catch {
        // Safety net — always render a tap-to-dismiss splash rather than
        // leaving the user staring at a native splash that never hides.
        setResolved({ mode: 'tap' });
      }
    })();
  }, []);

  const fireReadyOnce = useCallback(() => {
    if (readyFiredRef.current) return;
    readyFiredRef.current = true;
    onReady();
  }, [onReady]);

  const handleDismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    AsyncStorage.setItem(FIRST_LAUNCH_KEY, 'true').catch(() => {});
    onDismiss();
  }, [onDismiss]);

  if (!resolved) return null;

  if (resolved.mode === 'bypass') {
    // Dev / Expo Go / same-session remount: paint one #050B1F frame so
    // the native splash has a matching surface to hand off to, fire the
    // ready signal, then mark the launch sequence complete on the next
    // frame so keyboard / destination interactions become available.
    return (
      <View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: ROOT_BG, zIndex: 9999 }]}
        pointerEvents="none"
        onLayout={() => {
          fireReadyOnce();
          requestAnimationFrame(() => handleDismiss());
        }}
      />
    );
  }

  return (
    <View
      style={[StyleSheet.absoluteFillObject, { backgroundColor: ROOT_BG, zIndex: 9999, elevation: 9999 }]}
      pointerEvents="auto"
      onLayout={fireReadyOnce}
    >
      <WelcomeLaunch
        autoContinue={resolved.mode === 'auto'}
        autoContinueDelay={800}
        onTap={handleDismiss}
      />
    </View>
  );
}

function InnerLayout() {
  const { themeMode, currentTheme } = useApp();
  const { reactLaunchReady } = useLaunchState();
  const router = useRouter();
  const notifResponseListener = useRef<any>(null);
  const hideCalledRef = useRef(false);

  // ==========================================================================
  // NATIVE SPLASH HIDE — SINGLE OWNER, EVENT-DRIVEN
  // ==========================================================================
  // Fires exactly ONCE, only after LaunchSplashOverlay's root View has
  // committed its first onLayout (reactLaunchReady === true). No arbitrary
  // timer. hideCalledRef guarantees Strict Mode / re-renders cannot fire
  // hideAsync twice. This is the SOLE call site for SplashScreen.hideAsync
  // in the entire project.
  // ==========================================================================
  useEffect(() => {
    if (!reactLaunchReady) return;
    if (hideCalledRef.current) return;
    hideCalledRef.current = true;
    SplashScreen.hideAsync().catch(() => {});
  }, [reactLaunchReady]);

  // Status bar: white text on dark theme, black on light theme.
  const statusBarStyle = (() => {
    const bg = currentTheme.background;
    if (bg === '#FFFFFF' || bg === '#F8FAFC' || bg === '#F1F5F9' || bg === '#F9FAFB') return 'dark' as const;
    return 'light' as const;
  })();

  // Notification tap deep-linking. Session 177 — wrapped in try/catch so a
  // missing / renamed expo-notifications API in the installed SDK cannot
  // take down RootLayout on startup. Cleanup uses the modern
  // subscription.remove() API (Expo SDK 51+); the old
  // Notifications.removeNotificationSubscription() function was removed
  // in newer SDKs and throwing a TypeError during unmount could crash
  // Fast Refresh cycles in dev and cause hangs on cold launch in prod.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    try {
      notifResponseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
        try {
          const data = response?.notification?.request?.content?.data ?? {};
          if (data?.type === 'daily_summary') {
            AsyncStorage.setItem('ts_pending_daily_summary', 'true').catch(() => {});
            try { router.push('/daily-summary' as any); } catch { /* swallow */ }
          } else if (data?.type === 'ai_signal' && data?.ticker) {
            AsyncStorage.setItem('ts_pending_stock_deeplink', data.ticker).catch(() => {});
            AsyncStorage.setItem('ts_pending_stock_deeplink_type', 'ai_signal').catch(() => {});
            try { router.push(`/stock/${data.ticker}` as any); } catch { /* swallow */ }
          } else if (data?.type === 'price_alert' && data?.ticker) {
            AsyncStorage.setItem('ts_pending_stock_deeplink', data.ticker).catch(() => {});
            AsyncStorage.setItem('ts_pending_stock_deeplink_type', 'price_alert').catch(() => {});
            try { router.push(`/stock/${data.ticker}` as any); } catch { /* swallow */ }
          } else if (data?.type === 'ai_reminder') {
            // Session 186 — AI Moves reminders deep-link straight to the
            // AI Moves tab. Persist a pending-tab marker that the tabs
            // layout consumes on mount / focus, then push /(tabs). This
            // avoids adding a new named route and cannot corrupt any
            // existing router state.
            AsyncStorage.setItem('ts_pending_tab', String(data?.tab ?? 'moves')).catch(() => {});
            try { router.push('/(tabs)' as any); } catch { /* swallow */ }
          } else if (data?.type === 'market_open' || data?.type === 'market_close') {
            try { router.push('/(tabs)' as any); } catch { /* swallow */ }
          } else if (data?.type === 'breakout' && data?.ticker) {
            AsyncStorage.setItem('ts_pending_stock_deeplink', data.ticker).catch(() => {});
            AsyncStorage.setItem('ts_pending_stock_deeplink_type', 'ai_signal').catch(() => {});
            try { router.push(`/stock/${data.ticker}` as any); } catch { /* swallow */ }
          }
        } catch (e) {
          console.log('[NOTIF] response handler error (non-fatal):', e);
        }
      });
    } catch (e) {
      console.log('[NOTIF] addNotificationResponseReceivedListener failed (non-fatal):', e);
    }
    return () => {
      try {
        // Modern API: subscription.remove(). Falls back to the legacy
        // Notifications.removeNotificationSubscription only if it still
        // exists on the installed SDK. Both paths swallow errors so
        // teardown can never crash the app during Fast Refresh or unmount.
        const sub: any = notifResponseListener.current;
        if (sub && typeof sub.remove === 'function') {
          sub.remove();
        } else if (sub && typeof (Notifications as any).removeNotificationSubscription === 'function') {
          (Notifications as any).removeNotificationSubscription(sub);
        }
      } catch (e) {
        console.log('[NOTIF] listener cleanup error (non-fatal):', e);
      }
    };
  }, [router]);

  // Session 189 — LOCAL NOTIFICATION RECONCILIATION.
  //
  // Runs on mount and every time the app returns foreground. Reads the
  // current iOS permission status + prefs and repairs the pending local
  // notification set:
  //   • Daily Summary (was already reliable via the DAILY trigger).
  //   • Market Open / Close (both notifications, ET-aware, early-close-aware).
  //   • AI Moves reminders (3 per trading day, random minutes per day,
  //     persisted so times remain stable across app launches).
  //
  // If iOS authorization is not granted, EVERY Sight-owned pending local
  // notification is cancelled so a later toggle from Settings.app cannot
  // deliver a backlog. Idempotent — safe to invoke on every foreground.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    reconcileNotifications().catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcileNotifications().catch(() => {});
    });
    return () => { try { sub.remove(); } catch { /* swallow */ } };
  }, []);

  // Server-side AI signal delivery pipeline (Session 153, unchanged) plus
  // opportunistic price-alerts-worker foreground trigger.
  //
  // Session 191 — REMOVED duplicate schedulers.
  //   • AI Moves reminders  → LOCAL scheduled notifications (see
  //     services/notificationService.scheduleAIMovesReminders). The
  //     server ai-reminders-worker was doing the SAME thing and produced
  //     duplicate deliveries whenever the app was foregrounded, so it is
  //     no longer invoked here. The Edge Function itself now returns a
  //     disabled response — see supabase/functions/ai-reminders-worker.
  //   • Market Open / Close   → LOCAL scheduled notifications (see
  //     services/notificationService.scheduleMarketOpenClose). The
  //     server market-events-worker was doing the SAME thing at 09:30/
  //     16:00 ET and produced duplicates, so it is no longer invoked
  //     here and the Edge Function returns a disabled response.
  //
  // We still invoke generate-ai-signals (AI Moves data pipeline) and
  // price-alerts-worker (server-side price-change alerts — cannot be
  // implemented locally because the future crossing time is unknown
  // while the app is terminated). Background Fetch registration has
  // been REMOVED because expo-background-fetch is not installed and the
  // dynamic-import fallback silently failed with no observable behavior.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const supabase = getSupabaseClient();
    const trigger = () => {
      try {
        Promise.allSettled([
          supabase.functions.invoke('generate-ai-signals'),
          supabase.functions.invoke('price-alerts-worker'),
        ]).catch(() => { /* swallow */ });
      } catch { /* swallow */ }
    };
    trigger();
    const pollInterval = setInterval(trigger, 3 * 60 * 1000);
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') trigger();
    });
    return () => {
      try { subscription.remove(); } catch { /* swallow */ }
      clearInterval(pollInterval);
    };
  }, []);

  return (
    <>
      <StatusBar style={statusBarStyle} backgroundColor={themeMode === 'dark' ? ROOT_BG : '#FFFFFF'} translucent={false} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: ROOT_BG },
          animation: 'fade',
          animationTypeForReplace: 'push',
          fullScreenGestureEnabled: false,
          navigationBarHidden: true,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="login" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="auth" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
        <Stack.Screen name="disclaimer" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="market-status" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="welcome" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="image-intro" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="intro-offer" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="daily-summary" options={{ animation: 'fade', animationDuration: 100, gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
        <Stack.Screen name="stock/[id]" options={{ animation: 'slide_from_right', animationDuration: 200, gestureEnabled: true }} />
        <Stack.Screen name="subscription" options={{ animation: 'fade', animationDuration: 80, gestureEnabled: true }} />
        <Stack.Screen name="profile" options={{ animation: 'slide_from_right', animationDuration: 200 }} />
        <Stack.Screen name="tradingview" options={{ animation: 'slide_from_right', animationDuration: 200 }} />
        <Stack.Screen name="notifications" options={{ animation: 'slide_from_right', animationDuration: 200 }} />
        <Stack.Screen name="connect-brokerage" options={{ animation: 'slide_from_right', animationDuration: 200 }} />
        <Stack.Screen name="put-in-trade" options={{ animation: 'slide_from_bottom', animationDuration: 220, gestureEnabled: true }} />
        <Stack.Screen name="checkout-webview" options={{ presentation: 'containedTransparentModal', animation: 'slide_from_bottom', gestureEnabled: true, contentStyle: { backgroundColor: 'transparent' } }} />
        <Stack.Screen name="news-webview" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', animationDuration: 280, gestureEnabled: true, contentStyle: { backgroundColor: ROOT_BG } }} />
        <Stack.Screen name="terms" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: true }} />
        <Stack.Screen name="privacy" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: true }} />
        <Stack.Screen name="apple-eula" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: true }} />
      </Stack>
    </>
  );
}

/**
 * RootWithLaunch — owns the reactLaunchReady + launchSequenceComplete
 * + routingComplete state and provides them via LaunchContext so
 * InnerLayout can gate the native splash hide, TradingPasswordGate can
 * gate its autofocus, and app/index.tsx can signal when the destination
 * route has actually navigated.
 *
 * Session 212 — SPLASH LIFETIME REWRITE.
 * The overlay now stays mounted until BOTH:
 *   • launchSequenceComplete === true  (WelcomeLaunch animation done)
 *   • routingComplete === true         (app/index.tsx has router.replace()d)
 *
 * This eliminates the blank/blue screen users reported: previously the
 * overlay unmounted the moment the ~700ms auto-continue fired, but
 * Supabase getSession() / user_profiles / RevenueCat could still be in
 * flight, so app/index.tsx was still rendering its empty #050B1F View
 * when the overlay disappeared. Now the overlay bridges the gap and the
 * user only sees the animated Sight eye until the destination is
 * actually on screen.
 *
 * A HARD 4-second safety cap forces routingComplete true even if
 * something upstream never resolves, so the app can never hang on the
 * splash forever. Under normal conditions cache-first routing completes
 * within a few hundred ms of the animation ending, so the splash still
 * dismisses fast.
 */
function RootWithLaunch() {
  const [reactLaunchReady, setReactLaunchReady] = useState(false);
  const [launchSequenceComplete, setLaunchSequenceComplete] = useState(false);
  const [routingComplete, setRoutingComplete] = useState(false);

  const markReactLaunchReady = useCallback(() => setReactLaunchReady(true), []);
  const markLaunchSequenceComplete = useCallback(() => setLaunchSequenceComplete(true), []);
  const markRoutingComplete = useCallback(() => setRoutingComplete(true), []);

  // Hard safety cap — under ANY circumstance the overlay unmounts after
  // 4 seconds so the app is always interactive within a bounded time,
  // even if routing / auth / RC gets stuck. Cache-first routing usually
  // finishes in a few hundred ms so this rarely fires.
  useEffect(() => {
    if (routingComplete) return;
    const t = setTimeout(() => setRoutingComplete(true), 4000);
    return () => clearTimeout(t);
  }, [routingComplete]);

  const launchValue = useMemo(() => ({
    reactLaunchReady,
    launchSequenceComplete,
    routingComplete,
    markReactLaunchReady,
    markLaunchSequenceComplete,
    markRoutingComplete,
  }), [reactLaunchReady, launchSequenceComplete, routingComplete, markReactLaunchReady, markLaunchSequenceComplete, markRoutingComplete]);

  const overlayVisible = !launchSequenceComplete || !routingComplete;

  return (
    <LaunchContext.Provider value={launchValue}>
      <AlertProvider>
        <AuthProvider>
          <SafeAreaProvider>
            <AppProvider>
              <View style={{ flex: 1, backgroundColor: ROOT_BG }}>
                <InnerLayout />
                {overlayVisible ? (
                  <LaunchSplashOverlay
                    onReady={markReactLaunchReady}
                    onDismiss={markLaunchSequenceComplete}
                  />
                ) : null}
              </View>
            </AppProvider>
          </SafeAreaProvider>
        </AuthProvider>
      </AlertProvider>
    </LaunchContext.Provider>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <View style={{ flex: 1, backgroundColor: ROOT_BG }}>
        <RootWithLaunch />
      </View>
    </ErrorBoundary>
  );
}
