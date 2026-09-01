import { useMemo, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { useJson, useOptionalJson } from "../lib/data";
import { MISSING, pct, pts, signed } from "../lib/format";
import { useSort, useSorted } from "../lib/useSort";
import BadgeShelf from "../components/BadgeShelf";
import EmptyState from "../components/EmptyState";
import PlayerCardTrigger from "../components/PlayerCardTrigger";
import PlayerHeadshot from "../components/PlayerHeadshot";
import RosterTable from "../components/RosterTable";
import ScreenshotButton from "../components/ScreenshotButton";
import TeamLink from "../components/TeamLink";
import { PlayoffOddsChart } from "../components/HistoryCharts";
import { BenchChart, CoachChart, ScoringChart } from "../components/TeamCharts";
import type { Badges, ProjectionReportRow, Roster, Sim, SimByWeek, Teams, TopScorer } from "../types/data";

interface ScheduleRow {
  week: number;
  opponentId: number | null;
  isHome: boolean;
  played: boolean;
  result?: "W" | "L" | "T";
  points?: number;
  opponentPoints?: number | null;
  topScorers?: TopScorer[];
}

const PROJ_COLS: { key: keyof ProjectionReportRow | "player"; label: string; numeric: boolean }[] = [
  { key: "player", label: "Player", numeric: false },
  { key: "position", label: "Pos", numeric: false },
  { key: "starts", label: "Starts", numeric: true },
  { key: "actual", label: "Actual", numeric: true },
  { key: "projected", label: "Projected", numeric: true },
  { key: "diff", label: "Diff", numeric: true },
];

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-block">
      <div className="label">{label}</div>
      <div className="stat-value num">{value}</div>
      {sub && <div className="muted stat-sub">{sub}</div>}
    </div>
  );
}

