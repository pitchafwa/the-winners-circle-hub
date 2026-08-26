import { pts, signed, gameTime } from "../lib/format";
import type { RosterPlayerCard, TeamRoster } from "../types/data";

// ESPN's own short injury-designation letters — anything not in here (or
// ACTIVE, the healthy default) falls back to the raw status string so a
// designation this map hasn't seen yet still shows something real instead
// of silently disappearing.
const INJURY_ABBR: Record<string, string> = {
  QUESTIONABLE: "Q",
  DOUBTFUL: "D",
  OUT: "O",
  INJURY_RESERVE: "IR",
  SUSPENSION: "SUSP",
  PROBABLE: "P",
};

function OppCell({ card }: { card: RosterPlayerCard }) {
  if (card.player_id === null) return <span className="muted">—</span>;
  if (card.on_bye) return <span className="muted">BYE</span>;
  if (!card.next_game) return <span className="muted">—</span>;
  return (
    <span>
      {card.next_game.is_home ? "vs" : "@"} <strong>{card.next_game.opponent}</strong>{" "}
      <span className="muted" style={{ fontSize: "0.75rem" }}>{gameTime(card.next_game.date)}</span>
    </span>
  );
}

function PlayerRow({ card }: { card: RosterPlayerCard }) {
  const injury =
    card.injury_status && card.injury_status !== "ACTIVE"
      ? (INJURY_ABBR[card.injury_status] ?? card.injury_status)
      : null;

  return (
    <tr>
      <td className="muted">{card.slot}</td>
      <td>
        {card.player_id === null ? (
          <span className="muted">Empty</span>
        ) : (
          <>
            <strong>{card.name}</strong>{" "}
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              {card.position} · {card.pro_team}
            </span>
            {injury && (
              <span className="neg" style={{ fontSize: "0.72rem", marginLeft: "0.35rem" }}>
                {injury}
              </span>
            )}
          </>
        )}
      </td>
      <td><OppCell card={card} /></td>
      <td className="num">{pts(card.week_projection)}</td>
      <td className="num muted">
        {card.recent.length > 0 ? card.recent.map((r) => pts(r.points)).join(", ") : "—"}
      </td>
      <td className={`num ${card.recent_avg_diff !== null ? (card.recent_avg_diff >= 0 ? "pos" : "neg") : ""}`}>
        {signed(card.recent_avg_diff)}
      </td>
    </tr>
  );
}

function RosterSection({ title, cards }: { title: string; cards: RosterPlayerCard[] }) {
  if (cards.length === 0) return null;
  return (
    <>
      <tr className="roster-section-row"><td colSpan={6}>{title}</td></tr>
      {cards.map((c, i) => (
        <PlayerRow key={c.player_id ?? `empty-${i}`} card={c} />
      ))}
    </>
  );
}

export default function RosterTable({ roster }: { roster: TeamRoster }) {
  return (
    <div className="table-wrap">
      <table className="stat roster-table">
        <thead>
          <tr>
            <th scope="col">Slot</th>
            <th scope="col">Player</th>
            <th scope="col">Next game</th>
            <th scope="col" className="num">Proj</th>
            <th scope="col" className="num" title="Actual points, most recent games first">Recent</th>
            <th scope="col" className="num"
              title="Average of actual minus projected over the last 3 games — our own signal, not something ESPN shows">
              Diff
            </th>
          </tr>
        </thead>
        <tbody>
          <RosterSection title="Starters" cards={roster.starters} />
          <RosterSection title="Bench" cards={roster.bench} />
          <RosterSection title="IR" cards={roster.ir} />
        </tbody>
      </table>
    </div>
  );
}
