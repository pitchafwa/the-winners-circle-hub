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
import { pct, pts, signed } from "../lib/format";
import EmptyState from "./EmptyState";
import PlayerHeadshot from "./PlayerHeadshot";
import TeamLink from "./TeamLink";
import { ACCENT, CHART_QUALITATIVE, FONT_MONO, INK_MUTED, PAPER_2, RULE } from "../lib/tokens";
import type {
  Badges, Meta, MvpRace, MvpRacePlayer, Ownership, OwnershipStint, Schedule, ScheduleEntry,
  ScheduleSwap, SimByWeek,
} from "../types/data";
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
export const BumpChart = forwardRef<HTMLDivElement, { schedule: Schedule; meta: Meta; forceDesktop?: boolean }>(
  function BumpChart({ schedule, meta, forceDesktop }, ref) {
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
    <div ref={ref} style={forceDesktop ? { width: "650px" } : undefined}>
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
              <Line key={id} type="monotone" dataKey={`t${id}`} isAnimationActive={false}
                stroke={mine ? ACCENT : INK_MUTED} strokeWidth={mine ? 2.4 : 1}
                strokeOpacity={mine ? 1 : 0.45} dot={false} />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

/** Same idea as BumpTooltip above, but for a PPG figure instead of
 * standings rank — sorted descending (higher pace first) rather than
 * ascending (lower rank first), since here bigger is what's good. */
function PaceTooltip({
  active, payload, label, teamName, myTeamId,
}: {
  active?: boolean;
  payload?: BumpTooltipEntry[];
  label?: string | number;
  teamName: (id: number | null | undefined) => string;
  myTeamId: number | null;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const sorted = [...payload].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
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
            {pts(p.value ?? 0, 1)} {teamName(id)}
          </div>
        );
      })}
    </div>
  );
}

/** Trailing 3-week average points-for, week by week, all ten teams on one
 * chart — same shape as the bump chart above but tracking scoring pace
 * instead of standings rank. A raw weekly-score chart is too spiky to
 * read with ten overlapping lines, and a cumulative-total chart (an
 * earlier version of this) compresses all the interesting variation into
 * a few pixels once everyone's summed total climbs into the thousands —
 * a rolling average keeps the Y-axis on a PPG scale (roughly 80-180)
 * where real separation between teams is actually visible, while still
 * smoothing out single-week spikes/duds into a readable trend. Window
 * shrinks to whatever's available for the first two weeks (week 1 = that
 * week's score, week 2 = average of weeks 1-2) rather than leaving the
 * chart blank until week 3.
 *
 * Regular season plus real playoff games (ESPN's `WINNERS_BRACKET` tier)
 * both count — a playoff game is exactly the kind of material scoring
 * data this chart exists to show. `WINNERS_CONSOLATION_LADDER` and
 * `LOSERS_CONSOLATION_LADDER` (both also `is_playoff: true`) are
 * excluded: those are the 5th-10th-place bracket for teams that already
 * missed the playoffs, where a score reflects nothing about real playoff
 * performance. A team stops contributing new data — and its line simply
 * gaps via `connectNulls` rather than flatlining — the week it's
 * eliminated from `WINNERS_BRACKET`, since it has no more real games to
 * average in. */
