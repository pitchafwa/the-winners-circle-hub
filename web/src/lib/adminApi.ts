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
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error || `${path}: HTTP ${res.status}`);
  }
  return json as T;
}
