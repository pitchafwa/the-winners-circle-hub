import { pts } from "../lib/format";
import PlayerHeadshot from "./PlayerHeadshot";

// LineupPlayer and WeekLineupPlayer (the two real per-player shapes this
// renders) both satisfy this structurally — no need to import either type
// here, just the fields actually used.
export interface StackablePlayer {
  player_id: number | null;
  name: string | null;
  position: string | null;
  pro_team: string | null;
  slot: string;
  actual: number | null;
  projected: number | null;
  played: boolean;
  on_fire: boolean;
  on_ice: boolean;
}

function StackedRow({ p }: { p: StackablePlayer | undefined }) {
  if (!p) return null;
  return (
    <div className="c-row">
      <span className="c-badge">{p.slot}</span>
      {p.player_id === null ? (
        <span className="c-name-wrap"><span className="c-name muted">Empty</span></span>
      ) : (
        <>
          <PlayerHeadshot playerId={p.player_id} position={p.position} proTeam={p.pro_team} className="leaderboard-headshot" />
          <span className="c-name-wrap">
            <span className="c-name">{p.name}</span>
            {p.on_fire && <span className="on-fire-flame" title="On fire — well ahead of projection">🔥</span>}
            {p.on_ice && <span className="on-fire-flame" title="Ice cold — well behind projection">🧊</span>}
          </span>
          <span className="c-stat">
            {p.played ? pts(p.actual) : <span className="muted">—</span>}
            <span className="muted"> /{pts(p.projected)}</span>
          </span>
        </>
      )}
    </div>
  );
}

/** Option C — Tommy's pick for mobile: a full-width stacked list per team
 * (away, then home) instead of the desktop's 3-column side-by-side grid.
 * Position renders as the same small badge desktop's middle slot column
 * uses (.c-badge), just inline before the name instead of in its own
 * column — there's no room on a phone for 3 columns to stay legible, and
 * giving every row the full card width means a name almost never needs
 * to wrap, unlike the side-by-side layout this replaces on mobile.
 * Desktop is entirely unaffected — see the .mu-grid / .mobile-lineup
 * toggle in global.css, this component only ever renders (visibly) below
 * 640px. */
export default function MobileLineupList({
  awayName, awayPlayers, homeName, homePlayers,
}: {
  awayName: string;
  awayPlayers: (StackablePlayer | undefined)[];
  homeName: string;
  homePlayers: (StackablePlayer | undefined)[];
}) {
  return (
    <div className="mobile-lineup">
      <div className="team-block">
        <div className="team-block-head">{awayName}</div>
        {awayPlayers.map((p, i) => <StackedRow key={p?.player_id ?? `empty-${i}`} p={p} />)}
      </div>
      <div className="team-block">
        <div className="team-block-head">{homeName}</div>
        {homePlayers.map((p, i) => <StackedRow key={p?.player_id ?? `empty-${i}`} p={p} />)}
      </div>
    </div>
  );
}
