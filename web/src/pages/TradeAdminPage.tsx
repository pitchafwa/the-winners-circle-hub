import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import PasswordGate from "../components/PasswordGate";
import TeamPicker from "../components/TeamPicker";
import { clearJsonCache } from "../lib/data";
import { extractTradeMovements } from "../lib/claude";
import { deleteTrade, listTrades, resolveTradeMovements, submitTrade } from "../lib/tradeApi";
import type {
  RawMovement,
  ResolvedMovement,
  ResolvedPickAsset,
  ResolvedPlayerAsset,
  SubmitAsset,
  TradeListEntry,
} from "../types/trade";

const API_KEY_STORAGE = "league-hub:v1:anthropic-api-key";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type Stage = "paste" | "extracting" | "review" | "submitting" | "done";

export default function TradeAdminPage() {
  const { season, seasonsIndex, teamsById } = useApp();

  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) || "");
  const [showKeyInput, setShowKeyInput] = useState(!apiKey);

  const [text, setText] = useState("");
  const [tradeSeason, setTradeSeason] = useState(season ?? new Date().getFullYear());
  const [date, setDate] = useState(todayISO());
  const [week, setWeek] = useState(0);

  const [stage, setStage] = useState<Stage>("paste");
  const [error, setError] = useState<string | null>(null);
  const [movements, setMovements] = useState<RawMovement[]>([]);
  const [resolved, setResolved] = useState<ResolvedMovement[]>([]);
  const [overrides, setOverrides] = useState<Record<number, { originalTeamId?: number }>>({});
  const [resolving, setResolving] = useState(false);
  const [rebuildLog, setRebuildLog] = useState("");

  const [existingTrades, setExistingTrades] = useState<TradeListEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refreshList = () => {
    setListError(null);
    listTrades()
      .then((res) => setExistingTrades(res.trades))
      .catch((e: Error) => setListError(e.message));
  };

  useEffect(() => {
    refreshList();
  }, []);

  const doDelete = async (t: TradeListEntry) => {
    const summary = `${t.team_names.join(" ↔ ")} (${t.date})`;
    if (!window.confirm(`Delete this trade?\n\n${summary}\n\nThis can't be undone here — you'd have to re-enter it.`)) return;
    setDeletingId(t.id);
    setListError(null);
    try {
      const res = await deleteTrade(t.id);
      clearJsonCache();
      refreshList();
      if (res.reverted_picks.length > 0) {
        window.alert(`Trade deleted. Note: ${res.reverted_picks.join("; ")} — re-enter any later trades of that pick if needed.`);
      }
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    if (season !== null) setTradeSeason(season);
  }, [season]);

  // re-resolve whenever the raw movements change, once we're in review
  useEffect(() => {
    if (stage !== "review" && stage !== "extracting") return;
    let alive = true;
    setResolving(true);
    resolveTradeMovements(tradeSeason, movements)
      .then((res) => {
        if (!alive) return;
        setResolved(res.movements);
        setStage("review");
        setResolving(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setResolving(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movements, tradeSeason]);

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem(API_KEY_STORAGE, key);
  };

  const runExtraction = async () => {
    setError(null);
    setStage("extracting");
    try {
      const extraction = await extractTradeMovements(text, apiKey);
      if (extraction.movements.length === 0) {
        throw new Error("Nothing recognizable came out of that text — check it pasted fully.");
      }
      setMovements(extraction.movements);
      setOverrides({});
    } catch (e) {
      setError((e as Error).message);
      setStage("paste");
    }
  };

  const updateMovement = (i: number, patch: Partial<RawMovement>) => {
    setMovements((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  };

  const updateAsset = (i: number, patch: Partial<RawMovement["asset"]>) => {
    setMovements((prev) =>
      prev.map((m, idx) => (idx === i ? { ...m, asset: { ...m.asset, ...patch } } : m)),
    );
  };

  const removeMovement = (i: number) => {
    setMovements((prev) => prev.filter((_, idx) => idx !== i));
  };

  const addMovement = (type: "player" | "pick") => {
    setMovements((prev) => [
      ...prev,
      {
        from: "", to: "",
        asset: type === "player" ? { type: "player", name: "" } : { type: "pick", round: 1, year: null, raw_text: "" },
      },
    ]);
  };

  const teamName = (id: number | null) => (id === null ? "?" : teamsById.get(id)?.name ?? `Team ${id}`);
  const teamNick = (id: number | null) => (id === null ? "?" : teamsById.get(id)?.nickname ?? teamName(id));
  const allTeams = Array.from(teamsById.values()).map((t) => ({ id: t.id, name: t.name, nickname: t.nickname }));

  const canSubmit = resolved.length > 0 && !resolving && resolved.every((m, i) => {
    if (m.from_team_id === null || m.to_team_id === null) return false;
    if (m.asset.type === "player") return (m.asset as ResolvedPlayerAsset).matched;
    const pick = m.asset as ResolvedPickAsset;
    return pick.original_team_id !== null || overrides[i]?.originalTeamId !== undefined;
  });

  const doSubmit = async () => {
    setError(null);
    setStage("submitting");
    const assets: SubmitAsset[] = resolved.map((m, i) => {
      if (m.asset.type === "player") {
        const a = m.asset as ResolvedPlayerAsset;
        return {
          type: "player", player_id: a.player_id as number, name: a.name,
          raw_name: a.raw_name, from: m.from_team_id as number, to: m.to_team_id as number,
        };
      }
      const a = m.asset as ResolvedPickAsset;
      const originalTeamId = overrides[i]?.originalTeamId ?? (a.original_team_id as number);
      return {
        type: "pick", year: a.year, round: a.round, original_team_id: originalTeamId,
        from: m.from_team_id as number, to: m.to_team_id as number,
      };
    });
    try {
      const res = await submitTrade({ season: tradeSeason, date, week, assets });
      setRebuildLog(res.rebuild_output);
      clearJsonCache();
      refreshList();
      setStage("done");
    } catch (e) {
      setError((e as Error).message);
      setStage("review");
    }
  };

  const reset = () => {
    setText("");
    setMovements([]);
    setResolved([]);
    setOverrides({});
    setStage("paste");
    setError(null);
  };

  return (
    <PasswordGate>
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2>Existing trades</h2>
          <span className="label">delete a misentered one — there's no inline editor, re-submit after deleting</span>
        </div>
        {listError && <div className="error-state" style={{ marginBottom: "1rem" }}>{listError}</div>}
        {existingTrades === null ? (
          <p className="muted" style={{ fontStyle: "italic" }}>Loading...</p>
        ) : existingTrades.length === 0 ? (
          <p className="muted" style={{ fontStyle: "italic" }}>No trades on file yet.</p>
        ) : (
          <ul className="feed">
            {existingTrades.map((t) => (
              <li key={t.id} className="feed-row" style={{ alignItems: "flex-start" }}>
                <span className="muted num feed-date">{t.date}</span>
                <span style={{ flex: 1 }}>
                  <strong>{t.team_names.join(" ↔ ")}</strong>{" "}
                  <span className="muted">({t.season}, week {t.week})</span>
                  <br />
                  <span className="muted" style={{ fontSize: "0.82rem" }}>{t.assets.join(" · ")}</span>
                </span>
                <button
                  className="label"
                  style={{ color: "var(--negative)", cursor: deletingId ? "not-allowed" : "pointer" }}
                  disabled={deletingId !== null}
                  onClick={() => doDelete(t)}
                >
                  {deletingId === t.id ? "deleting..." : "delete"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Submit a trade</h2>
          <span className="label">local only — writes straight to the data source</span>
        </div>

        {showKeyInput && (
          <div className="empty-state" style={{ textAlign: "left", marginBottom: "1.5rem" }}>
            <p className="label" style={{ marginBottom: "0.5rem" }}>Anthropic API key (stored only in this browser)</p>
            <input
              type="password"
              className="control"
              style={{ width: "100%", maxWidth: "28rem" }}
              placeholder="sk-ant-..."
              value={apiKey}
              onChange={(e) => saveApiKey(e.target.value)}
            />
            {apiKey && (
              <button className="label" style={{ marginLeft: "0.75rem", color: "var(--accent)" }}
                onClick={() => setShowKeyInput(false)}>
                done
              </button>
            )}
          </div>
        )}
        {!showKeyInput && (
          <button className="label" style={{ marginBottom: "1rem", color: "var(--accent-2)" }}
            onClick={() => setShowKeyInput(true)}>
            change API key
          </button>
        )}

        {error && <div className="error-state" style={{ marginBottom: "1rem" }}>{error}</div>}

        {stage === "paste" && (
          <>
            <div className="stat-row" style={{ borderTop: "none", paddingTop: 0, marginBottom: "1rem" }}>
              <label>
                <span className="label">Season</span>
                <select className="control" style={{ display: "block", marginTop: "0.3rem" }}
                  value={tradeSeason} onChange={(e) => setTradeSeason(Number(e.target.value))}>
                  {(seasonsIndex?.seasons ?? []).map((s) => (
                    <option key={s.season} value={s.season}>{s.season}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Date</span>
                <input type="date" className="control" style={{ display: "block", marginTop: "0.3rem" }}
                  value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label>
                <span className="label">Week (0 = offseason)</span>
                <input type="number" min={0} max={17} className="control"
                  style={{ display: "block", marginTop: "0.3rem", width: "5rem" }}
                  value={week} onChange={(e) => setWeek(Number(e.target.value))} />
              </label>
            </div>
            <textarea
              className="control"
              style={{ width: "100%", minHeight: "12rem", fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}
              placeholder="Paste the trade announcement text here..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              className="control"
              style={{ marginTop: "1rem", cursor: text.trim() && apiKey ? "pointer" : "not-allowed",
                       background: "var(--paper-2)", opacity: text.trim() && apiKey ? 1 : 0.5 }}
              disabled={!text.trim() || !apiKey}
              onClick={runExtraction}
            >
              Extract
            </button>
            {!apiKey && <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>Add an API key above first.</p>}
          </>
        )}

        {stage === "extracting" && <EmptyLine text="Reading the trade..." />}

        {(stage === "review" || stage === "submitting") && (
          <div>
            <div className="table-wrap">
              <table className="stat">
                <thead>
                  <tr>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col">Asset</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m, i) => {
                    const r = resolved[i];
                    return (
                      <tr key={i}>
                        <td>
                          <TeamPicker value={m.from} teams={allTeams}
                            resolvedId={r?.from_team_id ?? null}
                            onChange={(v) => updateMovement(i, { from: v })} />
                        </td>
                        <td>
                          <TeamPicker value={m.to} teams={allTeams}
                            resolvedId={r?.to_team_id ?? null}
                            onChange={(v) => updateMovement(i, { to: v })} />
                        </td>
                        <td>
                          {m.asset.type === "player" ? (
                            <div>
                              <input className="control" style={{ width: "14rem" }}
                                value={m.asset.name ?? ""}
                                onChange={(e) => updateAsset(i, { name: e.target.value })} />
                              {r?.asset.type === "player" && (
                                r.asset.matched
                                  ? <span className="pos" style={{ marginLeft: "0.5rem" }}>✓ {r.asset.name}</span>
                                  : <span className="neg" style={{ marginLeft: "0.5rem" }}>unmatched</span>
                              )}
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                              <input type="number" className="control" style={{ width: "3.5rem" }}
                                value={m.asset.round ?? 1} min={1}
                                onChange={(e) => updateAsset(i, { round: Number(e.target.value) })} />
                              <span className="muted">round,</span>
                              <input type="number" className="control" style={{ width: "5.5rem" }}
                                value={m.asset.year ?? ""} placeholder="year"
                                onChange={(e) => updateAsset(i, { year: e.target.value ? Number(e.target.value) : null })} />
                              {r?.asset.type === "pick" && r.asset.year_assumed && (
                                <span className="neg" style={{ fontSize: "0.75rem" }}>assumed — confirm</span>
                              )}
                              {r?.asset.type === "pick" && (r.asset.original_team_id_ambiguous || r.asset.original_team_id_assumed) && (
                                <PickOriginPicker
                                  candidates={r.asset.original_team_id_ambiguous ? r.asset.candidates : allTeams.map((t) => t.id)}
                                  teams={allTeams}
                                  value={overrides[i]?.originalTeamId ?? r.asset.original_team_id ?? undefined}
                                  onChange={(v) => setOverrides((prev) => ({ ...prev, [i]: { originalTeamId: v } }))}
                                />
                              )}
                              {r?.asset.type === "pick" && !r.asset.original_team_id_ambiguous && !r.asset.original_team_id_assumed && (
                                <span className="pos" style={{ fontSize: "0.75rem" }}>
                                  ✓ {teamNick(r.asset.original_team_id)}'s pick
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td>
                          <button className="label" style={{ color: "var(--accent)" }}
                            onClick={() => removeMovement(i)}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
              <button className="label" style={{ color: "var(--accent-2)" }} onClick={() => addMovement("player")}>+ player</button>
              <button className="label" style={{ color: "var(--accent-2)" }} onClick={() => addMovement("pick")}>+ pick</button>
              {resolving && <span className="muted label">checking...</span>}
            </div>

            <div style={{ marginTop: "1.5rem", display: "flex", gap: "1rem", alignItems: "center" }}>
              <button
                className="control"
                style={{ cursor: canSubmit ? "pointer" : "not-allowed", background: "var(--paper-2)",
                         opacity: canSubmit ? 1 : 0.5 }}
                disabled={!canSubmit || stage === "submitting"}
                onClick={doSubmit}
              >
                {stage === "submitting" ? "Submitting..." : "Submit trade"}
              </button>
              <button className="label" style={{ color: "var(--accent)" }} onClick={reset}>start over</button>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div>
            <p className="pos" style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Trade submitted and rebuilt.</p>
            <details>
              <summary className="label" style={{ cursor: "pointer" }}>build output</summary>
              <pre className="mono" style={{ fontSize: "0.75rem", whiteSpace: "pre-wrap", marginTop: "0.5rem" }}>
                {rebuildLog}
              </pre>
            </details>
            <button className="control" style={{ marginTop: "1rem", background: "var(--paper-2)", cursor: "pointer" }}
              onClick={reset}>
              submit another
            </button>
          </div>
        )}
      </section>
    </PasswordGate>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="muted" style={{ fontStyle: "italic" }}>{text}</p>;
}

function PickOriginPicker({ candidates, teams, value, onChange }: {
  candidates: number[];
  teams: { id: number; name: string; nickname: string | null }[];
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  return (
    <select className="control" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}>
      <option value="" disabled>whose pick?</option>
      {candidates.map((id) => (
        <option key={id} value={id}>{teams.find((t) => t.id === id)?.nickname ?? `Team ${id}`}</option>
      ))}
    </select>
  );
}
