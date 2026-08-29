import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useApp } from "../state/AppContext";
import { useJson, useOptionalJson } from "../lib/data";
import StandingsTable from "../components/StandingsTable";
import DivisionStandings from "../components/DivisionStandings";
import PlayoffProbabilityTracks from "../components/PlayoffProbabilityTracks";
import SuperlativeCard from "../components/SuperlativeCard";
import ActivityFeed from "../components/ActivityFeed";
import EmptyState from "../components/EmptyState";
import PositionHeatmap from "../components/PositionHeatmap";
import ContendRebuildTable from "../components/ContendRebuildTable";
import ScreenshotButton from "../components/ScreenshotButton";
import { BumpChart, PointsPaceChart, SwapMatrix } from "../components/HistoryCharts";
import type {
  Activity, Positions, Schedule, ScheduleSwap, Sim, Spectrum, Standings, StandingsByWeek, Superlatives,
} from "../types/data";

// Shared by every bar-chart-style block below (no border/header of its
// own to frame it the way a table does) — the real mobile layout wraps/
// squeezes these specifically to fit a phone screen, which is exactly
// what a "send this to the group chat" screenshot shouldn't be
// constrained by. flushSync (not a plain setState) so the wider layout
// is guaranteed to have committed before ScreenshotButton reads
// anything. `asyncDelayMs`, when given, is for recharts'
// ResponsiveContainer specifically: unlike pure-CSS blocks (settle the
// instant the class/width flips), it only re-renders its SVG at the new
// width after its own ResizeObserver actually fires — a real async step
// flushSync can't force through. A short fixed wait (not
// requestAnimationFrame — confirmed live elsewhere in this feature that
// rAF never fires in a backgrounded/non-compositing tab) gives that time
// to settle before capture reads the resized chart.
function useForceDesktopCapture(asyncDelayMs?: number) {
  const [forceDesktop, setForceDesktop] = useState(false);
  const prepareCapture = () => {
    flushSync(() => setForceDesktop(true));
    if (asyncDelayMs) return new Promise<void>((resolve) => setTimeout(resolve, asyncDelayMs));
  };
  const cleanupCapture = () => flushSync(() => setForceDesktop(false));
  return { forceDesktop, prepareCapture, cleanupCapture };
}

