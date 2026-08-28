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

// D/ST and K carry no meaningful dynasty market value in this league (see
// teamValue.ts's VALUATION_EXCLUDED_SLOTS) — every team reads ~0 for both,
// so the columns add width without ever telling Tommy anything. The
// League tab's own positional table (PositionHeatmap.tsx, real weekly
// scoring rather than dynasty value) keeps them since actual points
// scored there very much isn't zero.
const POSITIONS = ["QB", "RB", "WR", "TE"];

interface Row {
  team_id: number;
  values: Record<string, PositionRating>;
}

/** Cell tint scales with how far a team's starter-tier value sits from
 * the league average AT THAT POSITION — green above, red below. Scaled
 * per column (not one scale across all four), since raw dynasty value
 * ranges are wildly different by position (RB starter tiers run ~3x a
 * TE's) — a single shared scale would make TE always read pale and RB
 * always read extreme regardless of real relative strength. Same
 * rgba/alpha formula as PositionHeatmap.tsx's League-tab heatmap
 * (--positive/--negative from global.css, alpha capped at 0.38) so the
 * two heatmaps read the same way even though the underlying stat differs. */
function cellStyle(diff: number, scale: number): React.CSSProperties {
  const a = Math.min(Math.abs(diff) / scale, 1) * 0.38;
  return {
    background: diff >= 0 ? `rgba(30, 143, 92, ${a})` : `rgba(194, 59, 50, ${a})`,
  };
}

function RatingsTable({ candidates, sort }: { candidates: Row[]; sort: ReturnType<typeof useSort<Row>> }) {
  const { teamName } = useApp();
  const rows = useSorted(candidates, sort);

  const avgByPosition: Record<string, number> = {};
  const scaleByPosition: Record<string, number> = {};
  for (const pos of POSITIONS) {
    const values = candidates.map((r) => r.values[pos]?.starter ?? 0);
    const avg = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    avgByPosition[pos] = avg;
    scaleByPosition[pos] = Math.max(...values.map((v) => Math.abs(v - avg)), 1);
  }

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
                title={`Starter-tier value / depth value, dynasty scale — tinted vs the league's own average at ${pos} (${pts(avgByPosition[pos], 0)})`}
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
                  <td key={pos} className="num"
                    style={v ? cellStyle(v.starter - avgByPosition[pos], scaleByPosition[pos]) : undefined}>
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
      <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.5rem", fontStyle: "italic" }}>
        Shading is each position's starter-tier value vs the league's own average there — darker green stronger, darker red weaker.
      </p>
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