export const PointsPaceChart = forwardRef<HTMLDivElement, { schedule: Schedule; meta: Meta; forceDesktop?: boolean }>(
  function PointsPaceChart({ schedule, meta, forceDesktop }, ref) {
  const { myTeamId, teamName } = useApp();
  const { data, teamIds } = useMemo(() => {
    const decided = schedule.entries.filter(
      (e) => e.winner !== "UNDECIDED" && e.away_id !== null
        && (!e.is_playoff || e.playoff_tier === "WINNERS_BRACKET")
        && !(e.home_score === 0 && e.away_score === 0),
    );
    const weeks = [...new Set(decided.map((e) => e.matchup_period))].sort((a, b) => a - b);
    const ids = meta.teams.map((t) => t.id);
    const weeklyScores = new Map<number, number[]>(ids.map((id) => [id, []]));
    const rows: Record<string, number>[] = [];
    const WINDOW = 3;
    for (const w of weeks) {
      const playedThisWeek = new Set<number>();
      for (const e of decided.filter((x) => x.matchup_period === w)) {
        weeklyScores.get(e.home_id)!.push(e.home_score);
        weeklyScores.get(e.away_id!)!.push(e.away_score);
        playedThisWeek.add(e.home_id);
        playedThisWeek.add(e.away_id!);
      }
      const row: Record<string, number> = { week: w };
      ids.forEach((id) => {
        if (!playedThisWeek.has(id)) return; // eliminated / bye — leave a gap, don't repeat a stale average
        const scores = weeklyScores.get(id)!;
        const trailing = scores.slice(-WINDOW);
        const avg = trailing.reduce((sum, s) => sum + s, 0) / trailing.length;
        row[`t${id}`] = Math.round(avg * 10) / 10;
      });
      rows.push(row);
    }
    return { data: rows, teamIds: ids };
  }, [schedule, meta]);

  if (data.length === 0) return <EmptyState>No completed weeks to chart.</EmptyState>;

  return (
    <div ref={ref} style={forceDesktop ? { width: "650px" } : undefined}>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={RULE} vertical={false} strokeWidth={0.5} />
          <XAxis dataKey="week" tick={{ fontFamily: FONT_MONO, fontSize: 11, fill: INK_MUTED }}
            tickLine={false} axisLine={{ stroke: RULE }} />
          <YAxis width={40} tick={{ fontFamily: FONT_MONO, fontSize: 11, fill: INK_MUTED }}
            tickLine={false} axisLine={false} domain={["auto", "auto"]} />
          <Tooltip content={<PaceTooltip teamName={teamName} myTeamId={myTeamId} />} />
          {teamIds.map((id) => {
            const mine = id === myTeamId;
            return (
              <Line key={id} type="monotone" dataKey={`t${id}`} isAnimationActive={false}
                stroke={mine ? ACCENT : INK_MUTED} strokeWidth={mine ? 2.4 : 1}
                strokeOpacity={mine ? 1 : 0.45} dot={false} connectNulls />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

/** Same idea as PaceTooltip above, but for playoff-odds percentages
 * instead of PPG — sorted descending, bigger is what's good. */
function PlayoffOddsTooltip({
  active, payload, label, teamName, accentTeamId,
}: {
  active?: boolean;
  payload?: BumpTooltipEntry[];
  label?: string | number;
  teamName: (id: number | null | undefined) => string;
  accentTeamId: number | null;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const sorted = [...payload].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return (
    <div style={{
      background: PAPER_2, border: `1px solid ${RULE}`,
      fontFamily: FONT_MONO, fontSize: "0.72rem", padding: "0.5rem 0.65rem",
    }}>
      <div style={{ marginBottom: "0.3rem", fontWeight: 600 }}>Week {label}</div>
      {sorted.map((p) => {
        const id = Number(String(p.dataKey).slice(1));
        return (
          <div key={p.dataKey} style={id === accentTeamId ? { color: ACCENT } : undefined}>
            {pct(p.value ?? 0, 0)} {teamName(id)}
          </div>
        );
      })}
    </div>
  );
}

/** Real playoff odds as of each completed week of the CURRENT season only
 * (`{season}/sim_by_week.json` — see that file's DATA.md section for why
 * this can't be backfilled for past seasons). Same shape as BumpChart/
 * PointsPaceChart above, except the rows come straight off the backend's
 * own Monte Carlo output rather than being reconstructed client-side from
 * schedule.json — playoff odds genuinely need the ingest-side simulation,
 * there's no way to derive them from raw scores in the browser.
 *
 * `onlyTeamId` renders a single team's line (My Team's use — that page's
 * own team, always accented, regardless of which team happens to be
 * globally selected). `accentTeamId` defaults to the globally-selected
 * team (`myTeamId`) for the League page's full overlay, or should be
 * passed explicitly alongside `onlyTeamId` so a specific team's own page
 * highlights ITS line even when viewed without that team being the
 * global selection (the Franchises-menu nav pivot's use case). */
export const PlayoffOddsChart = forwardRef<HTMLDivElement, {
  simByWeek: SimByWeek; meta: Meta; forceDesktop?: boolean; onlyTeamId?: number; accentTeamId?: number;
}>(function PlayoffOddsChart({ simByWeek, meta, forceDesktop, onlyTeamId, accentTeamId }, ref) {
  const { myTeamId, teamName } = useApp();
  const accent = accentTeamId ?? myTeamId;

  const { data, teamIds } = useMemo(() => {
    const weeks = Object.keys(simByWeek.weeks).map(Number).sort((a, b) => a - b);
    const allIds = meta.teams.map((t) => t.id);
    const ids = onlyTeamId !== undefined ? allIds.filter((id) => id === onlyTeamId) : allIds;
    const rows = weeks.map((w) => {
      const row: Record<string, number> = { week: w };
      const weekRow = simByWeek.weeks[String(w)] ?? {};
      ids.forEach((id) => {
        const v = weekRow[String(id)];
        if (v !== undefined) row[`t${id}`] = v;
      });
      return row;
    });
    return { data: rows, teamIds: ids };
  }, [simByWeek, meta, onlyTeamId]);

  if (data.length === 0) {
    return <EmptyState>Not simulated yet — odds arrive with the first data refresh once a week's in the books.</EmptyState>;
  }

  return (
    <div ref={ref} style={forceDesktop ? { width: "650px" } : undefined}>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={RULE} vertical={false} strokeWidth={0.5} />
          <XAxis dataKey="week" tick={{ fontFamily: FONT_MONO, fontSize: 11, fill: INK_MUTED }}
            tickLine={false} axisLine={{ stroke: RULE }} />
          <YAxis width={40} domain={[0, 1]} tickFormatter={(v: number) => pct(v, 0)}
            tick={{ fontFamily: FONT_MONO, fontSize: 11, fill: INK_MUTED }} tickLine={false} axisLine={false} />
          <Tooltip content={<PlayoffOddsTooltip teamName={teamName} accentTeamId={accent} />} />
          {teamIds.map((id) => {
            const mine = id === accent;
            return (
              <Line key={id} type="monotone" dataKey={`t${id}`} isAnimationActive={false}
                stroke={mine ? ACCENT : INK_MUTED} strokeWidth={mine ? 2.4 : 1}
                strokeOpacity={mine ? 1 : 0.45} dot={false} connectNulls />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

function MvpRaceTooltip({
  active, payload, label, playersById,
}: {
  active?: boolean;
  payload?: BumpTooltipEntry[];
  label?: string | number;
  playersById: Map<string, MvpRacePlayer>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const sorted = [...payload].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return (
    <div style={{
      background: PAPER_2, border: `1px solid ${RULE}`,
      fontFamily: FONT_MONO, fontSize: "0.72rem", padding: "0.5rem 0.65rem",
    }}>
      <div style={{ marginBottom: "0.3rem", fontWeight: 600 }}>Week {label}</div>
      {sorted.map((p) => {
        const pid = String(p.dataKey).slice(1);
        const info = playersById.get(pid);
        if (!info) return null;
        return (
          <div key={p.dataKey}>
            {signed(p.value ?? 0, 3)} {info.name}
          </div>
        );
      })}
    </div>
  );
}

const MVP_SHOWN_COUNT = 15;      // total lines on the chart — the "field"
const MVP_HIGHLIGHT_COUNT = 5;   // colored + labeled — the actual "race"
const MVP_CHART_HEIGHT = 300;
const MVP_MARGIN_BASE = { top: 10, bottom: 4, left: 0 };
const MVP_LABEL_MIN_GAP = 24;    // px — minimum vertical space between two end-labels before they'd overlap
const MVP_LABEL_FONT = "600 10.88px -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"; // must match the label <span> below
const MVP_LABEL_HEADSHOT_W = 18; // .mu-headshot is 1.125rem
const MVP_LABEL_GAP = 5;         // the label row's own flex `gap`
const MVP_LABEL_EDGE_PAD = 4;    // the label row's `right: 4`
const MVP_LABEL_SAFETY = 6;      // canvas measureText vs. real rendered width can differ a px or two across platforms
const MVP_YAXIS_TICK_FONT = "11px 'IBM Plex Mono', monospace"; // must match the YAxis `tick` style below
const MVP_YAXIS_PAD = 8;         // Recharts' own tick-to-text padding inside its reserved axis width

let mvpMeasureCanvas: HTMLCanvasElement | null = null;
/** Real pixel width of `text` set in `font` — used to size the chart's
 * right margin to whatever the actual top-5 names need, instead of a
 * fixed guess. A fixed guess is what silently ellipsis-truncated real
 * names before (Tommy: "it's important to me that there be enough room
 * for the names to be written out in full (no ellipses) whether in
 * desktop or mobile view") — this can't undershoot the way a flat
 * "108px, hope that's enough" constant could, because it's measuring the
 * literal strings actually being rendered. */
function mvpTextWidth(text: string, font: string): number {
  if (!mvpMeasureCanvas) mvpMeasureCanvas = document.createElement("canvas");
  const ctx = mvpMeasureCanvas.getContext("2d");
  if (!ctx) return text.length * 7; // no canvas support — a rough fallback, never a crash
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Isotonic regression (Pool Adjacent Violators, L2 loss, equal weights):
 * the least-squares-optimal non-decreasing sequence given a set of target
 * values. Used below to stack the 5 end-labels with a minimum gap while
 * keeping them, ON AVERAGE, as close as possible to their real values —
 * the greedy "push every collision straight down" approach this replaced
 * only ever pushed labels away from their true position, compounding
 * every time a lower label was already crowded, when redistributing the
 * whole cluster (including pulling the ones already below their target
 * back UP) gets everyone closer on the whole. Tommy, reviewing a
 * screenshot: "I would the bottom 4 of our 5 leaders to all be a little
 * higher... even if it would mean [the 2nd-place player] is slightly
 * further than currently. Ideal would be to optimize for average
 * closeness to line end." */
function isotonicRegression(values: number[]): number[] {
  const blocks: { sum: number; count: number; mean: number }[] = [];
  for (const v of values) {
    let block = { sum: v, count: 1, mean: v };
    while (blocks.length > 0 && blocks[blocks.length - 1].mean > block.mean) {
      const prev = blocks.pop()!;
      const sum = prev.sum + block.sum;
      const count = prev.count + block.count;
      block = { sum, count, mean: sum / count };
    }
    blocks.push(block);
  }
  const out: number[] = [];
  for (const block of blocks) for (let i = 0; i < block.count; i++) out.push(block.mean);
  return out;
}

/** League page "MVP race" — cumulative fantasy Win Probability Added for
 * every real STARTED appearance this regular season
 * (`{season}/mvp_race.json`, `metrics.mvp_race_by_week()`), tracked by
 * real player identity so a mid-season trade doesn't reset anyone's
 * line. Revised 2026-09-08 from an earlier points-over-projection design
 * — Tommy: "what really is valuable from a player is how much win
 * probability they contribute to a team over the course of a season" —
 * see that function's own docstring for the full formula (a real bug
 * caught there too, before shipping: a sign error was crediting bad
 * away-side performances as if they helped their own team).
 *
 * Layout, unchanged from the original ask: "could we include, say, the
 * top 15 players on the line graph but only highlight the current top 5
 * with names and headshots at the end of their line ... that way we can
 * see how they are tracking compared to the rest of the league." The
 * bottom `MVP_SHOWN_COUNT - MVP_HIGHLIGHT_COUNT` lines are the muted
 * "field" for context only (no distinct color, no tooltip-worthy
 * identity beyond hover); the top 5 get a real qualitative color each
 * (`CHART_QUALITATIVE` — deliberately not this app's usual single-
 * accent-vs-muted binary, since there's no one "mine" line here) and a
 * headshot+name label past the chart's right edge.
 *
 * The end-labels are a plain absolutely-positioned HTML overlay, not a
 * Recharts `label` render prop — Recharts' own label positioning doesn't
 * give enough control to de-collide two labels whose final values are
 * close together, so this computes each highlighted player's pixel Y by
 * hand (same linear map an EXPLICIT (not "auto") Y-domain lets Recharts'
 * own axis use, so the two stay in sync) and, when two are too close,
 * re-stacks the whole cluster via isotonic regression (`isotonicRegression`
 * above) rather than a naive greedy push — minimizes how far the labels
 * end up from their real values ON AVERAGE, not just fixing whichever
 * collision comes first. The chart's own right margin is sized from the
 * ACTUAL rendered width of the 5 real names being shown (`mvpTextWidth`),
 * not a flat guess, so a real name never gets ellipsis-truncated. */
export const MvpRaceChart = forwardRef<HTMLDivElement, { mvpRace: MvpRace; forceDesktop?: boolean }>(
  function MvpRaceChart({ mvpRace, forceDesktop }, ref) {
  const { data, shown, highlighted, playersById, domain } = useMemo(() => {
    const entries = Object.entries(mvpRace.players);
    const finalValue = (p: MvpRacePlayer) => p.cumulative_by_week[p.cumulative_by_week.length - 1] ?? 0;
    const ranked = [...entries].sort((a, b) => finalValue(b[1]) - finalValue(a[1]));
    const shownEntries = ranked.slice(0, MVP_SHOWN_COUNT);
    const highlightedIds = shownEntries.slice(0, MVP_HIGHLIGHT_COUNT).map(([pid]) => pid);

    const rows = mvpRace.weeks.map((w, i) => {
      const row: Record<string, number> = { week: w };
      shownEntries.forEach(([pid, info]) => { row[`p${pid}`] = info.cumulative_by_week[i]; });
      return row;
    });

    let dMin = 0;
    let dMax = 0;
    for (const [, info] of shownEntries) {
      for (const v of info.cumulative_by_week) {
        if (v < dMin) dMin = v;
        if (v > dMax) dMax = v;
      }
    }

    return {
      data: rows,
      shown: shownEntries.map(([pid]) => pid),
      highlighted: highlightedIds,
      playersById: new Map(entries) as Map<string, MvpRacePlayer>,
      domain: [dMin, dMax] as [number, number],
    };
  }, [mvpRace]);

  if (data.length === 0) {
    return <EmptyState>Not enough of the season played yet — the race starts once week 1 is in the books.</EmptyState>;
  }

  // Right margin sized from the actual rendered width of the 5 real names
  // on the chart right now — never a flat guess that could truncate a
  // long one (see the component doc comment above). Same value on mobile
  // and desktop/forced-desktop capture alike: a phone's narrower chart
  // gives up PLOT width for this, never label legibility.
  const longestNameWidth = Math.max(
    0, ...highlighted.map((pid) => mvpTextWidth(playersById.get(pid)!.name, MVP_LABEL_FONT)));
  const marginRight = Math.ceil(
    MVP_LABEL_HEADSHOT_W + MVP_LABEL_GAP + longestNameWidth + MVP_LABEL_EDGE_PAD + MVP_LABEL_SAFETY);
  const margin = { ...MVP_MARGIN_BASE, right: marginRight };

  const [domainMin, domainMax] = domain;

  // Y-axis width sized the same way as the right margin above — from the
  // actual rendered pixel width of its own widest real tick text, not a
  // flat guess. A flat `width={36}` combined with a small negative
  // `margin.left` (an earlier tightening hack) was clipping the leading
  // "-" off a negative tick (e.g. "-0.069" rendering as ".069" in an
  // exported capture, correct-but-cramped in the live page) whenever a
  // player's cumulative WPA dipped below zero early in the season. The
  // widest tick is always domainMin or domainMax themselves: Recharts
  // generates the intermediate ticks as domainMin plus a "nice" step (see
  // this component's real observed output — a 3-decimal domainMin like
  // -0.069 produces intermediate ticks 0.331, 0.731, 1.131, all the same
  // 3-decimal precision, never more), so measuring just the two endpoints
  // is a safe upper bound without having to replicate Recharts' own tick
  // algorithm. Measure BOTH endpoints and take the wider — a first attempt
  // at this compared their raw numeric magnitude instead (`abs(domainMin)
  // > abs(domainMax) ? ... `), which is exactly backwards for a case like
  // this one: "-0.069" is a LONGER string (6 characters, leading minus and
  // zero) than "1.468" (5 characters) despite being the smaller number, so
  // that version still picked the shorter string and still clipped — the
  // fix has to compare rendered width, not value.
  const yAxisWidth = Math.ceil(Math.max(
    mvpTextWidth(domainMin.toFixed(3), MVP_YAXIS_TICK_FONT),
    mvpTextWidth(domainMax.toFixed(3), MVP_YAXIS_TICK_FONT),
  )) + MVP_YAXIS_PAD + MVP_LABEL_SAFETY;

  const plotHeight = MVP_CHART_HEIGHT - margin.top - margin.bottom;
  const yFor = (v: number) => {
    const span = domainMax - domainMin || 1;
    return margin.top + (1 - (v - domainMin) / span) * plotHeight;
  };

  // Stack the 5 end-labels top-to-bottom with a minimum gap, minimizing
  // how far each one ends up from its real (raw) Y ON AVERAGE — not just
  // resolving whichever collision comes first (see doc comment above).
  // Isotonic regression on "raw Y minus i*GAP" is the standard trick for
  // "least-squares-optimal non-decreasing sequence with a minimum step":
  // shifting by i*GAP turns the minimum-gap constraint into a plain
  // non-decreasing constraint, isotonicRegression solves THAT optimally,
  // then shifting back by i*GAP restores the real gap.
  const rawSorted = highlighted
    .map((pid) => ({ pid, y: yFor(playersById.get(pid)!.cumulative_by_week[playersById.get(pid)!.cumulative_by_week.length - 1]) }))
    .sort((a, b) => a.y - b.y);
  const shifted = rawSorted.map((p, i) => p.y - i * MVP_LABEL_MIN_GAP);
  const pooled = isotonicRegression(shifted);
  const labelPositions = rawSorted.map((p, i) => ({ pid: p.pid, y: pooled[i] + i * MVP_LABEL_MIN_GAP }));

  return (
    <div ref={ref} style={{ position: "relative", ...(forceDesktop ? { width: "650px" } : {}) }}>
      <ResponsiveContainer width="100%" height={MVP_CHART_HEIGHT}>
        <LineChart data={data} margin={margin}>
          <CartesianGrid stroke={RULE} vertical={false} strokeWidth={0.5} />
          <XAxis dataKey="week" tick={{ fontFamily: FONT_MONO, fontSize: 11, fill: INK_MUTED }}
            tickLine={false} axisLine={{ stroke: RULE }} />
          <YAxis width={yAxisWidth} domain={domain}
            tick={{ fontFamily: FONT_MONO, fontSize: 11, fill: INK_MUTED }} tickLine={false} axisLine={false} />
          <Tooltip content={<MvpRaceTooltip playersById={playersById} />} />
          {shown.map((pid) => {
            const rank = highlighted.indexOf(pid);
            const isHighlighted = rank !== -1;
            return (
              <Line key={pid} type="monotone" dataKey={`p${pid}`} isAnimationActive={false}
                stroke={isHighlighted ? CHART_QUALITATIVE[rank] : INK_MUTED}
                strokeWidth={isHighlighted ? 2.2 : 1} strokeOpacity={isHighlighted ? 1 : 0.35}
                dot={false} connectNulls />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
      {labelPositions.map(({ pid, y }) => {
        const info = playersById.get(pid)!;
        const rank = highlighted.indexOf(pid);
        return (
          <div key={pid} style={{
            position: "absolute", top: y - 9, right: MVP_LABEL_EDGE_PAD,
            display: "flex", alignItems: "center", gap: `${MVP_LABEL_GAP}px`,
          }}>
            <PlayerHeadshot playerId={Number(pid)} position={info.position} proTeam={info.pro_team}
              className="mu-headshot" />
            <span style={{
              fontSize: "0.68rem", fontWeight: 600, color: CHART_QUALITATIVE[rank], whiteSpace: "nowrap",
            }}>
              {info.name}
            </span>
          </div>
        );
      })}
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
  points_wpa: number;
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
      points_wpa: 0,
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
    c.points_wpa += s.points_wpa;
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
    // WPA is never computed for K/D-ST at all (see metrics.weekly_wpa) so
    // they'd only ever show up here at a flat 0 — excluded the same way
    // vsProjectionEligible above excludes them, for the same reason.
    // Unlike the projection-based lists, this doesn't need a `weeks_projected`
    // floor -- WPA only needs real actual scores, which exist all the way
    // back to 2017 (no ESPN-projection gap to work around).
    const wpaEligible = totals.filter((c) => c.position !== "D/ST" && c.position !== "K");
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
      wpaLeaders: toRows(
        [...wpaEligible].sort((a, b) => b.points_wpa - a.points_wpa).slice(0, LEADERBOARD_LONG),
        (c) => signed(c.points_wpa, 2)),
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
      <Leaderboard title={teamId === undefined ? "Most win probability added, one franchise" : "Franchise MVPs"}
        subtitle="career WPA · playoffs included" rows={leaderboards.wpaLeaders} />
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
