import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

// Session 213 — restored the fully-transparent Sight eye asset per user
// request. `launch-eye-transparent.png` has NO background whatsoever, so
// the eye renders on top of the container's #050B1F background as a
// clean floating mark. The previous `native-splash-eye.png` shipped
// with a subtle blue/dark background baked into the artwork which the
// user reported as visible during the launch handoff — using the
// transparent variant everywhere the eye is shown fixes that.
Image.prefetch(require('../assets/images/launch-eye-transparent.png')).catch(() => {});

/**
 * WelcomeLaunch — the EXISTING TradeSight AI welcome screen.
 *
 * ============================================================================
 * SAME SCREEN, NEW LOGO + ONE-TIME BLINK + TAP GUARD (Session 113 #9)
 * ============================================================================
 * Session 112 background: swapped in the new uploaded eye logo and added a
 * single, subtle eye blink synced to the reveal of "Tap anywhere to
 * continue".
 *
 * SESSION 113 UPDATE — tap timing guard:
 *   The user must NOT be able to tap through the launch screen before the
 *   "Tap anywhere to continue" prompt is actually visible. Once the prompt
 *   is fully visible (t≈1720ms), we wait an additional 1s and only THEN
 *   enable the tap interaction. Effective earliest tap = ~2720ms after
 *   the JS runtime starts rendering this screen. Prevents users from
 *   accidentally skipping the branded launch animation on fast devices.
 * ============================================================================
 */