export default function LeaguePage() {
  const { season, meta } = useApp();
  const standingsTableRef = useRef<HTMLTableElement>(null);
  const contendRebuildRef = useRef<HTMLTableElement>(null);
  const positionHeatmapRef = useRef<HTMLTableElement>(null);
  const superlativesGridRef = useRef<HTMLDivElement>(null);
  const playoffTracksRef = useRef<HTMLDivElement>(null);
  const bumpChartRef = useRef<HTMLDivElement>(null);
  const pointsChartRef = useRef<HTMLDivElement>(null);

  const odds = useForceDesktopCapture();
  const bump = useForceDesktopCapture(150);
  const points = useForceDesktopCapture(150);

  const [standingsWeek, setStandingsWeek] = useState<"current" | number>("current");

  const base = season !== null ? `${season}` : null;
  const standings = useJson<Standings>(base ? `${base}/standings.json` : null);
  const standingsByWeek = useOptionalJson<StandingsByWeek>(base ? `${base}/standings_by_week.json` : null);
  const superlatives = useJson<Superlatives>(base ? `${base}/superlatives.json` : null);
  const activity = useJson<Activity>(base ? `${base}/activity.json` : null);
  const sim = useOptionalJson<Sim>(base ? `${base}/sim.json` : null);
  const positions = useOptionalJson<Positions>(base ? `${base}/positions.json` : null);
  const spectrum = useJson<Spectrum>("spectrum.json");
  const schedule = useOptionalJson<Schedule>(base ? `${base}/schedule.json` : null);
  const scheduleSwap = useOptionalJson<ScheduleSwap>(base ? `${base}/schedule_swap.json` : null);

  // Switching seasons with a specific past week still selected would silently
  // show the wrong (or missing) season's data under a stale week label.
  useEffect(() => setStandingsWeek("current"), [season]);

  if (!meta) return null;

  const latestWeek = meta.completed_weeks.at(-1) ?? null;
  const simByTeam = new Map((sim.data?.teams ?? []).map((t) => [t.team_id, t]));

  // Weeks the season actually has an as-of-week snapshot for (every
  // completed regular-season week — see standings_by_week.json's own
  // docstring for which seasons/columns that does and doesn't cover).
  // Sorted ascending as numbers, not strings, since object keys are "1".."14".
  const standingsWeekOptions = standingsByWeek.data
    ? Object.keys(standingsByWeek.data.weeks).map(Number).sort((a, b) => a - b)
    : [];
  const standingsRows = standingsWeek === "current"
    ? standings.data?.rows
    : standingsByWeek.data?.weeks[String(standingsWeek)];

  return (
    <>
      <section className="section" aria-labelledby="standings-h">
        <div className="section-head">
          <h2 id="standings-h">Standings</h2>
          <span className="label">
            click a column to sort
            {standingsWeekOptions.length > 0 && (
              <select
                className="control week-select"
                aria-label="Standings as of week"
                value={standingsWeek}
                onChange={(e) => setStandingsWeek(e.target.value === "current" ? "current" : Number(e.target.value))}
              >
                <option value="current">Current</option>
                {standingsWeekOptions.map((w) => (
                  <option key={w} value={w}>As of week {w}</option>
                ))}
              </select>
            )}
            <ScreenshotButton targetRef={standingsTableRef} filename="standings" />
          </span>
        </div>
        {standings.error && <div className="error-state">{standings.error}</div>}
        {standingsRows && <StandingsTable ref={standingsTableRef} rows={standingsRows} />}
      </section>

      <section className="section" aria-labelledby="race-h">
        <div className="section-head">
          <h2 id="race-h">Division Race</h2>
          {/* Each division owns its own screenshot button next to its own
              label (DivisionStandings.tsx) — two separate tables, no single
              shared block to capture here. */}
        </div>
        {standings.error && <div className="error-state">{standings.error}</div>}
        {standings.data && meta.divisions.length > 0 && (
          <div className="two-col">
            {meta.divisions.map((d) => (
              <DivisionStandings
                key={d.id}
                name={d.name}
                rows={standings.data!.rows.filter((r) => r.division_id === d.id)}
                simByTeam={simByTeam}
              />
            ))}
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="odds-h">
        <div className="section-head">
          <h2 id="odds-h">Playoff Probability</h2>
          <span className="label">
            current odds · red = if you lose this week · green = if you win
            {sim.data && (
              <ScreenshotButton
                targetRef={playoffTracksRef}
                filename="playoff-probability"
                prepareCapture={odds.prepareCapture}
                cleanupCapture={odds.cleanupCapture}
              />
            )}
          </span>
        </div>
        {sim.data ? (
          <>
            <PlayoffProbabilityTracks ref={playoffTracksRef} teams={sim.data.teams} forceDesktop={odds.forceDesktop} />
            <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.9rem", fontStyle: "italic" }}>
              {sim.data.n_sims.toLocaleString()} simulations, {sim.data.remaining_matchups} games left. {sim.data.model}.
            </p>
          </>
        ) : (
          !sim.loading && (
            <EmptyState>
              {meta.season_over
                ? "Season's over — no odds to simulate."
                : "Not yet simulated — odds arrive with the first data refresh."}
            </EmptyState>
          )
        )}
      </section>

      <section className="section" aria-labelledby="arc-h">
        <div className="section-head">
          <h2 id="arc-h">Season timeline</h2>
          <span className="label">
            {meta.season} standings by week — your team in green
            {schedule.data && (
              <ScreenshotButton
                targetRef={bumpChartRef}
                filename="season-timeline"
                prepareCapture={bump.prepareCapture}
                cleanupCapture={bump.cleanupCapture}
              />
            )}
          </span>
        </div>
        {schedule.data ? (
          <BumpChart ref={bumpChartRef} schedule={schedule.data} meta={meta} forceDesktop={bump.forceDesktop} />
        ) : (
          !schedule.loading && <EmptyState>No schedule data.</EmptyState>
        )}
      </section>

      <section className="section" aria-labelledby="points-h">
        <div className="section-head">
          <h2 id="points-h">Points race</h2>
          <span className="label">
            3-week rolling average PPG, playoffs included — your team in green
            {schedule.data && (
              <ScreenshotButton
                targetRef={pointsChartRef}
                filename="points-race"
                prepareCapture={points.prepareCapture}
                cleanupCapture={points.cleanupCapture}
              />
            )}
          </span>
        </div>
        {schedule.data ? (
          <PointsPaceChart ref={pointsChartRef} schedule={schedule.data} meta={meta} forceDesktop={points.forceDesktop} />
        ) : (
          !schedule.loading && <EmptyState>No schedule data.</EmptyState>
        )}
      </section>

      <section className="section" aria-labelledby="swap-h">
        <div className="section-head">
          <h2 id="swap-h">Schedule swap</h2>
          <span className="label">the argument generator</span>
        </div>
        {scheduleSwap.data ? (
          <SwapMatrix swap={scheduleSwap.data} meta={meta} />
        ) : (
          !scheduleSwap.loading && <EmptyState>Needs at least one completed week.</EmptyState>
        )}
      </section>

      {spectrum.data && spectrum.data.teams.length > 0 && (
        <section className="section" aria-labelledby="spectrum-h">
          <div className="section-head">
            <h2 id="spectrum-h">Contend / Rebuild</h2>
            <span className="label">
              redraft roster value vs. dynasty + pick capital
              <ScreenshotButton targetRef={contendRebuildRef} filename="contend-rebuild" />
            </span>
          </div>
          <ContendRebuildTable ref={contendRebuildRef} spectrum={spectrum.data} />
        </section>
      )}

      {positions.data && (
        <section className="section" aria-labelledby="pos-h">
          <div className="section-head">
            <h2 id="pos-h">Positional strength</h2>
            <span className="label">
              who's carrying a hole at TE
              <ScreenshotButton targetRef={positionHeatmapRef} filename="positional-strength" />
            </span>
          </div>
          <PositionHeatmap ref={positionHeatmapRef} positions={positions.data} />
        </section>
      )}

      {latestWeek !== null && superlatives.data && (
        <section className="section" aria-labelledby="awards-h">
          <div className="section-head">
            <h2 id="awards-h">Week {latestWeek} Superlatives</h2>
            <span className="label">
              the certificates
              <ScreenshotButton targetRef={superlativesGridRef} filename={`superlatives-week${latestWeek}`} />
            </span>
          </div>
          <div className="card-grid" ref={superlativesGridRef}>
            {superlatives.data.awards
              .filter((a) => a.week === latestWeek)
              .map((a, i) => (
                <SuperlativeCard
                  key={a.key}
                  award={a}
                  meta={superlatives.data!.awards_meta[a.key]}
                  index={i}
                />
              ))}
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="activity-h">
        <div className="section-head">
          <h2 id="activity-h">Recent Activity</h2>
        </div>
        {activity.error && <div className="error-state">{activity.error}</div>}
        {activity.data && <ActivityFeed activity={activity.data} />}
      </section>
    </>
  );
}
