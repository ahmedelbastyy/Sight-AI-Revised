// services/tutorialWalkthroughBus.ts
// Session 145 — lightweight event bus so the Home tab can request the
// tabs layout to start a guided tab walkthrough (Journal → Camera →
// Moves → Home → confetti). Using a module-level singleton keeps this
// independent of AppContext (no ripple through unrelated consumers) and
// works even when Home is the only mounted tab at start.

type Listener = () => void;

let pendingStart = false;
const listeners = new Set<Listener>();

export function startTabWalkthrough(): void {
  pendingStart = true;
  listeners.forEach((l) => {
    try { l(); } catch {}
  });
}

// Consume the pending flag exactly once — the subscriber that reads
// `true` here is responsible for actually running the walkthrough.
export function consumeTabWalkthroughStart(): boolean {
  const was = pendingStart;
  pendingStart = false;
  return was;
}

export function subscribeTabWalkthrough(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
