import { useApp } from "../state/AppContext";
import { useJson } from "../lib/data";
import { pts } from "../lib/format";
import { useSort, useSorted } from "../lib/useSort";
import EmptyState from "../components/EmptyState";
import PasswordGate from "../components/PasswordGate";
import TeamLink from "../components/TeamLink";
import { allTeamRosters, positionRatings } from "../lib/teamValue";
import type { PositionRating } from "../lib/teamValue";
import type { PlayerValues, Roster } from "../types/data";

const POSITIONS = ["QB", "RB", "WR", "TE", "D/ST", "K"];

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
  const { meta } = useApp();
  const season = meta?.season ?? null;
  const roster = useJson<Roster>(season !== null ? `${season}/roster.json` : null);
  const playerValues = useJson<PlayerValues>("player_values.json");

  const loading = roster.loading || playerValues.loading;
  const error = roster.error ?? playerValues.error;

  const rows: Row[] | null = (roster.data && playerValues.data && meta)
    ? Object.entries(allTeamRosters(roster.data, playerValues.data)).map(([tid, players]) => ({
        team_id: Number(tid),
        values: positionRatings(players, playerValues.data!.players, meta.starting_slots),
      }))
    : null;

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
        {loading && <p className="muted" style={{ fontStyle: "italic" }}>Loading...</p>}
        {error && <div className="error-state">{error}</div>}
        {rows && rows.length === 0 && <EmptyState>No roster data on file yet.</EmptyState>}
        {rows && rows.length > 0 && <RatingsTable candidates={rows} sort={sort} />}
      </section>
    </PasswordGate>
  );
}
