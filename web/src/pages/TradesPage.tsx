import { useApp } from "../state/AppContext";
import { useJson } from "../lib/data";
import { pts, shortDate, signed } from "../lib/format";
import EmptyState from "../components/EmptyState";
import type { TradeGradeAsset, TradeGrades } from "../types/data";

function AssetLine({ p, teamName }: { p: TradeGradeAsset; teamName: (id: number) => string }) {
  const label = p.name ?? p.pick ?? "?";
  const valueText = p.value === null ? "—" : p.pick ? `~${pts(p.value, 0)}` : pts(p.value, 0);
  const prod = p.production_since_trade;
  return (
    <li>
      {label} → {teamName(p.to_team_id)}{" "}
      <span className="num">({valueText})</span>
      {p.value_source === "current_fallback" && (
        <span className="muted" style={{ fontSize: "0.72rem" }}> · current-value estimate</span>
      )}
      {prod && (
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          {" — "}{pts(prod.points_started, 0)} pts started since
          {" ("}{signed(prod.points_started - prod.points_projected_started, 0)} vs. proj.
          {prod.still_held ? "" : ", since dropped"}{")"}
        </span>
      )}
      {p.flipped_again && (
        <span className="muted" style={{ fontSize: "0.78rem", fontStyle: "italic" }}> — traded again since</span>
      )}
    </li>
  );
}

export default function TradesPage() {
  const { teamName } = useApp();
  const trades = useJson<TradeGrades>("trades.json");
  const list = trades.data?.trades ?? [];
  const ledger = trades.data?.team_ledger ?? [];
  const valuationAvailable = trades.data?.valuation_available ?? false;

  return (
    <section className="section">
      <div className="section-head">
        <h2>Trade grades</h2>
        <span className="label">graded on dynasty market value as of the trade — same table as the draft report card</span>
      </div>

      {trades.error && <div className="error-state" style={{ marginBottom: "1rem" }}>{trades.error}</div>}

      {trades.data && !valuationAvailable && (
        <EmptyState>Dynasty valuations weren't reachable for this build — grades will appear once they're available.</EmptyState>
      )}

      {trades.loading ? (
        <p className="muted" style={{ fontStyle: "italic" }}>Loading...</p>
      ) : (
        <>
          {ledger.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: "2rem" }}>
              <table className="stat">
                <thead>
                  <tr>
                    <th scope="col">Team</th>
                    <th scope="col" className="num">Trades</th>
                    <th scope="col" className="num">Net value</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((r) => (
                    <tr key={r.team_id}>
                      <td><strong>{teamName(r.team_id)}</strong></td>
                      <td className="num">{r.trade_count}</td>
                      <td className={`num ${r.net >= 0 ? "pos" : "neg"}`}>{signed(r.net, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.5rem", fontStyle: "italic" }}>
                Net value across every trade a team's made, each graded at its own moment — a good flip
                counts even if the asset never played a snap for them.
              </p>
            </div>
          )}

          {list.length === 0 ? (
            !trades.error && <EmptyState>No trades on file yet.</EmptyState>
          ) : (
            <div className="trade-cards">
              {list.map((t) => {
                const winnerSide = t.winner_team_id !== null ? t.value_by_team[String(t.winner_team_id)] : null;
                return (
                  <div key={t.id ?? `${t.date}-${t.team_ids.join("-")}`} className="trade-card">
                    <div className="label">{t.season} · week {t.week} · {shortDate(t.date)}</div>
                    <div className="trade-teams">
                      {t.team_ids.map((tid) => teamName(tid)).join(" ↔ ")}
                    </div>
                    <ul className="trade-players muted">
                      {t.players.map((p, i) => <AssetLine key={`player-${i}`} p={p} teamName={teamName} />)}
                      {t.picks.map((p, i) => <AssetLine key={`pick-${i}`} p={p} teamName={teamName} />)}
                    </ul>
                    {(t.has_estimated_asset || t.uses_current_value_fallback) && (
                      <div className="muted" style={{ fontSize: "0.72rem", fontStyle: "italic", marginBottom: "0.4rem" }}>
                        {[
                          t.has_estimated_asset && "includes an estimated pick value (round average, not a resolved slot)",
                          t.uses_current_value_fallback && "at least one asset priced at today's value, not captured at trade time",
                        ].filter(Boolean).join(" · ")}
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
        </>
      )}
    </section>
  );
}
