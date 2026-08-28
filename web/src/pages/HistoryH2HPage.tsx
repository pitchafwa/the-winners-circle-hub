import { useRef } from "react";
import { useApp } from "../state/AppContext";
import { useAllSeasons } from "../lib/useAllSeasons";
import EmptyState from "../components/EmptyState";
import { H2HMatrix } from "../components/HistoryCharts";
import ScreenshotButton from "../components/ScreenshotButton";

export default function HistoryH2HPage() {
  const { meta } = useApp();
  const all = useAllSeasons();
  const tableRef = useRef<HTMLTableElement>(null);
  const h2hSeasons = all.bundles.filter((b) => b.meta.season_started).map((b) => b.season);

  if (!meta) return null;

  return (
    <section className="section">
      <div className="section-head">
        <h2>Head-to-head</h2>
        <span className="label">
          {h2hSeasons.length > 0
            ? `all-time, ${Math.min(...h2hSeasons)}–${Math.max(...h2hSeasons)} · row team's wins vs column team`
            : "row team's wins vs column team"}
          <ScreenshotButton targetRef={tableRef} filename="head-to-head" />
        </span>
      </div>
      {h2hSeasons.length > 0 ? (
        <H2HMatrix ref={tableRef} bundles={all.bundles} meta={meta} />
      ) : all.loading ? null : (
        <EmptyState>The grid fills in once games are played.</EmptyState>
      )}
    </section>
  );
}
