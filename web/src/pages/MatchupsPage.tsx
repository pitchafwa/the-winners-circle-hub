import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useApp } from "../state/AppContext";
import { useJson, useOptionalJson } from "../lib/data";
import { MISSING, pct, pts, signed } from "../lib/format";
import EmptyState from "../components/EmptyState";
import MobileLineupList from "../components/MobileLineupList";
import PlayerCardTrigger from "../components/PlayerCardTrigger";
import PlayerHeadshot from "../components/PlayerHeadshot";
import ScreenshotButton from "../components/ScreenshotButton";
import TeamLink from "../components/TeamLink";
import WeeklyMatchupProjections from "../components/WeeklyMatchupProjections";
import type { TeamInfo } from "../components/WeeklyMatchupProjections";
import { displayOrderIndices } from "../lib/lineupOrder";
import type {
  Award, AwardMeta, AwardTone, H2H, LineupPlayer, Matchup, MatchupSide,
  Sim, SimMatchup, SimTeam, Standings, Superlatives, WeekMatchups,
} from "../types/data";

// Not present in the data (AwardMeta has no icon field) — a small, stable
// set of weekly award keys, so a local map is simpler than threading an
// icon through the backend for something purely decorative.
const AWARD_ICON: Record<string, string> = {
  highest_score: "🏆",
  best_coach: "🧠",
  blowout: "💥",
  projection_buster: "🚀",
  waiver_hero: "🦸",
  nail_biter: "😬",
  luckiest: "🍀",
  unluckiest: "💔",
  bust: "📉",
  worst_benching: "🪑",
  lowest_score: "🥶",
};

function headlineValue(award: Award): string {
  if (award.key === "best_coach") return pct(award.value / 100, 1);
  // projection_buster's value is always positive by construction (only
  // awarded when actual > projected) — signed() adds the "+" that makes
  // "beat projection by this much" read clearly at a glance. bust's value
  // is always negative, so plain pts() already renders its own "-".
  if (award.key === "projection_buster") return signed(award.value);
  return pts(award.value);
}

/** "Biggest pre-game favorite that lost" — not a real award type from
 * superlatives.json (there's no persisted pre-game win probability for a
 * PAST week to read back — sim.json only ever holds the live/current
 * week's projection, overwritten every build). Reconstructed instead from
 * matchups/week-N.json's own real per-player projected points, which ARE
 * kept permanently once a week is decided: sum each side's STARTED
 * lineup's projected total (the same real pre-game numbers, just not run
 * through the win-probability model) and call whichever side projected
 * higher the pre-game favorite. Works for any real completed week,
 * current or years-old, with no new backend field. */
function worstLoss(matchups: Matchup[], teamName: (id: number) => string): { team: string; teamId: number; margin: number } | null {
  let worst: { team: string; teamId: number; margin: number } | null = null;
  for (const m of matchups) {
    if (!m.away || m.winner === "UNDECIDED" || m.winner === "TIE") continue;
    const homeProj = m.home.lineup.filter((p) => p.started).reduce((s, p) => s + (p.projected ?? 0), 0);
    const awayProj = m.away.lineup.filter((p) => p.started).reduce((s, p) => s + (p.projected ?? 0), 0);
    const homeFavored = homeProj >= awayProj;
    const favoriteWon = (homeFavored && m.winner === "HOME") || (!homeFavored && m.winner === "AWAY");
    if (favoriteWon) continue;
    const margin = Math.abs(homeProj - awayProj);
    if (!worst || margin > worst.margin) {
      const teamId = homeFavored ? m.home.team_id : m.away.team_id;
      worst = { team: teamName(teamId), teamId, margin };
    }
  }
  return worst;
}

/** Two small, cheap-to-compute storylines for the upcoming week — kept to
 * just these two on purpose (Tommy's ask: "only a few and on the smaller
 * side," shouldn't push the real matchup cards down). Game of the Week
 * reuses this_week_matchups' own existing sort (already ordered by
 * playoff_impact_score descending, so the first entry IS the pick — no
 * separate sort needed). Biggest Underdog scans every team's own win
 * probability across every game this week (not just favorites vs.
 * underdogs within a single game) for the single longest shot. */
