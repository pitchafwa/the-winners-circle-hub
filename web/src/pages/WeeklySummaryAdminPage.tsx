import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import PasswordGate from "../components/PasswordGate";
import { buildWeekBundle, generateWeeklySummary } from "../lib/weeklySummary";
import type { WeekBundle } from "../lib/weeklySummary";

const API_KEY_STORAGE = "league-hub:v1:anthropic-api-key";

type Stage = "idle" | "generating" | "done";

export default function WeeklySummaryAdminPage() {
  const { season, seasonsIndex, meta, teamsById } = useApp();

  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) || "");
  const [showKeyInput, setShowKeyInput] = useState(!apiKey);

  const [chosenSeason, setChosenSeason] = useState(season ?? new Date().getFullYear());
  const [week, setWeek] = useState<number | null>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<WeekBundle | null>(null);
  const [summary, setSummary] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (season !== null) setChosenSeason(season);
  }, [season]);

  useEffect(() => {
    if (chosenSeason === season && meta) {
      setWeek((w) => w ?? meta.completed_weeks.at(-1) ?? null);
    }
  }, [chosenSeason, season, meta]);

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem(API_KEY_STORAGE, key);
  };

  const generate = async () => {
    if (week === null) return;
    setError(null);
    setStage("generating");
    setCopied(false);
    try {
      const b = await buildWeekBundle(chosenSeason, week, teamsById);
      setBundle(b);
      const text = await generateWeeklySummary(b, apiKey);
      setSummary(text);
      setStage("done");
    } catch (e) {
      setError((e as Error).message);
      setStage("idle");
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(summary);
    setCopied(true);
  };

  const startOver = () => {
    setSummary("");
    setBundle(null);
    setStage("idle");
    setError(null);
  };

  const weekOptions = chosenSeason === season ? (meta?.completed_weeks ?? []) : [];

  return (
    <PasswordGate>
      <section className="section">
        <div className="section-head">
          <h2>Weekly summary</h2>
          <span className="label">local only — generated fresh each time, nothing is saved</span>
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

        {stage !== "done" && (
          <>
            <div className="stat-row" style={{ borderTop: "none", paddingTop: 0, marginBottom: "1rem" }}>
              <label>
                <span className="label">Season</span>
                <select className="control" style={{ display: "block", marginTop: "0.3rem" }}
                  value={chosenSeason}
                  onChange={(e) => { setChosenSeason(Number(e.target.value)); setWeek(null); }}>
                  {(seasonsIndex?.seasons ?? []).map((s) => (
                    <option key={s.season} value={s.season}>{s.season}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Week</span>
                <select className="control" style={{ display: "block", marginTop: "0.3rem" }}
                  value={week ?? ""} onChange={(e) => setWeek(Number(e.target.value))}>
                  <option value="" disabled>pick a week</option>
                  {weekOptions.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </label>
            </div>
            {chosenSeason !== season && (
              <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "1rem" }}>
                Switch the app's season selector to {chosenSeason} to see its completed weeks here.
              </p>
            )}
            <button
              className="control"
              style={{ cursor: week !== null && apiKey && stage !== "generating" ? "pointer" : "not-allowed",
                       background: "var(--paper-2)", opacity: week !== null && apiKey ? 1 : 0.5 }}
              disabled={week === null || !apiKey || stage === "generating"}
              onClick={generate}
            >
              {stage === "generating" ? "Writing..." : "Generate summary"}
            </button>
            {!apiKey && <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>Add an API key above first.</p>}
          </>
        )}

        {stage === "done" && (
          <div>
            <div className="recap" style={{ whiteSpace: "pre-wrap", maxWidth: "60rem", marginBottom: "1rem" }}>
              {summary}
            </div>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
              <button className="control" style={{ background: "var(--paper-2)", cursor: "pointer" }} onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
              <button className="label" style={{ color: "var(--accent)" }} onClick={startOver}>
                generate another
              </button>
            </div>
            {bundle && (
              <details style={{ marginTop: "1.5rem" }}>
                <summary className="label" style={{ cursor: "pointer" }}>data sent to Claude</summary>
                <pre className="mono" style={{ fontSize: "0.75rem", whiteSpace: "pre-wrap", marginTop: "0.5rem" }}>
                  {JSON.stringify(bundle, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </section>
    </PasswordGate>
  );
}
