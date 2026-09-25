import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeIn,
  useSharedValue, useAnimatedStyle, withTiming, withSequence, withRepeat, Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useApp } from '../contexts/AppContext';
import { markTutorialPending, clearTutorialPending } from '../services/tutorialStartBus';

// __DEV__-only perf logging helper. Timestamps every stage of the
// onboarding welcome-to-tabs handoff so we can measure it end-to-end.
function perfLog(tag: string, ...args: any[]) {
  if (__DEV__) console.log('[perf welcome]', performance.now().toFixed(0), 'ms', tag, ...args);
}

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currentTheme: t, setHasCompletedOnboarding, setHasCompletedTutorial } = useApp();

  // Session 173 — the previous 600ms setTimeout(setShowButton) plus 350ms
  // page-fade + 340ms navigation delay have been REMOVED. The welcome
  // screen is now interactive the moment it mounts (Get Started is
  // rendered immediately), and tapping Get Started navigates on the very
  // next frame. All welcome content is static/local (no network needed)
  // so there is no reason to gate the button behind a timer.

  React.useEffect(() => { perfLog('mount'); }, []);

  const handleStart = () => {
    if (__DEV__) console.log('[tutorial] WELCOME_CONTINUE_PRESSED t=', performance.now().toFixed(0), 'ms');
    perfLog('get-started-tapped');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Session 213 — GUARANTEE the tutorial plays for every user who
    // completes the Welcome screen. /welcome is only reached inside the
    // onboarding funnel (index.tsx routes here ONLY when isSubscribed &&
    // !hasCompletedOnboarding), so this reset never fires for repeat
    // sessions — it fires exactly once per new account, immediately
    // before we hand off to /(tabs). Combined with markTutorialPending()
    // below (which sets the bus + AsyncStorage flag on the same JS tick)
    // and clearTutorialPending() (which wipes any stale flag from a
    // previous device user) this makes the tutorial fire reliably for
    // every newly-created account with no ability for a stale state to
    // suppress it.
    try { clearTutorialPending().catch(() => {}); } catch { /* swallow */ }
    try { setHasCompletedTutorial(false); } catch { /* swallow */ }
    // Session 185 — SIGNAL the tutorial launch. markTutorialPending()
    // sets an in-memory bus flag (fires HomeScreen's listener
    // synchronously if it is already mounted underneath the route
    // stack) AND persists the flag to AsyncStorage (so a mid-onboarding
    // cold restart still resumes correctly). HomeScreen ONLY clears
    // this flag after the first spotlight overlay is proven to have
    // mounted, so if any measurement / state race prevents the overlay
    // from rendering the flag stays set and future focus events / state
    // changes can retry until it succeeds — no more "requires restart"
    // failure mode.
    //
    // MUST be called BEFORE setHasCompletedOnboarding + router.replace
    // so the in-memory flag is live on the exact same JS tick as any
    // subsequent render, guaranteeing HomeScreen's subscribeTutorialStart
    // listener (whenever it registers) sees the emission — the bus also
    // re-fires the listener on subscribe if a pending token already
    // exists, so registration order does not matter.
    const token = markTutorialPending();
    if (__DEV__) console.log('[tutorial] TUTORIAL_PENDING_MARKED_BY_WELCOME token=', token);
    // Mark onboarding done SYNCHRONOUSLY so the destination screen (tabs)
    // sees hasCompletedOnboarding === true on its very first render. The
    // AsyncStorage/Supabase persistence inside setHasCompletedOnboarding
    // is fire-and-forget — it does not gate navigation.
    setHasCompletedOnboarding(true);
    if (__DEV__) console.log('[tutorial] NAVIGATION_DISPATCHED (welcome -> tabs)');
    // Navigate immediately — the root Stack.Screen name="welcome" already
    // has animation: 'fade' configured, so the native fade transition
    // handles the visual polish. No JS-side delay needed.
    try { router.replace('/'); } catch { /* swallow */ }
  };

  // Session 113 #7 — blinking eye logo above the title.
  //   • Uses the SAME eye asset as WelcomeLaunch (assets/images/app-logo.png).
  //   • Blinks once shortly after mount, then subtly blinks again every ~6s.
  //   • Placed in the previously-empty area above the "The Future of Stock
  //     Intelligence" title — the existing text and buttons are NOT moved.
  const eyeScaleY = useSharedValue(1);
  React.useEffect(() => {
    // First blink 800ms after mount.
    const first = setTimeout(() => {
      eyeScaleY.value = withSequence(
        withTiming(0.05, { duration: 120, easing: Easing.in(Easing.quad) }),
        withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
      );
    }, 800);
    // Occasional blink loop after that (~6s cadence).
    const loop = setTimeout(() => {
      eyeScaleY.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 5500 }),
          withTiming(0.05, { duration: 120, easing: Easing.in(Easing.quad) }),
          withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
        ),
        -1,
        false,
      );
    }, 2000);
    return () => {
      clearTimeout(first);
      clearTimeout(loop);
    };
  }, []);
  const eyeAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: eyeScaleY.value }],
  }));

  return (
    <View style={[styles.container, { backgroundColor: t.background }]}>
      {/* Subtle dark gradient background — finance-focused, no purple/pink */}
      <LinearGradient
        colors={['rgba(59,130,246,0.10)', 'rgba(59,130,246,0.04)', 'transparent']}
        start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, justifyContent: 'space-between' }}>
        <View style={styles.content}>
          {/* Session 113 #7 — blinking eye logo. Fills the previously-empty
              area above the title. pointerEvents="none" so it never blocks
              taps intended for the Get Started button. */}
          <View pointerEvents="none" style={styles.eyeSection}>
            <Animated.View style={eyeAnimStyle}>
              <Image
                source={require('../assets/images/app-logo.png')}
                style={styles.eyeLogo}
                contentFit="contain"
                cachePolicy="memory-disk"
                priority="high"
              />
            </Animated.View>
          </View>

          {/* Header element removed per spec — no brand label, no decorative dots.
              The cleaner layout lets the title and feature list carry the visual weight. */}

          {/* Title and subtitle — strong typography hierarchy */}
          <View style={styles.textSection}>
            <Text style={[styles.title, { color: t.textPrimary }]}>
              The Future of{'\n'}Stock Intelligence
            </Text>
            <Text style={[styles.subtitle, { color: t.textSecondary }]}>
              Sight sees what other traders miss.{'\n'}Real-time AI analysis, smart trade targets, and market intelligence.
            </Text>
          </View>

          {/* Feature list */}
          <View style={styles.features}>
            {[
              { icon: 'psychology', text: 'AI Trading Signals', color: '#3B82F6' },
              { icon: 'show-chart', text: 'Real-Time Market Data', color: '#10B981' },
              { icon: 'notifications-active', text: 'Smart Price Alerts', color: '#F59E0B' },
            ].map((f, i) => (
              <View key={i} style={[styles.featureRow, { backgroundColor: t.surface, borderColor: t.border }]}>
                <View style={[styles.featureDot, { backgroundColor: f.color + '18' }]}>
                  <MaterialIcons name={f.icon as any} size={20} color={f.color} />
                </View>
                <Text style={[styles.featureText, { color: t.textPrimary }]}>{f.text}</Text>
                <MaterialIcons name="check-circle" size={18} color={f.color} />
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.ctaSection, { paddingBottom: insets.bottom + 20 }]}>
          {/* Session 173 — button rendered immediately with a short entering
              fade for polish. No 600ms delay before it becomes tappable. */}
          <Animated.View entering={FadeIn.duration(220)}>
            <TouchableOpacity activeOpacity={0.85} style={[styles.startBtn, { backgroundColor: t.primary }]} onPress={handleStart}>
              <Text style={styles.startBtnText}>Get Started</Text>
              <MaterialIcons name="arrow-forward" size={20} color="#FFF" />
            </TouchableOpacity>
          </Animated.View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center', maxWidth: 520, alignSelf: 'center', width: '100%' },
  // Session 113 #7 — blinking eye above the title. Sits inside the centered
  // content flow with a modest marginBottom so it reads as a clear brand
  // anchor without disrupting the existing text/button hierarchy.
  eyeSection: { alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  eyeLogo: { width: 72, height: 72 },
  // Header / brand row removed — spacing rebalanced via textSection.
  textSection: { alignItems: 'center', marginBottom: 40 },
  title: { fontSize: 34, fontWeight: '800', textAlign: 'center', lineHeight: 42, marginBottom: 14, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 },
  features: { gap: 10, width: '100%', maxWidth: 400 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  featureDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  featureText: { flex: 1, fontSize: 15, fontWeight: '600' },
  ctaSection: { paddingHorizontal: 28, maxWidth: 520, alignSelf: 'center', width: '100%' },
  startBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 56, borderRadius: 14, gap: 8 },
  startBtnText: { fontSize: 18, fontWeight: '700', color: '#FFF' },
});
