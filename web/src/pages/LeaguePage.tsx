import { useApp } from "../state/AppContext";
import { useJson, useOptionalJson } from "../lib/data";
import { pts } from "../lib/format";
import StandingsTable from "../components/StandingsTable";
import DivisionStandings from "../components/DivisionStandings";
import PlayoffProbabilityTracks from "../components/PlayoffProbabilityTracks";
import SuperlativeCard from "../components/SuperlativeCard";
import ActivityFeed from "../components/ActivityFeed";
import EmptyState from "../components/EmptyState";
import PositionHeatmap from "../components/PositionHeatmap";
import ContendRebuildTable from "../components/ContendRebuildTable";
import type { Activity, Award, Positions, Recaps, Sim, Spectrum, Standings, Superlatives } from "../types/data";

/** Pick the latest week's single biggest story for the hero. */
function marquee(awards: Award[], week: number): Award | null {
  const wk = awards.filter((a) => a.week === week);
  if (wk.length === 0) return null;
  const benching = wk.find((a) => a.key === "worst_benching");
  if (benching && benching.value >= 25) return benching;
  const blowout = wk.find((a) => a.key === "blowout");
  if (blowout && blowout.value >= 45) return blowout;
  return wk.find((a) => a.key === "highest_score") ?? wk[0];
}

export default function LeaguePage() {
  const { season, meta } = useApp();
  const base = season !== null ? `${season}` : null;
  const standings = useJson<Standings>(base ? `${base}/standings.json` : null);
  const superlatives = useJson<Superlatives>(base ? `${base}/superlatives.json` : null);
  const activity = useJson<Activity>(base ? `${base}/activity.json` : null);
  const sim = useOptionalJson<Sim>(base ? `${base}/sim.json` : null);
  const recaps = useOptionalJson<Recaps>(base ? `${base}/recaps.json` : null);
  const positions = useOptionalJson<Positions>(base ? `${base}/positions.json` : null);
  const spectrum = useJson<Spectrum>("spectrum.json");

  if (!meta) return null;

  const latestWeek = meta.completed_weeks.at(-1) ?? null;
  const simByTeam = new Map((sim.data?.teams ?? []).map((t) => [t.team_id, t]));
  const story =
    latestWeek !== null && superlatives.data
      ? marquee(superlatives.data.awards, latestWeek)
      : null;

  return (
    <>
      {!meta.season_started ? (
        <section className="hero">
          <p className="label">The {meta.season} season</p>
          <h2 className="hero-headline">The games haven't started yet.</h2>
          <p className="hero-sub muted">
            {meta.team_count} teams are in. {meta.reg_season_weeks}-week regular season,{" "}
            {meta.playoff_team_count} playoff spots. Flip the season selector to{" "}
            {meta.previous_seasons.at(-1)} for last year's full story.
          </p>
        </section>
      ) : (
        story && (
          <section className="hero">
            <p className="label">
              Week {story.week} · {meta.season}
            </p>
            <h2 className="hero-headline">{story.detail}.</h2>
            <p className="hero-sub muted">
              {superlatives.data?.awards_meta[story.key]?.label} · {pts(story.value)}
            </p>
            {recaps.data?.recaps[String(story.week)] && (
              <p className="recap">{recaps.data.recaps[String(story.week)]}</p>
            )}
          </section>
        )
      )}

      <section className="section" aria-labelledby="standings-h">
        <div className="section-head">
          <h2 id="standings-h">Standings</h2>
          <span className="label">click a column to sort</span>
        </div>
        {standings.error && <div className="error-state">{standings.error}</div>}
        {standings.data && <StandingsTable rows={standings.data.rows} />}
      </section>

      <section className="section" aria-labelledby="race-h">
        <div className="section-head">
          <h2 id="race-h">Division Race</h2>
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
          <span className="label">current odds · red = if you lose this week · green = if you win</span>
        </div>
        {sim.data ? (
          <>
            <PlayoffProbabilityTracks teams={sim.data.teams} />
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

      {spectrum.data && spectrum.data.teams.length > 0 && (
        <section className="section" aria-labelledby="spectrum-h">
          <div className="section-head">
            <h2 id="spectrum-h">Contend / Rebuild</h2>
            <span className="label">redraft roster value vs. dynasty + pick capital</span>
          </div>
          <ContendRebuildTable spectrum={spectrum.data} />
        </section>
      )}

      {positions.data && (
        <section className="section" aria-labelledby="pos-h">
          <div className="section-head">
            <h2 id="pos-h">Positional strength</h2>
            <span className="label">who's carrying a hole at TE</span>
          </div>
          <PositionHeatmap positions={positions.data} />
        </section>
      )}

      {latestWeek !== null && superlatives.data && (
        <section className="section" aria-labelledby="awards-h">
          <div className="section-head">
            <h2 id="awards-h">Week {latestWeek} Superlatives</h2>
            <span className="label">the certificates</span>
          </div>
          <div className="card-grid">
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
