import { useApp } from "../state/AppContext";
import { MISSING, signed } from "../lib/format";
import { useSort, useSorted } from "../lib/useSort";
import TeamLink from "./TeamLink";
import type { Positions } from "../types/data";

type Row = Positions["rows"][number];

/** Cell tint scales with diff vs league average: green above, red below.
 * Matches --positive/--negative in global.css (rgb, not the hex from
 * lib/tokens.ts, since these need an alpha channel CSS vars can't add here). */
function cellStyle(diff: number, scale: number): React.CSSProperties {
  const a = Math.min(Math.abs(diff) / scale, 1) * 0.38;
  return {
    background: diff >= 0 ? `rgba(30, 143, 92, ${a})` : `rgba(194, 59, 50, ${a})`,
  };
}

export default function PositionHeatmap({ positions }: { positions: Positions }) {
  const { teamName } = useApp();
  const sortHook = useSort<Row>("team", 1, (r, key) =>
    key === "team" ? teamName(r.team_id) : r.values[key]?.diff ?? null,
  );
  const rows = useSorted(positions.rows, sortHook);
  const scale = Math.max(
    ...positions.rows.flatMap((r) =>
      positions.positions.map((p) => Math.abs(r.values[p]?.diff ?? 0)),
    ),
    1,
  );

  return (
    <div className="table-wrap">
      <table className="stat">
        <thead>
          <tr>
            <th scope="col" className="sortable" aria-sort={sortHook.ariaSort("team")}
              onClick={() => sortHook.toggle("team", 1)}>
              Team{sortHook.marker("team")}
            </th>
            {positions.positions.map((p) => (
              <th key={p} scope="col" className="num sortable"
                title={`league avg ${positions.league_avg[p]}`}
                aria-sort={sortHook.ariaSort(p)}
                onClick={() => sortHook.toggle(p)}>
                {p}{sortHook.marker(p)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team_id}>
              <td><TeamLink id={r.team_id}><strong>{teamName(r.team_id)}</strong></TeamLink></td>
              {positions.positions.map((p) => {
                const v = r.values[p];
                return (
                  <td key={p} className="num" style={v ? cellStyle(v.diff, scale) : undefined}
                    title={v ? `${v.avg} avg / wk (league ${positions.league_avg[p]})` : undefined}>
                    {v ? signed(v.diff) : MISSING}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.5rem", fontStyle: "italic" }}>
        Average started points per week vs league average at the position.
      </p>
    </div>
  );
}
