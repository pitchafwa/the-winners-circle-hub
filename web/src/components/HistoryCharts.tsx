import { forwardRef, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApp } from "../state/AppContext";
import { pts, signed } from "../lib/format";
import EmptyState from "./EmptyState";
import PlayerHeadshot from "./PlayerHeadshot";
import TeamLink from "./TeamLink";
import { ACCENT, FONT_MONO, INK_MUTED, PAPER_2, RULE } from "../lib/tokens";
import type { Badges, Meta, Ownership, OwnershipStint, Schedule, ScheduleEntry, ScheduleSwap } from "../types/data";
import type { SeasonBundle } from "../lib/useAllSeasons";

type BumpTooltipEntry = { dataKey?: string | number; value?: number };

/** Recharts renders tooltip lines in the order the <Line> series were
 * declared (fixed, by meta.teams order) — not by that week's actual
 * standing. Sorting the payload by rank (the line's y-value; 1 = best,
 * since the axis is reversed) makes the hover box read top-to-bottom as
 * the real standings at that point in the season. */
function BumpTooltip({
  active,
  payload,
  label,
  teamName,
  myTeamId,
}: {
  active?: boolean;
  payload?: BumpTooltipEntry[];
  label?: string | number;
  teamName: (id: number | null | undefined) => string;
  myTeamId: number | null;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const sorted = [...payload].sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  return (
    <div style={{
      background: PAPER_2, border: `1px solid ${RULE}`,
      fontFamily: FONT_MONO, fontSize: "0.72rem", padding: "0.5rem 0.65rem",
    }}>
      <div style={{ marginBottom: "0.3rem", fontWeight: 600 }}>Week {label}</div>
      {sorted.map((p) => {
        const id = Number(String(p.dataKey).slice(1));
        return (
          <div key={p.dataKey} style={id === myTeamId ? { color: ACCENT } : undefined}>
            #{p.value} {teamName(id)}
          </div>
        );
      })}
    </div>
  );
}

/** Standings-by-week bump chart for the selected season. */
export const BumpChart = forwardRef<HTMLDivElement, { schedule: Schedule; meta: Meta }>(function BumpChart(
  { schedule, meta }, ref,
) {
  const { myTeamId, teamName } = useApp();
  const { data, teamIds } = useMemo(() => {
    const decided = schedule.entries.filter(
      (e) => e.winner !== "UNDECIDED" && !e.is_playoff && e.away_id !== null
        && e.matchup_period <= meta.reg_season_weeks
        && !(e.home_score === 0 && e.away_score === 0),
    );
    const weeks = [...new Set(decided.map((e) => e.matchup_period))].sort((a, b) => a - b);
    const ids = meta.teams.map((t) => t.id);
    const wins = new Map(ids.map((id) => [id, 0]));
    const pf = new Map(ids.map((id) => [id, 0]));
    const rows: Record<string, number>[] = [];
    for (const w of weeks) {
      for (const e of decided.filter((x) => x.matchup_period === w)) {
        pf.set(e.home_id, (pf.get(e.home_id) ?? 0) + e.home_score);
        pf.set(e.away_id!, (pf.get(e.away_id!) ?? 0) + e.away_score);
        if (e.winner === "HOME") wins.set(e.home_id, (wins.get(e.home_id) ?? 0) + 1);
        if (e.winner === "AWAY") wins.set(e.away_id!, (wins.get(e.away_id!) ?? 0) + 1);
        if (e.winner === "TIE") {
          wins.set(e.home_id, (wins.get(e.home_id) ?? 0) + 0.5);
          wins.set(e.away_id!, (wins.get(e.away_id!) ?? 0) + 0.5);
        }
      }
      const ranked = [...ids].sort(
        (a, b) => (wins.get(b)! - wins.get(a)!) || (pf.get(b)! - pf.get(a)!),
      );
      const row: Record<string, number> = { week: w };
      ranked.forEach((id, i) => { row[`t${id}`] = i + 1; });
      rows.push(row);
    }
    return { data: rows, teamIds: ids };
  }, [schedule, meta]);

  if (data.length === 0) return <EmptyState>No completed weeks to chart.</EmptyState>;

  return (
    <div ref={ref}>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
          <CartesianGrid stroke={RULE} vertical={false} strokeWidth={0.5} />
          <XAxis dataKey="week" tick={{ fontFamily: FONT_MONO, fontSize: 11, fill: INK_MUTED }}
            tickLine={false} axisLine={{ stroke: RULE }} />
          <YAxis reversed domain={[1, teamIds.length]} tickCount={teamIds.length}
            tick={{ fontFamily: FONT_MONO, fontSize: 11, fill: INK_MUTED }} tickLine={false} axisLine={false} />
          <Tooltip content={<BumpTooltip teamName={teamName} myTeamId={myTeamId} />} />
          {teamIds.map((id) => {
            const mine = id === myTeamId;
            return (
              <Line key={id} type="monotone" dataKey={`t${id}`}
                stroke={mine ? ACCENT : INK_MUTED} strokeWidth={mine ? 2.4 : 1}
                strokeOpacity={mine ? 1 : 0.45} dot={false} />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

export function SwapMatrix({ swap, meta }: { swap: ScheduleSwap; meta: Meta }) {
  const teams = meta.teams;
  const abbrev = new Map(teams.map((t) => [t.id, t.abbrev || String(t.id)]));
  const fullName = new Map(teams.map((t) => [t.id, t.name]));
  return (
    <div className="table-wrap">
      <table className="stat h2h">
        <thead>
          <tr>
            <th scope="col" title="row team plays column team's schedule">with ↓'s scores on →'s schedule</th>
            {teams.map((t) => (
              <th key={t.id} scope="col" className="num" title={t.name}>{abbrev.get(t.id)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {swap.rows.map((r) => {
            const own = r.records[String(r.team_id)];
            const ownPct = own ? (own.wins + 0.5 * own.ties) : 0;
            return (
              <tr key={r.team_id}>
                <th scope="row" style={{ borderBottom: `1px solid ${RULE}` }}>
                  <TeamLink id={r.team_id}>{fullName.get(r.team_id)}</TeamLink>
                </th>
                {teams.map((c) => {
                  const rec = r.records[String(c.id)];
                  if (!rec) return <td key={c.id} className="num muted">—</td>;
                  const self = c.id === r.team_id;
                  const better = (rec.wins + 0.5 * rec.ties) - ownPct;
                  return (
                    <td key={c.id}
                      className={`num ${self ? "" : better > 0 ? "pos" : better < 0 ? "neg" : "muted"}`}
                      style={self ? { background: "var(--paper-2)" } : undefined}
                      title={self ? "actual record" : `${signed(better, 1)} wins vs actual`}>
                      {rec.wins}-{rec.losses}{rec.ties ? `-${rec.ties}` : ""}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.5rem", fontStyle: "italic" }}>
        Each cell: the row team's record if they'd inherited the column team's schedule.
        Green = easier ride than the one they got.
      </p>
    </div>
  );
}

/** All-time head-to-head win matrix, aggregated across every season on
 * record — a single season's H2H is mostly noise at 10 teams (a handful of
 * games each), but the full history actually says something. Franchise
 * slot (team_id) is the join key, so this reads correctly across name/owner
 * changes the same way Franchise Careers already does. */
export const H2HMatrix = forwardRef<HTMLTableElement, { bundles: SeasonBundle[]; meta: Meta }>(function H2HMatrix(
  { bundles, meta }, ref,
) {
  const { currentTeamsById } = useApp();
  const teams = meta.teams;
  const currentName = (id: number) => currentTeamsById.get(id)?.name ?? `Team ${id}`;
  const currentAbbrev = (id: number) => currentTeamsById.get(id)?.abbrev || String(id);
  const wins = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bundles) {
      for (const e of b.schedule.entries) {
        if (e.winner === "UNDECIDED" || e.away_id === null) continue;
        if (e.winner === "HOME") m.set(`${e.home_id}>${e.away_id}`, (m.get(`${e.home_id}>${e.away_id}`) ?? 0) + 1);
        if (e.winner === "AWAY") m.set(`${e.away_id}>${e.home_id}`, (m.get(`${e.away_id}>${e.home_id}`) ?? 0) + 1);
      }
    }
    return m;
  }, [bundles]);

  return (
    <div className="table-wrap">
      <table className="stat h2h" ref={ref}>
        <thead>
          <tr>
            <th scope="col">vs →</th>
            {teams.map((t) => (
              <th key={t.id} scope="col" className="num" title={currentName(t.id)}>{currentAbbrev(t.id)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((row) => (
            <tr key={row.id}>
              <th scope="row" style={{ borderBottom: `1px solid ${RULE}` }}>
                <TeamLink id={row.id}>{currentName(row.id)}</TeamLink>
              </th>
              {teams.map((col) => {
                if (row.id === col.id) return <td key={col.id} className="num muted">·</td>;
                const w = wins.get(`${row.id}>${col.id}`) ?? 0;
                const l = wins.get(`${col.id}>${row.id}`) ?? 0;
                return (
                  <td key={col.id} className={`num ${w > l ? "pos" : w < l ? "neg" : "muted"}`}>
                    {w}-{l}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

interface CareerStint {
  team_id: number;
  player_id: number;
  name: string;
  position: string;
  pro_team: string;
  weeks_rostered: number;
  weeks_started: number;
  weeks_benched: number;
  weeks_projected: number;
  points_started: number;
  points_projected_started: number;
  points_started_projected_weeks: number;
  points_benched: number;
  start_season: number;
  start_week: number;
  end_season: number | null; // null = still on the roster
  end_week: number | null;
}

const seasonWeekCmp = (aS: number, aW: number, bS: number, bW: number) =>
  aS !== bS ? aS - bS : aW - bW;

/** One player can have several separate stints on the same franchise (traded
 * away, later reacquired) — merge those into one "career with this team"
 * total so leaderboards count a whole tenure once, not per-stint. */
function careerStints(stints: OwnershipStint[]): CareerStint[] {
  const byKey = new Map<string, CareerStint>();
  for (const s of stints) {
    const key = `${s.team_id}-${s.player_id}`;
    const c = byKey.get(key) ?? {
      team_id: s.team_id, player_id: s.player_id, name: s.name, position: s.position,
      pro_team: s.pro_team,
      weeks_rostered: 0, weeks_started: 0, weeks_benched: 0, weeks_projected: 0,
      points_started: 0, points_projected_started: 0, points_started_projected_weeks: 0, points_benched: 0,
      start_season: s.start_season, start_week: s.start_week,
      end_season: s.end_season, end_week: s.end_week,
    };
    c.weeks_rostered += s.weeks_rostered;
    c.weeks_started += s.weeks_started;
    c.weeks_benched += s.weeks_benched;
    c.weeks_projected += s.weeks_projected;
    c.points_started += s.points_started;
    c.points_projected_started += s.points_projected_started;
    c.points_started_projected_weeks += s.points_started_projected_weeks;
    c.points_benched += s.points_benched;
    if (seasonWeekCmp(s.start_season, s.start_week, c.start_season, c.start_week) < 0) {
      c.start_season = s.start_season; c.start_week = s.start_week;
    }
    if (c.end_season === null || s.end_season === null) {
      c.end_season = null; c.end_week = null;
    } else if (seasonWeekCmp(s.end_season, s.end_week!, c.end_season, c.end_week!) > 0) {
      c.end_season = s.end_season; c.end_week = s.end_week;
    }
    byKey.set(key, c);
  }
  return [...byKey.values()];
}

function tenureLabel(c: CareerStint): string {
  if (c.end_season === null) return `${c.start_season}–now`;
  return c.start_season === c.end_season ? String(c.start_season) : `${c.start_season}–${c.end_season}`;
}

interface LeaderboardRow {
  key: string;
  primary: string;
  primaryTeamId?: number;
  secondary?: string;
  secondaryTeamId?: number;
  value: string;
  playerId?: number | null;
  position?: string | null;
  proTeam?: string | null;
}

const LEADERBOARD_SHORT = 5;
const LEADERBOARD_LONG = 25;

/** One uniform leaderboard card, used for every record-book category —
 * game-level (highest score, blowout) and career-level (most points for one
 * franchise, PPG over projection) alike — so they all read the same: rank,
 * who, context, value. Shows the top 5 by default; "show top 25" expands it
 * in place, per card, without affecting any other list on the page. */
function Leaderboard({ title, subtitle, rows }: {
  title: string;
  subtitle?: string;
  rows: LeaderboardRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = rows.slice(0, expanded ? LEADERBOARD_LONG : LEADERBOARD_SHORT);
  return (
    <div>
      <h3 className="leaderboard-title">
        {title}
        {subtitle && <span className="leaderboard-subtitle muted"> — {subtitle}</span>}
      </h3>
      {shown.length === 0 ? (
        <p className="muted" style={{ fontStyle: "italic", fontSize: "0.85rem" }}>Nothing on file yet.</p>
      ) : (
        <ol className="leaderboard">
          {shown.map((r, i) => (
            <li key={r.key} className="leaderboard-row">
              <span className="leaderboard-rank num">{i + 1}</span>
              {r.playerId != null && (
                <PlayerHeadshot playerId={r.playerId} position={r.position} proTeam={r.proTeam} className="leaderboard-headshot" />
              )}
              <span className="leaderboard-main">
                <strong>
                  {r.primaryTeamId !== undefined ? <TeamLink id={r.primaryTeamId}>{r.primary}</TeamLink> : r.primary}
                </strong>
                {r.secondary && (
                  <span className="muted leaderboard-sub">
                    {r.secondaryTeamId !== undefined ? <TeamLink id={r.secondaryTeamId}>{r.secondary}</TeamLink> : r.secondary}
                  </span>
                )}
              </span>
              <span className="num leaderboard-value">{r.value}</span>
            </li>
          ))}
        </ol>
      )}
      {rows.length > LEADERBOARD_SHORT && (
        <button className="label leaderboard-toggle" onClick={() => setExpanded((s) => !s)}>
          {expanded ? "hide ↑" : `show top ${Math.min(rows.length, LEADERBOARD_LONG)} ↓`}
        </button>
      )}
    </div>
  );
}

/** One row per franchise: its all-time leading scorer and most-used starter,
 * from the roster-ownership timeline (career.py's per-stint aggregates,
 * merged across stints). */
export const FranchiseLeaders = forwardRef<HTMLTableElement, { ownership: Ownership | null; meta: Meta }>(
  function FranchiseLeaders({ ownership, meta }, ref) {
  const { currentTeamName } = useApp();
  const rows = useMemo(() => {
    const career = careerStints(ownership?.stints ?? []);
    const byTeam = new Map<number, CareerStint[]>();
    for (const c of career) {
      if (!byTeam.has(c.team_id)) byTeam.set(c.team_id, []);
      byTeam.get(c.team_id)!.push(c);
    }
    return meta.teams.map((t) => {
      const list = byTeam.get(t.id) ?? [];
      const scorer = [...list].sort((a, b) => b.points_started - a.points_started)[0] ?? null;
      const starter = [...list].sort((a, b) => b.weeks_started - a.weeks_started)[0] ?? null;
      return { team: t, scorer, starter };
    });
  }, [ownership, meta]);

  if (rows.every((r) => !r.scorer)) return <EmptyState>No roster-ownership data on file yet.</EmptyState>;

  return (
    <div className="table-wrap">
      <table className="stat" ref={ref}>
        <thead>
          <tr>
            <th scope="col">Franchise</th>
            <th scope="col">Leading scorer</th>
            <th scope="col" className="num">Pts started</th>
            <th scope="col">Most-used starter</th>
            <th scope="col" className="num">Weeks started</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ team, scorer, starter }) => (
            <tr key={team.id}>
              <td><TeamLink id={team.id}><strong>{currentTeamName(team.id)}</strong></TeamLink></td>
              <td>
                {scorer && (
                  <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <PlayerHeadshot playerId={scorer.player_id} position={scorer.position} proTeam={scorer.pro_team} />
                    {scorer.name} {scorer.position}
                  </span>
                )}
                {!scorer && "—"}
              </td>
              <td className="num">{scorer ? pts(scorer.points_started, 0) : "—"}</td>
              <td>
                {starter && (
                  <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <PlayerHeadshot playerId={starter.player_id} position={starter.position} proTeam={starter.pro_team} />
                    {starter.name} {starter.position}
                  </span>
                )}
                {!starter && "—"}
              </td>
              <td className="num">{starter ? starter.weeks_started : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

const MIN_STARTS_FOR_RATE = 8;
// Compared against the ROUNDED display percentage, not the raw fraction —
// 5.4% ("5%" once rounded) should qualify, 5.5% ("6%") shouldn't.
const STASH_MAX_START_PCT = 5;

/** All the "career, across the roster-ownership timeline" leaderboards —
 * shared by the league-wide Record Book (every franchise) and each
 * Franchise page (teamId scopes it to one). Same categories, same card
 * style, same show-top-25 toggle, either way. */
export function CareerLeaderboards({ ownership, teamId, teamName }: {
  ownership: Ownership | null;
  teamId?: number;
  teamName: (id: number) => string;
}) {
  const leaderboards = useMemo(() => {
    const filtered = teamId === undefined
      ? (ownership?.stints ?? [])
      : (ownership?.stints ?? []).filter((s) => s.team_id === teamId);
    const totals = careerStints(filtered).filter((c) => c.weeks_rostered >= 4);
    const rateEligible = totals.filter((c) => c.weeks_started >= MIN_STARTS_FOR_RATE);
    // Projection-based stats (both the raw point-total delta and the
    // per-game versions) can only fairly use weeks that actually HAD a
    // real ESPN projection — 2017 has none at all, and silently treating
    // "no projection" as "projected 0" would credit every 2017 performance
    // as a huge overperformance.
    const projectionEligible = totals.filter((c) => c.weeks_projected >= 4);
    const projectionRateEligible = totals.filter((c) => c.weeks_projected >= MIN_STARTS_FOR_RATE);
    // D/ST and K scoring is low-variance and lumpy enough that they crowd
    // out every skill-position player on the over/under-expectation lists.
    const vsProjectionEligible = projectionRateEligible.filter((c) => c.position !== "D/ST" && c.position !== "K");
    const stashEligible = totals.filter(
      (c) => Math.round((c.weeks_started / c.weeks_rostered) * 100) <= STASH_MAX_START_PCT);
    const ppg = (c: CareerStint) => c.points_started / c.weeks_started;
    const projDelta = (c: CareerStint) => c.points_started_projected_weeks - c.points_projected_started;
    const ppgOverExp = (c: CareerStint) => projDelta(c) / c.weeks_projected;
    // Scoped to one franchise, every row is that same team — show tenure
    // instead of repeating the team name on every line.
    const secondary = (c: CareerStint) => (teamId === undefined ? teamName(c.team_id) : tenureLabel(c));

    const toRows = (list: CareerStint[], value: (c: CareerStint) => string): LeaderboardRow[] =>
      list.map((c) => ({
        key: `${c.team_id}-${c.player_id}`,
        primary: `${c.name} ${c.position}`,
        secondary: secondary(c),
        secondaryTeamId: teamId === undefined ? c.team_id : undefined,
        value: value(c),
        playerId: c.player_id,
        position: c.position,
        proTeam: c.pro_team,
      }));

    return {
      scorers: toRows(
        [...totals].sort((a, b) => b.points_started - a.points_started).slice(0, LEADERBOARD_LONG),
        (c) => pts(c.points_started, 0)),
      starters: toRows(
        [...totals].sort((a, b) => b.weeks_started - a.weeks_started).slice(0, LEADERBOARD_LONG),
        (c) => `${c.weeks_started} wk`),
      overperformers: toRows(
        [...projectionEligible].sort((a, b) => projDelta(b) - projDelta(a)).slice(0, LEADERBOARD_LONG),
        (c) => signed(projDelta(c), 0)),
      underperformers: toRows(
        [...projectionEligible].sort((a, b) => projDelta(a) - projDelta(b)).slice(0, LEADERBOARD_LONG),
        (c) => signed(projDelta(c), 0)),
      ppgLeaders: toRows(
        [...rateEligible].sort((a, b) => ppg(b) - ppg(a)).slice(0, LEADERBOARD_LONG),
        (c) => `${ppg(c).toFixed(1)} ppg`),
      ppgOver: toRows(
        [...vsProjectionEligible].sort((a, b) => ppgOverExp(b) - ppgOverExp(a)).slice(0, LEADERBOARD_LONG),
        (c) => `${signed(ppgOverExp(c), 1)} ppg`),
      ppgUnder: toRows(
        [...vsProjectionEligible].sort((a, b) => ppgOverExp(a) - ppgOverExp(b)).slice(0, LEADERBOARD_LONG),
        (c) => `${signed(ppgOverExp(c), 1)} ppg`),
      stashes: toRows(
        [...stashEligible].sort((a, b) => b.weeks_rostered - a.weeks_rostered).slice(0, LEADERBOARD_LONG),
        (c) => `${c.weeks_rostered} wk, ${c.weeks_started} ${c.weeks_started === 1 ? "start" : "starts"}`),
    };
  }, [ownership, teamId, teamName]);

  return (
    <div className="record-book">
      <Leaderboard title={teamId === undefined ? "Most points, one franchise" : "Leading scorers"}
        rows={leaderboards.scorers} />
      <Leaderboard title="Most weeks started" rows={leaderboards.starters} />
      <Leaderboard title="Best value beyond projection" subtitle="min. 4 projected starts"
        rows={leaderboards.overperformers} />
      <Leaderboard title="Biggest busts" subtitle="min. 4 projected starts"
        rows={leaderboards.underperformers} />
      <Leaderboard title="Most points per game" subtitle={`min. ${MIN_STARTS_FOR_RATE} starts`}
        rows={leaderboards.ppgLeaders} />
      <Leaderboard title="Most PPG over expectation" subtitle={`min. ${MIN_STARTS_FOR_RATE} projected starts`}
        rows={leaderboards.ppgOver} />
      <Leaderboard title="Most PPG below expectation" subtitle={`min. ${MIN_STARTS_FOR_RATE} projected starts`}
        rows={leaderboards.ppgUnder} />
      <Leaderboard title="Favorite stashes" subtitle={`≤${STASH_MAX_START_PCT}% starts`}
        rows={leaderboards.stashes} />
    </div>
  );
}

export function RecordBook({ bundles, ownership }: { bundles: SeasonBundle[]; ownership: Ownership | null }) {
  const { currentTeamName: teamName } = useApp();
  const rows = useMemo(() => {
    const games: { e: ScheduleEntry; season: number; team: number; score: number }[] = [];
    for (const b of bundles) {
      for (const e of b.schedule.entries) {
        if (e.winner === "UNDECIDED" || e.away_id === null) continue;
        if (e.home_score === 0 && e.away_score === 0) continue;
        // Consolation-bracket games don't count — most managers don't
        // bother setting a real lineup once they're out of championship
        // contention, so a score there isn't a genuine best/worst effort.
        if (e.matchup_period > b.meta.reg_season_weeks && e.playoff_tier !== "WINNERS_BRACKET") continue;
        games.push({ e, season: b.season, team: e.home_id, score: e.home_score });
        games.push({ e, season: b.season, team: e.away_id, score: e.away_score });
      }
    }
    const high = [...games].sort((a, b) => b.score - a.score).slice(0, LEADERBOARD_LONG);
    const low = [...games].sort((a, b) => a.score - b.score).slice(0, LEADERBOARD_LONG);
    const blowouts = [...games.filter((g) => g.team === g.e.home_id)]
      .map((g) => {
        const homeWon = g.e.home_score >= g.e.away_score;
        return {
          ...g,
          margin: Math.abs(g.e.home_score - g.e.away_score),
          // name the winner, not whoever happened to be home
          team: homeWon ? g.e.home_id : g.e.away_id!,
          winnerScore: homeWon ? g.e.home_score : g.e.away_score,
          loserScore: homeWon ? g.e.away_score : g.e.home_score,
        };
      })
      .sort((a, b) => b.margin - a.margin)
      .slice(0, LEADERBOARD_LONG);
    return { high, low, blowouts };
  }, [bundles]);

  const games = useMemo(() => ({
    high: rows.high.map((g): LeaderboardRow => ({
      key: `${g.season}-${g.e.matchup_period}-${g.team}`, primary: teamName(g.team), primaryTeamId: g.team,
      secondary: `${g.season} wk ${g.e.matchup_period}`, value: pts(g.score),
    })),
    low: rows.low.map((g): LeaderboardRow => ({
      key: `${g.season}-${g.e.matchup_period}-${g.team}`, primary: teamName(g.team), primaryTeamId: g.team,
      secondary: `${g.season} wk ${g.e.matchup_period}`, value: pts(g.score),
    })),
    blowouts: rows.blowouts.map((g): LeaderboardRow => ({
      key: `${g.season}-${g.e.matchup_period}-${g.team}`, primary: teamName(g.team), primaryTeamId: g.team,
      secondary: `${g.season} wk ${g.e.matchup_period}`,
      value: `${pts(g.margin)} (${pts(g.winnerScore)}–${pts(g.loserScore)})`,
    })),
  }), [rows, teamName]);

  return (
    <>
      <div className="record-book">
        <Leaderboard title="Highest scores" rows={games.high} />
        <Leaderboard title="Lowest scores" rows={games.low} />
        <Leaderboard title="Biggest blowouts" rows={games.blowouts} />
      </div>
      <div style={{ marginTop: "2rem" }}>
        <CareerLeaderboards ownership={ownership} teamName={teamName} />
      </div>
    </>
  );
}

interface CareerRow {
  id: number;
  seasons: number;
  w: number;
  l: number;
  t: number;
  pf: number;
  pct: number;
  titles: number;
  lasts: number;
}

const CAREER_COLS: { key: keyof CareerRow | "name"; label: string; numeric: boolean }[] = [
  { key: "name", label: "Franchise", numeric: false },
  { key: "seasons", label: "Seasons", numeric: true },
  { key: "pct", label: "Record", numeric: true },
  { key: "pf", label: "PF", numeric: true },
  { key: "titles", label: "Titles", numeric: true },
  { key: "lasts", label: "Last places", numeric: true },
];

export const CareerTable = forwardRef<HTMLTableElement, { bundles: SeasonBundle[]; badges: Badges | null }>(
  function CareerTable({ bundles, badges }, ref) {
  const { currentTeamName: teamName } = useApp();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "pct", dir: -1 });

  const rows = useMemo(() => {
    const acc = new Map<number, { seasons: number; w: number; l: number; t: number; pf: number }>();
    for (const b of bundles) {
      if (!b.meta.season_started) continue;
      for (const r of b.standings.rows) {
        const a = acc.get(r.team_id) ?? { seasons: 0, w: 0, l: 0, t: 0, pf: 0 };
        a.seasons += 1;
        a.w += r.wins; a.l += r.losses; a.t += r.ties; a.pf += r.points_for ?? 0;
        acc.set(r.team_id, a);
      }
    }
    return [...acc.entries()].map(([id, a]): CareerRow => {
      const bl = badges?.teams[String(id)] ?? [];
      return {
        id, ...a,
        pct: (a.w + 0.5 * a.t) / Math.max(a.w + a.l + a.t, 1),
        titles: bl.filter((x) => x.type === "champion").length,
        lasts: bl.filter((x) => x.type === "last_place").length,
      };
    });
  }, [bundles, badges]);

  const sorted = useMemo(() => {
    const val = (r: CareerRow): number | string =>
      sort.key === "name" ? teamName(r.id) : (r[sort.key as keyof CareerRow] as number);
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return 0;
    });
  }, [rows, sort, teamName]);

  const clickSort = (col: (typeof CAREER_COLS)[number]) =>
    setSort((s) =>
      s.key === col.key
        ? { key: s.key, dir: s.dir === 1 ? -1 : 1 }
        : { key: col.key, dir: col.numeric ? -1 : 1 },
    );

  return (
    <div className="table-wrap">
      <table className="stat" ref={ref}>
        <thead>
          <tr>
            {CAREER_COLS.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`sortable${c.numeric ? " num" : ""}`}
                aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                onClick={() => clickSort(c)}
              >
                {c.label}
                {sort.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td><TeamLink id={r.id}><strong>{teamName(r.id)}</strong></TeamLink></td>
              <td className="num">{r.seasons}</td>
              <td className="num">
                {r.w}-{r.l}{r.t ? `-${r.t}` : ""}{" "}
                <span className="muted">({(r.pct * 100).toFixed(1)}%)</span>
              </td>
              <td className="num">{pts(r.pf)}</td>
              <td className="num">{r.titles > 0 ? "🏆".repeat(r.titles) : "—"}</td>
              <td className="num">{r.lasts > 0 ? "💀".repeat(r.lasts) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
