/** Number/date formatting. Missing values render as an em dash — never 0. */

export const MISSING = "—";

export function pts(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined) return MISSING;
  const rounded = Number(v.toFixed(decimals));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(decimals);
}

export function pct(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined) return MISSING;
  return `${(v * 100).toFixed(decimals)}%`;
}

export function signed(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined) return MISSING;
  const s = v.toFixed(decimals).replace(/\.0+$/, "");
  return v > 0 ? `+${s}` : s;
}

export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Weekday + kickoff time for a "next game" card, e.g. "Sun 1:00 PM". */
export function gameTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dateTime(iso: string): string {
  if (!iso) return MISSING;
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
