/**
 * AnimatedNumber — Odometer-style number transition with animated text color.
 *
 * Renders a formatted numeric value where each individual digit is a vertical
 * strip of 0-9 characters. When the digit changes, the strip smoothly
 * translates on the UI thread (via Reanimated shared values) to reveal the
 * new digit — producing a premium rolling/flipping odometer effect.
 *
 * Design notes:
 *  - Only digits animate. `$`, commas, decimal point, and any other
 *    separators are rendered as plain <Text> so they never shift.
 *  - Uses `fontVariant: ['tabular-nums']` so every digit has the same width
 *    (prevents layout jitter as the value changes).
 *  - Rapid updates are handled by `cancelAnimation` + `withTiming` to the
 *    new target — the digit always ends at the correct value, no matter how
 *    many updates come in.
 *  - Animation is entirely on the UI thread (Reanimated shared values +
 *    animatedStyle) so it never competes with scroll/tap gestures.
 *  - Runs at native 60fps with zero JS-thread cost per frame.
 *  - When `animatedTextStyle` is provided, every Text element is rendered
 *    with Animated.Text and receives that style — used by
 *    AnimatedPortfolioValue to flash the entire number green (up) or red
 *    (down) on the UI thread without any background/overlay effect.
 */
import React, { useEffect, useMemo, useRef, memo, useState } from 'react';
import { View, TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  interpolateColor,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';

interface AnimatedNumberProps {
  /** Numeric value to display. Non-finite values are treated as 0. */
  value: number;
  /** Text prepended before the number (e.g. "$"). Static — never animates. */
  prefix?: string;
  /** Text appended after the number (e.g. "%"). Static — never animates. */
  suffix?: string;
  /** Number of fraction digits (default 2). */
  decimals?: number;
  /** Text style — fontSize / fontWeight / color / letterSpacing. */
  style?: TextStyle;
  /** Roll duration per digit in ms (default 550). */
  duration?: number;
  /**
   * Optional animated style produced by `useAnimatedStyle`. When provided,
   * it is applied to every rendered Text element (digits, prefix, suffix,
   * commas, decimal point). Intended for animating the text COLOR on the
   * UI thread — e.g. flashing the whole number green when portfolio value
   * goes up. Does not affect the digit rolling animation.
   */
  animatedTextStyle?: any;
}

// One column showing a single digit. Renders a vertical strip of 0-9 stacked
// and translates it so the target digit is visible in the clipped viewport.
const DigitColumn = memo(function DigitColumn({
  digit,
  digitHeight,
  digitWidth,
  textStyle,
  duration,
  animatedTextStyle,
}: {
  digit: number;
  digitHeight: number;
  digitWidth: number;
  textStyle: TextStyle;
  duration: number;
  animatedTextStyle?: any;
}) {
  const translateY = useSharedValue(-digit * digitHeight);
  const prevDigit = useRef(digit);

  useEffect(() => {
    if (prevDigit.current === digit) return;
    // Cancel any in-flight animation and roll to the new target. This
    // guarantees the digit always ends at the correct value even if the
    // portfolio value updates multiple times in quick succession — the
    // animation always converges on the latest target rather than queueing
    // stale animations.
    cancelAnimation(translateY);
    translateY.value = withTiming(-digit * digitHeight, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
    prevDigit.current = digit;
  }, [digit, digitHeight, duration]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <View style={{ height: digitHeight, width: digitWidth, overflow: 'hidden' }}>
      <Animated.View style={animStyle}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <Animated.Text
            key={n}
            allowFontScaling={false}
            style={[
              textStyle,
              {
                height: digitHeight,
                lineHeight: digitHeight,
                width: digitWidth,
                textAlign: 'center',
                includeFontPadding: false,
                fontVariant: ['tabular-nums'],
              },
              animatedTextStyle,
            ]}
          >
            {n}
          </Animated.Text>
        ))}
      </Animated.View>
    </View>
  );
});

export const AnimatedNumber = memo(function AnimatedNumber({
  value,
  prefix = '',
  suffix = '',
  decimals = 2,
  style,
  duration = 550,
  animatedTextStyle,
}: AnimatedNumberProps) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const isNegative = safeValue < 0;

  const formatted = useMemo(
    () =>
      Math.abs(safeValue).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    [safeValue, decimals],
  );

  // Derive digit box dimensions from the fontSize. tabular-nums keeps each
  // digit the same width across the font, so a fixed proportional width
  // produces perfect alignment with no visible gap or overlap.
  const fontSize = (style?.fontSize as number) ?? 32;
  const digitHeight = Math.round(fontSize * 1.15);
  const digitWidth = Math.round(fontSize * 0.6);

  const textStyle: TextStyle = {
    fontSize,
    fontWeight: (style?.fontWeight as TextStyle['fontWeight']) ?? '700',
    color: (style?.color as string) ?? '#FFFFFF',
  };

  const staticTextStyle: TextStyle = {
    ...textStyle,
    height: digitHeight,
    lineHeight: digitHeight,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  };

  const chars = useMemo(() => Array.from(formatted), [formatted]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: digitHeight, alignSelf: 'flex-start' }}>
      {isNegative ? (
        <Animated.Text allowFontScaling={false} style={[staticTextStyle, animatedTextStyle]}>
          -
        </Animated.Text>
      ) : null}
      {prefix ? (
        <Animated.Text allowFontScaling={false} style={[staticTextStyle, animatedTextStyle]}>
          {prefix}
        </Animated.Text>
      ) : null}
      {chars.map((c, i) => {
        if (c >= '0' && c <= '9') {
          return (
            // Key includes length so a magnitude change ($9,999 → $10,000)
            // cleanly re-mounts the row rather than trying to animate through
            // an ambiguous digit-shift. This is a rare edge case in portfolio
            // values; the common case (small change) animates smoothly.
            <DigitColumn
              key={`d${i}-${chars.length}`}
              digit={parseInt(c, 10)}
              digitHeight={digitHeight}
              digitWidth={digitWidth}
              textStyle={textStyle}
              duration={duration}
              animatedTextStyle={animatedTextStyle}
            />
          );
        }
        return (
          <Animated.Text
            key={`s${i}-${c}`}
            allowFontScaling={false}
            style={[staticTextStyle, animatedTextStyle]}
          >
            {c}
          </Animated.Text>
        );
      })}
      {suffix ? (
        <Animated.Text allowFontScaling={false} style={[staticTextStyle, animatedTextStyle]}>
          {suffix}
        </Animated.Text>
      ) : null}
    </View>
  );
});

