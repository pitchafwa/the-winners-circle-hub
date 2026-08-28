import { useRef } from "react";
import { useApp } from "../state/AppContext";
import { useJson } from "../lib/data";
import { useAllSeasons } from "../lib/useAllSeasons";
import { FranchiseLeaders, RecordBook } from "../components/HistoryCharts";
import ScreenshotButton from "../components/ScreenshotButton";
import type { Ownership } from "../types/data";

export default function HistoryRecordsPage() {
  const all = useAllSeasons();
  const { meta } = useApp();
  const ownership = useJson<Ownership>("ownership.json");
  const franchiseLeadersRef = useRef<HTMLTableElement>(null);

  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2>Record book</h2>
          <span className="label">all seasons on file</span>
        </div>
        {all.error && <div className="error-state">{all.error}</div>}
        {all.bundles.length > 0 && <RecordBook bundles={all.bundles} ownership={ownership.data} />}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>By franchise</h2>
          <span className="label">
            each team's all-time leading scorer and most-used starter
            <ScreenshotButton targetRef={franchiseLeadersRef} filename="franchise-leaders" />
          </span>
        </div>
        {ownership.error && <div className="error-state">{ownership.error}</div>}
        {meta && <FranchiseLeaders ref={franchiseLeadersRef} ownership={ownership.data} meta={meta} />}
      </section>
    </>
  );
}
