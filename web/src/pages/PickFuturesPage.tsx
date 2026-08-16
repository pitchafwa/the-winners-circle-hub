import { useApp } from "../state/AppContext";
import { useJson } from "../lib/data";
import { useSort, useSorted } from "../lib/useSort";
import EmptyState from "../components/EmptyState";
import type { PickFutures, PickResolutionStatus } from "../types/data";

const STATUS_LABEL: Record<PickResolutionStatus, string> = {
  unresolved: "Unresolved",
  projected: "Projected",
  resolved: "Resolved",
};

const COLS: { key: string; label: string; numeric: boolean; title?: string }[] = [
  { key: "season", label: "Draft", numeric: true },
  { key: "round", label: "Rd", numeric: true },
  { key: "original", label: "Original owner", numeric: false },
  { key: "owner", label: "Current owner", numeric: false },
  { key: "status", label: "Status", numeric: false },
  { key: "overall_pick", label: "Slot", numeric: true, title: "Overall pick number, once the prior season is final" },
  { key: "player_name", label: "Player", numeric: false, title: "Once that year's draft has actually happened" },
];

export default function PickFuturesPage() {
  const { teamName } = useApp();
  const futures = useJson<PickFutures>("pick_futures.json");
  const sort = useSort<PickFutures["board"][number]>("season", 1, (r, key) => {
    if (key === "original") return teamName(r.original_team_id);
    if (key === "owner") return teamName(r.current_owner_id);
    return r[key as keyof typeof r] as number | string | null;
  });
  const rows = useSorted(futures.data?.board ?? [], sort);

  return (
    <section className="section">
      <div className="section-head">
        <h2>Pick futures board</h2>
        <span className="label">every team's slate of upcoming rookie-draft picks</span>
      </div>
      {futures.error && <div className="error-state" style={{ marginBottom: "1rem" }}>{futures.error}</div>}
      {futures.loading ? (
        <p className="muted" style={{ fontStyle: "italic" }}>Loading...</p>
      ) : rows.length === 0 ? (
        !futures.error && <EmptyState>No pick data on file yet.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="stat">
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} scope="col" className={`sortable${c.numeric ? " num" : ""}`}
                    title={c.title}
                    aria-sort={sort.ariaSort(c.key)}
                    onClick={() => sort.toggle(c.key, c.numeric ? 1 : -1)}>
                    {c.label}{sort.marker(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={`${p.season}-${p.round}-${p.original_team_id}`}>
                  <td className="num">{p.season}</td>
                  <td className="num">{p.round}</td>
                  <td className={p.original_team_id !== p.current_owner_id ? "muted" : undefined}>
                    {teamName(p.original_team_id)}
                  </td>
                  <td>
                    <strong>{teamName(p.current_owner_id)}</strong>
                    {p.original_team_id !== p.current_owner_id && (
                      <span className="muted" style={{ fontSize: "0.75rem" }}> · traded</span>
                    )}
                  </td>
                  <td className="muted">{STATUS_LABEL[p.status]}</td>
                  <td className="num muted">{p.overall_pick ?? "—"}</td>
                  <td>{p.player_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
