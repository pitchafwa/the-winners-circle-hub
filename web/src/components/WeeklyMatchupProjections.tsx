import { useApp } from "../state/AppContext";
import { MISSING, pct, pts } from "../lib/format";
import { h2hLookup } from "../lib/h2h";
import { displayOrderIndices } from "../lib/lineupOrder";
import MobileLineupList from "./MobileLineupList";
import PlayerHeadshot from "./PlayerHeadshot";
import type { H2HPair, SimMatchup, WeekLineupPlayer } from "../types/data";

export interface TeamInfo {
  record: string;
  streak: string;
}

/** Playoff impact is a combined percentage-point swing (0-2 in theory,
 * usually much smaller) — bucket it into a plain-English read rather than
 * asking the reader to calibrate a raw number. */
function impactLabel(score: number): { text: string; tone: "" | "pos" } {
  if (score >= 0.3) return { text: "🔥 huge swing game", tone: "pos" };
  if (score >= 0.12) return { text: "Playoff stakes", tone: "" };
  return { text: "Low stakes", tone: "" };
}

function TeamScore({
  name,
  info,
  current,
  projected,
  remaining,
  totalStarters,
  started,
  align,
}: {
  name: string;
  info: TeamInfo | undefined;
  current: number | null;
  projected: number;
  remaining: number;
  totalStarters: number;
  started: boolean;
  align: "left" | "right";
}) {
  // Preseason ESPN reports a streak of "N0" ("None") — real, but noise to
  // print next to every single team, so only show a genuine win/loss run.
  const hasStreak = info?.streak && !info.streak.startsWith("N");
  const recordBits = info && (
    <span className="muted mu-record">
      {info.record}{hasStreak ? ` · ${info.streak}` : ""}
    </span>
  );
  return (
    <div className="mu-team">
      <span className="mu-name-row">
        {align === "left" ? (
          <>
            <strong>{name}</strong>
            {recordBits}
          </>
        ) : (
          <>
            {recordBits}
            <strong>{name}</strong>
          </>
        )}
      </span>
      {started ? (
        <>
          <span className="num mu-total">{pts(current)}</span>
          <span className="num muted mu-proj-final">proj final {pts(projected)}</span>
          {totalStarters > 0 && (
            <span className="muted mu-remaining">{remaining} of {totalStarters} left to play</span>
          )}
        </>
      ) : (
        <>
          <span className="num mu-total">{pts(projected)}</span>
          <span className="muted mu-proj-label">projected</span>
        </>
      )}
    </div>
  );
}

function LineupRow({ p }: { p: WeekLineupPlayer | undefined }) {
  if (!p || p.player_id === null) return <div className="mu-player" />;
  // Slot badge already tells you what's needed for every started player
  // (including flex slots like RB/WR or FLEX) — repeating the player's
  // actual position next to a name we already recognize is just noise.
  const showPosition = p.slot === "BE" || p.slot === "IR";
  return (
    <div className="mu-player">
      <span className="mu-name-group">
        <PlayerHeadshot playerId={p.player_id} position={p.position} proTeam={p.pro_team} className="mu-headshot" />
        <span className="mu-name">
          {p.name}
          {showPosition && <span className="muted mu-pos"> {p.position}</span>}
        </span>
        {p.on_fire && <span className="on-fire-flame" title="On fire — well ahead of projection">🔥</span>}
        {p.on_ice && <span className="on-fire-flame" title="Ice cold — well behind projection">🧊</span>}
      </span>
      <span className="num mu-pts">
        {p.played ? pts(p.actual) : <span className="muted">{MISSING}</span>}
        <span className="muted mu-proj"> /{pts(p.projected)}</span>
      </span>
    </div>
  );
}

