/**
 * motionService — thin wrapper around expo-sensors Accelerometer.
 *
 * Used by the Scanner to detect when the phone is genuinely being held steady
 * (a REAL hardware signal from the device's accelerometer, not a simulated
 * animation). This lets the scanner auto-trigger capture only when the user
 * has intentionally framed a chart, without pretending to perform per-frame
 * computer-vision rectangle detection that expo-camera cannot support.
 *
 * If genuine per-corner CV detection is ever required, this file can be
 * replaced by frame-processor callbacks from react-native-vision-camera +
 * OpenCV/MLKit.
 */

let updateIntervalConfigured = false;

export interface MotionSample {
  x: number;
  y: number;
  z: number;
}

/**
 * Subscribe to accelerometer samples at ~10Hz. Returns an unsubscribe fn.
 * Wrapped in try/catch so a sensor-unavailable device (rare) doesn't crash
 * the scanner — the scanner falls back to manual capture in that case.
 */
export function subscribeMotion(callback: (sample: MotionSample) => void): () => void {
  try {
    // Dynamic require so a missing expo-sensors module doesn't crash import.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Accelerometer } = require('expo-sensors');
    if (!updateIntervalConfigured) {
      Accelerometer.setUpdateInterval(100); // 10 Hz
      updateIntervalConfigured = true;
    }
    const sub = Accelerometer.addListener(callback);
    return () => {
      try { sub.remove(); } catch {}
    };
  } catch (e) {
    // Sensor unavailable — return a no-op unsubscribe. Scanner will still
    // work with the manual capture button.
    return () => {};
  }
}

/**
 * Compute the deviation from 1G gravity magnitude.
 *
 *   At rest, |accel_vector| ≈ 1 (gravity only), so deviation ≈ 0.
 *   Any linear motion increases the deviation above 0.
 *
 * This is a robust "how much is the phone moving" signal that works in any
 * orientation, without needing to calibrate against gravity direction.
 */
export function motionDeviation(sample: MotionSample): number {
  const mag = Math.sqrt(sample.x * sample.x + sample.y * sample.y + sample.z * sample.z);
  return Math.abs(mag - 1.0);
}
