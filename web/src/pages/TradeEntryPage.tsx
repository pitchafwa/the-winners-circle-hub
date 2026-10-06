import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { useJson, clearJsonCache } from "../lib/data";
import PasswordGate from "../components/PasswordGate";
import {
  GITHUB_REPO, deleteTrade, getToken, listTrades, rebuildSite, setToken, submitTrade,
} from "../lib/githubTrades";
import type { ManualTrade, SubmitAsset } from "../lib/githubTrades";
import { AssetPicker, emptySelection, rosterCards } from "./TradeAnalyzerPage";
import type { AssetSelection, PickChoice } from "./TradeAnalyzerPage";
import type { PickFutures, Roster } from "../types/data";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function TradeEntryPage() {
  const { seasonsIndex, meta, teamName } = useApp();
  const season = seasonsIndex?.default_season ?? null;
  const roster = useJson<Roster>(season !== null ? `${season}/roster.json` : null);
  const pickFutures = useJson<PickFutures>("pick_futures.json");

  const [token, setTokenState] = useState(getToken());
  const [tokenInput, setTokenInput] = useState("");
  const [teamA, setTeamA] = useState<number | null>(null);
  const [teamB, setTeamB] = useState<number | null>(null);
  const [aOut, setAOut] = useState<AssetSelection>(emptySelection());
  const [bOut, setBOut] = useState<AssetSelection>(emptySelection());
  const [date, setDate] = useState(todayISO());
  const [week, setWeek] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [trades, setTrades] = useState<ManualTrade[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (meta && week === 0) setWeek(meta.current_matchup_period);
  }, [meta, week]);

  const refreshList = () => {
    if (!getToken()) { setTrades(null); return; }
    setListError(null);
    listTrades().then(setTrades).catch((e: Error) => setListError(e.message));
  };
  useEffect(refreshList, [token]);

  const picksFor = (teamId: number | null): PickChoice[] =>
    (pickFutures.data?.board ?? [])
      .filter((p) => p.current_owner_id === teamId && p.status !== "resolved")
      .map((p) => ({
        key: `${p.season}-${p.round}-${p.original_team_id}`,
        season: p.season, round: p.round, originalTeamId: p.original_team_id, value: p.value,
      }));

  const toggle = (
    set: (v: AssetSelection) => void, current: AssetSelection,
    kind: "players" | "picks", key: number | string,
  ) => {
    const next: AssetSelection = { players: new Set(current.players), picks: new Set(current.picks) };
    const target = kind === "players" ? next.players : next.picks;
    if (target.has(key as never)) target.delete(key as never);
    else target.add(key as never);
    set(next);
  };

  const buildAssets = (): SubmitAsset[] => {
    if (teamA === null || teamB === null) return [];
    const out: SubmitAsset[] = [];
    const add = (from: number, to: number, sel: AssetSelection) => {
      for (const c of rosterCards(roster.data?.teams[String(from)])) {
        if (sel.players.has(c.player_id!)) out.push({ kind: "player", from, to, playerName: c.name ?? "" });
      }
      for (const pk of picksFor(from)) {
        if (sel.picks.has(pk.key)) {
          out.push({ kind: "pick", from, to, year: pk.season, round: pk.round, originalTeamId: pk.originalTeamId });
        }
      }
    };
    add(teamA, teamB, aOut);
    add(teamB, teamA, bOut);
    return out;
  };

  const assets = buildAssets();
  const describe = (a: SubmitAsset): string => {
    const what = a.kind === "player"
      ? a.playerName
      : `${a.year} round ${a.round} pick (${teamName(a.originalTeamId!)}'s)`;
    return `${what}: ${teamName(a.from)} → ${teamName(a.to)}`;
  };

  const doSubmit = async () => {
    if (season === null) return;
    setBusy(true);
    setMessage(null);
    try {
      await submitTrade({ season, date, week, assets });
      setAOut(emptySelection());
      setBOut(emptySelection());
      setMessage({
        kind: "ok",
        text: "Saved to GitHub. The site updates on the next scheduled refresh — or use “Rebuild site now” below.",
      });
      refreshList();
    } catch (e) {
      setMessage({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (t: ManualTrade) => {
    if (!window.confirm(`Delete the ${t.date} trade? Any pick-holder changes it made are rolled back.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const { revertedPicks } = await deleteTrade(t.id);
      setMessage({ kind: "ok", text: `Trade removed${revertedPicks ? ` (${revertedPicks} pick holder(s) rolled back)` : ""}. Rebuild to update the site.` });
      refreshList();
    } catch (e) {
      setMessage({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const doRebuild = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await rebuildSite();
      clearJsonCache();
      setMessage({ kind: "ok", text: "Rebuild started — check the Actions tab on GitHub; the site refreshes in a few minutes." });
    } catch (e) {
      setMessage({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const label = (id: number) => teamName(id);

  return (
    <PasswordGate>
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2>GitHub token</h2>
          <span className="label">saved only in this browser — needed to record trades</span>
        </div>
        {token ? (
          <p>
            Token saved.{" "}
            <button type="button" className="label" style={{ cursor: "pointer" }}
              onClick={() => { setToken(""); setTokenState(""); setTrades(null); }}>
              remove
            </button>
          </p>
        ) : (
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <input className="control" type="password" placeholder="github_pat_…" value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)} style={{ minWidth: "20rem" }} />
            <button type="button" className="control" style={{ cursor: "pointer" }}
              disabled={!tokenInput.trim()}
              onClick={() => { setToken(tokenInput.trim()); setTokenState(tokenInput.trim()); setTokenInput(""); }}>
              Save token
            </button>
          </div>
        )}
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
          Fine-grained token for {GITHUB_REPO} only: Contents read/write and Actions read/write.
        </p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Submit a trade</h2>
          <span className="label">only players and picks each team really holds can be selected</span>
        </div>
        <div className="two-col" style={{ marginBottom: "1rem" }}>
          <label>
            <span className="label">Team A&nbsp;</span>
            <select className="control" value={teamA ?? ""} onChange={(e) => { setTeamA(Number(e.target.value)); setAOut(emptySelection()); }}>
              <option value="" disabled>Pick a team…</option>
              {(meta?.teams ?? []).filter((t) => t.id !== teamB).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>
            <span className="label">Team B&nbsp;</span>
            <select className="control" value={teamB ?? ""} onChange={(e) => { setTeamB(Number(e.target.value)); setBOut(emptySelection()); }}>
              <option value="" disabled>Pick a team…</option>
              {(meta?.teams ?? []).filter((t) => t.id !== teamA).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>

        {teamA !== null && teamB !== null && (
          <>
            <div className="two-col" style={{ marginBottom: "1rem" }}>
              <AssetPicker
                title={`${label(teamA)} gives up`}
                roster={roster.data?.teams[String(teamA)]}
                picks={picksFor(teamA)}
                selection={aOut}
                onToggleplayer={(id) => toggle(setAOut, aOut, "players", id)}
                onTogglePick={(key) => toggle(setAOut, aOut, "picks", key)}
              />
              <AssetPicker
                title={`${label(teamB)} gives up`}
                roster={roster.data?.teams[String(teamB)]}
                picks={picksFor(teamB)}
                selection={bOut}
                onToggleplayer={(id) => toggle(setBOut, bOut, "players", id)}
                onTogglePick={(key) => toggle(setBOut, bOut, "picks", key)}
              />
            </div>

            <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              <label>
                <span className="label">Trade date&nbsp;</span>
                <input className="control" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label>
                <span className="label">Week it lands in&nbsp;</span>
                <input className="control" type="number" min={0} max={18} value={week}
                  onChange={(e) => setWeek(Number(e.target.value))} style={{ width: "5rem" }} />
              </label>
            </div>

            {assets.length > 0 && (
              <ul className="feed" style={{ marginBottom: "1rem" }}>
                {assets.map((a, i) => <li key={i} className="feed-row">{describe(a)}</li>)}
              </ul>
            )}

            <button type="button" className="control" style={{ cursor: "pointer", background: "var(--paper-2)" }}
              disabled={busy || !token || assets.length === 0 || !date}
              onClick={doSubmit}>
              {busy ? "Saving…" : "Save trade to GitHub"}
            </button>
            {!token && <span className="muted" style={{ marginLeft: "0.75rem" }}>Add a token above first.</span>}
          </>
        )}

        {message && (
          <div className={message.kind === "error" ? "error-state" : "muted"} style={{ marginTop: "1rem" }}>
            {message.text}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Existing trades</h2>
          <span className="label">delete a misentered one, then re-submit</span>
        </div>
        {listError && <div className="error-state" style={{ marginBottom: "1rem" }}>{listError}</div>}
        {!token ? (
          <p className="muted" style={{ fontStyle: "italic" }}>Add a token to load the trades on file.</p>
        ) : trades === null ? (
          <p className="muted" style={{ fontStyle: "italic" }}>Loading…</p>
        ) : trades.length === 0 ? (
          <p className="muted" style={{ fontStyle: "italic" }}>No trades on file yet.</p>
        ) : (
          <ul className="feed">
            {trades.map((t) => (
              <li key={t.id} className="feed-row" style={{ alignItems: "flex-start" }}>
                <span className="muted num feed-date">{t.date}</span>
                <span style={{ flex: 1 }}>
                  <strong>{t.teams.map(label).join(" ↔ ")}</strong>{" "}
                  <span className="muted">({t.season}, week {t.week})</span>
                  <br />
                  <span className="muted" style={{ fontSize: "0.82rem" }}>
                    {t.assets.map((a) => `${a.player ?? a.pick} → ${label(a.to)}`).join(" · ")}
                  </span>
                </span>
                <button className="label" style={{ color: "var(--negative)", cursor: busy ? "not-allowed" : "pointer" }}
                  disabled={busy} onClick={() => doDelete(t)}>
                  delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: "1.25rem" }}>
          <button type="button" className="control" style={{ cursor: "pointer" }}
            disabled={busy || !token} onClick={doRebuild}>
            Rebuild site now
          </button>
          <span className="muted" style={{ marginLeft: "0.75rem", fontSize: "0.8rem" }}>
            starts the refresh workflow instead of waiting for the next scheduled run
          </span>
        </div>
      </section>
    </PasswordGate>
  );
}
