// brokerConnectionBus.ts — Session 164
// =============================================================================
// Lightweight in-memory event bus for broadcasting "brokerage connection
// state changed" events across the app. Solves the previous UX bug where
// after connecting a brokerage, the Home tab's Portfolio Value would not
// update until the useBrokerConnection hook's 60-second refresh interval
// fired — leaving users staring at an empty / stale portfolio for up to
// a full minute after a successful connection.
//
// Producer (connect-brokerage.tsx) — calls triggerBrokerRefresh() as soon
// as SnapTrade returns a successful sync payload. This is done AFTER we
// write the fresh accounts_snapshot / positions_snapshot / balances_snapshot
// to Supabase, so subscribers can immediately re-read the latest state.
//
// Consumer (useBrokerConnection.ts) — subscribes on mount and calls
// refresh() + sync() the moment an event is received. That in turn
// updates the hook's state, which cascades through the Home portfolio
// value useMemo → the animated Portfolio Value re-renders → the entire
// app is instantly in sync with the broker.
// =============================================================================

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeBrokerRefresh(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function triggerBrokerRefresh(): void {
  listeners.forEach((l) => {
    try { l(); } catch { /* swallow — one listener failure must not block others */ }
  });
}
