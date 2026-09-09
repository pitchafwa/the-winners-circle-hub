import { useMemo, useState } from "react";
import { useApp } from "../state/AppContext";
import { useOptionalJson } from "../lib/data";
import { pts } from "../lib/format";
import { useSort, useSorted } from "../lib/useSort";
import EmptyState from "../components/EmptyState";
import PlayerCardTrigger from "../components/PlayerCardTrigger";
import PlayerHeadshot from "../components/PlayerHeadshot";
import TeamLink from "../components/TeamLink";
import type { PlayerPool, PlayerPoolEntry } from "../types/data";

// Same short injury-designation letters RosterTable already uses — kept
// as its own copy rather than a shared import since the two components
// don't otherwise share anything, and this one small map isn't worth a
// new shared module for.
const INJURY_ABBR: Record<string, string> = {
  QUESTIONABLE: "Q",
  DOUBTFUL: "D",
  OUT: "O",
  INJURY_RESERVE: "IR",
  SUSPENSION: "SUSP",
  PROBABLE: "P",
};

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "D/ST"];
const FREE_AGENT = "FA"; // sentinel team-filter value — not a real team_id

const COLS: { key: string; label: string; numeric: boolean; title?: string }[] = [
  { key: "player", label: "Player", numeric: false },
  { key: "team", label: "Team", numeric: false },
  { key: "percent_owned", label: "Own%", numeric: true, title: "% of ESPN leagues rostering this player" },
  { key: "percent_started", label: "Start%", numeric: true, title: "% of ESPN leagues starting this player" },
  { key: "total_points", label: "Total", numeric: true, title: "Season points so far, this league's scoring" },
  { key: "projected_total_points", label: "Proj", numeric: true, title: "ESPN's rest-of-season projected total" },
  { key: "avg_points", label: "Avg", numeric: true, title: "Points per game played so far" },
  { key: "projected_avg_points", label: "Proj Avg", numeric: true, title: "ESPN's projected points per game" },
];

export default function PlayersPage() {
  const { season, meta, currentTeamName } = useApp();
  const base = season !== null ? `${season}` : null;
  const pool = useOptionalJson<PlayerPool>(base ? `${base}/player_pool.json` : null);

  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("");
  const [teamFilter, setTeamFilter] = useState("");

  const teamName = (id: number) => currentTeamName(id);

  const sort = useSort<PlayerPoolEntry>("percent_owned", -1, (r, key) => {
    if (key === "player") return r.name;
    if (key === "team") return r.team_id === null ? "" : teamName(r.team_id);
    return r[key as keyof PlayerPoolEntry] as number;
  });

  const filtered = useMemo(() => {
    const players = pool.data?.players ?? [];
    const q = search.trim().toLowerCase();
    return players.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (position && p.position !== position) return false;
      if (teamFilter === FREE_AGENT && p.team_id !== null) return false;
      if (teamFilter && teamFilter !== FREE_AGENT && String(p.team_id) !== teamFilter) return false;
      return true;
    });
  }, [pool.data, search, position, teamFilter]);

  const rows = useSorted(filtered, sort);

  return (
    <>
      <section className="section" aria-labelledby="players-h">
        <div className="section-head">
          <h2 id="players-h">Players</h2>
          <span className="label">
            {pool.data ? `${rows.length} of ${pool.data.players.length} players` : "browse every rostered player and free agent"}
          </span>
        </div>

        <div className="filter-row">
          <input
            className="control"
            style={{ width: "14rem" }}
            type="search"
            placeholder="Search players…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search players"
          />
          <select className="control" value={position} onChange={(e) => setPosition(e.target.value)} aria-label="Filter by position">
            <option value="">All positions</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select className="control" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} aria-label="Filter by team">
            <option value="">All teams</option>
            <option value={FREE_AGENT}>Free agents</option>
            {(meta?.teams ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.nickname ?? t.name}</option>
            ))}
          </select>
        </div>

        {pool.error && <div className="error-state">{pool.error}</div>}
        {!pool.error && !pool.data && (
          <EmptyState>No player pool yet — check back once the season's underway.</EmptyState>
        )}
        {pool.data && rows.length === 0 && (
          <EmptyState>No players match those filters.</EmptyState>
        )}
        {pool.data && rows.length > 0 && (
          <div className="table-wrap">
            <table className="stat">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} scope="col" title={c.title}
                      className={`sortable${c.numeric ? " num" : ""}`}
                      aria-sort={sort.ariaSort(c.key)}
                      onClick={() => sort.toggle(c.key, c.numeric ? -1 : 1)}>
                      {c.label}{sort.marker(c.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const injury = p.injury_status && p.injury_status !== "ACTIVE"
                    ? (INJURY_ABBR[p.injury_status] ?? p.injury_status)
                    : null;
                  return (
                    <tr key={p.player_id}>
                      <td>
                        <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <PlayerHeadshot playerId={p.player_id} position={p.position} proTeam={p.pro_team} />
                          <span>
                            <strong>
                              <PlayerCardTrigger playerId={p.player_id} name={p.name} position={p.position} proTeam={p.pro_team}>
                                {p.name}
                              </PlayerCardTrigger>
                            </strong>{" "}
                            {injury && <span className="neg" style={{ fontSize: "0.72rem" }}>{injury}</span>}
                            <br />
                            <span className="muted" style={{ fontSize: "0.78rem" }}>
                              {p.position} · {p.pro_team}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td>
                        {p.team_id === null
                          ? <span className="muted">Free agent</span>
                          : <TeamLink id={p.team_id}>{teamName(p.team_id)}</TeamLink>}
                      </td>
                      <td className="num">{p.percent_owned.toFixed(1)}%</td>
                      <td className="num">{p.percent_started.toFixed(1)}%</td>
                      <td className="num">{pts(p.total_points)}</td>
                      <td className="num muted">{pts(p.projected_total_points)}</td>
                      <td className="num">{pts(p.avg_points)}</td>
                      <td className="num muted">{pts(p.projected_avg_points)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
