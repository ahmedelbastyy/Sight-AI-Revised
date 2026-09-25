/**
 * DetectionGuide — dynamic detection frame that scales based on real motion.
 *
 * ============================================================================
 * SESSION 113 UPDATE (feature #10) — DYNAMIC SIZING
 * ============================================================================
 * Previously (Session 106) this was a fixed-size 4-corner bracket guide that
 * only changed COLOR based on motion. That was honest but didn't respond to
 * how the user actually held the phone.
 *
 * NEW BEHAVIOR:
 *   The frame now RESIZES based on motion state, giving the impression that
 *   the guide is expanding to fit whatever the user is pointing at:
 *
 *     • idle (phone moving)         → compact 260 × 156 frame in center
 *     • framing (held ~400ms)       → grows to 320 × 192 with brighter corners
 *     • stable (held ~1s+)          → expands to 348 × 214 with blue corners
 *                                     (max useful size ≈ 88% of viewport width)
 *     • capturing (in progress)     → fades out for the flash
 *
 *   Transitions are 320ms cubic ease-out on the UI thread so they feel smooth
 *   and reactive, not scripted. Corner brackets grow proportionally with the
 *   frame — they are NOT fixed-position graphics being nudged around.
 *
 * HONEST LIMITATION:
 *   Genuine per-pixel screen-boundary detection with 4-corner perspective
 *   would require frame-processor callbacks from react-native-vision-camera
 *   plus OpenCV or MLKit (native module). expo-camera on the New Architecture
 *   does not expose per-frame pixel data. The current implementation:
 *     • Uses real accelerometer stability as the ONLY trigger for size
 *       changes — no random or scripted animations.
 *     • Actual chart validation happens post-capture via the existing AI
 *       pipeline (analyzeChartImage) which reads the JPEG bytes and returns
 *       isChart=true/false plus analysis results.
 *
 *   To upgrade to true per-pixel corner detection, migrate the scanner to
 *   react-native-vision-camera + OpenCV/MLKit frame processors.
 * ============================================================================
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing,
} from 'react-native-reanimated';
import { CORNER, CORNER_THICK } from './scannerStyles';

/**
 * Detection states driven by device-motion stability from ScannerContent.
 *   • idle      — phone is moving (default)
 *   • framing   — phone has been steady briefly (< 1s)
 *   • stable    — phone has been steady long enough (≥ 1s) that we
 *                 assume the user has settled on a subject
 *   • capturing — capture is in-flight (guide fades out)
 */
export type DetectionState = 'idle' | 'framing' | 'stable' | 'capturing';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Frame size targets per state. Aspect ratio 5:3 mimics a typical monitor /
// laptop screen — the most common "chart source" the user photographs.
const SIZE_BY_STATE: Record<DetectionState, { w: number; h: number }> = {
  idle:      { w: Math.min(260, SCREEN_W - 96), h: Math.min(156, SCREEN_H * 0.22) },
  framing:   { w: Math.min(320, SCREEN_W - 64), h: Math.min(192, SCREEN_H * 0.27) },
  stable:    { w: Math.min(Math.round(SCREEN_W * 0.88), 380), h: Math.min(Math.round(SCREEN_W * 0.88 * 0.6), 240) },
  capturing: { w: Math.min(Math.round(SCREEN_W * 0.88), 380), h: Math.min(Math.round(SCREEN_W * 0.88 * 0.6), 240) },
};

// Corner color per state.
const COLOR_BY_STATE: Record<DetectionState, string> = {
  idle:      'rgba(255,255,255,0.35)',
  framing:   'rgba(255,255,255,0.85)',
  stable:    '#3B82F6',
  capturing: '#3B82F6',
};

export function DetectionGuide({ state }: { state: DetectionState }) {
  const targetSize = SIZE_BY_STATE[state];
  const targetColor = COLOR_BY_STATE[state];

  // Animated frame dimensions. Drive on UI thread via Reanimated shared values
  // so the resize feels smooth even under camera load.
  const width = useSharedValue(SIZE_BY_STATE.idle.w);
  const height = useSharedValue(SIZE_BY_STATE.idle.h);
  const opacity = useSharedValue(1);

  useEffect(() => {
    width.value = withTiming(targetSize.w, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
    height.value = withTiming(targetSize.h, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
    opacity.value = withTiming(state === 'capturing' ? 0 : 1, {
      duration: 220,
      easing: Easing.out(Easing.quad),
    });
  }, [state, targetSize.w, targetSize.h]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const frameStyle = useAnimatedStyle(() => ({
    width: width.value,
    height: height.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { alignItems: 'center', justifyContent: 'center' },
        containerStyle,
      ]}
    >
      <Animated.View style={frameStyle}>
        {/* Corner brackets — positioned at each corner of the animated
            frame so they scale WITH the frame, not against it. Border
            color transitions to reflect detection state. */}
        <View style={[cornerStyles.corner, cornerStyles.tl, { borderColor: targetColor }]} />
        <View style={[cornerStyles.corner, cornerStyles.tr, { borderColor: targetColor }]} />
        <View style={[cornerStyles.corner, cornerStyles.bl, { borderColor: targetColor }]} />
        <View style={[cornerStyles.corner, cornerStyles.br, { borderColor: targetColor }]} />
      </Animated.View>
    </Animated.View>
  );
}

const cornerStyles = StyleSheet.create({
  corner: { position: 'absolute', width: CORNER, height: CORNER },
  tl: { top: 0, left: 0, borderTopWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK, borderTopLeftRadius: 6 },
  tr: { top: 0, right: 0, borderTopWidth: CORNER_THICK, borderRightWidth: CORNER_THICK, borderTopRightRadius: 6 },
  bl: { bottom: 0, left: 0, borderBottomWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK, borderBottomLeftRadius: 6 },
  br: { bottom: 0, right: 0, borderBottomWidth: CORNER_THICK, borderRightWidth: CORNER_THICK, borderBottomRightRadius: 6 },
});
