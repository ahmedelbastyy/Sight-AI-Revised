// services/storeReviewService.ts
// =============================================================================
// Session 187 — After-every-successful-scan App Store review request.
//
// This module owns Sight's one and only call site for expo-store-review.
// It is invoked ONLY from the Chart Scanner's successful-analysis path
// (see components/scanner/ScannerContent.tsx). Every completed camera
// scan produces one legitimate call to StoreReview.requestReview().
//
// KEY GUARANTEES:
//   1. NO AsyncStorage counter. NO odd/even guard. NO cadence gate.
//   2. Idempotent per-scan: callers pass a unique scanId. If the same
//      scanId is submitted twice (e.g., result screen re-render), the
//      second call is a silent no-op. This means one native
//      requestReview() call MAXIMUM per successful scan even if React
//      re-renders the result screen multiple times.
//   3. Fire-and-forget. Never awaited on the scanner critical path.
//      Never throws. Never delays capture, "AI is analyzing", or the
//      result screen.
//   4. Module never imports expo-store-review at top level — the import
//      is deferred until the first call so a missing native module can
//      never affect app launch.
//   5. Never retried. Apple's SKStoreReviewController silently rate-limits
//      display frequency; Sight's responsibility is to make ONE proper
//      call per successful scan. Whether the sheet actually appears is
//      entirely Apple's decision.
//   6. StoreKit provides NO callback telling us whether the user reviewed.
//      We never try to detect that.
// =============================================================================

const processedScanIds = new Set<string>();
// Bound the Set so long sessions cannot leak memory. 200 is far more than
// any realistic single-session scan count.
const MAX_TRACKED_SCANS = 200;

/**
 * Request an App Store review after a successful camera scan.
 *
 * Fire-and-forget. Safe to call from a Promise chain with `.catch(() => {})`
 * on the critical UI path.
 *
 * @param scanId Unique identifier for the completed scan. The same scanId
 *   submitted twice will produce at most one native requestReview() call.
 */
export async function requestReviewForScan(scanId: string): Promise<void> {
  if (!scanId || typeof scanId !== 'string') return;
  if (processedScanIds.has(scanId)) {
    if (__DEV__) console.log('[storeReview] Duplicate call for scan', scanId, '— skipping');
    return;
  }
  processedScanIds.add(scanId);
  if (processedScanIds.size > MAX_TRACKED_SCANS) {
    // Drop the oldest tracked scanId. Set iteration order is insertion order.
    const oldest = processedScanIds.values().next().value;
    if (oldest) processedScanIds.delete(oldest);
  }

  try {
    if (__DEV__) console.log('[storeReview] Scanner completed -> requesting App Store review for scan', scanId);
    let StoreReview: any = null;
    try {
      StoreReview = await import('expo-store-review');
    } catch (e) {
      if (__DEV__) console.log('[storeReview] expo-store-review import failed (non-fatal):', String(e));
      return;
    }
    if (!StoreReview) {
      if (__DEV__) console.log('[storeReview] expo-store-review module unavailable in this build');
      return;
    }
    let isAvailable = false;
    if (typeof StoreReview.isAvailableAsync === 'function') {
      try {
        isAvailable = await StoreReview.isAvailableAsync();
      } catch (e) {
        if (__DEV__) console.log('[storeReview] isAvailableAsync threw:', String(e));
        return;
      }
    } else {
      // Older / stub variants — if the availability API is missing we
      // conservatively assume unavailable rather than blindly calling.
      isAvailable = false;
    }
    if (__DEV__) console.log('[storeReview] StoreReview.isAvailableAsync() ->', isAvailable);
    if (!isAvailable) return;

    // hasAction() is optional — some platforms / builds omit it. When
    // present and returning false the OS has explicitly declared it
    // cannot display the sheet, so we short-circuit.
    if (typeof StoreReview.hasAction === 'function') {
      try {
        const hasAction = await StoreReview.hasAction();
        if (__DEV__) console.log('[storeReview] StoreReview.hasAction() ->', hasAction);
        if (!hasAction) return;
      } catch (e) {
        if (__DEV__) console.log('[storeReview] hasAction threw (continuing):', String(e));
      }
    }

    try {
      await StoreReview.requestReview();
      if (__DEV__) console.log('[storeReview] requestReview() invoked for scan', scanId, '— Apple decides whether the native sheet is shown. StoreKit does not report back.');
    } catch (e) {
      if (__DEV__) console.log('[storeReview] requestReview() threw (non-fatal):', String(e));
    }
  } catch (e) {
    // Absolute outer safety net — never let a StoreKit error surface.
    if (__DEV__) console.log('[storeReview] outer catch (non-fatal):', String(e));
  }
}

/**
 * Development helper — clears the per-session dedup set. Not used in
 * production code paths. Exposed so a debug panel or QA reset action
 * can force the next scan to re-request without restarting the app.
 */
export function _resetProcessedScanIdsForDev(): void {
  if (!__DEV__) return;
  processedScanIds.clear();
}
