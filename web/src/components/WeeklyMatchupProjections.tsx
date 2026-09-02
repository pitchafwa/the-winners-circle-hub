import { useApp } from "../state/AppContext";
import { MISSING, pct, pts } from "../lib/format";
import { h2hLookup } from "../lib/h2h";
import { displayOrderIndices } from "../lib/lineupOrder";
import MobileLineupList from "./MobileLineupList";
import PlayerCardTrigger from "./PlayerCardTrigger";
import PlayerHeadshot from "./PlayerHeadshot";
import TeamLink from "./TeamLink";
import type { AwardTone, H2HPair, SimMatchup, SimTeam, WeekLineupPlayer } from "../types/data";

export interface TeamInfo {
  record: string;
  streak: string;
}

const ELIMINATION_THRESHOLD = 0.05;
const CLINCH_THRESHOLD = 0.97;

// Playoff impact is a combined percentage-point swing (0-2 in theory,
// usually much smaller) in BOTH teams' playoff odds between winning and
// losing this one game. Gated to the back half of the regular season —
// early on, the model is maximally uncertain about how the whole race
// plays out (nothing is decided yet), which makes a single game's swing
// look artificially large in a way that has nothing to do with real
// stakes: no one calls a week 1 game "playoff stakes" in real fantasy
// football, no matter what a same-week Monte Carlo delta says. Requiring
// at least half the season played before this can fire at all is a
// blunter fix than trying to normalize the raw score against its own
// week's distribution, but it directly matches the actual complaint
// (Tommy, 2026-09-02: "do week 1 games really have much playoff stakes?
// it currently applies to every week 1 matchup") without inventing a
// more complex statistical model for a plain-English badge.
const PLAYOFF_IMPACT_HUGE_SWING = 0.3;
const PLAYOFF_IMPACT_STAKES = 0.12;

// Upset alert used to flag whichever underdog had the highest THIS-WEEK
// win probability — which only ever meant "the least underdog of the
// underdogs," not a real upset story (Tommy, 2026-09-02: "that just
// indicates that they're less of an underdog"). Redesigned around
// power_score (1-100, see metrics.power_score_1_100 — same redraft
// roster-value signal that nudges the playoff-odds prior): an "upset"
// needs a team that's genuinely worse by roster quality (a real gap,
// not a coin flip) that still has a live shot at winning THIS specific
// game. POWER_GAP_THRESHOLD is a meaningful chunk of this season's real
// observed spread (~30-75 as of 2026-09-02, so 15 points is a clearly-
// worse-roster gap, not noise); UPSET_WIN_PROB_THRESHOLD keeps the
// "still expected to lose, but has a real shot" framing intact — a team
// that's already favored despite the power gap is a different story
// (recent form beating preseason reputation), not an upset alert.
const POWER_GAP_THRESHOLD = 15;
const UPSET_WIN_PROB_THRESHOLD = 0.4;

interface MatchupFlag {
  key: string;
  teamId: number | null;
  label: string;
  tone: AwardTone;
}

/** Elimination/clinch read off the SAME playoff_pct_if_win_next/
 * playoff_pct_if_lose_next fields the Playoff Probability bars already use
 * — a team "faces elimination" only if a loss THIS week would actually be
 * what does it (current playoff_pct still real, not already ~0), and only
 * "can clinch" if a win THIS week would actually be what does it (not
 * already effectively in). Scoped to the regular season — a real playoff
 * bracket game is already sudden-death by construction, and these fields
 * mean something different there. Playoff-impact and upset alert are both
 * playoff_pct-independent so they're shown for playoff games too.
 * `regSeasonWeeks` gates playoff-impact to the back half of the season —
 * see PLAYOFF_IMPACT_STAKES' comment for why. */
