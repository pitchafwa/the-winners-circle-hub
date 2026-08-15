import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import PasswordGate from "../components/PasswordGate";
import TeamPicker from "../components/TeamPicker";
import { parseDraft, submitDraft } from "../lib/draftApi";
import type { ParsedDraftPick } from "../types/draftAdmin";

type RawRow = Pick<ParsedDraftPick, "round" | "round_pick" | "original_owner_raw" | "drafting_team_raw" | "player_name_raw">;
type Stage = "paste" | "review" | "submitting" | "done";

function toRaw(p: ParsedDraftPick): RawRow {
  return {
    round: p.round, round_pick: p.round_pick, original_owner_raw: p.original_owner_raw,
    drafting_team_raw: p.drafting_team_raw, player_name_raw: p.player_name_raw,
  };
}

export default function DraftAdminPage() {
  const { season, seasonsIndex, teamsById } = useApp();

  const [text, setText] = useState("");
  const [hasPickColumn, setHasPickColumn] = useState(false);
  const [draftSeason, setDraftSeason] = useState(season ?? new Date().getFullYear());
  const [stage, setStage] = useState<Stage>("paste");
  const [error, setError] = useState<string | null>(null);

  const [rawPicks, setRawPicks] = useState<RawRow[]>([]);
  const [resolved, setResolved] = useState<ParsedDraftPick[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [existingFile, setExistingFile] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [needsOverwrite, setNeedsOverwrite] = useState(false);
  const [rebuildLog, setRebuildLog] = useState("");
  const [picksWritten, setPicksWritten] = useState(0);

  useEffect(() => {
    if (season !== null) setDraftSeason(season);
  }, [season]);

  // re-resolve whenever the raw rows change, once in review — same
  // live-recheck pattern as the trade admin page
  const rawFingerprint = JSON.stringify(rawPicks);
  useEffect(() => {
    if (stage !== "review" || rawPicks.length === 0) return;
    let alive = true;
    setResolving(true);
    parseDraft({ season: draftSeason, picks: rawPicks })
      .then((res) => {
        if (!alive) return;
        setResolved(res.picks);
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
  }, [rawFingerprint, stage, draftSeason]);

  const parseInitial = async () => {
    setError(null);
    try {
      const res = await parseDraft({ season: draftSeason, text, has_pick_column: hasPickColumn });
      setRawPicks(res.picks.map(toRaw));
      setResolved(res.picks);
      setProblems(res.problems);
      setExistingFile(res.existing_file);
      setNeedsOverwrite(false);
      setStage("review");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const updateRow = (i: number, patch: Partial<RawRow>) => {
    setRawPicks((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const removeRow = (i: number) => {
    setRawPicks((prev) => prev.filter((_, idx) => idx !== i));
  };

  const addRow = () => {
    setRawPicks((prev) => [
      ...prev,
      { round: 1, round_pick: 1, original_owner_raw: "", drafting_team_raw: "", player_name_raw: "" },
    ]);
  };

  const teamsList = Array.from(teamsById.values()).map((t) => ({ id: t.id, name: t.name, nickname: t.nickname }));

  const canSubmit = rawPicks.length > 0 && !resolving && resolved.length === rawPicks.length
    && resolved.every((p) => p.team_id !== null && p.player_id !== null);

  const doSubmit = async (overwrite: boolean) => {
    setError(null);
    setStage("submitting");
    try {
      const res = await submitDraft({ season: draftSeason, overwrite, picks: resolved });
      if (res.needs_overwrite) {
        setNeedsOverwrite(true);
        setStage("review");
        return;
      }
      setRebuildLog(res.rebuild_output ?? "");
      setPicksWritten(res.picks_written ?? 0);
      setStage("done");
    } catch (e) {
      setError((e as Error).message);
      setStage("review");
    }
  };

  const reset = () => {
    setText("");
    setRawPicks([]);
    setResolved([]);
    setProblems([]);
    setNeedsOverwrite(false);
    setStage("paste");
    setError(null);
  };

  return (
    <PasswordGate>
      <section className="section">
        <div className="section-head">
          <h2>Enter a draft</h2>
          <span className="label">local only — deterministic table parse, no AI</span>
        </div>

        {error && <div className="error-state" style={{ marginBottom: "1rem" }}>{error}</div>}

        {stage === "paste" && (
          <>
            <label style={{ display: "block", marginBottom: "1rem" }}>
              <span className="label">Season</span>
              <select className="control" style={{ display: "block", marginTop: "0.3rem" }}
                value={draftSeason} onChange={(e) => setDraftSeason(Number(e.target.value))}>
                {(seasonsIndex?.seasons ?? []).map((s) => (
                  <option key={s.season} value={s.season}>{s.season}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", cursor: "pointer" }}>
              <input type="checkbox" checked={hasPickColumn}
                onChange={(e) => setHasPickColumn(e.target.checked)} />
              <span style={{ fontSize: "0.85rem" }}>This table has a Pick column</span>
            </label>
            <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
              {hasPickColumn ? (
                <>Columns: Round, Pick, Original owner, Current owner, Selection.</>
              ) : (
                <>Columns: Round, Original owner, Current owner, Selection — no Pick column;
                  pick number is just row order within each round.</>
              )} Copy straight out of Google Sheets and paste below.
            </p>
            <textarea
              className="control"
              style={{ width: "100%", minHeight: "16rem", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}
              placeholder={hasPickColumn
                ? "Round\tPick\tOriginal owner\tCurrent owner\tSelection\n1\t1\tAntonio\t\tAshton Jeanty\n..."
                : "Round\tOriginal owner\tCurrent owner\tSelection\n1\tAntonio\t\tAshton Jeanty\n..."}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              className="control"
              style={{ marginTop: "1rem", cursor: text.trim() ? "pointer" : "not-allowed",
                       background: "var(--paper-2)", opacity: text.trim() ? 1 : 0.5 }}
              disabled={!text.trim()}
              onClick={parseInitial}
            >
              Parse
            </button>
          </>
        )}

        {(stage === "review" || stage === "submitting") && (
          <div>
            {existingFile && (
              <div className="error-state" style={{ marginBottom: "1rem" }}>
                {draftSeason}.csv already exists — submitting will ask you to confirm overwrite.
              </div>
            )}
            {problems.length > 0 && (
              <div className="error-state" style={{ marginBottom: "1rem" }}>
                {problems.map((p, i) => <div key={i}>{p}</div>)}
              </div>
            )}
            <div className="table-wrap">
              <table className="stat">
                <thead>
                  <tr>
                    <th scope="col">Rd</th>
                    <th scope="col">Pick</th>
                    <th scope="col">Team</th>
                    <th scope="col">Player</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {rawPicks.map((r, i) => {
                    const res = resolved[i];
                    return (
                      <tr key={i}>
                        <td>
                          <input type="number" className="control" style={{ width: "3rem" }}
                            value={r.round} min={1}
                            onChange={(e) => updateRow(i, { round: Number(e.target.value) })} />
                        </td>
                        <td>
                          <input type="number" className="control" style={{ width: "3rem" }}
                            value={r.round_pick} min={1}
                            onChange={(e) => updateRow(i, { round_pick: Number(e.target.value) })} />
                        </td>
                        <td>
                          <TeamPicker value={r.drafting_team_raw} teams={teamsList}
                            resolvedId={res?.team_id ?? null}
                            onChange={(v) => updateRow(i, { drafting_team_raw: v })} />
                        </td>
                        <td>
                          <div>
                            <input className="control" style={{ width: "13rem" }}
                              value={r.player_name_raw}
                              onChange={(e) => updateRow(i, { player_name_raw: e.target.value })} />
                            {res && (
                              res.player_id
                                ? <span className="pos" style={{ marginLeft: "0.5rem", fontSize: "0.75rem" }}>✓ {res.player_name}</span>
                                : <span className="neg" style={{ marginLeft: "0.5rem", fontSize: "0.75rem" }}>unmatched</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <button className="label" style={{ color: "var(--accent)" }}
                            onClick={() => removeRow(i)}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem", alignItems: "center" }}>
              <button className="label" style={{ color: "var(--accent-2)" }} onClick={addRow}>+ pick</button>
              {resolving && <span className="muted label">checking...</span>}
              <span className="muted label">{rawPicks.length} picks</span>
            </div>

            <div style={{ marginTop: "1.5rem", display: "flex", gap: "1rem", alignItems: "center" }}>
              {!needsOverwrite ? (
                <button
                  className="control"
                  style={{ cursor: canSubmit ? "pointer" : "not-allowed", background: "var(--paper-2)",
                           opacity: canSubmit ? 1 : 0.5 }}
                  disabled={!canSubmit || stage === "submitting"}
                  onClick={() => doSubmit(false)}
                >
                  {stage === "submitting" ? "Submitting..." : "Submit draft"}
                </button>
              ) : (
                <button
                  className="control"
                  style={{ cursor: "pointer", background: "var(--accent)", color: "var(--paper)" }}
                  onClick={() => doSubmit(true)}
                >
                  Confirm overwrite {draftSeason}.csv
                </button>
              )}
              <button className="label" style={{ color: "var(--accent)" }} onClick={reset}>start over</button>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div>
            <p className="pos" style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>
              {picksWritten} picks written and rebuilt.
            </p>
            <details>
              <summary className="label" style={{ cursor: "pointer" }}>build output</summary>
              <pre className="mono" style={{ fontSize: "0.75rem", whiteSpace: "pre-wrap", marginTop: "0.5rem" }}>
                {rebuildLog}
              </pre>
            </details>
            <button className="control" style={{ marginTop: "1rem", background: "var(--paper-2)", cursor: "pointer" }}
              onClick={reset}>
              enter another
            </button>
          </div>
        )}
      </section>
    </PasswordGate>
  );
}
