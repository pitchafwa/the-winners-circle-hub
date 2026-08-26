// Generic gray bust-silhouette, used whenever ESPN's real headshot 404s
// (D/ST entries always hit this — ESPN doesn't have a "player" photo for a
// team defense — plus any player ESPN just doesn't have art for yet).
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
export default function PlayerHeadshot({ playerId, className = "" }: { playerId: number; className?: string }) {
  return (
    <img
      className={`player-headshot ${className}`.trim()}
      src={`https://a.espncdn.com/i/headshots/nfl/players/full/${playerId}.png`}
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
