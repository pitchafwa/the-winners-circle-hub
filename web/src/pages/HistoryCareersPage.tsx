import { useJson } from "../lib/data";
import { useAllSeasons } from "../lib/useAllSeasons";
import { CareerTable } from "../components/HistoryCharts";
import type { Badges } from "../types/data";

export default function HistoryCareersPage() {
  const all = useAllSeasons();
  const badges = useJson<Badges>("badges.json");

  return (
    <section className="section">
      <div className="section-head">
        <h2>Franchise careers</h2>
        <span className="label">every season on record, 2012–present</span>
      </div>
      {all.bundles.length > 0 && <CareerTable bundles={all.bundles} badges={badges.data} />}
      {(badges.data?.unassigned.length ?? 0) > 0 && (
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.75rem", fontStyle: "italic" }}>
          Pre-2018 honors held by departed franchises:{" "}
          {badges.data!.unassigned.map((b) => `${b.team_name_then || "unknown"} (${b.season} ${b.type})`).join(" · ")}
        </p>
      )}
    </section>
  );
}
