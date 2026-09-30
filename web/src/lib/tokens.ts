/** Chart-side mirror of the CSS palette — SVG attributes can't read CSS vars
 * reliably across renderers, so charts import these as plain strings
 * instead. Read from the ACTUAL computed `:root` custom properties (not
 * hardcoded light-mode hex) at module-load time, so a chart picks up
 * whichever theme is active when the page loads — light, dark, or
 * whatever `prefers-color-scheme`/the saved ThemeToggle choice resolved
 * to (index.html's inline script sets `data-theme` before this module
 * ever evaluates, so that resolution has already happened). Falls back to
 * the light-mode literal if `document` isn't available (defensive only —
 * this is a pure client SPA, never actually SSR'd) or a property is
 * somehow missing.
 *
 * Known limitation (2026-09-29, accepted): these are read ONCE at module
 * load, not reactively — a chart already on screen won't recolor itself
 * if the theme changes without a page reload. ThemeToggle.tsx reloads the
 * page on every change specifically to route around this rather than
 * pretend it's live — a full, correct repaint beats fast-but-stale.
 */
function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export const INK = cssVar("--ink", "#12213D");
export const INK_MUTED = cssVar("--ink-muted", "#5B6584");
export const RULE = cssVar("--rule", "#E0D3AC");
export const PAPER_2 = cssVar("--paper-2", "#F1E7CE");
export const ACCENT = cssVar("--accent", "#0FA894");
export const ACCENT_2 = cssVar("--accent-2", "#C99A2E");
export const GOLD = cssVar("--gold", "#B8862E");
export const POSITIVE = cssVar("--positive", "#1E8F5C");
export const NEGATIVE = cssVar("--negative", "#C23B32");

export const FONT_MONO = "'IBM Plex Mono', monospace";

/** Chart-only qualitative palette — for identifying a handful of
 * DISTINCT individual series (e.g. the MVP race's top 5 players) where a
 * single accent-vs-muted binary (every other chart's convention) doesn't
 * apply, since there's no single "mine" line here. Deliberately avoids
 * POSITIVE/NEGATIVE — those carry a real green=good/red=bad meaning
 * elsewhere in this app, which would misread as a value judgment on a
 * player's raw rank position rather than just telling rank 1 apart from
 * rank 3. Five muted-but-distinguishable hues in the same warm/paper
 * family as the rest of the palette, ordered rank 1 first (ACCENT, this
 * app's one true "important" color, leads).*/
export const CHART_QUALITATIVE = [ACCENT, ACCENT_2, "#6B5CA5", "#B8562E", INK];
