import { useApp } from "../state/AppContext";
import { pts } from "../lib/format";
import { useSort, useSorted } from "../lib/useSort";
import type { Spectrum, SpectrumLabel } from "../types/data";

const LABEL_TONE: Record<SpectrumLabel, "pos" | "neg" | ""> = {
  Contending: "pos",
  Balanced: "",
  Rebuilding: "neg",
};

// Contending -> Balanced -> Rebuilding, not alphabetical (which would read
// Balanced/Contending/Rebuilding) — this is what "Posture" should sort back
// to as its natural/default order.
const POSTURE_ORDER: Record<SpectrumLabel, number> = {
  Contending: 0,
  Balanced: 1,
  Rebuilding: 2,
};

export default function ContendRebuildTable({ spectrum }: { spectrum: Spectrum }) {
  const { teamName } = useApp();
  const sort = useSort<Spectrum["teams"][number]>("label", 1, (r, key) => {
    if (key === "team") return teamName(r.team_id);
    if (key === "label") return POSTURE_ORDER[r.label];
    return r[key as keyof typeof r] as number;
  });
  const rows = useSorted(spectrum.teams, sort);

  return (
    <div className="table-wrap">
      <table className="stat">
        <thead>
          <tr>
            <th scope="col" className="sortable" aria-sort={sort.ariaSort("team")}
              onClick={() => sort.toggle("team", 1)}>Team{sort.marker("team")}</th>
            <th scope="col" className="sortable num" title="Current roster priced on this-season (redraft) value — KeepTradeCut fantasy-rankings"
              aria-sort={sort.ariaSort("contending_value")}
              onClick={() => sort.toggle("contending_value")}>
              Contending value{sort.marker("contending_value")}
            </th>
            <th scope="col" className="sortable num" title="Current roster priced on long-term dynasty value — same table as draft/trade grades"
              aria-sort={sort.ariaSort("dynasty_roster_value")}
              onClick={() => sort.toggle("dynasty_roster_value")}>
              Dynasty roster{sort.marker("dynasty_roster_value")}
            </th>
            <th scope="col" className="sortable num" title="Estimated value of future draft picks held"
              aria-sort={sort.ariaSort("future_pick_capital")}
              onClick={() => sort.toggle("future_pick_capital")}>
              Pick capital{sort.marker("future_pick_capital")}
            </th>
            <th scope="col" className="sortable num" title="Dynasty roster value and pick capital, weighted 3:1 toward the roster — assets banked for the future"
              aria-sort={sort.ariaSort("rebuilding_value")}
              onClick={() => sort.toggle("rebuilding_value")}>
              Rebuilding value{sort.marker("rebuilding_value")}
            </th>
            <th scope="col" className="sortable" aria-sort={sort.ariaSort("label")}
              onClick={() => sort.toggle("label", 1)}>Posture{sort.marker("label")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team_id}>
              <td><strong>{teamName(r.team_id)}</strong></td>
              <td className="num">{pts(r.contending_value, 0)}</td>
              <td className="num muted">{pts(r.dynasty_roster_value, 0)}</td>
              <td className="num muted">{pts(r.future_pick_capital, 0)}</td>
              <td className="num">{pts(r.rebuilding_value, 0)}</td>
              <td className={LABEL_TONE[r.label]}>{r.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.5rem", fontStyle: "italic" }}>
        Contending value = current roster priced on this-season (redraft) value. Rebuilding value = the
        same roster's long-term dynasty value and held future pick capital, weighted 3:1 toward the roster.
      </p>
    </div>
  );
}
