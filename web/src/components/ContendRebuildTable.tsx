import { useApp } from "../state/AppContext";
import { pts } from "../lib/format";
import { useSort, useSorted } from "../lib/useSort";
import type { Spectrum, SpectrumLabel } from "../types/data";

const LABEL_TONE: Record<SpectrumLabel, "pos" | "neg" | ""> = {
  Contending: "pos",
  Balanced: "",
  Rebuilding: "neg",
};

export default function ContendRebuildTable({ spectrum }: { spectrum: Spectrum }) {
  const { teamName } = useApp();
  const sort = useSort<Spectrum["teams"][number]>("ratio", 1, (r, key) =>
    key === "team" ? teamName(r.team_id) : (r[key as keyof typeof r] as number),
  );
  const rows = useSorted(spectrum.teams, sort);

  return (
    <div className="table-wrap">
      <table className="stat">
        <thead>
          <tr>
            <th scope="col" className="sortable" aria-sort={sort.ariaSort("team")}
              onClick={() => sort.toggle("team", 1)}>Team{sort.marker("team")}</th>
            <th scope="col" className="sortable num" title="Dynasty value of players currently on the roster"
              aria-sort={sort.ariaSort("current_roster_value")}
              onClick={() => sort.toggle("current_roster_value")}>
              Roster value{sort.marker("current_roster_value")}
            </th>
            <th scope="col" className="sortable num" title="Estimated value of future draft picks held"
              aria-sort={sort.ariaSort("future_pick_capital")}
              onClick={() => sort.toggle("future_pick_capital")}>
              Pick capital{sort.marker("future_pick_capital")}
            </th>
            <th scope="col" className="sortable" aria-sort={sort.ariaSort("label")}
              onClick={() => sort.toggle("label", 1)}>Posture{sort.marker("label")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team_id}>
              <td><strong>{teamName(r.team_id)}</strong></td>
              <td className="num">{pts(r.current_roster_value, 0)}</td>
              <td className="num">{pts(r.future_pick_capital, 0)}</td>
              <td className={LABEL_TONE[r.label]}>{r.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.5rem", fontStyle: "italic" }}>
        Contending = current roster carries most of the value. Rebuilding = future pick capital does.
      </p>
    </div>
  );
}