function biggestUnderdog(matchups: SimMatchup[]): { team: number; winPct: number } | null {
  let worst: { team: number; winPct: number } | null = null;
  for (const m of matchups) {
    const awayPct = 1 - m.home_win_pct;
    if (!worst || m.home_win_pct < worst.winPct) worst = { team: m.home_id, winPct: m.home_win_pct };
    if (!worst || awayPct < worst.winPct) worst = { team: m.away_id, winPct: awayPct };
  }
  return worst;
}

function HeadlineCard({ icon, label, tone, children }: {
  icon: string; label: string; tone: AwardTone; children: ReactNode;
}) {
  return (
    <div className="headline-card" data-tone={tone}>
      <span className="headline-icon" aria-hidden="true">{icon}</span>
      <div>
        <div className="headline-label">{label}</div>
        <div className="headline-value">{children}</div>
      </div>
    </div>
  );
}

/** Lines up a team's started lineup against the league's real slot order
 * (e.g. QB, RB, RB, RB/WR, WR, WR, TE, D/ST, K, FLEX) by each player's own
 * real `.slot`, rather than raw array position. A manager who leaves a
 * slot unfilled that week (confirmed real — happens most weeks somewhere
 * in this league's history) makes that team's started-player count fall
 * short of a fully-staffed opponent's; zipping two such lists by index
 * shifts everything after the gap out of alignment, which is what was
 * making some rows' position label not match the player shown there. */
function alignBySlot(lineup: LineupPlayer[], slotOrder: string[]): (LineupPlayer | undefined)[] {
  const bySlot = new Map<string, LineupPlayer[]>();
  for (const p of lineup) {
    if (!p.started) continue;
    const list = bySlot.get(p.slot) ?? [];
    list.push(p);
    bySlot.set(p.slot, list);
  }
  return slotOrder.map((slot) => bySlot.get(slot)?.shift());
}

function PlayerRow({ p }: { p: LineupPlayer | undefined }) {
  if (!p) return <div className="mu-player" />;
  // Same reasoning as the projected card's LineupRow: the position tag is
  // only useful in the bench list, where "slot" (BE/IR) isn't a real
  // position at all — for started players (including flex slots like
  // RB/WR or FLEX) the slot badge already tells you what's needed, and
  // repeating the player's actual position next to a name we already
  // recognize is just noise.
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
        {pts(p.actual)}
        <span className="muted mu-proj">{p.projected !== null ? ` /${pts(p.projected)}` : ""}</span>
      </span>
    </div>
  );
}

function SideMeta({ side }: { side: MatchupSide }) {
  return (
    <div className="muted mu-meta">
      coach {side.coach_rating !== null ? pct(side.coach_rating) : MISSING} · left{" "}
      {pts(side.bench_points_lost)} benched
      {side.home_bonus > 0 && <> · +{pts(side.home_bonus)} home</>}
      {side.adjustment !== 0 && <> · {side.adjustment > 0 ? "+" : ""}{pts(side.adjustment)} adj</>}
    </div>
  );
}

function Ribbons({ awards, awardsMeta }: { awards: Award[]; awardsMeta: Record<string, AwardMeta> }) {
  if (awards.length === 0) return null;
  return (
    <div className="mu-ribbons">
      {awards.map((a) => {
        const meta = awardsMeta[a.key];
        return (
          <span key={a.key} className="badge-chip mu-ribbon" data-tone={meta?.tone ?? "neutral"} title={a.detail}>
            {meta?.label ?? a.key}
          </span>
        );
      })}
    </div>
  );
}

