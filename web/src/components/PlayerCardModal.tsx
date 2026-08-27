import { useEffect, useMemo, useState } from "react";
import { useOptionalJson } from "../lib/data";
import { MISSING, pts } from "../lib/format";
import { fetchPlayerOverview, type PlayerOverview } from "../lib/playerCard";
import { fetchPlayerSeasonData, type PlayerSeasonData } from "../lib/playerGameLog";
import { useApp } from "../state/AppContext";
import type { PlayerCardTarget } from "../state/PlayerCardContext";
import type { PlayerAges } from "../types/data";
import PlayerHeadshot from "./PlayerHeadshot";
import TeamLink from "./TeamLink";

function formatDate(input: string | undefined): string {
  if (!input) return "";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** ESPN's statistics block is one flat labels/stats array spanning every
 * category (e.g. a QB's passing AND rushing columns together) rather than
 * split per category the way gameLog is — rendered as one wide table,
 * scrollable via .table-wrap like every other dense table in this app.
 * Renders its own label, or nothing at all — keeps the "is there real data
 * here" decision in one place rather than duplicated in the parent (a
 * stale duplicate of that check is exactly what let an empty "Recent
 * games" header through the first time this was written). */
function SeasonStatsSection({ statistics }: { statistics: PlayerOverview["statistics"] }) {
  if (!statistics || statistics.splits.length === 0) return null;
  const split = statistics.splits.find((s) => s.displayName === "Regular Season") ?? statistics.splits[0];
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <div className="label" style={{ marginBottom: "0.3rem" }}>ESPN season stats</div>
      <div className="table-wrap">
        <table className="stat">
          <thead>
            <tr>
              <th scope="col">{split.displayName}</th>
              {statistics.labels.map((l, i) => <th key={i} scope="col" className="num">{l}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="muted">{statistics.displayName}</td>
              {split.stats.map((s, i) => <td key={i} className="num">{s}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PlayerCardModal({ target, onClose }: { target: PlayerCardTarget; onClose: () => void }) {
  const { seasonsIndex, currentTeamName } = useApp();
  const ages = useOptionalJson<PlayerAges>("player_ages.json");

  const [state, setState] = useState<{ data: PlayerOverview | null; error: string | null; loading: boolean }>({
    data: null, error: null, loading: true,
  });

  // Own season selector, shared by the PPG/rank stat block above and the
  // game log table below — both read the same league data for whichever
  // season is picked, so one selector drives both rather than risking two
  // drifting out of sync. Defaults to the latest season that's actually
  // started (current season if underway, most recent one otherwise) —
  // seasons.json is already written newest-first.
  const seasons = useMemo(
    () => (seasonsIndex?.seasons ?? []).filter((s) => s.season_started),
    [seasonsIndex],
  );
  const [season, setSeason] = useState<number | null>(null);
  useEffect(() => {
    if (season === null && seasons.length > 0) setSeason(seasons[0].season);
  }, [seasons, season]);

  const [seasonState, setSeasonState] = useState<{ data: PlayerSeasonData | null; loading: boolean; error: string | null }>({
    data: null, loading: false, error: null,
  });

  useEffect(() => {
    let alive = true;
    setState({ data: null, error: null, loading: true });
    fetchPlayerOverview(target.playerId)
      .then((data) => { if (alive) setState({ data, error: null, loading: false }); })
      .catch((err: Error) => { if (alive) setState({ data: null, error: err.message, loading: false }); });
    return () => { alive = false; };
  }, [target.playerId]);

  useEffect(() => {
    if (season === null) return;
    let alive = true;
    setSeasonState({ data: null, loading: true, error: null });
    fetchPlayerSeasonData(season, target.playerId, target.position)
      .then((data) => { if (alive) setSeasonState({ data, loading: false, error: null }); })
      .catch((err: Error) => { if (alive) setSeasonState({ data: null, loading: false, error: err.message }); });
    return () => { alive = false; };
  }, [season, target.playerId, target.position]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = state.data;
  const nextGame = d?.nextGame?.league?.events?.[0];
  const news = d?.rotowire ?? null;
  const fallbackNews = !news ? d?.news?.[0] : null;
  const age = ages.data?.ages[String(target.playerId)];
  const summary = seasonState.data?.summary;

  return (
    <div className="player-card-overlay" onClick={onClose}>
      <div className="player-card-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="player-card-close" aria-label="Close" onClick={onClose}>✕</button>

        <div className="player-card-header">
          <PlayerHeadshot playerId={target.playerId} position={target.position} proTeam={target.proTeam}
            className="player-card-headshot" />
          <div>
            <h3 className="player-card-name">{target.name ?? "Player"}</h3>
            <p className="muted">{[target.position, target.proTeam].filter(Boolean).join(" · ")}</p>
          </div>
        </div>

        {seasons.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span className="label">Season</span>
            <label>
              <select className="control" style={{ fontSize: "0.78rem", padding: "0.15rem 0.45rem" }}
                value={season ?? ""} onChange={(e) => setSeason(Number(e.target.value))}>
                {seasons.map((s) => <option key={s.season} value={s.season}>{s.season}</option>)}
              </select>
            </label>
          </div>
        )}

        <div className="stat-row" style={{ borderTop: "none", paddingTop: 0, marginBottom: "1rem" }}>
          <div className="stat-block">
            <div className="label">PPG</div>
            <div className="stat-value num">{summary?.ppg != null ? pts(summary.ppg) : MISSING}</div>
            {summary && summary.gamesPlayed > 0 && (
              <div className="muted stat-sub">{summary.gamesPlayed} game{summary.gamesPlayed === 1 ? "" : "s"}</div>
            )}
          </div>
          <div className="stat-block">
            <div className="label">Position rank</div>
            <div className="stat-value num">{summary?.positionRank != null ? `#${summary.positionRank}` : MISSING}</div>
            {summary && summary.positionCount > 0 && (
              <div className="muted stat-sub">of {summary.positionCount} in PPG</div>
            )}
          </div>
          <div className="stat-block">
            <div className="label">Age</div>
            <div className="stat-value num">{age != null ? age.toFixed(1) : MISSING}</div>
          </div>
        </div>

        {state.loading && <p className="muted" style={{ fontStyle: "italic" }}>Loading...</p>}
        {state.error && <div className="error-state">{state.error}</div>}

        {d && (
          <>
            {nextGame && (
              <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
                Next: <strong>{nextGame.shortName}</strong>
                {nextGame.weekText && ` · ${nextGame.weekText}`}
                {" · "}{formatDate(nextGame.date)}
              </p>
            )}

            {(news || fallbackNews) && (
              <div className="player-card-news">
                <div className="label" style={{ marginBottom: "0.3rem" }}>
                  {news ? "Latest report" : "Latest news"}
                </div>
                <p style={{ fontWeight: 600, marginBottom: "0.3rem" }}>
                  {news?.headline ?? fallbackNews?.headline}
                </p>
                {news?.story && <p className="muted" style={{ fontSize: "0.85rem" }}>{news.story}</p>}
                {!news && fallbackNews?.description && (
                  <p className="muted" style={{ fontSize: "0.85rem" }}>{fallbackNews.description}</p>
                )}
                <p className="muted" style={{ fontSize: "0.72rem", fontStyle: "italic", marginTop: "0.3rem" }}>
                  {formatDate(news?.published ?? fallbackNews?.lastModified)}
                </p>
              </div>
            )}

            {d.fantasy?.projection && (
              <div style={{ marginBottom: "1.25rem" }}>
                <div className="label" style={{ marginBottom: "0.3rem" }}>Season outlook</div>
                <p style={{ fontSize: "0.88rem" }}>{d.fantasy.projection}</p>
              </div>
            )}

            {d.awards && d.awards.length > 0 && (
              <p style={{ marginBottom: "1.25rem" }}>
                {d.awards.map((a) => `🏆 ${a.name} (${a.displayCount})`).join(" · ")}
              </p>
            )}

            <SeasonStatsSection statistics={d.statistics} />
          </>
        )}

        {season !== null && (
          <div>
            <div className="label" style={{ marginBottom: "0.3rem" }}>Game log — {season}</div>
            {seasonState.loading && <p className="muted" style={{ fontStyle: "italic", fontSize: "0.85rem" }}>Loading...</p>}
            {seasonState.error && <div className="error-state">{seasonState.error}</div>}
            {seasonState.data && (
              <div className="table-wrap">
                <table className="stat">
                  <thead>
                    <tr>
                      <th scope="col">Wk</th>
                      <th scope="col">Franchise</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="num">Points</th>
                      <th scope="col" className="num">Proj</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seasonState.data.rows.map((r) => (
                      <tr key={r.week}>
                        <td className="num muted">{r.week}</td>
                        <td>
                          {r.hasData && r.teamId !== null ? (
                            <TeamLink id={r.teamId}>{currentTeamName(r.teamId)}</TeamLink>
                          ) : (
                            <span className="muted">{MISSING}</span>
                          )}
                        </td>
                        <td className="muted">
                          {!r.hasData ? (
                            <span style={{ fontStyle: "italic" }}>Data not available</span>
                          ) : (
                            <>
                              {!r.played ? MISSING : r.started ? "Started" : "Bench"}
                              {r.onFire && " 🔥"}
                              {r.onIce && " 🧊"}
                            </>
                          )}
                        </td>
                        <td className="num">
                          {r.hasData && r.played ? pts(r.actual) : <span className="muted">{MISSING}</span>}
                        </td>
                        <td className="num muted">{r.hasData ? pts(r.projected) : MISSING}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
