import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { pts } from "../lib/format";
import { useSort, useSorted } from "../lib/useSort";
import EmptyState from "../components/EmptyState";
import PasswordGate from "../components/PasswordGate";
import { post } from "../lib/adminApi";
import TeamLink from "../components/TeamLink";

const POSITIONS = ["QB", "RB", "WR", "TE", "D/ST", "K"];

interface PositionRating {
  starter: number;
  depth: number;
  count: number;
}

interface LeaguePositionsResponse {
  season: number;
  teams: Record<string, Record<string, PositionRating>>;
}

interface Row {
  team_id: number;
  values: Record<string, PositionRating>;
}

function RatingsTable({ candidates, sort }: { candidates: Row[]; sort: ReturnType<typeof useSort<Row>> }) {
  const { teamName } = useApp();
  const rows = useSorted(candidates, sort);
  return (
    <div className="table-wrap">
      <table className="stat">
        <thead>
          <tr>
            <th scope="col" className="sortable" aria-sort={sort.ariaSort("team")}
              onClick={() => sort.toggle("team", 1)}>
              Team{sort.marker("team")}
            </th>
            {POSITIONS.map((pos) => (
              <th key={pos} scope="col" className="num sortable"
                title={`Starter-tier value / depth value, dynasty scale`}
                aria-sort={sort.ariaSort(pos)}
                onClick={() => sort.toggle(pos)}>
                {pos}{sort.marker(pos)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team_id}>
              <td><TeamLink id={r.team_id}><strong>{teamName(r.team_id)}</strong></TeamLink></td>
              {POSITIONS.map((pos) => {
                const v = r.values[pos];
                return (
                  <td key={pos} className="num">
                    {v ? (
                      <>
                        {pts(v.starter, 0)}
                        <div className="muted" style={{ fontSize: "0.72rem" }}>{pts(v.depth, 0)} depth · {v.count}</div>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PositionalStrengthPage() {
  const { seasonsIndex } = useApp();
  const season = seasonsIndex?.default_season ?? null;
  const [state, setState] = useState<{ rows: Row[] | null; loading: boolean; error: string | null }>({
    rows: null, loading: true, error: null,
  });

  useEffect(() => {
    if (season === null) return;
    let alive = true;
    setState({ rows: null, loading: true, error: null });
    post<LeaguePositionsResponse>("/api/analyzer/league_positions", { season })
      .then((res) => {
        if (!alive) return;
        const rows = Object.entries(res.teams).map(([tid, values]) => ({ team_id: Number(tid), values }));
        setState({ rows, loading: false, error: null });
      })
      .catch((err: Error) => { if (alive) setState({ rows: null, loading: false, error: err.message }); });
    return () => { alive = false; };
  }, [season]);

  const sort = useSort<Row>("team", 1, (r, key) => {
    if (key === "team") return r.team_id;
    return r.values[key]?.starter ?? 0;
  });

  return (
    <PasswordGate>
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2>Positional strength — all teams</h2>
          <span className="label">dynasty value: starter tier (top N at the position) + depth (everyone else rostered there) · click a column to sort</span>
        </div>
        {state.loading && <p className="muted" style={{ fontStyle: "italic" }}>Loading...</p>}
        {state.error && <div className="error-state">{state.error}</div>}
        {state.rows && state.rows.length === 0 && <EmptyState>No roster data on file yet.</EmptyState>}
        {state.rows && state.rows.length > 0 && <RatingsTable candidates={state.rows} sort={sort} />}
      </section>
    </PasswordGate>
  );
}
