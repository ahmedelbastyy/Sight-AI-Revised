import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable,
  useWindowDimensions, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

// Pre-load assets used on this screen so they show immediately on cold
// launch. The login-bg.png candlestick backdrop is intentionally
// preserved — it grounds the hero in a real market context without
// requiring any live data.
Image.prefetch(require('../assets/images/app-logo.png')).catch(() => {});
Image.prefetch(require('../assets/images/login-bg.png')).catch(() => {});

// ---------------------------------------------------------------------------
// CleanEye — Session 177 rewrite
// ---------------------------------------------------------------------------
// Per user requirements: NO radial blur, NO circular halo, NO orbital rings,
// NO glow container of any kind. Just the plain white Sight eye rendered
// directly over the trading candlestick background. Any "premium" feel
// comes from the background gradient + typography, not from decorations
// around the eye itself.
// ---------------------------------------------------------------------------
// Session 213 — restored the fully-transparent Sight eye asset per user
// request. `launch-eye-transparent.png` has NO background baked into it,
// so the eye reads as a clean floating mark on top of the candlestick
// login background. The previous `native-splash-eye.png` had a subtle
// blue/dark surround baked in, which the user reported as ugly against
// the login backdrop.
function CleanEye({ size }: { size: number }) {
  return (
    <Image
      source={require('../assets/images/launch-eye-transparent.png')}
      style={{ width: size, height: size }}
      contentFit="contain"
      cachePolicy="memory-disk"
      priority="high"
    />
  );
}

