import { useMemo, useState } from "react";
import { useApp } from "../state/AppContext";
import { pts, pct, signed, MISSING } from "../lib/format";
import type { StandingsRow } from "../types/data";

type Col = {
  key: keyof StandingsRow | "team";
  label: string;
  title?: string;
  numeric: boolean;
  render: (r: StandingsRow) => string;
  sortValue?: (r: StandingsRow) => number | string | null;
};

const COLS: Col[] = [
  { key: "seed", label: "Seed", numeric: true, render: (r) => (r.seed ? String(r.seed) : MISSING) },
  { key: "team", label: "Team", numeric: false, render: () => "" },
  { key: "record", label: "Record", numeric: true, render: (r) => r.record,
    sortValue: (r) => r.win_pct },
  { key: "points_for", label: "PF", numeric: true, render: (r) => pts(r.points_for) },
  { key: "points_against", label: "PA", numeric: true, render: (r) => pts(r.points_against) },
  { key: "all_play_record", label: "All-Play", title: "Record if you played every team every week",
    numeric: true, render: (r) => (r.all_play_pct === null ? MISSING : r.all_play_record),
    sortValue: (r) => r.all_play_pct },
  { key: "luck", label: "Luck", title: "Actual wins minus all-play expected wins",
    numeric: true, render: (r) => signed(r.luck, 2), sortValue: (r) => r.luck },
  { key: "optimal_points", label: "Optimal PF", title: "Season points with a perfect lineup every week",
    numeric: true, render: (r) => pts(r.optimal_points), sortValue: (r) => r.optimal_points },
  { key: "consistency", label: "Stdev", title: "Weekly scoring stdev — lower is steadier",
    numeric: true, render: (r) => pts(r.consistency), sortValue: (r) => r.consistency },
  { key: "bench_points_lost", label: "Benched", title: "Season points left on the bench",
    numeric: true, render: (r) => pts(r.bench_points_lost), sortValue: (r) => r.bench_points_lost },
  { key: "coach_rating", label: "Coach", title: "Actual lineup points / optimal",
    numeric: true, render: (r) => pct(r.coach_rating), sortValue: (r) => r.coach_rating },
];

export default function StandingsTable({ rows }: { rows: StandingsRow[] }) {
  const { teamsById } = useApp();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "seed", dir: 1 });

  const sorted = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key) ?? COLS[0];
    const val = (r: StandingsRow) =>
      col.sortValue ? col.sortValue(r) : (r[col.key as keyof StandingsRow] as number | string | null);
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === null || va === undefined) return 1; // missing always sinks
      if (vb === null || vb === undefined) return -1;
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return 0;
    });
  }, [rows, sort]);

  const clickSort = (col: Col) => {
    setSort((s) =>
      s.key === col.key
        ? { key: col.key, dir: s.dir === 1 ? -1 : 1 }
        : { key: col.key as string, dir: col.key === "seed" || col.key === "team" ? 1 : -1 },
    );
  };

  return (
    <div className="table-wrap">
      <table className="stat">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th
                key={c.key}
                title={c.title}
                className={`sortable${c.numeric ? " num" : ""}`}
                aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                onClick={() => clickSort(c)}
                scope="col"
              >
                {c.label}
                {sort.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const team = teamsById.get(r.team_id);
            return (
              <tr key={r.team_id}>
                {COLS.map((c) =>
                  c.key === "team" ? (
                    <td key="team">
                      <strong>{team?.name ?? `Team ${r.team_id}`}</strong>{" "}
                      <span className="muted" style={{ fontSize: "0.78rem" }}>
                        {team?.nickname ?? team?.owner}
                      </span>
                    </td>
                  ) : (
                    <td key={c.key} className={c.numeric ? "num" : undefined}>
                      {c.render(r)}
                    </td>
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
