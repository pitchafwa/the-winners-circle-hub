import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { useJson, useOptionalJson } from "../lib/data";
import { MISSING, pct, pts, signed } from "../lib/format";
import { useSort, useSorted } from "../lib/useSort";
import BadgeShelf from "../components/BadgeShelf";
import EmptyState from "../components/EmptyState";
import PlayerHeadshot from "../components/PlayerHeadshot";
import RosterTable from "../components/RosterTable";
import { BenchChart, CoachChart, ScoringChart } from "../components/TeamCharts";
import type { Badges, ProjectionReportRow, Roster, Sim, Teams } from "../types/data";

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
  const base = season !== null ? `${season}` : null;
  const teams = useJson<Teams>(base ? `${base}/teams.json` : null);
  const badges = useJson<Badges>("badges.json");
  const sim = useOptionalJson<Sim>(base ? `${base}/sim.json` : null);
  const roster = useOptionalJson<Roster>(base ? `${base}/roster.json` : null);

  const my = teams.data?.teams.find((t) => t.team_id === myTeamId) ?? null;
  const projSort = useSort<ProjectionReportRow>("diff", -1, (r, key) =>
    key === "player" ? r.name : (r[key as keyof ProjectionReportRow] as number | string),
  );
  const projRows = useSorted(my?.projection_report ?? [], projSort);
  const avgByWeek = useMemo(() => {
    const m = new Map<number, number | null>();
    teams.data?.league_weekly_avg.forEach((w) => m.set(w.week, w.avg));
    return m;
  }, [teams.data]);

  if (!meta) return null;

  if (myTeamId === null) {
    return (
      <section className="section">
        <div className="section-head"><h2>My Team</h2></div>
        <EmptyState>Pick your team in the header — the choice sticks on this device.</EmptyState>
      </section>
    );
  }

  const info = teamsById.get(myTeamId);
  const myBadges = badges.data?.teams[String(myTeamId)] ?? [];

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
          <h2 className="team-title">{info?.name ?? `Team ${myTeamId}`}</h2>
          {badges.error ? <div className="error-state">{badges.error}</div> : <BadgeShelf badges={myBadges} />}
          <Link to={`/franchise/${myTeamId}`} className="muted" style={{ fontSize: "0.8rem" }}>
            View full franchise history →
          </Link>
        </div>
      </section>

      {teams.error && <div className="error-state">{teams.error}</div>}

      {(() => {
        const myRoster = roster.data?.teams[String(myTeamId)];
        if (!myRoster) return null;
        return (
          <section className="section">
            <div className="section-head">
              <h2>Current roster</h2>
              <span className="label">week {roster.data!.current_week}</span>
            </div>
            <RosterTable roster={myRoster} />
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
              <section className="section">
                <div className="section-head"><h2>The regret chart</h2>
                  <span className="label">cumulative points benched</span></div>
                <BenchChart data={bench} />
              </section>
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
                    <span className="muted">week {best.week} {best.result === "W" ? "win" : best.result === "L" ? "loss" : "tie"} vs {teamName(best.opponent_id)}</span>
                  </p>
                )}
              </section>
              <section className="section">
                <div className="section-head"><h2>Worst week</h2></div>
                {worst && (
                  <p>
                    <span className="num" style={{ fontSize: "1.6rem" }}>{pts(worst.points)}</span>{" "}
                    <span className="muted">week {worst.week} {worst.result === "W" ? "win" : worst.result === "L" ? "loss" : "tie"} vs {teamName(worst.opponent_id)}</span>
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
                              <PlayerHeadshot playerId={p.player_id} position={p.position} />
                              <strong>{p.name}</strong>
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
        <div className="section-head"><h2>Upcoming schedule</h2></div>
        {my && my.upcoming.length > 0 ? (
          <ul className="feed">
            {my.upcoming.map((u) => (
              <li key={u.matchup_period} className="feed-row">
                <span className="muted num feed-date">wk {u.matchup_period}</span>
                <span>{u.is_home ? "vs" : "at"} <strong>{teamName(u.opponent_id)}</strong></span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No remaining games{meta.season_over ? " — season's done" : " on the schedule yet"}.</EmptyState>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Playoff picture</h2></div>
        {(() => {
          const s = sim.data?.teams.find((t) => t.team_id === myTeamId);
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
