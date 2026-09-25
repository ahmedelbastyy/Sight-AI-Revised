/**
 * ScannerContent — live-camera scanner with HONEST manual capture only.
 *
 * ============================================================================
 * SESSION 110 — REMOVED FALSE MOTION-BASED AUTO-CAPTURE
 * ============================================================================
 * WHY THIS CHANGED:
 *   The previous implementation auto-captured whenever the phone was held
 *   steady for ~1.4s — regardless of what the camera was pointing at. That
 *   produced false captures when the user aimed at anything static: a black
 *   wall, a desk, a book, a laptop lid, etc. Motion-only "detection" is
 *   NOT chart detection.
 *
 * WHAT'S REMOVED:
 *   - Auto-capture triggered by motion stability (STABLE_MS state)
 *   - Auto-paywall triggered by motion stability for Free users
 *   - needsMotionRef / PAYWALL_COOLDOWN_MS — no longer needed
 *   - Any timer-based capture path that could fire without a valid chart
 *
 * WHAT REMAINS (honest signals only):
 *   - Live camera preview for both Free and Pro users
 *   - Positioning guide whose COLOR reflects real device-motion stability
 *     from expo-sensors accelerometer:
 *       idle (moving)    -> dim white  (RGBA 0.35)
 *       framing (steady) -> bright white (RGBA 0.85)
 *       stable (long steady) -> blue + expanded frame (Session 113 #10)
 *     Motion NEVER triggers capture or paywall on its own.
 *   - Manual capture button:
 *       Pro user tap  -> capture -> compress -> analyzeChartImage()
 *         The AI pipeline validates whether it's actually a chart and
 *         returns isChart=true/false plus analysis results.
 *       Free user tap -> route to /subscription
 *
 * ============================================================================
 * SESSION 113 UPDATE (feature #10) — DYNAMIC FRAME SIZING
 * ============================================================================
 * DetectionState is now escalated on TWO stability thresholds:
 *   - FRAMING_MS (400ms steady)  -> 'framing' state, brighter corners
 *   - STABLE_MS  (1000ms steady) -> 'stable' state, expanded frame
 *
 * DetectionGuide reads the state and animates the frame's width/height
 * on the UI thread, giving the impression that the guide is finding and
 * fitting to whatever the user is pointing at. Corner brackets scale WITH
 * the frame — they are NOT fixed graphics being nudged around.
 *
 * HONEST LIMITATION:
 *   True per-pixel screen-boundary detection with 4-corner perspective
 *   requires react-native-vision-camera + OpenCV/MLKit frame processors
 *   (native module). expo-camera on the New Architecture does not expose
 *   per-frame pixel data. Post-capture chart validation still runs
 *   through the existing analyzeChartImage AI pipeline.
 * ============================================================================
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useApp } from '../../contexts/AppContext';
import { useAlert } from '@/template';
import { DetectionGuide, DetectionState } from './DetectionFrame';
import { CaptureButton } from './CaptureButton';
import { PermissionRequestView } from './PermissionRequest';
import { AnalysisResultView } from './AnalysisResult';
import { scannerStyles as styles } from './scannerStyles';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestReviewForScan } from '../../services/storeReviewService';

// Motion thresholds — for VISUAL feedback only.
// Values are deviations from 1G gravity magnitude, measured by expo-sensors
// accelerometer at 10Hz.
const STABILITY_THRESHOLD = 0.025;   // below -> phone is steady
const INSTABILITY_THRESHOLD = 0.05;  // above -> phone is moving
const FRAMING_MS = 400;              // steady this long -> brighten corners
// Session 113 #10 — STABLE_MS: after this long continuously steady,
// escalate DetectionState to 'stable' which drives DetectionGuide to its
// largest ("detected") size and blue-corner color.
const STABLE_MS = 1000;

// Lazy-load image processing helpers inside handlers so anyone who never
// captures doesn't pay the cost.
async function compressImage(uri: string): Promise<string> {
  try {
    const IM = await import('expo-image-manipulator');
    const manipulated = await IM.manipulateAsync(
      uri,
      [{ resize: { width: 1400 } }],
      { compress: 0.72, format: IM.SaveFormat.JPEG, base64: true },
    );
    return manipulated.base64 || '';
  } catch {
    const FS = await import('expo-file-system');
    return await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
  }
}

export function ScannerContent({
  cameraMod,
  tabVisible,
  insets,
}: {
  cameraMod: any;
  tabVisible: boolean;
  insets: any;
}) {
  const [permission, requestPermission] = cameraMod.useCameraPermissions();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { isSubscribed, currentTheme: t, analyzeChartImage } = useApp();
  const cameraRef = useRef<any>(null);

  const [torch, setTorch] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [detectionState, setDetectionState] = useState<DetectionState>('idle');
  const processingRef = useRef(false);
  const stableSinceRef = useRef<number | null>(null);
  // Session 187 — Each shutter press generates a unique scanId. When the
  // analysis completes successfully we hand that ID to
  // requestReviewForScan(); it dedupes internally so subsequent re-renders
  // of the result screen for the same scan cannot produce a second
  // StoreKit request.
  const currentScanIdRef = useRef<string | null>(null);

  const CameraView = cameraMod.CameraView;

  const cameraShouldRender =
    tabVisible && !capturedUri && !analyzing && permission?.granted === true;

  // Reset visual state whenever the camera goes off-screen.
  useEffect(() => {
    if (!cameraShouldRender) {
      setDetectionState('idle');
      stableSinceRef.current = null;
    }
  }, [cameraShouldRender]);

  // Single choke point for Free -> paywall.
  const handleFreeGate = useCallback(() => {
    Haptics.selectionAsync();
    router.push('/subscription');
  }, [router]);

  const handleProCapture = useCallback(async () => {
    if (!cameraRef.current || processingRef.current) return;
    processingRef.current = true;
    const shutterPressedAt = performance.now();
    if (__DEV__) console.log('[perf scanner]', shutterPressedAt.toFixed(0), 'ms shutter-pressed');
    // Session 195 — Generate a unique scanId at shutter press. This scanId
    // is the dedup key for the App Store review request AND for any future
    // per-scan analytics. Each ACCEPTED shutter press generates one and
    // only one scanId. The review request itself no longer fires here —
    // it fires only AFTER a valid image is verified and the post-capture
    // UI has settled (see the block after the RAF yield below), per the
    // release spec: every SUCCESSFUL photo capture creates exactly one
    // eligible native review-request opportunity. Failed / cancelled
    // captures never produce a StoreKit call.
    const scanId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    currentScanIdRef.current = scanId;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDetectionState('capturing');
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, skipProcessing: false });
      if (!photo?.uri) throw new Error('Capture failed. Please try again.');
      const captureReturnedAt = performance.now();
      if (__DEV__) console.log('[perf scanner]', captureReturnedAt.toFixed(0), 'ms capture-returned (', (captureReturnedAt - shutterPressedAt).toFixed(0), 'ms after shutter)');
      // Session 182 — INSTANT transition to analyzing UI. As soon as the
      // local photo URI exists we commit the state that shows the
      // analyzing screen. Everything after this point (compression, base64,
      // AI request) runs while the analyzing UI is ALREADY visible.
      setCapturedUri(photo.uri);
      setAnalyzing(true);
      if (__DEV__) console.log('[perf scanner]', performance.now().toFixed(0), 'ms analyzing-ui-committed');
      // Yield one animation frame so React actually paints the analyzing
      // screen BEFORE we start the CPU-heavy compress + base64 conversion
      // below. Without this yield, the JS thread stays busy inside the
      // same task and the paint of the analyzing UI is delayed until
      // compression completes — which is the visible bug the user
      // reported ("Camera stays visible while capture/upload happens").
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      // Session 195 — SUCCESSFUL-CAPTURE StoreKit review request.
      // ============================================================
      // Only fires once we have verified:
      //   1. photo.uri exists (a valid image was produced)
      //   2. capture callback completed (takePictureAsync resolved)
      //   3. the post-capture UI has been committed (setCapturedUri +
      //      setAnalyzing) and the RAF yield has flushed the next frame
      //      so the analyzing screen is actually on screen.
      // Fire-and-forget — never awaited, never delays the AI analysis
      // request that follows. Idempotent via scanId dedup inside
      // requestReviewForScan(), so a re-rendered result screen or a
      // duplicate capture callback can NEVER produce a second call for
      // the same physical shutter press. Apple's StoreKit
      // SKStoreReviewController owns whether the native sheet actually
      // appears; Sight only guarantees that one eligible request per
      // successful capture is issued. Failed / cancelled captures fall
      // through to the catch block below without ever reaching this
      // line, so they never invoke requestReview().
      if (__DEV__) console.log('[storeReview] successful capture -> firing review request scan=', scanId);
      requestReviewForScan(scanId).catch(() => {});
      const base64 = await compressImage(photo.uri);
      if (__DEV__) console.log('[perf scanner]', performance.now().toFixed(0), 'ms compression-done');
      const analysis = await analyzeChartImage(`data:image/jpeg;base64,${base64}`);
      if (__DEV__) console.log('[perf scanner]', performance.now().toFixed(0), 'ms analysis-done');
      if (analysis?.error && typeof analysis.error === 'string' && analysis.error.includes('exceeded')) {
        showAlert('Limit Reached', analysis.error);
        setResult({ isChart: false, error: analysis.error });
      } else {
        setResult(analysis);
        Haptics.notificationAsync(
          analysis?.isChart ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
        );
        // Session 195 — StoreKit review request was ALREADY fired at the
        // successful-capture point (right after the RAF yield above). It
        // is intentionally NOT called again here so Apple's rate limiter
        // sees exactly one review request per successful capture, no
        // matter how many result-screen re-renders occur.
      }
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to capture or analyze.';
      setResult({ isChart: false, error: msg });
      showAlert('Scan Error', msg);
    } finally {
      setAnalyzing(false);
      processingRef.current = false;
    }
  }, [analyzeChartImage, showAlert]);

  // Motion subscription — VISUAL FEEDBACK ONLY.
  // Updates detectionState between 'idle', 'framing', and 'stable' based on
  // real accelerometer readings. NEVER triggers capture or navigation.
  // Capture requires an explicit tap on the CaptureButton.
  useEffect(() => {
    if (!cameraShouldRender) return;

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    // Small delay lets the camera preview settle before we start sampling.
    const startTimer = setTimeout(async () => {
      try {
        const { subscribeMotion, motionDeviation } = await import('../../services/motionService');
        if (cancelled) return;

        unsubscribe = subscribeMotion((sample) => {
          if (processingRef.current) return;

          const dev = motionDeviation(sample);
          const now = Date.now();

          // Genuine motion -> reset to idle
          if (dev > INSTABILITY_THRESHOLD) {
            stableSinceRef.current = null;
            setDetectionState((prev) => (prev === 'idle' ? prev : 'idle'));
            return;
          }

          // Steady -> brighten corners after brief settling period, then
          // expand frame to 'stable' size after longer settling.
          if (dev < STABILITY_THRESHOLD) {
            if (stableSinceRef.current == null) {
              stableSinceRef.current = now;
            }
            const steadyMs = now - stableSinceRef.current;
            if (steadyMs >= STABLE_MS) {
              // Session 113 #10 — long steady -> DetectionGuide expands
              // the frame to its largest "detected" size with blue corners.
              setDetectionState((prev) => (prev === 'stable' ? prev : 'stable'));
            } else if (steadyMs >= FRAMING_MS) {
              setDetectionState((prev) => (prev === 'framing' ? prev : 'framing'));
            }
          }
          // Between thresholds: hold current state (hysteresis avoids jitter)
        });
      } catch {
        // Sensor unavailable — scanner still works via manual capture.
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      if (unsubscribe) unsubscribe();
      stableSinceRef.current = null;
    };
  }, [cameraShouldRender]);

  const handleGalleryPress = useCallback(async () => {
    if (!isSubscribed) {
      handleFreeGate();
      return;
    }
    Haptics.selectionAsync();
    try {
      const ImagePicker = await import('expo-image-picker');
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (res.canceled || !res.assets?.[0]) return;
      processingRef.current = true;
      // Session 182 — same instant-transition pattern as handleProCapture:
      // commit analyzing UI first, yield one frame, then run compression
      // and AI analysis with the analyzing screen already visible.
      setCapturedUri(res.assets[0].uri);
      setAnalyzing(true);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      // Session 181 — Gallery uploads do NOT count toward the shutter review
      // counter. Only presses of the physical ROUND camera shutter button on
      // the Scanner page increment sight_camera_shutter_review_count.
      const base64 = await compressImage(res.assets[0].uri);
      const analysis = await analyzeChartImage(`data:image/jpeg;base64,${base64}`);
      if (analysis?.error && typeof analysis.error === 'string' && analysis.error.includes('exceeded')) {
        showAlert('Limit Reached', analysis.error);
        setResult({ isChart: false, error: analysis.error });
      } else {
        setResult(analysis);
        Haptics.notificationAsync(
          analysis?.isChart ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
        );
      }
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to analyze image.';
      setResult({ isChart: false, error: msg });
      showAlert('Scan Error', msg);
    } finally {
      setAnalyzing(false);
      processingRef.current = false;
    }
  }, [isSubscribed, handleFreeGate, analyzeChartImage, showAlert]);

  const resetScan = useCallback(() => {
    setCapturedUri(null);
    setResult(null);
    setAnalyzing(false);
    setTorch(false);
    setDetectionState('idle');
    stableSinceRef.current = null;
    processingRef.current = false;
    Haptics.selectionAsync();
  }, []);

  if (capturedUri || analyzing || result) {
    return (
      <AnalysisResultView
        capturedUri={capturedUri}
        analyzing={analyzing}
        result={result}
        onReset={resetScan}
        theme={t}
        insets={insets}
      />
    );
  }

  if (permission && !permission.granted) {
    return (
      <PermissionRequestView
        canAskAgain={permission.canAskAgain}
        onRequest={requestPermission}
        insets={insets}
        isSubscribed={isSubscribed}
      />
    );
  }

  // Session 204 — while permission is still resolving (permission === null),
  // show the PermissionRequestView immediately so there is no flash of the
  // dark camera background before the enable-camera UI appears. Once the
  // hook resolves, this branch is replaced with either the granted-permission
  // camera view or the actual PermissionRequestView above.
  if (!permission) {
    return (
      <PermissionRequestView
        canAskAgain={true}
        onRequest={requestPermission}
        insets={insets}
        isSubscribed={isSubscribed}
      />
    );
  }

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      {cameraShouldRender ? (
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} />
      ) : (
        <LinearGradient colors={['#0A0E17', '#000000']} style={StyleSheet.absoluteFill} />
      )}

      {/* Subtle top/bottom vignette so the top title and bottom controls
          stay readable over any camera scene. Not a fake detection overlay. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.75)']}
        locations={[0, 0.22, 0.72, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Top bar — just the title. No badges, no pills, no PRO markers. */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.scannerTitle}>Chart Scanner</Text>
        </View>
      </View>

      {/* Dynamic detection guide — Session 113 #10 — frame resizes based on
          real motion stability. Corners scale WITH the frame, not against it. */}
      <DetectionGuide state={detectionState} />

      {/* Bottom bar — gallery, capture, torch. Manual capture only — no auto-fire. */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 20 }]}>
        <Pressable
          style={styles.sideBtn}
          onPress={handleGalleryPress}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialIcons name={isSubscribed ? 'photo-library' : 'lock-outline'} size={22} color="#FFF" />
        </Pressable>
        <CaptureButton
          onPress={isSubscribed ? handleProCapture : handleFreeGate}
          showLock={!isSubscribed}
        />
        <Pressable
          style={styles.sideBtn}
          onPress={() => { setTorch((v) => !v); Haptics.selectionAsync(); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialIcons name={torch ? 'flash-on' : 'flash-off'} size={22} color="#FFF" />
        </Pressable>
      </View>
    </View>
  );
}
