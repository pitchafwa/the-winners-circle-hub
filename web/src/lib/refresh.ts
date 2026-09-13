import { useEffect, useState } from "react";

/**
 * Why this exists: `data.ts`'s fetch cache already expires after 60s, but
 * nothing was ever re-triggering a fetch on an already-mounted page — a
 * `useEffect` only re-runs when its dependencies change, and a cache TTL
 * alone doesn't change anything. So a tab left open during a live game just
 * kept showing whatever it fetched on load, forever, until the user forced
 * a real reload (Tommy, 2026-09-14: "i don't like have to force quit the
 * app/browser in order to get scores to refresh").
 *
 * This adds one global "refresh tick" — a counter every `useJson`/
 * `useOptionalJson` call subscribes to (see `data.ts`'s `useFetch`) and
 * re-fetches whenever it changes. One shared interval bumps it
 * automatically (paused while the tab isn't visible, so a backgrounded
 * mobile tab doesn't keep polling), and the header's refresh button bumps
 * it on demand — both routes through the exact same mechanism, so there's
 * only one code path to trust.
 */

const POLL_INTERVAL_MS = 30_000;

type Listener = () => void;
const listeners = new Set<Listener>();
let tick = 0;

function bump(): void {
  tick += 1;
  listeners.forEach((l) => l());
}

/** Called by the header's refresh button, and by the automatic poll below. */
export function triggerRefresh(): void {
  bump();
}

/** Subscribed inside `data.ts`'s `useFetch` — re-fetches whenever the
 * shared tick advances, from either the automatic poll or a manual click. */
export function useRefreshTick(): number {
  const [local, setLocal] = useState(tick);
  useEffect(() => {
    const onTick = () => setLocal(tick);
    listeners.add(onTick);
    return () => {
      listeners.delete(onTick);
    };
  }, []);
  return local;
}

/** Started once, at the app root (`AppContext.tsx`) — a single shared
 * interval rather than one per mounted page, so opening more tabs/pages
 * doesn't multiply how often this polls. */
export function startAutoRefresh(): () => void {
  const id = setInterval(() => {
    if (document.visibilityState === "visible") triggerRefresh();
  }, POLL_INTERVAL_MS);
  // Also refresh immediately on returning to a backgrounded tab, rather
  // than waiting for the next interval tick — the whole point is that
  // switching back to the app should just show what's current, not make
  // you wait up to 30s more on top of however long it was backgrounded.
  const onVisible = () => {
    if (document.visibilityState === "visible") triggerRefresh();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
