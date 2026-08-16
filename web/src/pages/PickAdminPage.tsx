import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import PasswordGate from "../components/PasswordGate";
import { clearJsonCache, loadJson } from "../lib/data";
import { reassignPick } from "../lib/tradeApi";
import type { PickFutures, PickFuturesEntry } from "../types/data";

const rowKey = (p: PickFuturesEntry) => `${p.season}-${p.round}-${p.original_team_id}`;

export default function PickAdminPage() {
  const { teamsById, teamName } = useApp();
  const [board, setBoard] = useState<PickFuturesEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = () => {
    setError(null);
    clearJsonCache();
    loadJson<PickFutures>("pick_futures.json")
      .then((d) => setBoard(d?.board ?? []))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  const teams = Array.from(teamsById.values());

  const onReassign = async (p: PickFuturesEntry, newOwnerId: number) => {
    if (newOwnerId === p.current_owner_id) return;
    setSavingKey(rowKey(p));
    setError(null);
    try {
      await reassignPick({
        season: p.season, round: p.round, original_team_id: p.original_team_id,
        new_owner_id: newOwnerId,
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <PasswordGate>
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2>Reassign picks</h2>
          <span className="label">for when backdating the real trade isn't worth it — writes straight to the pick-ownership ledger, no trade record created</span>
        </div>
        {error && <div className="error-state" style={{ marginBottom: "1rem" }}>{error}</div>}
        {board === null ? (
          <p className="muted" style={{ fontStyle: "italic" }}>Loading...</p>
        ) : (
          <div className="table-wrap">
            <table className="stat">
              <thead>
                <tr>
                  <th scope="col">Draft</th>
                  <th scope="col" className="num">Rd</th>
                  <th scope="col">Original owner</th>
                  <th scope="col">Current owner</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {board.map((p) => (
                  <tr key={rowKey(p)}>
                    <td className="num">{p.season}</td>
                    <td className="num">{p.round}</td>
                    <td className="muted">{teamName(p.original_team_id)}</td>
                    <td>
                      <select
                        className="control"
                        value={p.current_owner_id}
                        disabled={p.status === "resolved" || savingKey === rowKey(p)}
                        onChange={(e) => onReassign(p, Number(e.target.value))}
                      >
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>{t.nickname ?? t.name}</option>
                        ))}
                      </select>
                      {savingKey === rowKey(p) && (
                        <span className="muted label" style={{ marginLeft: "0.5rem" }}>saving...</span>
                      )}
                    </td>
                    <td className="muted">
                      {p.status === "resolved" ? `resolved — ${p.player_name}` : p.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PasswordGate>
  );
}
