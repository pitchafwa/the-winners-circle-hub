import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import PasswordGate from "../components/PasswordGate";
import { clearJsonCache } from "../lib/data";
import { clearDraftOrder, getDraftOrder, setDraftOrder } from "../lib/draftOrderApi";
import type { DraftOrderResponse } from "../types/draftOrder";

const SOURCE_LABEL: Record<DraftOrderResponse["source"], string> = {
  override: "manually overridden",
  computed: "computed from real standings",
  none: "not yet determined — showing default team order",
};

export default function DraftOrderAdminPage() {
  const { season, seasonsIndex } = useApp();
  const [year, setYear] = useState(() => (season ?? new Date().getFullYear()) + 1);
  const [data, setData] = useState<DraftOrderResponse | null>(null);
  const [order, setOrder] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = (y: number) => {
    setError(null);
    setSaved(false);
    getDraftOrder(y)
      .then((res) => {
        setData(res);
        setOrder(res.order);
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(() => load(year), [year]);

  const teamName = (id: number) => {
    const t = data?.teams.find((tm) => tm.id === id);
    return t?.nickname ?? t?.name ?? `Team ${id}`;
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    setOrder((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setDraftOrder(year, order);
      clearJsonCache();
      setSaved(true);
      load(year);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      await clearDraftOrder(year);
      clearJsonCache();
      load(year);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PasswordGate>
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2>Draft order override</h2>
          <span className="label">wins over the real-standings order whenever set — doesn't need last season to be over</span>
        </div>

        <div className="stat-row" style={{ borderTop: "none", paddingTop: 0, marginBottom: "1rem" }}>
          <label>
            <span className="label">Draft year</span>
            <select className="control" style={{ display: "block", marginTop: "0.3rem" }}
              value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[...new Set([year, ...(seasonsIndex?.seasons.map((s) => s.season + 1) ?? [])])]
                .sort((a, b) => a - b)
                .map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </div>

        {error && <div className="error-state" style={{ marginBottom: "1rem" }}>{error}</div>}

        {data && (
          <>
            <p className="muted" style={{ marginBottom: "1rem", fontSize: "0.85rem" }}>
              {SOURCE_LABEL[data.source]}
            </p>
            <ol style={{ listStyle: "none", margin: 0, padding: 0, maxWidth: "28rem" }}>
              {order.map((tid, i) => (
                <li key={tid} className="feed-row" style={{ alignItems: "center" }}>
                  <span className="num" style={{ minWidth: "1.5rem" }}>{i + 1}</span>
                  <span style={{ flex: 1 }}><strong>{teamName(tid)}</strong></span>
                  <button className="label" style={{ color: "var(--accent)" }}
                    disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="label" style={{ color: "var(--accent)" }}
                    disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button>
                </li>
              ))}
            </ol>

            <div style={{ marginTop: "1.5rem", display: "flex", gap: "1rem", alignItems: "center" }}>
              <button className="control" style={{ cursor: busy ? "not-allowed" : "pointer", background: "var(--paper-2)" }}
                disabled={busy} onClick={save}>
                {busy ? "Saving..." : "Save order"}
              </button>
              {data.source === "override" && (
                <button className="label" style={{ color: "var(--negative)" }} disabled={busy} onClick={clear}>
                  clear override — revert to computed
                </button>
              )}
              {saved && <span className="pos label">saved</span>}
            </div>
          </>
        )}
      </section>
    </PasswordGate>
  );
}
