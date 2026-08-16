import { useAllSeasons } from "../lib/useAllSeasons";
import { RecordBook } from "../components/HistoryCharts";

export default function HistoryRecordsPage() {
  const all = useAllSeasons();

  return (
    <section className="section">
      <div className="section-head">
        <h2>Record book</h2>
        <span className="label">all seasons on file</span>
      </div>
      {all.error && <div className="error-state">{all.error}</div>}
      {all.bundles.length > 0 && <RecordBook bundles={all.bundles} />}
    </section>
  );
}