export function WelcomeLaunch({ onTap, autoContinue = false, autoContinueDelay = 1500 }: { onTap: () => void; autoContinue?: boolean; autoContinueDelay?: number }) {
  const insets = useSafeAreaInsets();

  // Staggered fade-in flags for title/tagline. Tap hint is shown via a
  // separate opacity shared value synced with the blink.
  const [showTitle, setShowTitle] = useState(false);
  const [showTagline, setShowTagline] = useState(false);

  // Session 113 #9 — tap enable guard. Starts false; flips true 1s AFTER
  // the tap hint is fully visible (i.e., t≈2720ms after mount) so the
  // user cannot accidentally skip the launch animation on fast devices.
  const [canTap, setCanTap] = useState(false);

  // Session 186 — RESTORE the pre-Session-178 center-to-up eye movement.
  //
  // The intended splash sequence has the Sight eye start visually CENTERED
  // on the screen and then smoothly TRANSLATE UP to its final layout
  // position while the wordmark + tagline fade in below. Session 178
  // had removed this and left the eye pinned in-place (only blinking),
  // which is what the user reported as "only blinks now".
  //
  // Implementation: the eye's initial translateY offsets it downward
  // (visually centering it inside the SafeAreaView, since the wordmark
  // and tagline are opacity 0 initially but still reserve layout below
  // the eye). A single ~700ms withTiming animation then moves it back
  // to translateY 0 (its final layout position), synchronized with the
  // wordmark fade-in at 500ms so the movement and the reveal feel like
  // one coordinated motion. Uses a native-friendly transform, not a
  // layout mutation, and is skipped when Reduce Motion is enabled via
  // Reanimated's runtime respect for that setting on the transform.
  const eyeScaleY = useSharedValue(1);
  // Session 202 — CRITICAL: Eye starts at translateY(28) so its VISUAL
  // position is at exact screen center on first paint, matching the
  // native splash screen (which renders the eye centered at 96pt). The
  // welcomeCenter block includes wordmark + tagline below the eye that
  // reserve ~56pt of layout below (opacity 0 initially, still consumes
  // space). This 28pt offset compensates for that layout so the eye's
  // visual center = screen center at t=0. Then the animation lifts it
  // up (translateY → 0) while the wordmark fades in below, producing
  // the intended "eye starts centered, moves up, blinks, text pops up"
  // one-cohesive-launch sequence the user described.
  const eyeTranslateY = useSharedValue(28);

  // Session 207 — MUCH snappier splash. Timings collapsed so the whole
  // sequence completes in under 1s and tap becomes available ~1.3s
  // after mount (down from ~2.7s), eliminating the perceived "lag"
  // between the native splash and the app.
  //   • Eye lifts up   → 100ms delay, 400ms duration (ends at 500ms)
  //   • Sight wordmark → 250ms
  //   • Tagline        → 400ms
  //   • Blink          → 500ms (auto) / 600ms (tap)
  const blinkStartMs = autoContinue ? 500 : 600;

  useEffect(() => {
    // Session 207 — Faster eye lift so the handoff from native splash to
    // animated WelcomeLaunch feels seamless without a perceptible delay.
    // 100ms delay + 400ms duration → completes at 500ms.
    const eyeUpTimer = setTimeout(() => {
      eyeTranslateY.value = withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) });
    }, 100);
    const t1 = setTimeout(() => setShowTitle(true), 250);
    const t2 = setTimeout(() => setShowTagline(true), 400);

    // Single blink starts at 1400ms.
    // Sequence: close (120ms ease-in) → open (180ms ease-out).
    const blinkTimer = setTimeout(() => {
      eyeScaleY.value = withSequence(
        withTiming(0.05, { duration: 120, easing: Easing.in(Easing.quad) }),
        withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
      );
      // In auto mode we skip the tap-hint reveal entirely — the splash
      // dismisses itself via autoContinueDelay.
      if (autoContinue) return;
      // Session 207 — Faster tap-hint reveal. Fade begins immediately
      // after the blink starts and completes in 150ms. Tap is enabled
      // 300ms after full visibility for a total splash time of ~1.05s.
      const revealTimer = setTimeout(() => {
        tapHintOpacity.value = withTiming(1, {
          duration: 150,
          easing: Easing.out(Easing.cubic),
        });
        const enableTapTimer = setTimeout(() => {
          setCanTap(true);
        }, 150 + 300);
        // Start the wiggle loop 400ms after the hint fully appears.
        const wiggleTimer = setTimeout(() => {
          tapHintTranslateX.value = withRepeat(
            withSequence(
              withTiming(-3, { duration: 150, easing: Easing.inOut(Easing.ease) }),
              withTiming(3, { duration: 150, easing: Easing.inOut(Easing.ease) }),
              withTiming(-2, { duration: 120, easing: Easing.inOut(Easing.ease) }),
              withTiming(2, { duration: 120, easing: Easing.inOut(Easing.ease) }),
              withTiming(0, { duration: 100, easing: Easing.inOut(Easing.ease) }),
              withTiming(0, { duration: 1500 }),
            ),
            -1,
            false,
          );
        }, 400);
        (revealTimer as any)._wiggle = wiggleTimer;
        (revealTimer as any)._enableTap = enableTapTimer;
      }, 120);
      (blinkTimer as any)._reveal = revealTimer;
    }, blinkStartMs);

    return () => {
      clearTimeout(eyeUpTimer);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(blinkTimer);
      const r = (blinkTimer as any)._reveal;
      if (r) clearTimeout(r);
      const w = r && (r as any)._wiggle;
      if (w) clearTimeout(w);
      const et = r && (r as any)._enableTap;
      if (et) clearTimeout(et);
    };
  }, [autoContinue, blinkStartMs]);

  // Title + tagline drift-up fade — identical shared values to prior version.
  const titleOpacity = useSharedValue(0);
  const titleTranslateY = useSharedValue(8);
  const taglineOpacity = useSharedValue(0);
  const taglineTranslateY = useSharedValue(8);
  const tapHintOpacity = useSharedValue(0);
  const tapHintTranslateX = useSharedValue(0);

  useEffect(() => {
    if (showTitle) {
      // Session 158 — eye's upward animation now fires independently in
      // the main setup effect above (eyeUpTimer). Here we only fade in
      // the delayed wordmark so the eye is never gated on the text.
      titleOpacity.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) });
      titleTranslateY.value = withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) });
    }
  }, [showTitle]);
  useEffect(() => {
    if (showTagline) {
      taglineOpacity.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) });
      taglineTranslateY.value = withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) });
    }
  }, [showTagline]);

  const titleAnimStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleTranslateY.value }],
  }));
  const taglineAnimStyle = useAnimatedStyle(() => ({
    opacity: taglineOpacity.value,
    transform: [{ translateY: taglineTranslateY.value }],
  }));
  const tapHintAnimStyle = useAnimatedStyle(() => ({
    opacity: tapHintOpacity.value,
    transform: [{ translateX: tapHintTranslateX.value }],
  }));
  const eyeAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: eyeTranslateY.value }, { scaleY: eyeScaleY.value }],
  }));

  const handleTap = () => {
    // Session 113 #9 — no-op until the tap hint is fully visible + 1s buffer.
    // Prevents the user from accidentally skipping the launch animation on
    // fast devices where the first render happens in < 200ms.
    if (!canTap) return;
    Haptics.selectionAsync();
    onTap();
  };

  // Session 141 — auto-continue mode for every subsequent app open (after
  // the very first tap-through). Fires onTap after `autoContinueDelay`ms so
  // the branded animation still plays but no user tap is required. Guards
  // against firing twice or after unmount.
  //
  // Session 207 — auto-continue min lowered from 1100ms to 700ms so the
  // splash dismisses quickly on subsequent app opens.
  useEffect(() => {
    if (!autoContinue) return;
    const fired = { current: false };
    const effectiveDelay = Math.max(700, autoContinueDelay);
    const timer = setTimeout(() => {
      if (fired.current) return;
      fired.current = true;
      try { onTap(); } catch {}
    }, effectiveDelay);
    return () => { clearTimeout(timer); };
  }, [autoContinue, autoContinueDelay, onTap]);

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <Pressable style={styles.welcomeContent} onPress={handleTap}>
          <View style={styles.welcomeCenter}>
            <Animated.View style={[styles.eyeWrap, eyeAnimStyle]}>
              <Image
                source={require('../assets/images/launch-eye-transparent.png')}
                style={styles.starLogo}
                contentFit="contain"
                cachePolicy="memory-disk"
                priority="high"
              />
            </Animated.View>
            <Animated.Text style={[styles.appTitle, titleAnimStyle]}>Sight</Animated.Text>
            {/* Session 149 — The Future of Trading tagline is shown ONLY on
                the tap-to-continue splash (autoContinue === false). On the
                automated post-first-install opens we keep the splash minimal
                so it dismisses cleanly. */}
            {!autoContinue ? (
              <Animated.Text style={[styles.tagline, taglineAnimStyle]}>The Future of Trading</Animated.Text>
            ) : null}
          </View>
          <Animated.Text
            style={[styles.tapHint, { bottom: insets.bottom + 40 }, tapHintAnimStyle]}
          >
            {autoContinue ? '' : 'Tap anywhere to continue'}
          </Animated.Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Session 172/186 — background MUST match the native splash background
  // configured in app.json (#050B1F) so the handoff from native splash
  // to this animated launch is visually seamless with zero color flash.
  // This is the ORIGINAL working background color; Session 186 keeps it.
  container: { flex: 1, backgroundColor: '#050B1F' },
  safeArea: { flex: 1 },
  welcomeContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  welcomeCenter: { alignItems: 'center' },
  // eyeWrap host lets the scaleY animation drive only the eye image without
  // affecting the layout of the title/tagline below. Session 156 — the gap
  // between the visible eye and the "Sight" wordmark has been tightened
  // further so the two feel like one brand mark rather than two separate
  // pieces. -24 pulls the wordmark closer to the actual eye bottom.
  eyeWrap: { width: 96, height: 96, marginBottom: -24, alignItems: 'center', justifyContent: 'center' },
  starLogo: { width: 96, height: 96 },
  appTitle: { fontSize: 42, fontWeight: '800', color: '#3B82F6', letterSpacing: -1, marginBottom: 14, marginTop: 0 },
  tagline: { fontSize: 18, color: '#E5E7EB', fontWeight: '400', height: 24 },
  tapHint: { position: 'absolute', fontSize: 14, color: 'rgba(255,255,255,0.45)', fontWeight: '500' },
});
