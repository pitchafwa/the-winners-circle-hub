/** Chart-side mirror of the CSS palette — SVG attributes can't read CSS vars
 * reliably across renderers, so charts import these. Keep in sync with
 * styles/global.css. */
export const INK = "#12213D";
export const INK_MUTED = "#5B6584";
export const RULE = "#E0D3AC";
export const PAPER_2 = "#F1E7CE";
export const ACCENT = "#0FA894";
export const ACCENT_2 = "#C99A2E";
export const GOLD = "#B8862E";
export const POSITIVE = "#1E8F5C";
export const NEGATIVE = "#C23B32";

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
