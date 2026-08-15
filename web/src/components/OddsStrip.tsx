import { useApp } from "../state/AppContext";
import { pct } from "../lib/format";
import type { Sim } from "../types/data";

export default function OddsStrip({ sim }: { sim: Sim }) {
  const { teamName } = useApp();
  const rows = [...sim.teams].sort((a, b) => b.playoff_pct - a.playoff_pct);
  return (
    <div>
      <ol className="odds-list">
        {rows.map((t) => (
          <li key={t.team_id} className="odds-row">
            <span className="odds-team">{teamName(t.team_id)}</span>
            <span className="odds-bar-track" aria-hidden="true">
              <span className="odds-bar" style={{ width: `${t.playoff_pct * 100}%` }} />
            </span>
            <span className="num odds-pct">
              {pct(t.playoff_pct, 0)}
              <span className="muted odds-se"> ±{(t.playoff_se * 100).toFixed(1)}</span>
            </span>
            <span className="num muted odds-title">🏆 {pct(t.title_pct, 1)}</span>
          </li>
        ))}
      </ol>
      <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.6rem", fontStyle: "italic" }}>
        {sim.n_sims.toLocaleString()} simulations, {sim.remaining_matchups} games left. {sim.model}.
      </p>
    </div>
  );
}