// ---------------------------------------------------------------------------
// Login / sign-up entry screen — Session 177 hero cleanup
// ---------------------------------------------------------------------------
// Per user requirement: the blurred/radial/circular halo around the Sight
// eye has been completely removed. The eye now sits directly over the
// candlestick trading background with NO circle, orbit, ring, radial blue
// blur, or circular container of any kind.
//
// Composition:
//   • Plain white Sight eye over the trading background
//   • Small uppercase SIGHT wordmark with restrained tracking
//   • One strong white headline with a single blue-accented emphasis word
//   • One short honest secondary line describing what Sight actually does
//   • The existing candlestick background image is preserved
//   • All navigation, CTA copy, legal links, layout constraints preserved
// ---------------------------------------------------------------------------
export default function LoginEntryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: winW, height: winH } = useWindowDimensions();

  // Respect Reduce Motion for the CTA entrance animations. There are no
  // continuously running animations any more so the flag only affects the
  // one-time FadeInDown / FadeIn entrance transitions.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => (sub as any)?.remove?.();
  }, []);

  const isShort = winH < 700;
  const isTall = winH >= 820;

  // Session 183 — Eye enlarged an additional ~17% per user request. New
  // sizes are 90/108/122 (from 77/93/104), delivering a noticeably larger
  // hero without upscaling from a low-res bitmap. The asset itself is the
  // full-resolution transparent Sight eye (assets/images/app-logo.png)
  // rendered at even integer sizes with contentFit="contain" so aspect
  // ratio is preserved and edges stay crisp. No blur, no glow, no circle,
  // no shadow. tintColor forces pure white regardless of the underlying
  // artwork so the eye reads as a clean high-contrast mark against the
  // candlestick backdrop.
  const eyeSize = isShort ? 90 : isTall ? 122 : 108;
  const headlineFont = isShort ? 28 : isTall ? 36 : 32;
  const subFont = isShort ? 13 : 14;

  // Navigation handlers — PRESERVED exactly from previous version.
  // router.replace so /login is removed from the stack before /auth, so
  // any router.back() from /auth cannot land on /login.
  const handleSignUp = () => {
    Haptics.selectionAsync();
    router.replace({ pathname: '/auth', params: { mode: 'signup' } });
  };
  const handleLogin = () => {
    Haptics.selectionAsync();
    router.replace({ pathname: '/auth', params: { mode: 'login' } });
  };

  return (
    <View style={styles.container}>
      {/* Existing chart/candlestick background — intentionally preserved */}
      <Image
        source={require('../assets/images/login-bg.png')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient
        colors={['rgba(10,14,23,0.42)', 'rgba(10,14,23,0.78)', 'rgba(10,14,23,0.94)', 'rgba(10,14,23,0.98)']}
        locations={[0, 0.4, 0.72, 1]}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        {/* HERO — Session 209: eye logo RESTORED per user request. The
            plain white Sight eye sits directly over the candlestick
            background (no circle, glow, or halo), immediately above the
            headline block. Uses the higher-resolution native-splash-eye
            asset via CleanEye's tintColor override so edges stay crisp. */}
        <View style={styles.heroSection}>
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(500).delay(200)}
            style={styles.eyeWrap}
          >
            <CleanEye size={eyeSize} />
          </Animated.View>
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(520).delay(300)}
            style={styles.headlineWrap}
          >
            <Text
              style={[styles.headline, {
                fontSize: headlineFont,
                lineHeight: Math.round(headlineFont * 1.14),
              }]}
              accessibilityRole="header"
              accessibilityLabel="See the Market More Clearly"
            >
              See the Market{'\n'}
              <Text style={styles.headlineAccent}>More Clearly</Text>
            </Text>
            <Text style={[styles.subheadline, { fontSize: subFont }]}>
              AI-powered market intelligence for smarter research and trading decisions.
            </Text>
          </Animated.View>
        </View>
        {/* eyeSize / CleanEye retained above solely as parked references to
            keep unused-import warnings quiet; the eye is no longer rendered. */}

        {/* CTA — layout preserved exactly. Sign Up, I have an account,
            Privacy Policy, Terms of Use. Navigation handlers preserved
            (router.replace to /auth?mode=signup and mode=login). */}
        <Animated.View
          entering={reduceMotion ? undefined : FadeInDown.duration(420).delay(420)}
          style={[styles.ctaSection, { paddingBottom: insets.bottom + 16 }]}
        >
          <Pressable style={styles.signUpBtn} onPress={handleSignUp}>
            <LinearGradient
              colors={['#3B82F6', '#2563EB']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={styles.signUpGradient}
            >
              <Text style={styles.signUpText}>Sign Up</Text>
              <MaterialIcons name="arrow-forward" size={20} color="#FFF" />
            </LinearGradient>
          </Pressable>

          <Pressable style={styles.loginBtn} onPress={handleLogin}>
            <Text style={styles.loginText}>I have an account</Text>
          </Pressable>

          <View style={styles.legalRow}>
            <Pressable onPress={() => router.push('/privacy')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </Pressable>
            <View style={styles.legalDot} />
            <Pressable onPress={() => router.push('/terms')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.legalLink}>Terms of Use</Text>
            </Pressable>
          </View>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0E17' },
  safeArea: { flex: 1, justifyContent: 'space-between' },
  heroSection: {
    flex: 1,
    // Session 183 — paddingTop increased back to 96 per user request to
    // move the eye+headline block DOWN toward the CTA. Combined with the
    // ~17% larger eye above and the reduced eyeWrap.marginBottom below,
    // the eye now sits lower on the page AND closer to the headline as
    // required, with the Sign Up / I have an account buttons still
    // anchored to the bottom via ctaSection's paddingBottom.
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 96,
    // iPad / large screen constraint — hero + CTA stay a centered column
    // while the candlestick background continues to fill the display.
    maxWidth: 520,
    alignSelf: 'center',
    width: '100%',
  },
  eyeWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    // Session 183 — marginBottom reduced 32 → 22 so the (now ~17%
    // larger) eye sits closer to the headline, matching the user's
    // "move the Sight eye farther DOWN toward the headline" spec while
    // still leaving comfortable breathing room. The extra vertical
    // space vacated by this reduction is absorbed by the increased
    // heroSection.paddingTop above.
    marginBottom: 22,
  },
  headlineWrap: {
    alignItems: 'center',
    maxWidth: 460,
    width: '100%',
  },
  headline: {
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  headlineAccent: {
    color: '#60A5FA',
  },
  subheadline: {
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
    fontWeight: '400',
    marginTop: 16,
  },
  ctaSection: {
    paddingHorizontal: 28,
    maxWidth: 520,
    alignSelf: 'center',
    width: '100%',
  },
  signUpBtn: { borderRadius: 14, overflow: 'hidden', marginBottom: 12 },
  signUpGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 56, gap: 8,
  },
  signUpText: { fontSize: 18, fontWeight: '700', color: '#FFF' },
  loginBtn: {
    height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  loginText: { fontSize: 16, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  legalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, marginTop: 20,
  },
  legalLink: { fontSize: 12, color: '#6B7280' },
  legalDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#4B5563' },
});
