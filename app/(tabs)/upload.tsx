/**
 * TradeSight Chart Scanner — Lazy-loaded custom in-app camera.
 *
 * ============================================================================
 * CRITICAL STARTUP FIX (Session 105) — root cause of "Failed to Launch App"
 * ============================================================================
 * PROBLEM
 *   Previously, `expo-camera` was imported statically at the top of this file:
 *
 *     import { CameraView, useCameraPermissions } from 'expo-camera';
 *
 *   The tabs layout mounts ALL 5 tab screens simultaneously in a horizontal
 *   paging ScrollView, so on cold start expo-camera's native module was looked
 *   up before the user had even seen the Scanner tab. Because `expo-camera`
 *   was NOT registered as a config plugin in `app.json`, its native module
 *   was not linked into the production binary → the entire app failed to
 *   launch with "Failed to Launch App".
 *
 * FIX (two parts, both required)
 *   1. `app.json` — expo-camera is now registered as a config plugin, so the
 *      native module is properly linked into production builds.
 *   2. This file — all imaging-related packages (expo-camera, expo-image-picker,
 *      expo-image-manipulator, expo-file-system) are now dynamically imported
 *      only when the user actually needs them. If any fail to load, only the
 *      Scanner tab is affected; the rest of the app remains fully functional.
 *
 * STARTUP BENEFIT
 *   The app no longer touches any camera or imaging native modules during
 *   cold start. First paint is measurably faster.
 *
 * FREE vs PRO
 *   Both tiers see the identical live camera preview + intelligent detection
 *   frame. The gate lives at the capture action only — free users tapping
 *   capture routes through `handleFreeGate` → /subscription. No image is ever
 *   captured, uploaded, or analyzed for free users.
 *
 * BATTERY
 *   The camera sensor is only mounted while the Scanner tab is on-screen
 *   (detected via measureInWindow polling every 400ms). Swiping to any other
 *   tab releases the sensor immediately.
 *
 * ADMOB REWARDED-AD INSERTION POINT
 *   `handleFreeGate` (in components/scanner/ScannerContent.tsx) is the single
 *   choke point for the Free → paywall transition. The AdMob state machine
 *   slots in there without any other scanner code changes.
 * ============================================================================
 */
import React, { useState, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scannerStyles as styles } from '../../components/scanner/scannerStyles';
import { ScannerBootstrapView } from '../../components/scanner/ScannerBootstrap';
import { ScannerContent } from '../../components/scanner/ScannerContent';

export default function ChartScannerScreen() {
  const insets = useSafeAreaInsets();
  const containerRef = useRef<View>(null);
  const [tabVisible, setTabVisible] = useState(false);
  const [cameraMod, setCameraMod] = useState<any>(null);
  const [cameraLoadError, setCameraLoadError] = useState<string | null>(null);

  // Tab visibility polling — cheap measureInWindow every 400ms. When the user
  // is on any tab OTHER than the Scanner, the camera sensor is never mounted.
  useEffect(() => {
    const measure = () => {
      if (!containerRef.current) return;
      containerRef.current.measureInWindow((x, _y, w) => {
        const nowVisible = Math.abs(x) < 60 && w > 0;
        setTabVisible((prev) => (prev !== nowVisible ? nowVisible : prev));
      });
    };
    measure();
    const interval = setInterval(measure, 400);
    return () => {
      clearInterval(interval);
      setTabVisible(false);
    };
  }, []);

  // Session 205 — Preload expo-camera as soon as the Scanner tab MOUNTS,
  // not when it becomes visible. The tab layout mounts adjacent tabs when
  // the user navigates, so by the time they actually swipe to the Scanner
  // tab, the camera module has usually finished loading in the background.
  // This removes the previous "Preparing camera…" loading state that
  // flashed briefly before the Enable Camera Access screen appeared, so
  // the Continue button is available effectively the moment the user
  // opens the Scanner tab. Wrapped in try/catch so a load failure only
  // affects this tab — the rest of the app stays fully functional.
  useEffect(() => {
    if (cameraMod || cameraLoadError) return;
    let mounted = true;
    (async () => {
      try {
        const mod = await import('expo-camera');
        if (mounted) setCameraMod(mod);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.log('[Scanner] expo-camera failed to load:', msg);
        if (mounted) setCameraLoadError(msg);
      }
    })();
    return () => { mounted = false; };
  }, [cameraMod, cameraLoadError]);

  return (
    <View ref={containerRef} collapsable={false} style={styles.scannerRoot}>
      {cameraMod && !cameraLoadError ? (
        <ScannerContent cameraMod={cameraMod} tabVisible={tabVisible} insets={insets} />
      ) : (
        <ScannerBootstrapView
          loading={tabVisible && !cameraLoadError}
          failed={!!cameraLoadError}
          insets={insets}
        />
      )}
    </View>
  );
}