export default function MyTeamPage() {
  const { season, meta, myTeamId, teamsById, teamName } = useApp();
  // A team id in the URL (the Franchises-menu nav pivot: "that team's
  // current-season page," reachable for ANY team without touching the
  // globally-selected myTeamId) wins over the global selection. The
  // no-param /team route keeps its exact original behavior — always the
  // globally-selected team, still the "Pick your team" gate below when
  // nothing's picked yet.
  const { teamId: teamIdParam } = useParams<{ teamId: string }>();
  const teamId = teamIdParam ? Number(teamIdParam) : myTeamId;
  const rosterTableRef = useRef<HTMLTableElement>(null);
  const base = season !== null ? `${season}` : null;
  const teams = useJson<Teams>(base ? `${base}/teams.json` : null);
  const badges = useJson<Badges>("badges.json");
  const sim = useOptionalJson<Sim>(base ? `${base}/sim.json` : null);
  const simByWeek = useOptionalJson<SimByWeek>(base ? `${base}/sim_by_week.json` : null);
  const roster = useOptionalJson<Roster>(base ? `${base}/roster.json` : null);

  const my = teams.data?.teams.find((t) => t.team_id === teamId) ?? null;
  const projSort = useSort<ProjectionReportRow>("diff", -1, (r, key) =>
    key === "player" ? r.name : (r[key as keyof ProjectionReportRow] as number | string),
  );
  const projRows = useSorted(my?.projection_report ?? [], projSort);
  const scheduleRows: ScheduleRow[] = useMemo(() => {
    if (!my) return [];
    const played: ScheduleRow[] = my.weekly.map((w) => ({
      week: w.week, opponentId: w.opponent_id, isHome: w.is_home, played: true,
      result: w.result, points: w.points, opponentPoints: w.opponent_points,
      topScorers: w.top_scorers,
    }));
    const upcoming: ScheduleRow[] = my.upcoming.map((u) => ({
      week: u.matchup_period, opponentId: u.opponent_id, isHome: u.is_home, played: false,
    }));
    return [...played, ...upcoming].sort((a, b) => a.week - b.week);
  }, [my]);
  const avgByWeek = useMemo(() => {
    const m = new Map<number, number | null>();
    teams.data?.league_weekly_avg.forEach((w) => m.set(w.week, w.avg));
    return m;
  }, [teams.data]);

  if (!meta) return null;

  if (teamId === null) {
    // Only reachable via the no-param /team route — the parameterized
    // team/:teamId route always has a real (if possibly bogus) id from
    // the URL, handled by the "Team not found" branch below instead.
    return (
      <section className="section">
        <div className="section-head"><h2>My Team</h2></div>
        <EmptyState>Pick your team in the header — the choice sticks on this device.</EmptyState>
      </section>
    );
  }

  if (teamIdParam && !teamsById.has(teamId)) {
    return (
      <section className="section">
        <div className="section-head"><h2>Team not found</h2></div>
        <EmptyState>No team with that id in {meta.season}.</EmptyState>
      </section>
    );
  }

  const info = teamsById.get(teamId);
  const myBadges = badges.data?.teams[String(teamId)] ?? [];

  const scoring = my?.weekly.map((w) => ({ week: w.week, points: w.points, avg: avgByWeek.get(w.week) ?? null })) ?? [];
  let running = 0;
  const bench = my?.weekly.map((w) => ({ week: w.week, cumulative: Math.round((running += w.bench_points_lost ?? 0) * 10) / 10 })) ?? [];
  const coachTrend = my?.weekly.map((w) => ({ week: w.week, rating: w.coach_rating })) ?? [];

  const best = my && my.weekly.length ? my.weekly.reduce((a, b) => (b.points > a.points ? b : a)) : null;
  const worst = my && my.weekly.length ? my.weekly.reduce((a, b) => (b.points < a.points ? b : a)) : null;

  const record = my
    ? my.weekly.filter((w) => !w.is_playoff).reduce(
        (acc, w) => {
          acc[w.result] += 1;
          return acc;
        },
        { W: 0, L: 0, T: 0 } as Record<"W" | "L" | "T", number>,
      )
    : null;

  const ap = my?.season.all_play;

  return (
    <>
      <section className="team-head">
        <div>
          <p className="label">{meta.season} · {info?.nickname ?? info?.owner ?? "unclaimed"}</p>
          <h2 className="team-title">{info?.name ?? `Team ${teamId}`}</h2>
          {badges.error ? <div className="error-state">{badges.error}</div> : <BadgeShelf badges={myBadges} />}
          <Link to={`/franchise/${teamId}`} className="muted" style={{ fontSize: "0.8rem" }}>
            View full franchise history →
          </Link>
        </div>
      </section>

      {teams.error && <div className="error-state">{teams.error}</div>}

      {(() => {
        const myRoster = roster.data?.teams[String(teamId)];
        if (!myRoster) return null;
        return (
          <section className="section">
            <div className="section-head">
              <h2>Current roster</h2>
              <span className="label">
                week {roster.data!.current_week}
                <ScreenshotButton targetRef={rosterTableRef} filename="my-roster" />
              </span>
            </div>
            <RosterTable ref={rosterTableRef} roster={myRoster} />
            <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.5rem", fontStyle: "italic" }}>
              Last = points in the most recent game. Last3 = average points over the last 3 games. Diff = average
              of actual minus projected points per game over the last 3 games. 🔥/🧊 = well ahead of/behind
              projection — a single big week once that player's game has started, or 3 straight games before it
              has. None of this is something ESPN shows.
            </p>
          </section>
        );
      })()}

      {!meta.season_started || !my || my.weekly.length === 0 ? (
        <section className="section">
          <EmptyState>
            {meta.season_started
              ? `ESPN only serves summary data for ${meta.season} — week-by-week detail starts in 2025.`
              : `Nothing to chart yet — the ${meta.season} season hasn't kicked off. The badge shelf
                 above is career hardware; flip to ${meta.previous_seasons.at(-1)} for last season's numbers.`}
          </EmptyState>
        </section>
      ) : (
        my && (
          <>
            <section className="section stat-row hero-stats">
              <Stat label="Record" value={record ? `${record.W}-${record.L}${record.T ? `-${record.T}` : ""}` : MISSING} />
              <Stat
                label="All-play"
                value={ap ? `${ap.wins}-${ap.losses}${ap.ties ? `-${ap.ties}` : ""}` : MISSING}
                sub={ap?.pct != null ? pct(ap.pct) : undefined}
              />
              <Stat
                label="Luck"
                value={ap ? signed(ap.luck, 2) : MISSING}
                sub="wins vs all-play expectation"
              />
              <Stat
                label="Coach rating"
                value={my.season.coach.rating != null ? pct(my.season.coach.rating) : MISSING}
                sub="of a perfect lineup"
              />
              <Stat
                label="Left on bench"
                value={pts(my.season.coach.bench_lost)}
                sub="season points"
              />
            </section>

            <section className="section">
              <div className="section-head">
                <h2>Scoring, week by week</h2>
                <span className="label">green = you · gold dash = league average</span>
              </div>
              <ScoringChart data={scoring} />
            </section>

            <div className="two-col">
              {meta.season_over ? (
                <section className="section">
                  <div className="section-head"><h2>The regret chart</h2>
                    <span className="label">cumulative points benched</span></div>
                  <BenchChart data={bench} />
                </section>
              ) : (
                // Playoff-odds-by-week only exists for the CURRENT season
                // (sim_by_week.json isn't backfilled for past ones — see
                // that file's DATA.md section for why) — a past season
                // keeps the regret chart above, unchanged.
                <section className="section">
                  <div className="section-head"><h2>Playoff odds by week</h2>
                    <span className="label">{meta.season}</span></div>
                  {simByWeek.data ? (
                    <PlayoffOddsChart simByWeek={simByWeek.data} meta={meta} onlyTeamId={teamId} accentTeamId={teamId} />
                  ) : (
                    !simByWeek.loading && (
                      <EmptyState>Not simulated yet — odds arrive with the first data refresh once a week's in the books.</EmptyState>
                    )
                  )}
                </section>
              )}
              <section className="section">
                <div className="section-head"><h2>Coach rating trend</h2></div>
                <CoachChart data={coachTrend} />
              </section>
            </div>

            <div className="two-col">
              <section className="section">
                <div className="section-head"><h2>Best week</h2></div>
                {best && (
                  <p>
                    <span className="num" style={{ fontSize: "1.6rem" }}>{pts(best.points)}</span>{" "}
                    <span className="muted">week {best.week} {best.result === "W" ? "win" : best.result === "L" ? "loss" : "tie"} vs{" "}
                      {best.opponent_id !== null ? <TeamLink id={best.opponent_id}>{teamName(best.opponent_id)}</TeamLink> : teamName(best.opponent_id)}
                    </span>
                  </p>
                )}
              </section>
              <section className="section">
                <div className="section-head"><h2>Worst week</h2></div>
                {worst && (
                  <p>
                    <span className="num" style={{ fontSize: "1.6rem" }}>{pts(worst.points)}</span>{" "}
                    <span className="muted">week {worst.week} {worst.result === "W" ? "win" : worst.result === "L" ? "loss" : "tie"} vs{" "}
                      {worst.opponent_id !== null ? <TeamLink id={worst.opponent_id}>{teamName(worst.opponent_id)}</TeamLink> : teamName(worst.opponent_id)}
                    </span>
                  </p>
                )}
              </section>
            </div>

            <section className="section">
              <div className="section-head">
                <h2>Who contributed more than expected</h2>
                <span className="label">your starters, season actual vs projected</span>
              </div>
              {my.projection_report.length === 0 ? (
                <EmptyState>No projection data yet.</EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="stat">
                    <thead>
                      <tr>
                        {PROJ_COLS.map((c) => (
                          <th key={c.key} scope="col"
                            className={`sortable${c.numeric ? " num" : ""}`}
                            aria-sort={projSort.ariaSort(c.key)}
                            onClick={() => projSort.toggle(c.key, c.numeric ? -1 : 1)}>
                            {c.label}{projSort.marker(c.key)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {projRows.map((p) => (
                        <tr key={p.player_id}>
                          <td>
                            <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                              <PlayerHeadshot playerId={p.player_id} position={p.position} proTeam={p.pro_team} />
                              <strong>
                                <PlayerCardTrigger playerId={p.player_id} name={p.name} position={p.position} proTeam={p.pro_team}>
                                  {p.name}
                                </PlayerCardTrigger>
                              </strong>
                            </span>
                          </td>
                          <td className="muted">{p.position}</td>
                          <td className="num">{p.starts}</td>
                          <td className="num">{pts(p.actual)}</td>
                          <td className="num">{pts(p.projected)}</td>
                          <td className={`num ${p.diff >= 0 ? "pos" : "neg"}`}>{signed(p.diff)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )
      )}

      <section className="section">
        <div className="section-head"><h2>Schedule</h2></div>
        {scheduleRows.length > 0 ? (
          <div className="table-wrap">
            <table className="stat">
              <thead>
                <tr>
                  <th scope="col" className="num">Week</th>
                  <th scope="col">Opponent</th>
                  <th scope="col" className="num">Result</th>
                  <th scope="col">Top scorers</th>
                </tr>
              </thead>
              <tbody>
                {scheduleRows.map((r) => (
                  <tr key={r.week}>
                    <td className="num muted">{r.week}</td>
                    <td>
                      {r.opponentId === null ? (
                        <span className="muted">bye</span>
                      ) : (
                        <>{r.isHome ? "vs" : "at"} <strong><TeamLink id={r.opponentId}>{teamName(r.opponentId)}</TeamLink></strong></>
                      )}
                    </td>
                    <td className="num">
                      {r.played && r.result ? (
                        <span className={r.result === "W" ? "pos" : r.result === "L" ? "neg" : ""}>
                          {r.result} {pts(r.points, 0)}-{pts(r.opponentPoints, 0)}
                        </span>
                      ) : (
                        <span className="muted">{MISSING}</span>
                      )}
                    </td>
                    <td>
                      {r.topScorers?.map((p) => (
                        <span key={p.player_id} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", marginRight: "0.7rem" }}>
                          <PlayerHeadshot playerId={p.player_id} position={p.position} proTeam={p.pro_team} className="leaderboard-headshot" />
                          <PlayerCardTrigger playerId={p.player_id} name={p.name} position={p.position} proTeam={p.pro_team}>
                            {p.name}
                          </PlayerCardTrigger> <span className="muted num">{pts(p.points)}</span>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>No schedule on file{meta.season_over ? "" : " yet"}.</EmptyState>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Playoff picture</h2></div>
        {(() => {
          const s = sim.data?.teams.find((t) => t.team_id === teamId);
          if (!s) {
            return (
              !sim.loading && (
                <EmptyState>
                  {meta.season_over
                    ? "Season's over — see Superlatives for how it ended."
                    : '"What has to happen" arrives with the playoff-odds simulation once the season is underway.'}
                </EmptyState>
              )
            );
          }
          const winsNeeded = Object.entries(s.playoff_pct_by_final_wins)
            .find(([, p]) => p >= 0.8)?.[0];
          return (
            <div>
              <div className="stat-row" style={{ borderTop: "none", paddingTop: 0 }}>
                <Stat label="Make playoffs" value={pct(s.playoff_pct, 0)}
                  sub={`±${(s.playoff_se * 100).toFixed(1)}% over ${sim.data!.n_sims.toLocaleString()} sims`} />
                <Stat label="Win it all" value={pct(s.title_pct, 1)} />
                <Stat label="Projected wins" value={pts(s.avg_final_wins)} />
              </div>
              <p style={{ marginTop: "1rem", maxWidth: "56ch" }}>
                {s.playoff_pct_if_win_next !== null && s.playoff_pct_if_lose_next !== null && (
                  <>Win next week and it's <strong className="num">{pct(s.playoff_pct_if_win_next, 0)}</strong>;
                  {" "}lose and it drops to <strong className="num">{pct(s.playoff_pct_if_lose_next, 0)}</strong>.{" "}</>
                )}
                {winsNeeded && (
                  <>Get to <strong className="num">{winsNeeded} wins</strong> and you're in at least{" "}
                  <strong className="num">{pct(s.playoff_pct_by_final_wins[winsNeeded], 0)}</strong> of simulations.</>
                )}
              </p>
            </div>
          );
        })()}
      </section>
    </>
  );
}
