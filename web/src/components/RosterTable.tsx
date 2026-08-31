import { forwardRef } from "react";
import { pts, signed, gameTime } from "../lib/format";
import { displayOrderIndices } from "../lib/lineupOrder";
import { useApp } from "../state/AppContext";
import PlayerCardTrigger from "./PlayerCardTrigger";
import PlayerHeadshot from "./PlayerHeadshot";
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

function PlayerRow({ card, showFp }: { card: RosterPlayerCard; showFp: boolean }) {
  const injury =
    card.injury_status && card.injury_status !== "ACTIVE"
      ? (INJURY_ABBR[card.injury_status] ?? card.injury_status)
      : null;

  const last = card.recent[0]?.points ?? null;
  const last3 = card.recent.length
    ? card.recent.reduce((sum, r) => sum + r.points, 0) / card.recent.length
    : null;

  return (
    <tr>
      <td className="muted">{card.slot}</td>
      <td>
        {card.player_id === null ? (
          <span className="muted">Empty</span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <PlayerHeadshot playerId={card.player_id} position={card.position} proTeam={card.pro_team} />
            <span>
              <strong style={card.suggested ? { fontStyle: "italic" } : undefined}>
                <PlayerCardTrigger playerId={card.player_id} name={card.name} position={card.position} proTeam={card.pro_team}>
                  {card.name}
                </PlayerCardTrigger>
              </strong>{" "}
              {card.on_fire && <span className="on-fire-flame" title="On fire — well ahead of projection">🔥</span>}
              {card.on_ice && <span className="on-fire-flame" title="Ice cold — well behind projection">🧊</span>}
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                {card.position} · {card.pro_team}
              </span>
              {injury && (
                <span className="neg" style={{ fontSize: "0.72rem", marginLeft: "0.35rem" }}>
                  {injury}
                </span>
              )}
              {card.suggested && (
                <span className="muted" style={{ fontSize: "0.72rem", marginLeft: "0.35rem" }}
                  title="This slot is empty on ESPN — showing the best available bench player instead of leaving it blank">
                  (suggested)
                </span>
              )}
            </span>
          </div>
        )}
      </td>
      <td><OppCell card={card} /></td>
      <td className="num">{pts(card.week_projection)}</td>
      {showFp && (
        <td className="num muted" title="FantasyPros' generic PPR consensus projection — a second opinion, not scored against this league's exact custom rules the way ESPN's own projection above is">
          {pts(card.fp_projection)}
        </td>
      )}
      <td className="num muted">{pts(last)}</td>
      <td className="num muted">{pts(last3)}</td>
      <td className={`num ${card.recent_avg_diff !== null ? (card.recent_avg_diff >= 0 ? "pos" : "neg") : ""}`}>
        {signed(card.recent_avg_diff)}
      </td>
    </tr>
  );
}

function RosterSection({ title, cards, totalProjected, totalFp, showFp }: {
  title: string; cards: RosterPlayerCard[]; totalProjected?: number; totalFp?: number; showFp: boolean;
}) {
  if (cards.length === 0) return null;
  return (
    <>
      <tr className="roster-section-row">
        <td colSpan={3}>{title}</td>
        <td className="num">{totalProjected !== undefined ? pts(totalProjected) : ""}</td>
        {showFp && <td className="num muted">{totalFp !== undefined ? pts(totalFp) : ""}</td>}
        <td colSpan={3}></td>
      </tr>
      {cards.map((c, i) => (
        <PlayerRow key={c.player_id ?? `empty-${i}`} card={c} showFp={showFp} />
      ))}
    </>
  );
}

const RosterTable = forwardRef<HTMLTableElement, { roster: TeamRoster }>(function RosterTable({ roster }, ref) {
  // FantasyPros' projection column is LM-Tools-gated (same password gate
  // as the rest of that menu) — a third-party projection isn't core site
  // content the way ESPN's own is, and this keeps the column out of the
  // way for anyone who hasn't unlocked LM Tools.
  const { adminUnlocked } = useApp();

  // Display order only — roster.json's own starting-slot order (real ESPN
  // ascending slot-id order) is untouched; RB/WR and FLEX render grouped
  // right after the WRs instead of split across the two ends of the list,
  // same reorder MatchupsPage's lineup grid already uses.
  const slotLabels = roster.starters.map((s) => s.slot);
  const orderedStarters = displayOrderIndices(slotLabels).map((i) => roster.starters[i]);
  const totalProjected = roster.starters.reduce((sum, s) => sum + (s.week_projection ?? 0), 0);
  const totalFp = roster.starters.reduce((sum, s) => sum + (s.fp_projection ?? 0), 0);

  return (
    <div className="table-wrap">
      <table className="stat roster-table" ref={ref}>
        <thead>
          <tr>
            <th scope="col">Slot</th>
            <th scope="col">Player</th>
            <th scope="col">Next game</th>
            <th scope="col" className="num">Proj</th>
            {adminUnlocked && (
              <th scope="col" className="num" title="FantasyPros' generic PPR consensus projection">FP</th>
            )}
            <th scope="col" className="num" title="Points scored, most recent game">Last</th>
            <th scope="col" className="num" title="Average points scored over the last 3 games">Last3</th>
            <th scope="col" className="num"
              title="Average of actual minus projected points per game over the last 3 games — our own signal, not something ESPN shows">
              Diff
            </th>
          </tr>
        </thead>
        <tbody>
          <RosterSection title="Starters" cards={orderedStarters} totalProjected={totalProjected}
            totalFp={totalFp} showFp={adminUnlocked} />
          <RosterSection title="Bench" cards={roster.bench} showFp={adminUnlocked} />
          <RosterSection title="IR" cards={roster.ir} showFp={adminUnlocked} />
        </tbody>
      </table>
    </div>
  );
});

export default RosterTable;
