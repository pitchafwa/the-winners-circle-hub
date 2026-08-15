import type { AwardTone, Badge, BadgeType } from "../types/data";

export const BADGE_ICON: Record<BadgeType, string> = {
  champion: "🏆",
  runner_up: "🥈",
  reg_season_title: "🚩",
  points_title: "🎯",
  superlative_champion: "⭐",
  best_coach_season: "🧠",
  record_high_week: "💥",
  last_place: "💀",
  record_low_week: "🧊",
  bench_king: "🪑",
};

/** Mirrors ingest/build.py's BADGE_META tones — badges.json doesn't carry
 * tone per-badge (only badge_meta{type: {label, tone}} at the top level),
 * and threading that through every BadgeShelf call site isn't worth it for
 * a fixed, small, stable set of types. */
const BADGE_TONE: Record<BadgeType, AwardTone> = {
  champion: "gold",
  runner_up: "positive",
  reg_season_title: "positive",
  points_title: "positive",
  superlative_champion: "gold",
  best_coach_season: "positive",
  record_high_week: "gold",
  last_place: "negative",
  record_low_week: "negative",
  bench_king: "negative",
};

/** Grouped badge chips: one chip per type, seasons listed, tooltip = details. */
export default function BadgeShelf({ badges, size = "normal" }: { badges: Badge[]; size?: "normal" | "compact" }) {
  if (badges.length === 0) {
    return size === "normal" ? (
      <p className="muted" style={{ fontStyle: "italic", fontSize: "0.85rem" }}>
        No hardware yet.
      </p>
    ) : null;
  }
  const groups = new Map<BadgeType, Badge[]>();
  for (const b of badges) {
    const g = groups.get(b.type) ?? [];
    g.push(b);
    groups.set(b.type, g);
  }
  // championships lead the shelf regardless of when they happened; everything
  // else keeps its existing (chronological-first-appearance) relative order
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === "champion" ? -1 : b === "champion" ? 1 : 0,
  );

  return (
    <div className={`badge-shelf ${size}`}>
      {ordered.map(([type, list]) => (
        <span
          key={type}
          className="badge-chip"
          data-tone={BADGE_TONE[type]}
          title={list.map((b) => b.detail).join("\n")}
        >
          <span aria-hidden="true">{BADGE_ICON[type]}</span>
          {list.length > 1 && <span className="num badge-count">×{list.length}</span>}
          {size === "normal" && (
            <span className="badge-seasons num">{list.map((b) => `'${String(b.season).slice(2)}`).join(" ")}</span>
          )}
        </span>
      ))}
    </div>
  );
}
