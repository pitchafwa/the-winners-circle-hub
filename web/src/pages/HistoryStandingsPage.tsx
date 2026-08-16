import { useApp } from "../state/AppContext";
import { useOptionalJson } from "../lib/data";
import { useAllSeasons } from "../lib/useAllSeasons";
import EmptyState from "../components/EmptyState";
import { BumpChart, SwapMatrix } from "../components/HistoryCharts";
import type { ScheduleSwap } from "../types/data";

export default function HistoryStandingsPage() {
  const { season, meta } = useApp();
  const all = useAllSeasons();
  const swap = useOptionalJson<ScheduleSwap>(season !== null ? `${season}/schedule_swap.json` : null);
  const current = all.bundles.find((b) => b.season === season) ?? null;

  if (!meta) return null;

  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2>Season timeline</h2>
          <span className="label">{season} standings by week — your team in green</span>
        </div>
        {current ? <BumpChart schedule={current.schedule} meta={current.meta} /> :
          all.loading ? null : <EmptyState>No schedule data.</EmptyState>}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Schedule swap</h2>
          <span className="label">{season} · the argument generator</span>
        </div>
        {swap.data ? (
          <SwapMatrix swap={swap.data} meta={meta} />
        ) : (
          !swap.loading && <EmptyState>Needs at least one completed week.</EmptyState>
        )}
      </section>
    </>
  );
}
