import { createContext, useContext, ReactNode } from 'react';

/**
 * LaunchContext (Session 212 — startup handoff hardening)
 * =============================================================================
 * Shares launch-sequence state between app/_layout.tsx (the SINGLE owner of
 * native splash hide) and downstream components that must defer any
 * keyboard / focus / interactive behavior until the animated WelcomeLaunch
 * has actually dismissed AND the destination route has actually landed.
 *
 *   reactLaunchReady        — flips true the moment LaunchSplashOverlay's
 *                             full-screen View commits its first layout.
 *                             This is the ONLY signal that authorizes the
 *                             root to call SplashScreen.hideAsync().
 *
 *   launchSequenceComplete  — flips true once the animated WelcomeLaunch
 *                             has been dismissed (tap-through in first-
 *                             launch mode, auto-dismiss timer in auto
 *                             mode, or the single-frame bypass in dev /
 *                             Expo Go).
 *
 *   routingComplete         — flips true the moment app/index.tsx has
 *                             computed the correct destination AND called
 *                             router.replace(). The launch overlay stays
 *                             mounted until BOTH launchSequenceComplete
 *                             AND routingComplete are true (with a hard
 *                             safety cap in _layout.tsx so we never hang
 *                             forever). This is what eliminates the
 *                             blank/blue screen users saw when the splash
 *                             animation finished before Supabase / user
 *                             flags had resolved.
 *
 * Consumers: components/TradingPasswordGate.tsx — waits for
 * launchSequenceComplete === true before autofocusing the password field
 * so the keyboard cannot flash behind the launch overlay on any device
 * speed. app/index.tsx — calls markRoutingComplete() after
 * router.replace() fires so the overlay finally unmounts.
 * =============================================================================
 */
export interface LaunchContextValue {
  reactLaunchReady: boolean;
  launchSequenceComplete: boolean;
  routingComplete: boolean;
  markReactLaunchReady: () => void;
  markLaunchSequenceComplete: () => void;
  markRoutingComplete: () => void;
}

// Defaults treat launch as complete so any consumer accidentally rendered
// outside the provider degrades to a normal interactive experience rather
// than deadlocking.
const DEFAULT_VALUE: LaunchContextValue = {
  reactLaunchReady: true,
  launchSequenceComplete: true,
  routingComplete: true,
  markReactLaunchReady: () => {},
  markLaunchSequenceComplete: () => {},
  markRoutingComplete: () => {},
};

export const LaunchContext = createContext<LaunchContextValue>(DEFAULT_VALUE);

export function LaunchProvider({ value, children }: { value: LaunchContextValue; children: ReactNode }) {
  return <LaunchContext.Provider value={value}>{children}</LaunchContext.Provider>;
}

export function useLaunchState(): LaunchContextValue {
  return useContext(LaunchContext);
}
