import React, { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';

/**
 * Confetti — lightweight GPU-only celebratory particle burst.
 *
 * ============================================================================
 * Used on the welcome-pro screen after a successful subscription purchase.
 *
 * Perf: every particle drives translateY / translateX / rotate / opacity
 * through Reanimated shared values, which run on the UI thread and never
 * touch the JS bridge per frame. The whole component renders once with
 * `pointerEvents="none"` so it can't block the "Start Trading with Pro" tap
 * underneath.
 *
 * Cleanup: each particle fades to opacity 0 near the end of its fall and
 * stops. No infinite loops → no lingering CPU work after the animation.
 * ============================================================================
 */

// TradeSight-aligned celebratory palette
const COLORS = ['#FFD700', '#FF6B6B', '#4D96FF', '#6BCB77', '#9B59B6', '#F59E0B', '#EC4899'];

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

interface ParticleProps {
  delay: number;
  startX: number;
  color: string;
  size: number;
  duration: number;
  drift: number;
  rotationSpeed: number;
}

function Particle({ delay, startX, color, size, duration, drift, rotationSpeed }: ParticleProps) {
  const translateY = useSharedValue(-60);
  const translateX = useSharedValue(0);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    // Fade in quickly
    opacity.value = withDelay(delay, withTiming(1, { duration: 120 }));
    // Session 146 — pieces of confetti fall from the very top of the
    // screen straight through and off the bottom. They are NOT stopped
    // anywhere and do NOT fade out mid-fall — they simply exit the
    // bottom edge of the screen naturally.
    translateY.value = withDelay(
      delay,
      withTiming(SCREEN_H + 200, { duration, easing: Easing.in(Easing.quad) }),
    );
    // Horizontal drift for a natural, non-uniform fall
    translateX.value = withDelay(
      delay,
      withTiming(drift, { duration, easing: Easing.inOut(Easing.sin) }),
    );
    // Rotation as it falls
    rotate.value = withDelay(
      delay,
      withTiming(rotationSpeed, { duration, easing: Easing.linear }),
    );
    // no cleanup needed — Reanimated cancels running animations on unmount
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.particle,
        {
          left: startX,
          width: size,
          height: size * 0.42, // rectangle particles look more like real confetti
          backgroundColor: color,
          borderRadius: Math.max(1, size * 0.12),
        },
        animStyle,
      ]}
    />
  );
}

export function Confetti({ count = 40 }: { count?: number }) {
  // Randomize per-particle props ONCE per mount so re-renders don't reshuffle.
  // Session 167 — reduced default count 60 -> 40, delay range 400 -> 180ms,
  // and duration range 2600-4400ms -> 1600-2800ms so the celebration fires
  // and clears fast without lagging the JS thread. Each particle still runs
  // 100% on the UI thread via Reanimated shared values.
  const particles = useMemo(
    () =>
      Array.from({ length: count }).map(() => ({
        delay: Math.random() * 180,
        startX: Math.random() * SCREEN_W,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        size: 8 + Math.random() * 10,
        duration: 1600 + Math.random() * 1200,
        drift: (Math.random() - 0.5) * 240,
        rotationSpeed: (Math.random() - 0.5) * 720,
      })),
    [count],
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {particles.map((p, i) => (
        <Particle key={i} {...p} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  particle: {
    position: 'absolute',
    top: 0,
  },
});