export default function WeeklyMatchupProjections({
  matchups,
  teamInfo,
  h2hPairs,
}: {
  matchups: SimMatchup[];
  teamInfo: Map<number, TeamInfo>;
  h2hPairs: H2HPair[];
}) {
  const { teamName, myTeamId } = useApp();

  return (
    <div className="mu-list">
      {matchups.map((m) => {
        const awayWinPct = 1 - m.home_win_pct;
        const homeFavored = m.home_win_pct >= 0.5;
        const impact = impactLabel(m.playoff_impact_score);
        const mine = m.home_id === myTeamId || m.away_id === myTeamId;
        const h2h = h2hLookup(h2hPairs, m.away_id, m.home_id);
        const rows = Math.max(m.away_lineup.length, m.home_lineup.length);
        // Both sides share the identical real slot order index-for-index,
        // so one permutation (computed off either side) reorders both.
        const order = displayOrderIndices(m.away_lineup.map((p) => p.slot));

        return (
          <article key={`${m.home_id}-${m.away_id}`} className="mu-card"
            style={mine ? { borderColor: "var(--accent)" } : undefined}>
            <div className="label" style={{ marginBottom: "0.4rem" }}>
              Week {m.matchup_period}{mine ? " · your game" : ""}
              {m.projection_source === "model" && (
                <span className="muted" style={{ textTransform: "none", fontStyle: "italic" }}>
                  {" "}· ESPN projections not available yet, estimated
                </span>
              )}
            </div>

            {/* Away on the left, home on the right — same convention as the
               real box-score cards, so "who's home" reads the same everywhere. */}
            <div className="mu-head">
              <TeamScore
                name={teamName(m.away_id)}
                info={teamInfo.get(m.away_id)}
                current={m.away_current}
                projected={m.away_projected}
                remaining={m.away_remaining}
                totalStarters={m.away_total_starters}
                started={m.started}
                align="left"
              />
              <span className="muted mu-at">
                at
                {h2h && (
                  <span className="mu-h2h" title="all-time head-to-head">
                    {h2h.wins}-{h2h.losses}{h2h.ties ? `-${h2h.ties}` : ""}
                  </span>
                )}
              </span>
              <TeamScore
                name={teamName(m.home_id)}
                info={teamInfo.get(m.home_id)}
                current={m.home_current}
                projected={m.home_projected}
                remaining={m.home_remaining}
                totalStarters={m.home_total_starters}
                started={m.started}
                align="right"
              />
            </div>

            {/* "Tug of war" win-probability bar — each side's own color (green
               favored, red underdog) so it doesn't read as sharing the gold
               "playoff stakes" tone below, with each team's % printed inside
               its own end of the bar. */}
            <div className="mu-wp-track" aria-hidden="true">
              <span
                className={`mu-wp-seg ${awayWinPct >= 0.5 ? "favored" : "underdog"}`}
                style={{ left: 0, width: `${awayWinPct * 100}%` }}
              />
              <span
                className={`mu-wp-seg ${homeFavored ? "favored" : "underdog"}`}
                style={{ left: `${awayWinPct * 100}%`, width: `${m.home_win_pct * 100}%` }}
              />
              <div className="mu-wp-labels">
                <span>{pct(awayWinPct, 0)}</span>
                <span>{pct(m.home_win_pct, 0)}</span>
              </div>
            </div>

            <div className={`trade-verdict ${impact.tone}`} style={{ marginTop: "0.75rem", marginBottom: rows > 0 ? "0.9rem" : 0 }}>
              {impact.text}
            </div>

            {rows > 0 && (
              <>
                <div className="mu-grid">
                  <div className="mu-col">
                    {order.map((idx, i) => (
                      <LineupRow key={i} p={m.away_lineup[idx]} />
                    ))}
                  </div>
                  <div className="mu-slots">
                    {order.map((idx, i) => (
                      <div key={i} className="label mu-slot">
                        <span className="c-badge">{m.home_lineup[idx]?.slot ?? m.away_lineup[idx]?.slot ?? ""}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mu-col right">
                    {order.map((idx, i) => (
                      <LineupRow key={i} p={m.home_lineup[idx]} />
                    ))}
                  </div>
                </div>
                <MobileLineupList
                  awayName={teamName(m.away_id)} awayPlayers={order.map((idx) => m.away_lineup[idx])}
                  homeName={teamName(m.home_id)} homePlayers={order.map((idx) => m.home_lineup[idx])}
                />
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
