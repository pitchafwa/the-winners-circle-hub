import { useApp } from "../state/AppContext";
import { useJson } from "../lib/data";
import { pts, shortDate, signed } from "../lib/format";
import EmptyState from "../components/EmptyState";
import type { TradeGrades } from "../types/data";

export default function TradesPage() {
  const { teamName } = useApp();
  const trades = useJson<TradeGrades>("trades.json");
  const list = trades.data?.trades ?? [];
  const valuationAvailable = trades.data?.valuation_available ?? false;

  return (
    <section className="section">
      <div className="section-head">
        <h2>Trade grades</h2>
        <span className="label">graded on current dynasty market value — same table as the draft report card</span>
      </div>

      {trades.error && <div className="error-state" style={{ marginBottom: "1rem" }}>{trades.error}</div>}

      {trades.data && !valuationAvailable && (
        <EmptyState>Dynasty valuations weren't reachable for this build — grades will appear once they're available.</EmptyState>
      )}

      {trades.loading ? (
        <p className="muted" style={{ fontStyle: "italic" }}>Loading...</p>
      ) : list.length === 0 ? (
        !trades.error && <EmptyState>No trades on file yet.</EmptyState>
      ) : (
        <div className="trade-cards">
          {list.map((t) => {
            const winnerSide = t.winner_team_id !== null ? t.value_by_team[String(t.winner_team_id)] : null;
            return (
              <div key={`${t.date}-${t.team_ids.join("-")}`} className="trade-card">
                <div className="label">{t.season} · week {t.week} · {shortDate(t.date)}</div>
                <div className="trade-teams">
                  {t.team_ids.map((tid) => teamName(tid)).join(" ↔ ")}
                </div>
                <ul className="trade-players muted">
                  {t.players.map((p, i) => (
                    <li key={`player-${i}`}>
                      {p.name} → {teamName(p.to_team_id)}{" "}
                      <span className="num">({p.value === null ? "—" : pts(p.value, 0)})</span>
                    </li>
                  ))}
                  {t.picks.map((p, i) => (
                    <li key={`pick-${i}`}>
                      {p.pick} → {teamName(p.to_team_id)}{" "}
                      <span className="num">({p.value === null ? "—" : `~${pts(p.value, 0)}`})</span>
                    </li>
                  ))}
                </ul>
                {t.has_estimated_asset && (
                  <div className="muted" style={{ fontSize: "0.72rem", fontStyle: "italic", marginBottom: "0.4rem" }}>
                    includes an estimated pick value (round average, not a resolved slot)
                  </div>
                )}
                {t.winner_team_id !== null && winnerSide ? (
                  <div className="trade-verdict num">
                    {signed(winnerSide.net, 0)} for {teamName(t.winner_team_id)} so far
                  </div>
                ) : (
                  <div className="trade-verdict muted">grade unavailable</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
