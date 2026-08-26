// Generic gray bust-silhouette, used whenever ESPN's real headshot/logo
// 404s — any player ESPN just doesn't have art for, or a bad/missing
// team abbreviation for a D/ST logo.
const SILHOUETTE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E" +
  "%3Crect width='24' height='24' fill='%23E4E7F0'/%3E" +
  "%3Ccircle cx='12' cy='9.5' r='4' fill='%23AAB2C8'/%3E" +
  "%3Cpath d='M3.5 22c0-4.7 3.8-8 8.5-8s8.5 3.3 8.5 8' fill='%23AAB2C8'/%3E" +
  "%3C/svg%3E";

// Sizing lives in CSS (.player-headshot + a modifier class per call site),
// not an inline style, specifically so a media query can shrink the
// matchup-card variant on narrow viewports without a JS resize listener —
// see .mu-headshot in global.css.
export default function PlayerHeadshot({
  playerId,
  position,
  proTeam,
  className = "",
}: {
  playerId: number;
  // D/ST isn't a "player" ESPN has photo art for (its headshot URL always
  // 404s) — a team logo reads far better there than the generic
  // silhouette every defense would otherwise show.
  position?: string | null;
  proTeam?: string | null;
  className?: string;
}) {
  const isDefense = position === "D/ST";
  const src =
    isDefense && proTeam
      ? `https://a.espncdn.com/i/teamlogos/nfl/500/${proTeam.toLowerCase()}.png`
      : `https://a.espncdn.com/i/headshots/nfl/players/full/${playerId}.png`;
  return (
    <img
      className={`player-headshot ${className}`.trim()}
      src={src}
      alt=""
      loading="lazy"
      onError={(e) => {
        const img = e.currentTarget;
        img.onerror = null;
        img.src = SILHOUETTE;
      }}
    />
  );
}
