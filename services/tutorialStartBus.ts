// services/tutorialStartBus.ts
// =============================================================================
// Session 185 — Robust tutorial launch signal (rewrite of Session 182).
//
// ROOT CAUSE THIS FILE ADDRESSES:
//   The previous Session 182 implementation solved the InteractionManager
//   hang for the TOP-LEVEL start effect, but the pending flag was still
//   being CONSUMED by HomeScreen the instant it saw the flag — before the
//   first spotlight overlay had actually rendered. If the actual
//   measurement step failed for any reason (stale onboarding state,
//   ref not yet laid out, in-flight route animation, etc.), the pending
//   flag was already gone and no future trigger could recover it. The
//   user then had to close and reopen the app so the AsyncStorage-
//   backed pending flag was hydrated on the fresh mount and re-tried.
//
// NEW CONTRACT (Session 185):
//   • markTutorialPending()  — Welcome calls this SYNCHRONOUSLY before
//     it navigates. Generates a unique launch token, sets both the
//     in-memory flag and the persisted AsyncStorage entry, and fires
//     all currently-registered listeners on the same JS tick.
//   • subscribeTutorialStart(cb) — HomeScreen subscribes on mount.
//     If a pending token already exists at subscribe time, the listener
//     is invoked immediately (via microtask so it does not fire inside
//     the render pass). This covers the case where Welcome fired the
//     bus event BEFORE HomeScreen had mounted its subscription.
//   • readTutorialPending()  — Reads the current pending state WITHOUT
//     clearing it. Safe to call from any focus effect / retry.
//   • markOverlayMounted()  — Called by HomeScreen the moment the FIRST
//     spotlight overlay has been confirmed to render on screen
//     (measurement returned real dimensions AND tutorialStep was set to
//     a non-DONE value). Clears the flag from BOTH in-memory and disk.
//     This is the ONLY function that clears the pending state.
//   • consumeTutorialPending() — Kept as a legacy alias for account-
//     deletion / logout code paths that need to force-clear the flag
//     without an overlay actually rendering.
//
// CONSEQUENCE:
//   If HomeScreen's measurement retry loop never succeeds (pathological),
//   the pending flag STAYS set and any future focus / re-render / state
//   change can retry the tutorial. On the normal happy path the flag is
//   cleared the instant the overlay is proven visible. In either case
//   the "requires app restart" bug is eliminated because we never lose
//   the intent to run the tutorial until it is actually running.
// =============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage key. Value is a unique launch token generated per markTutorialPending
// call. The presence of the key = pending; the specific value is only used
// for __DEV__ diagnostics and to distinguish stale bus emissions from fresh ones.
const PENDING_KEY = 'sight_tutorial_pending_token';

type Listener = () => void;
let currentToken: string | null = null;
const listeners = new Set<Listener>();

function generateToken(): string {
  return 'tut_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/**
 * Emit "start the tutorial ASAP". Called SYNCHRONOUSLY from welcome.tsx
 * immediately before router.replace('/'). Sets the in-memory flag FIRST
 * so any listener already subscribed receives the signal on the same JS
 * tick, then fires an AsyncStorage write for the cold-restart-mid-
 * onboarding fallback path (write is fire-and-forget — the flag is
 * already valid in memory before the write resolves).
 *
 * Returns the generated launch token so callers can log it for __DEV__.
 */
export function markTutorialPending(): string {
  const token = generateToken();
  currentToken = token;
  AsyncStorage.setItem(PENDING_KEY, token).catch(() => {});
  if (__DEV__) console.log('[tutorial] TUTORIAL_PENDING_SET token=', token);
  const snapshot = Array.from(listeners);
  for (const l of snapshot) {
    try { l(); } catch { /* swallow */ }
  }
  return token;
}

/**
 * Read the pending flag (in-memory first, AsyncStorage fallback).
 * Does NOT clear the flag — the caller can safely retry as often as
 * needed. Returns true if a launch is pending, false otherwise.
 */
export async function readTutorialPending(): Promise<boolean> {
  if (currentToken !== null) return true;
  try {
    const v = await AsyncStorage.getItem(PENDING_KEY);
    if (v && v.length > 0) {
      currentToken = v;
      return true;
    }
  } catch { /* swallow */ }
  return false;
}

/**
 * Clear the pending flag from BOTH in-memory and disk. HomeScreen calls
 * this the moment the first spotlight overlay is confirmed to have
 * mounted (measureInWindow returned real dimensions AND tutorialStep
 * transitioned to a non-DONE value). This is the ONLY code path that
 * clears the pending flag on the happy path.
 */
export async function markOverlayMounted(): Promise<void> {
  currentToken = null;
  try { await AsyncStorage.removeItem(PENDING_KEY); } catch { /* swallow */ }
  if (__DEV__) console.log('[tutorial] PENDING_CLEARED (overlay mounted)');
}

/**
 * Legacy alias — force-clear the pending flag without an overlay
 * necessarily rendering. Used by account-deletion / logout code paths
 * so a previous user's stale flag cannot re-trigger the tutorial after
 * a fresh sign-in on the same device.
 */
export async function consumeTutorialPending(): Promise<boolean> {
  const had = currentToken !== null;
  currentToken = null;
  try { await AsyncStorage.removeItem(PENDING_KEY); } catch { /* swallow */ }
  return had;
}

/**
 * Subscribe to bus events. Fires whenever markTutorialPending() is
 * called. If a pending token ALREADY exists at subscribe time (bus
 * emission preceded this listener registering), the listener is
 * invoked immediately in the next microtask so it fires outside of
 * React's current render pass but on the same event-loop turn.
 *
 * Returns an unsubscribe function.
 */
export function subscribeTutorialStart(listener: Listener): () => void {
  listeners.add(listener);
  if (currentToken !== null) {
    // Fire in a microtask so React can finish its current render cycle
    // before we trigger another state update from the callback.
    Promise.resolve().then(() => {
      if (!listeners.has(listener)) return;
      try { listener(); } catch { /* swallow */ }
    });
  }
  return () => { listeners.delete(listener); };
}

/**
 * Explicit clear without emitting. Used by logout / account deletion.
 * Behaves identically to consumeTutorialPending().
 */
export async function clearTutorialPending(): Promise<void> {
  currentToken = null;
  try { await AsyncStorage.removeItem(PENDING_KEY); } catch { /* swallow */ }
}
