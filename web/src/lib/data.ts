import { useEffect, useState } from "react";

/**
 * Typed fetch for the static JSON contract. Fails loudly: a missing or
 * malformed required file renders an error state, never a silent undefined.
 */

const cache = new Map<string, { value: unknown; at: number }>();

// A long-lived tab (this is a personal dashboard people leave open) should
// still notice server-side changes eventually, even without an explicit
// clearJsonCache() call (only the local admin tools trigger those, after
// their own submit) — e.g. re-running the ingest by hand outside the admin
// UI. 60s caps how stale a view can get without needing a manual reload.
const CACHE_TTL_MS = 60_000;

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

async function fetchJson(path: string, optional: boolean): Promise<unknown> {
  const key = `${path}|${optional}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const res = await fetch(`${import.meta.env.BASE_URL}data/${path}`);
  // Dev server and Netlify SPA fallbacks answer missing files with index.html
  // and a 200 — a non-JSON content-type means the file does not exist.
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  if (!res.ok || !isJson) {
    if (optional && (res.status === 404 || !isJson)) {
      cache.set(key, { value: null, at: Date.now() });
      return null;
    }
    throw new Error(`data/${path}: ${res.ok ? "not found (SPA fallback)" : `HTTP ${res.status}`}`);
  }
  const json = (await res.json()) as unknown;
  cache.set(key, { value: json, at: Date.now() });
  return json;
}

function useFetch<T>(path: string | null, optional: boolean): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: null, loading: path !== null });

  useEffect(() => {
    if (path === null) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let alive = true;
    setState({ data: null, error: null, loading: true });
    fetchJson(path, optional)
      .then((json) => alive && setState({ data: json as T, error: null, loading: false }))
      .catch((e: Error) => alive && setState({ data: null, error: e.message, loading: false }));
    return () => {
      alive = false;
    };
  }, [path, optional]);

  return state;
}

/** Required file — 404 is an error the user sees. */
export function useJson<T>(path: string | null): Loaded<T> {
  return useFetch<T>(path, false);
}

/** Optional file (sim.json, draft.json) — 404 resolves to data:null, no error. */
export function useOptionalJson<T>(path: string | null): Loaded<T> {
  return useFetch<T>(path, true);
}

/** Imperative load for multi-file pages (History fetches every season). */
export function loadJson<T>(path: string, optional = false): Promise<T | null> {
  return fetchJson(path, optional) as Promise<T | null>;
}

/** Drop every cached response so the next fetch of any path hits the
 * network again. The admin tools (trade/draft submit and delete) rebuild
 * JSON files on disk in place — without this, any page already visited in
 * this browser tab keeps serving what it fetched before the rebuild for
 * the rest of the session, since `cache` above never expires on its own. */
export function clearJsonCache(): void {
  cache.clear();
}
