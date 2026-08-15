import { useState } from "react";
import { useApp } from "../state/AppContext";
import { useJson, useOptionalJson } from "../lib/data";
import { MISSING, pct, pts } from "../lib/format";
import EmptyState from "../components/EmptyState";
import type { LineupPlayer, Matchup, MatchupSide, Recaps, WeekMatchups } from "../types/data";

function PlayerRow({ p }: { p: LineupPlayer | undefined }) {
  if (!p) return <div className="mu-player" />;
  return (
    <div className="mu-player">
      <span className="mu-name">
        {p.name}
        <span className="muted mu-pos"> {p.position}</span>
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

function MatchupCard({ m }: { m: Matchup }) {
  const { teamName } = useApp();
  if (!m.away) {
    return (
      <article className="mu-card">
        <div className="mu-head">
          <strong>{teamName(m.home.team_id)}</strong>
          <span className="muted">bye</span>
        </div>
      </article>
    );
  }
  const homeWon = m.winner === "HOME";
  const awayWon = m.winner === "AWAY";
  const homeStarters = m.home.lineup.filter((p) => p.started);
  const awayStarters = m.away.lineup.filter((p) => p.started);
  const rows = Math.max(homeStarters.length, awayStarters.length);

  return (
    <article className="mu-card">
      {m.is_playoff && <div className="label" style={{ marginBottom: "0.4rem" }}>
        {m.playoff_tier === "WINNERS_BRACKET" ? "playoffs" : "consolation"}</div>}
      <div className="mu-head">
        <div className={`mu-team ${awayWon ? "winner" : ""}`}>
          <strong>{teamName(m.away.team_id)}</strong>
          <span className="num mu-total">{pts(m.away.total)}</span>
        </div>
        <span className="muted mu-at">at</span>
        <div className={`mu-team ${homeWon ? "winner" : ""}`}>
          <strong>{teamName(m.home.team_id)}</strong>
          <span className="num mu-total">{pts(m.home.total)}</span>
        </div>
      </div>
      <div className="mu-grid">
        <div className="mu-col">
          {Array.from({ length: rows }, (_, i) => (
            <PlayerRow key={i} p={awayStarters[i]} />
          ))}
        </div>
        <div className="mu-slots">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="label mu-slot">{homeStarters[i]?.slot ?? awayStarters[i]?.slot ?? ""}</div>
          ))}
        </div>
        <div className="mu-col right">
          {Array.from({ length: rows }, (_, i) => (
            <PlayerRow key={i} p={homeStarters[i]} />
          ))}
        </div>
      </div>
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
      </details>
    </article>
  );
}

export default function MatchupsPage() {
  const { season, meta } = useApp();
  const weeks = meta?.completed_weeks ?? [];
  const [chosen, setChosen] = useState<number | null>(null);
  const week = chosen ?? weeks.at(-1) ?? null;
  const data = useJson<WeekMatchups>(
    season !== null && week !== null ? `${season}/matchups/week-${week}.json` : null,
  );
  const recaps = useOptionalJson<Recaps>(season !== null ? `${season}/recaps.json` : null);

  if (!meta) return null;

  const recap = week !== null ? recaps.data?.recaps[String(week)] : undefined;

  return (
    <section className="section">
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
        <div className="mu-list">
          {recap && <p className="recap" style={{ marginBottom: "0.5rem" }}>{recap}</p>}
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "1rem" }}>
            Player lines show actual /projected points.
          </p>
          {data.data.matchups.map((m, i) => (
            <MatchupCard key={i} m={m} />
          ))}
        </div>
      )}
    </section>
  );
}