function MatchupCard({
  m,
  awardsByTeam,
  awardsMeta,
}: {
  m: Matchup;
  awardsByTeam: Map<number, Award[]>;
  awardsMeta: Record<string, AwardMeta>;
}) {
  const { teamName, meta } = useApp();
  const cardRef = useRef<HTMLElement>(null);
  // Forces the card into its desktop side-by-side layout for the duration
  // of a screenshot capture, regardless of the real (mobile) viewport —
  // see .mu-card-force-desktop in global.css for what this class actually
  // overrides and why simply un-hiding .mu-grid alone isn't enough.
  //
  // Driven through real React state (via flushSync), not a direct
  // `classList.add` on the DOM node: a raw DOM mutation is invisible to
  // React's own reconciler, so if this component re-rendered for any
  // unrelated reason during the capture's async gap (loading html-to-image,
  // decoding the image), React would reassert `className` from its virtual
  // DOM and silently wipe the manually-added class mid-capture. flushSync
  // forces the state update to commit synchronously before capture
  // proceeds, so there's no gap for that race to happen in — the safer
  // way to drive this even though a raw classList toggle happened to test
  // out fine here.
  const [forceDesktop, setForceDesktop] = useState(false);
  const prepareCapture = () => flushSync(() => setForceDesktop(true));
  const cleanupCapture = () => flushSync(() => setForceDesktop(false));
  if (!m.away) {
    return (
      <article className="mu-card">
        <div className="mu-head">
          <strong><TeamLink id={m.home.team_id}>{teamName(m.home.team_id)}</TeamLink></strong>
          <span className="muted">bye</span>
        </div>
      </article>
    );
  }
  const homeWon = m.winner === "HOME";
  const awayWon = m.winner === "AWAY";
  // The league's real bracket collapses to exactly one WINNERS_BRACKET
  // game in the championship week (confirmed against real data — every
  // other game that week is a consolation ladder of some kind), so this
  // condition alone unambiguously identifies THE championship, no lookup
  // against final standings needed. Once it's decided, the winner of
  // THIS specific game is, by construction, the league champion.
  // Only the real elimination bracket counts as "playoffs" for styling —
  // a consolation ladder (WINNERS_CONSOLATION_LADDER for eliminated
  // playoff teams, LOSERS_CONSOLATION_LADDER for teams that never made
  // it) is still flagged is_playoff by the data, but Tommy's read is
  // that neither one is meaningfully "the playoffs" anymore.
  const isRealPlayoff = m.playoff_tier === "WINNERS_BRACKET";
  const isChampionship = isRealPlayoff && m.matchup_period === meta?.championship_week;
  const decided = m.winner !== "UNDECIDED" && m.winner !== "TIE";
  const cardClass = `mu-card${isRealPlayoff ? " mu-playoff" : ""}${isChampionship ? " mu-championship" : ""}${forceDesktop ? " mu-card-force-desktop" : ""}`;
  const realSlotOrder = meta?.starting_slots ?? [];
  // Reordered for display only — meta.starting_slots itself (the real
  // ESPN order) is untouched; this permutation just changes what order
  // the grid below renders rows in.
  const slotOrder = displayOrderIndices(realSlotOrder).map((i) => realSlotOrder[i]);
  const homeAligned = alignBySlot(m.home.lineup, slotOrder);
  const awayAligned = alignBySlot(m.away.lineup, slotOrder);

  const filename = `matchup-week${m.matchup_period}-${teamName(m.away.team_id)}-vs-${teamName(m.home.team_id)}`
    .toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <article className={cardClass} ref={cardRef}>
      <div className="mu-card-shot">
        <ScreenshotButton
          targetRef={cardRef}
          filename={filename}
          prepareCapture={prepareCapture}
          cleanupCapture={cleanupCapture}
        />
      </div>
      {m.is_playoff && <div className="label" style={{ marginBottom: "0.4rem" }}>
        {isChampionship ? "championship" : isRealPlayoff ? "playoffs" : "consolation"}</div>}
      <div className="mu-head">
        <div className={`mu-team ${awayWon ? "winner" : ""}`}>
          <span className="mu-name-row">
            {isChampionship && decided && awayWon && <span className="mu-crown" aria-hidden="true">👑</span>}
            <strong><TeamLink id={m.away.team_id}>{teamName(m.away.team_id)}</TeamLink></strong>
          </span>
          <span className="num mu-total">{pts(m.away.total)}</span>
          <Ribbons awards={awardsByTeam.get(m.away.team_id) ?? []} awardsMeta={awardsMeta} />
        </div>
        <span className="muted mu-at">at</span>
        <div className={`mu-team ${homeWon ? "winner" : ""}`}>
          <span className="mu-name-row">
            <strong><TeamLink id={m.home.team_id}>{teamName(m.home.team_id)}</TeamLink></strong>
            {isChampionship && decided && homeWon && <span className="mu-crown" aria-hidden="true">👑</span>}
          </span>
          <span className="num mu-total">{pts(m.home.total)}</span>
          <Ribbons awards={awardsByTeam.get(m.home.team_id) ?? []} awardsMeta={awardsMeta} />
        </div>
      </div>
      <div className="mu-grid">
        <div className="mu-col">
          {slotOrder.map((_slot, i) => (
            <PlayerRow key={i} p={awayAligned[i]} />
          ))}
        </div>
        <div className="mu-slots">
          {slotOrder.map((slot, i) => (
            <div key={i} className="label mu-slot"><span className="c-badge">{slot}</span></div>
          ))}
        </div>
        <div className="mu-col right">
          {slotOrder.map((_slot, i) => (
            <PlayerRow key={i} p={homeAligned[i]} />
          ))}
        </div>
      </div>
      <MobileLineupList
        awayName={teamName(m.away.team_id)} awayPlayers={awayAligned}
        homeName={teamName(m.home.team_id)} homePlayers={homeAligned}
      />
      <div className="mu-footer">
        <SideMeta side={m.away} />
        <SideMeta side={m.home} />
      </div>
      <details className="mu-bench">
        <summary className="label">benches</summary>
        <div className="mu-grid">
          <div className="mu-col">
            {m.away.lineup.filter((p) => !p.started).map((p) => <PlayerRow key={p.player_id} p={p} />)}
          </div>
          <div className="mu-slots" />
          <div className="mu-col right">
            {m.home.lineup.filter((p) => !p.started).map((p) => <PlayerRow key={p.player_id} p={p} />)}
          </div>
        </div>
        <MobileLineupList
          awayName={teamName(m.away.team_id)} awayPlayers={m.away.lineup.filter((p) => !p.started)}
          homeName={teamName(m.home.team_id)} homePlayers={m.home.lineup.filter((p) => !p.started)}
        />
      </details>
    </article>
  );
}

