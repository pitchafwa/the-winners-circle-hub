/** Shared POST helper for the local admin-only tools (trade submission,
 * draft entry) — bridges to Python via the Vite dev-middleware in
 * web/vite-plugins/admin-api.ts. Throws only on transport failure or an
 * explicit `error` field; callers inspect other fields (like `ok`) for
 * soft-fail states such as "file already exists, confirm overwrite." */
export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // The admin-api middleware only exists on the local Vite dev server —
  // the deployed static site (GitHub Pages) has no backend at all, so this
  // same request there falls through to the SPA's HTML fallback instead of
  // a real API response. Checking content-type turns that into a real
  // explanation instead of a raw "Unexpected token '<'" JSON.parse error.
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  if (!isJson) {
    throw new Error(
      "This tool only works on the local dev server (`pnpm dev`), not the deployed site — " +
      "it needs the admin-api dev middleware to talk to the ingest scripts, which doesn't exist there.",
    );
  }
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error || `${path}: HTTP ${res.status}`);
  }
  return json as T;
}
