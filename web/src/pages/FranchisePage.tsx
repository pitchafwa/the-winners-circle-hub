import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { loadJson, useJson } from "../lib/data";
import { useAllSeasons } from "../lib/useAllSeasons";
import { pts, shortDate, signed } from "../lib/format";
import BadgeShelf from "../components/BadgeShelf";
import EmptyState from "../components/EmptyState";
import { CareerLeaderboards } from "../components/HistoryCharts";
import PlayerHeadshot from "../components/PlayerHeadshot";
import type { Badges, Draft, DraftPick, Ownership, TradeGrades } from "../types/data";

function useTeamDraftPicks(teamId: number): { picks: (DraftPick & { season: number })[]; loading: boolean } {
  const { seasonsIndex } = useApp();
  const [state, setState] = useState<{ picks: (DraftPick & { season: number })[]; loading: boolean }>({
    picks: [], loading: true,
  });

  useEffect(() => {
    if (!seasonsIndex) return;
    let alive = true;
    Promise.all(
      seasonsIndex.seasons.map((s) => loadJson<Draft>(`${s.season}/draft.json`, true)),
    ).then((drafts) => {
      if (!alive) return;
      const picks: (DraftPick & { season: number })[] = [];
      drafts.forEach((d, i) => {
        if (!d) return;
        for (const p of d.picks) {
          if (p.team_id === teamId) picks.push({ ...p, season: seasonsIndex.seasons[i].season });
        }
      });
      picks.sort((a, b) => b.season - a.season || a.overall - b.overall);
      setState({ picks, loading: false });
    });
    return () => { alive = false; };
  }, [seasonsIndex, teamId]);

  return state;
}

export default function FranchisePage() {
  const { teamId } = useParams<{ teamId: string }>();
  const tid = Number(teamId);
  const { teamsById, teamName, currentTeamName } = useApp();
  const badges = useJson<Badges>("badges.json");
  const trades = useJson<TradeGrades>("trades.json");
  const ownership = useJson<Ownership>("ownership.json");
  const all = useAllSeasons();
  const draftPicks = useTeamDraftPicks(tid);

  const info = teamsById.get(tid);
  const myBadges = badges.data?.teams[String(tid)] ?? [];

  const career = useMemo(() => {
    let seasons = 0, w = 0, l = 0, t = 0, pf = 0;
    for (const b of all.bundles) {
      if (!b.meta.season_started) continue;
      const row = b.standings.rows.find((r) => r.team_id === tid);
      if (!row) continue;
      seasons += 1;
      w += row.wins; l += row.losses; t += row.ties; pf += row.points_for ?? 0;
    }
    return { seasons, w, l, t, pf, pct: (w + 0.5 * t) / Math.max(w + l + t, 1) };
  }, [all.bundles, tid]);

  const myTrades = (trades.data?.trades ?? []).filter((tr) => tr.team_ids.includes(tid));

  if (!info) return null;

  return (
    <>
      <section className="team-head">
        <p className="label">{info.nickname ?? info.owner}</p>
        <h2 className="team-title">{info.name}</h2>
        <BadgeShelf badges={myBadges} />
      </section>

      <section className="section stat-row hero-stats">
        <div className="stat-block">
          <div className="label">Seasons</div>
          <div className="stat-value num">{career.seasons}</div>
        </div>
        <div className="stat-block">
          <div className="label">Career record</div>
          <div className="stat-value num">{career.w}-{career.l}{career.t ? `-${career.t}` : ""}</div>
          <div className="muted stat-sub">{(career.pct * 100).toFixed(1)}%</div>
        </div>
        <div className="stat-block">
          <div className="label">Career PF</div>
          <div className="stat-value num">{pts(career.pf, 0)}</div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Roster legends</h2>
          <span className="label">from the roster-ownership timeline</span>
        </div>
        <CareerLeaderboards ownership={ownership.data} teamId={tid} teamName={currentTeamName} />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Trade history</h2>
        </div>
        {myTrades.length === 0 ? (
          <EmptyState>No trades on file for this franchise.</EmptyState>
        ) : (
          <div className="trade-cards">
            {myTrades.map((t) => {
              const side = t.value_by_team[String(tid)];
              return (
                <div key={`${t.date}-${t.team_ids.join("-")}`} className="trade-card">
                  <div className="label">{t.season} · week {t.week} · {shortDate(t.date)}</div>
                  <div className="trade-teams">
                    {t.team_ids.filter((id) => id !== tid).map((id) => teamName(id)).join(", ")}
                  </div>
                  <ul className="trade-players muted">
                    {t.players.map((p, i) => (
                      <li key={`p-${i}`} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        {p.player_id != null && <PlayerHeadshot playerId={p.player_id} className="leaderboard-headshot" />}
                        {p.name} → {teamName(p.to_team_id)}
                      </li>
                    ))}
                    {t.picks.map((p, i) => (
                      <li key={`k-${i}`}>{p.pick} → {teamName(p.to_team_id)}</li>
                    ))}
                  </ul>
                  {side && <div className="trade-verdict num">{signed(side.net, 0)}</div>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Draft history</h2>
        </div>
        {draftPicks.picks.length === 0 ? (
          !draftPicks.loading && <EmptyState>No draft picks on file for this franchise.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="stat">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col" className="num">Pick</th>
                  <th scope="col">Player</th>
                  <th scope="col">Pos</th>
                  <th scope="col" className="num">Value diff</th>
                </tr>
              </thead>
              <tbody>
                {draftPicks.picks.map((p) => (
                  <tr key={`${p.season}-${p.overall}`}>
                    <td className="num">{p.season}</td>
                    <td className="num">{p.overall}</td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        {p.player_id !== null && <PlayerHeadshot playerId={p.player_id} position={p.position} className="leaderboard-headshot" />}
                        <strong>{p.name}</strong>
                      </span>
                    </td>
                    <td className="muted">{p.position}</td>
                    <td className={p.value_diff === null ? "num muted" : `num ${p.value_diff >= 0 ? "pos" : "neg"}`}>
                      {p.value_diff === null ? "—" : signed(p.value_diff, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