export default function MatchupsPage() {
  const { season, meta, teamName } = useApp();
  const weeks = meta?.completed_weeks ?? [];
  const [chosen, setChosen] = useState<number | null>(null);
  const week = chosen ?? weeks.at(-1) ?? null;
  const data = useJson<WeekMatchups>(
    season !== null && week !== null ? `${season}/matchups/week-${week}.json` : null,
  );
  const sim = useOptionalJson<Sim>(season !== null ? `${season}/sim.json` : null);
  const standings = useOptionalJson<Standings>(season !== null ? `${season}/standings.json` : null);
  const superlatives = useOptionalJson<Superlatives>(season !== null ? `${season}/superlatives.json` : null);
  const h2h = useOptionalJson<H2H>("h2h.json");

  if (!meta) return null;

  const teamInfo = new Map<number, TeamInfo>(
    (standings.data?.rows ?? []).map((r) => [r.team_id, { record: r.record, streak: r.streak }]),
  );
  const simTeams = new Map<number, SimTeam>((sim.data?.teams ?? []).map((t) => [t.team_id, t]));
  const weekAwards = (superlatives.data?.awards ?? []).filter((a) => a.week === week);
  const awardsByTeam = new Map<number, Award[]>();
  for (const a of weekAwards) {
    const list = awardsByTeam.get(a.team_id) ?? [];
    list.push(a);
    awardsByTeam.set(a.team_id, list);
  }
  // "Only 1-2 games actually count" weeks (essentially the playoffs, once
  // most of the field is playing out a consolation ladder instead) —
  // whole-league-pool storylines (Game of the Week, Biggest Underdog,
  // Worst Loss, and the equivalent backend awards like luckiest/highest
  // score) stop being meaningful once most of "the pool" isn't playing
  // for anything real that week, so these get skipped entirely rather
  // than partially filtered.
  const thisWeekIsRealPool = !(sim.data?.this_week_matchups?.some((m) => m.is_playoff) ?? false);
  const selectedWeekIsRegSeason = week !== null && week <= meta.reg_season_weeks;
  const underdog = thisWeekIsRealPool && sim.data?.this_week_matchups?.length
    ? biggestUnderdog(sim.data.this_week_matchups) : null;
  const weekWorstLoss = selectedWeekIsRegSeason && data.data ? worstLoss(data.data.matchups, teamName) : null;

  return (
    <>
      {sim.data && sim.data.this_week_matchups?.length > 0 && (
        <section className="section" aria-labelledby="weekly-h">
          <div className="section-head">
            <h2 id="weekly-h">This Week's Games</h2>
            <span className="label">projected score · win probability · playoff stakes</span>
          </div>
          {thisWeekIsRealPool && (
            <div className="headline-row">
              <HeadlineCard icon="🔥" label="Game of the Week" tone="gold">
                <TeamLink id={sim.data.this_week_matchups[0].away_id}>{teamName(sim.data.this_week_matchups[0].away_id)}</TeamLink>{" "}
                @ <TeamLink id={sim.data.this_week_matchups[0].home_id}>{teamName(sim.data.this_week_matchups[0].home_id)}</TeamLink>
              </HeadlineCard>
              {underdog && (
                <HeadlineCard icon="🐶" label="Biggest Underdog" tone="neutral">
                  <TeamLink id={underdog.team}>{teamName(underdog.team)}</TeamLink> <span className="muted">{pct(underdog.winPct, 0)} to win</span>
                </HeadlineCard>
              )}
            </div>
          )}
          <WeeklyMatchupProjections
            matchups={sim.data.this_week_matchups}
            teamInfo={teamInfo}
            h2hPairs={h2h.data?.pairs ?? []}
            simTeams={simTeams}
          />
        </section>
      )}

      <section className="section" style={sim.data?.this_week_matchups?.length ? { marginTop: "2.5rem" } : undefined}>
        <div className="section-head">
          <h2>Matchups</h2>
          {weeks.length > 0 && (
            <label>
              <span className="label">Week&nbsp;</span>
              <select className="control" value={week ?? ""} onChange={(e) => setChosen(Number(e.target.value))}>
                {weeks.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {weeks.length === 0 && <EmptyState>Matchups appear once games are played. Scores land here every Sunday.</EmptyState>}
        {data.error && <div className="error-state">{data.error}</div>}
        {data.data && (
          <>
            {(weekAwards.length > 0 || weekWorstLoss) && (
              <div className="headline-row" style={{ marginBottom: "1rem" }}>
                {weekAwards.map((a) => (
                  <HeadlineCard key={a.key} icon={AWARD_ICON[a.key] ?? "🏅"}
                    label={superlatives.data?.awards_meta[a.key]?.label ?? a.key}
                    tone={superlatives.data?.awards_meta[a.key]?.tone ?? "neutral"}>
                    {a.player_name ? (
                      <>
                        <PlayerCardTrigger playerId={a.player_id} name={a.player_name}>{a.player_name}</PlayerCardTrigger>{" "}
                        <span className="muted">(<TeamLink id={a.team_id}>{teamName(a.team_id)}</TeamLink>) {headlineValue(a)}</span>
                      </>
                    ) : (
                      <><TeamLink id={a.team_id}>{teamName(a.team_id)}</TeamLink> <span className="muted">{headlineValue(a)}</span></>
                    )}
                  </HeadlineCard>
                ))}
                {weekWorstLoss && (
                  <HeadlineCard icon="😱" label="Worst Loss" tone="negative">
                    <TeamLink id={weekWorstLoss.teamId}>{weekWorstLoss.team}</TeamLink> <span className="muted">favored by {pts(weekWorstLoss.margin)}, lost anyway</span>
                  </HeadlineCard>
                )}
              </div>
            )}
            <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "1rem" }}>
              Player lines show actual /projected points.
            </p>
            <div className="mu-list">
              {data.data.matchups.map((m, i) => (
                <MatchupCard
                  key={i}
                  m={m}
                  awardsByTeam={awardsByTeam}
                  awardsMeta={superlatives.data?.awards_meta ?? {}}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