function matchupFlags(m: SimMatchup, simTeams: Map<number, SimTeam>, teamName: (id: number) => string,
                      regSeasonWeeks: number): MatchupFlag[] {
  const flags: MatchupFlag[] = [];
  if (!m.is_playoff) {
    for (const id of [m.away_id, m.home_id]) {
      const s = simTeams.get(id);
      if (!s) continue;
      if (s.playoff_pct_if_lose_next !== null && s.playoff_pct_if_lose_next < ELIMINATION_THRESHOLD
          && s.playoff_pct >= ELIMINATION_THRESHOLD) {
        flags.push({ key: `elim-${id}`, teamId: id, label: `${teamName(id)}: must win`, tone: "negative" });
      }
      if (s.playoff_pct_if_win_next !== null && s.playoff_pct_if_win_next >= CLINCH_THRESHOLD
          && s.playoff_pct < CLINCH_THRESHOLD) {
        flags.push({ key: `clinch-${id}`, teamId: id, label: `${teamName(id)}: clinches with a win`, tone: "positive" });
      }
    }
  }

  if (m.matchup_period >= Math.ceil(regSeasonWeeks / 2)) {
    if (m.playoff_impact_score >= PLAYOFF_IMPACT_HUGE_SWING) {
      flags.push({ key: "impact", teamId: null, label: "🔥 huge swing game", tone: "gold" });
    } else if (m.playoff_impact_score >= PLAYOFF_IMPACT_STAKES) {
      flags.push({ key: "impact", teamId: null, label: "Playoff stakes", tone: "positive" });
    }
  }

  const awaySide = simTeams.get(m.away_id);
  const homeSide = simTeams.get(m.home_id);
  if (awaySide && homeSide) {
    const awayWinPct = 1 - m.home_win_pct;
    const [dogId, dogPower, dogWinPct, favPower] = awaySide.power_score <= homeSide.power_score
      ? [m.away_id, awaySide.power_score, awayWinPct, homeSide.power_score]
      : [m.home_id, homeSide.power_score, m.home_win_pct, awaySide.power_score];
    const powerGap = favPower - dogPower;
    if (powerGap >= POWER_GAP_THRESHOLD && dogWinPct >= UPSET_WIN_PROB_THRESHOLD && dogWinPct < 0.5) {
      flags.push({
        key: "upset", teamId: dogId,
        label: `Upset alert: ${teamName(dogId)} has a real shot (${pct(dogWinPct, 0)}) despite the roster gap`,
        tone: "gold",
      });
    }
  }

  return flags;
}

function MatchupFlags({ flags }: { flags: MatchupFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="mu-ribbons" style={{ marginBottom: "0.6rem" }}>
      {flags.map((f) => (
        <span key={f.key} className="badge-chip mu-ribbon" data-tone={f.tone}>
          {f.teamId !== null ? <TeamLink id={f.teamId} className="team-link">{f.label}</TeamLink> : f.label}
        </span>
      ))}
    </div>
  );
}

function TeamScore({
  teamId,
  name,
  info,
  current,
  projected,
  remaining,
  totalStarters,
  started,
  align,
}: {
  teamId: number;
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
  const nameBits = <strong><TeamLink id={teamId}>{name}</TeamLink></strong>;
  return (
    <div className="mu-team">
      <span className="mu-name-row">
        {align === "left" ? (
          <>
            {nameBits}
            {recordBits}
          </>
        ) : (
          <>
            {recordBits}
            {nameBits}
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
          <PlayerCardTrigger playerId={p.player_id} name={p.name} position={p.position} proTeam={p.pro_team}>
            {p.name}
          </PlayerCardTrigger>
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
  simTeams,
  regSeasonWeeks,
}: {
  matchups: SimMatchup[];
  teamInfo: Map<number, TeamInfo>;
  h2hPairs: H2HPair[];
  simTeams: Map<number, SimTeam>;
  regSeasonWeeks: number;
}) {
  const { teamName, myTeamId } = useApp();

  return (
    <div className="mu-list">
      {matchups.map((m) => {
        const awayWinPct = 1 - m.home_win_pct;
        const homeFavored = m.home_win_pct >= 0.5;
        const mine = m.home_id === myTeamId || m.away_id === myTeamId;
        const h2h = h2hLookup(h2hPairs, m.away_id, m.home_id);
        const rows = Math.max(m.away_lineup.length, m.home_lineup.length);
        const flags = matchupFlags(m, simTeams, teamName, regSeasonWeeks);
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

            <MatchupFlags flags={flags} />

            {/* Away on the left, home on the right — same convention as the
               real box-score cards, so "who's home" reads the same everywhere. */}
            <div className="mu-head">
              <TeamScore
                teamId={m.away_id}
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
                teamId={m.home_id}
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
               favored, red underdog), with each team's % printed inside its
               own end of the bar. Playoff stakes/huge-swing and upset alert
               are both ribbon badges above the card now (MatchupFlags), not
               a banner here — so this just needs its own bottom margin. */}
            <div className="mu-wp-track" aria-hidden="true" style={{ marginBottom: rows > 0 ? "0.9rem" : 0 }}>
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