/**
 * AnimatedPortfolioValue — AnimatedNumber wrapper that briefly changes the
 * TEXT COLOR on value changes.
 *
 * ============================================================================
 * SESSION 114 #2 — text-only up/down color feedback (no background glow)
 * ============================================================================
 * The digit-rolling odometer from AnimatedNumber is preserved verbatim.
 * On top of it, this wrapper animates the color of the ACTUAL DIGITS:
 *   - Value goes UP   → digits fade to green then back to original color
 *   - Value goes DOWN → digits fade to red then back to original color
 *   - Value unchanged → digits stay in original color (no animation fired)
 *   - Micro-fluctuations (< $0.005) are ignored to avoid flicker
 *
 * There is NO background overlay, NO tinted box behind the number, and NO
 * shadow/glow on the wrapping view. Only the text itself changes color.
 *
 * Everything runs on the UI thread via a Reanimated shared value +
 * `interpolateColor` inside `useAnimatedStyle`. Portfolio value calculations
 * in the parent screen are completely independent of this display logic.
 * ============================================================================
 */
export const AnimatedPortfolioValue = memo(function AnimatedPortfolioValue(
  props: AnimatedNumberProps,
) {
  const prevValueRef = useRef<number>(Number.isFinite(props.value) ? props.value : 0);
  const colorProgress = useSharedValue(0); // -1 = down (red), 0 = neutral, 1 = up (green)
  const [initialized, setInitialized] = useState(false);
  // Session 208 — track whether we've ever seen a real (non-zero)
  // portfolio value. The initial 0 -> real-value transition is treated
  // as data hydration, NOT a real gain — so we never flash green when
  // the user first opens the app and the portfolio finishes loading.
  const hasSeenRealValueRef = useRef<boolean>(false);
  // Session 208 — grace window: for the first 1500ms after mount we
  // suppress ALL color flashes so that any late-arriving hydration
  // updates (broker sync, live quotes, cost basis recompute) can't
  // trigger a false gain/loss flash while the app is settling.
  const mountTimeRef = useRef<number>(Date.now());
  const originalColor = (props.style?.color as string) ?? '#FFFFFF';

  useEffect(() => {
    const currentValue = Number.isFinite(props.value) ? props.value : 0;
    // Skip the very first render — don't flash on initial mount.
    if (!initialized) {
      prevValueRef.current = currentValue;
      if (Math.abs(currentValue) > 0.005) hasSeenRealValueRef.current = true;
      setInitialized(true);
      return;
    }
    const delta = currentValue - prevValueRef.current;
    // Ignore micro-fluctuations to avoid flicker on rounding noise.
    if (Math.abs(delta) < 0.005) return;

    // Session 208 — First real (non-zero) value we've ever seen. This is
    // the async hydration from broker sync / stock quotes / cost basis
    // computation completing, NOT a real portfolio change. Latch the
    // ref, update prev, and return without flashing.
    if (!hasSeenRealValueRef.current) {
      hasSeenRealValueRef.current = true;
      prevValueRef.current = currentValue;
      return;
    }

    // Session 208 — Global grace window: skip flashes for the first
    // 1500ms after mount to cover any additional hydration ripples.
    if (Date.now() - mountTimeRef.current < 1500) {
      prevValueRef.current = currentValue;
      return;
    }

    prevValueRef.current = currentValue;

    const target = delta > 0 ? 1 : -1;
    // Fade to target color quickly (200ms), hold briefly, then fade back to
    // the original color over ~700ms for a subtle, polished flash.
    colorProgress.value = withSequence(
      withTiming(target, { duration: 220, easing: Easing.out(Easing.quad) }),
      withDelay(650, withTiming(0, { duration: 700, easing: Easing.in(Easing.quad) })),
    );
  }, [props.value, initialized]);

  const animatedTextStyle = useAnimatedStyle(() => {
    const color = interpolateColor(
      colorProgress.value,
      [-1, 0, 1],
      ['#EF4444', originalColor, '#10B981'],
    );
    return { color };
  });

  return <AnimatedNumber {...props} animatedTextStyle={animatedTextStyle} />;
});
