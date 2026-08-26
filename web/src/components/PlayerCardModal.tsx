import { useEffect, useMemo, useState } from "react";
import { MISSING, pts } from "../lib/format";
import { fetchPlayerOverview, type PlayerOverview } from "../lib/playerCard";
import { fetchPlayerSeasonGameLog, type PlayerGameLogRow } from "../lib/playerGameLog";
import { useApp } from "../state/AppContext";
import type { PlayerCardTarget } from "../state/PlayerCardContext";
import PlayerHeadshot from "./PlayerHeadshot";

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
    <div>
      <div className="label" style={{ marginBottom: "0.3rem" }}>Season stats</div>
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

/** This league's own real fantasy points, week by week — deliberately NOT
 * the ESPN-sourced gameLog (raw box-score stats, and only ever the
 * CURRENT real NFL season regardless of which fantasy season the rest of
 * the app is browsing). Season-selectable back to whatever year the
 * league has real box scores for; defaults to the latest season that's
 * actually started (current season if it's underway, most recent one
 * otherwise) via `seasons[0]` — `seasons.json` is already written
 * newest-first. */
function LeagueGameLogSection({ playerId }: { playerId: number }) {
  const { seasonsIndex } = useApp();
  const seasons = useMemo(
    () => (seasonsIndex?.seasons ?? []).filter((s) => s.season_started),
    [seasonsIndex],
  );
  const [season, setSeason] = useState<number | null>(null);
  const [state, setState] = useState<{ rows: PlayerGameLogRow[]; loading: boolean; error: string | null }>({
    rows: [], loading: false, error: null,
  });

  // seasonsIndex loads asynchronously — this settles the real default the
  // first moment a real season list exists, then leaves the user's own
  // choice alone on every render after.
  useEffect(() => {
    if (season === null && seasons.length > 0) setSeason(seasons[0].season);
  }, [seasons, season]);

  useEffect(() => {
    if (season === null) return;
    let alive = true;
    setState({ rows: [], loading: true, error: null });
    fetchPlayerSeasonGameLog(season, playerId)
      .then((rows) => { if (alive) setState({ rows, loading: false, error: null }); })
      .catch((err: Error) => { if (alive) setState({ rows: [], loading: false, error: err.message }); });
    return () => { alive = false; };
  }, [season, playerId]);

  if (seasons.length === 0) return null;

  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
        <span className="label">Game log</span>
        <label>
          <span className="label">Season&nbsp;</span>
          <select className="control" style={{ fontSize: "0.78rem", padding: "0.15rem 0.45rem" }}
            value={season ?? ""} onChange={(e) => setSeason(Number(e.target.value))}>
            {seasons.map((s) => <option key={s.season} value={s.season}>{s.season}</option>)}
          </select>
        </label>
      </div>
      {state.loading && <p className="muted" style={{ fontStyle: "italic", fontSize: "0.85rem" }}>Loading...</p>}
      {state.error && <div className="error-state">{state.error}</div>}
      {!state.loading && !state.error && state.rows.length === 0 && (
        <p className="muted" style={{ fontStyle: "italic", fontSize: "0.85rem" }}>
          No game log on file for {season}.
        </p>
      )}
      {state.rows.length > 0 && (
        <div className="table-wrap">
          <table className="stat">
            <thead>
              <tr>
                <th scope="col">Wk</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Points</th>
                <th scope="col" className="num">Proj</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={r.week}>
                  <td className="num muted">{r.week}</td>
                  <td className="muted">
                    {!r.played ? MISSING : r.started ? "Started" : "Bench"}
                    {r.onFire && " 🔥"}
                    {r.onIce && " 🧊"}
                  </td>
                  <td className="num">{r.played ? pts(r.actual) : <span className="muted">{MISSING}</span>}</td>
                  <td className="num muted">{pts(r.projected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PlayerCardModal({ target, onClose }: { target: PlayerCardTarget; onClose: () => void }) {
  const [state, setState] = useState<{ data: PlayerOverview | null; error: string | null; loading: boolean }>({
    data: null, error: null, loading: true,
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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = state.data;
  const nextGame = d?.nextGame?.league?.events?.[0];
  const news = d?.rotowire ?? null;
  const fallbackNews = !news ? d?.news?.[0] : null;

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

        <LeagueGameLogSection playerId={target.playerId} />

        {state.loading && <p className="muted" style={{ fontStyle: "italic" }}>Loading...</p>}
        {state.error && <div className="error-state">{state.error}</div>}

        {d && (
          <>
            {d.fantasy && (
              <div className="stat-row" style={{ borderTop: "none", paddingTop: 0, marginBottom: "1rem" }}>
                {d.fantasy.positionRank && (
                  <div className="stat-block">
                    <div className="label">Position rank</div>
                    <div className="stat-value num">#{d.fantasy.positionRank}</div>
                  </div>
                )}
                {d.fantasy.draftRank && (
                  <div className="stat-block">
                    <div className="label">Draft rank</div>
                    <div className="stat-value num">#{d.fantasy.draftRank}</div>
                  </div>
                )}
                {d.fantasy.percentOwned && (
                  <div className="stat-block">
                    <div className="label">Owned</div>
                    <div className="stat-value num">{Number(d.fantasy.percentOwned).toFixed(0)}%</div>
                  </div>
                )}
              </div>
            )}

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
      </div>
    </div>
  );
}
