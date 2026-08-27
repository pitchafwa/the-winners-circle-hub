import { useMemo, useState } from "react";
import { useApp } from "../state/AppContext";
import { useJson } from "../lib/data";
import { pts, signed } from "../lib/format";
import PasswordGate from "../components/PasswordGate";
import PlayerHeadshot from "../components/PlayerHeadshot";
import TeamLink from "../components/TeamLink";
import { simulateTrade } from "../lib/tradeAnalyzerApi";
import type { PositionRating, SimulateTradeResponse, TeamSnapshot } from "../lib/tradeAnalyzerApi";
import type { PickFutures, Roster, RosterPlayerCard, TeamRoster } from "../types/data";

const POSITION_ORDER = ["QB", "RB", "WR", "TE", "D/ST", "K"];

function positionSort(a: string, b: string): number {
  const ia = POSITION_ORDER.indexOf(a);
  const ib = POSITION_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
}

function rosterPlayers(roster: TeamRoster | undefined): RosterPlayerCard[] {
  if (!roster) return [];
  return [...roster.starters, ...roster.bench, ...roster.ir].filter(
    (p): p is RosterPlayerCard & { player_id: number } => p.player_id !== null,
  );
}

interface AssetSelection {
  players: Set<number>;
  picks: Set<string>; // pick key — see PickChoice.key
}

function emptySelection(): AssetSelection {
  return { players: new Set(), picks: new Set() };
}

interface PickChoice {
  key: string;
  season: number;
  round: number;
  // Always the pick's real original team, current holder or not — shown
  // on every pick (not just ones acquired via trade) so "whose pick is
  // this" reads the same way for every row, and a team's own natural pick
  // isn't the odd one out. Also why the key has to include this: a team
  // can legitimately hold two picks of the same season/round at once (its
  // own natural pick plus one acquired via trade).
  originalTeamId: number;
}

function AssetPicker({
  title, roster, picks, selection, onToggleplayer, onTogglePick,
}: {
  title: string;
  roster: TeamRoster | undefined;
  picks: PickChoice[];
  selection: AssetSelection;
  onToggleplayer: (id: number) => void;
  onTogglePick: (key: string) => void;
}) {
  const { currentTeamsById, currentTeamName } = useApp();
  const ownerLabel = (id: number) => currentTeamsById.get(id)?.nickname || currentTeamName(id);
  const players = rosterPlayers(roster);
  return (
    <div>
      <div className="label" style={{ marginBottom: "0.4rem" }}>{title}</div>
      <div style={{ maxHeight: "18rem", overflowY: "auto", border: "1px solid var(--rule)", borderRadius: "8px", padding: "0.5rem" }}>
        {players.map((p) => (
          <label key={p.player_id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.2rem 0", cursor: "pointer" }}>
            <input type="checkbox" checked={selection.players.has(p.player_id!)}
              onChange={() => onToggleplayer(p.player_id!)} />
            <PlayerHeadshot playerId={p.player_id!} position={p.position} proTeam={p.pro_team} className="leaderboard-headshot" />
            <span>{p.name}</span>
            <span className="muted" style={{ fontSize: "0.75rem" }}>{p.position} · {p.slot}</span>
          </label>
        ))}
        {picks.length > 0 && (
          <>
            <div className="muted" style={{ fontSize: "0.72rem", margin: "0.5rem 0 0.2rem", textTransform: "uppercase" }}>Picks</div>
            {picks.map((pk) => (
              <label key={pk.key} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.2rem 0", cursor: "pointer" }}>
                <input type="checkbox" checked={selection.picks.has(pk.key)} onChange={() => onTogglePick(pk.key)} />
                <span>{pk.season} Round {pk.round}</span>
                <span className="muted" style={{ fontSize: "0.72rem" }}>
                  (<TeamLink id={pk.originalTeamId}>{ownerLabel(pk.originalTeamId)}</TeamLink>'s pick)
                </span>
              </label>
            ))}
          </>
        )}
        {players.length === 0 && picks.length === 0 && <p className="muted" style={{ fontStyle: "italic" }}>Nothing to select.</p>}
      </div>
    </div>
  );
}

function DeltaStat({ label, before, after }: { label: string; before: number; after: number }) {
  const diff = after - before;
  return (
    <div className="stat-block">
      <div className="label">{label}</div>
      <div className="stat-value num">{pts(after, 0)}</div>
      <div className={`muted stat-sub ${diff > 0 ? "pos" : diff < 0 ? "neg" : ""}`}>
        {pts(before, 0)} → {pts(after, 0)} ({signed(diff, 0)})
      </div>
    </div>
  );
}

function PositionTable({ before, after }: { before: Record<string, PositionRating>; after: Record<string, PositionRating> }) {
  const positions = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(positionSort);
  return (
    <div className="table-wrap">
      <table className="stat">
        <thead>
          <tr>
            <th scope="col">Position</th>
            <th scope="col" className="num">Starter tier</th>
            <th scope="col" className="num">Depth</th>
            <th scope="col" className="num">Rostered</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => {
            const b = before[pos] ?? { starter: 0, depth: 0, count: 0 };
            const a = after[pos] ?? { starter: 0, depth: 0, count: 0 };
            const starterDiff = a.starter - b.starter;
            const depthDiff = a.depth - b.depth;
            return (
              <tr key={pos}>
                <td><strong>{pos}</strong></td>
                <td className={`num ${starterDiff > 0 ? "pos" : starterDiff < 0 ? "neg" : ""}`}>
                  {pts(b.starter, 0)}{starterDiff !== 0 && <> → {pts(a.starter, 0)}</>}
                </td>
                <td className={`num ${depthDiff > 0 ? "pos" : depthDiff < 0 ? "neg" : ""}`}>
                  {pts(b.depth, 0)}{depthDiff !== 0 && <> → {pts(a.depth, 0)}</>}
                </td>
                <td className="num muted">{b.count}{a.count !== b.count && <> → {a.count}</>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TeamResultCard({ teamId, snapshot }: { teamId: number; snapshot: { before: TeamSnapshot; after: TeamSnapshot } }) {
  const { teamName } = useApp();
  return (
    <section className="section">
      <div className="section-head">
        <h2><TeamLink id={teamId}>{teamName(teamId)}</TeamLink></h2>
      </div>
      <div className="stat-row" style={{ borderTop: "none", paddingTop: 0, marginBottom: "1rem" }}>
        <DeltaStat label="Contending value" before={snapshot.before.contending_value} after={snapshot.after.contending_value} />
        <DeltaStat label="Dynasty roster value" before={snapshot.before.dynasty_roster_value} after={snapshot.after.dynasty_roster_value} />
        <DeltaStat label="Pick capital" before={snapshot.before.future_pick_capital} after={snapshot.after.future_pick_capital} />
        <DeltaStat label="Rebuilding value" before={snapshot.before.rebuilding_value} after={snapshot.after.rebuilding_value} />
      </div>
      <div className="label" style={{ marginBottom: "0.3rem" }}>Positional strength — before → after</div>
      <PositionTable before={snapshot.before.positions} after={snapshot.after.positions} />
    </section>
  );
}

export default function TradeAnalyzerPage() {
  const { seasonsIndex, meta, myTeamId, teamName } = useApp();
  const season = seasonsIndex?.default_season ?? null;

  const roster = useJson<Roster>(season !== null ? `${season}/roster.json` : null);
  const pickFutures = useJson<PickFutures>("pick_futures.json");

  const [teamA, setTeamA] = useState<number | null>(myTeamId);
  const [teamB, setTeamB] = useState<number | null>(null);
  const [aOut, setAOut] = useState<AssetSelection>(emptySelection());
  const [bOut, setBOut] = useState<AssetSelection>(emptySelection());
  const [result, setResult] = useState<SimulateTradeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Keyed on original_team_id too, not just season-round — a team can
  // legitimately hold two picks of the same season/round at once (its own
  // natural pick plus one acquired via trade), and season-round alone
  // collapsed those into one checkbox (a real bug, not just a duplicate-
  // key console warning: the two picks are logically distinct assets).
  const picksFor = (teamId: number | null): PickChoice[] =>
    (pickFutures.data?.board ?? [])
      .filter((p) => p.current_owner_id === teamId && p.status !== "resolved")
      .map((p) => ({
        key: `${p.season}-${p.round}-${p.original_team_id}`,
        season: p.season,
        round: p.round,
        originalTeamId: p.original_team_id,
      }));

  const toggle = (set: (v: AssetSelection) => void, current: AssetSelection, kind: "players" | "picks", key: number | string) => {
    const next: AssetSelection = { players: new Set(current.players), picks: new Set(current.picks) };
    const target = kind === "players" ? next.players : next.picks;
    if (target.has(key as never)) target.delete(key as never);
    else target.add(key as never);
    set(next);
  };

  const analyze = async () => {
    if (teamA === null || teamB === null || season === null) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // Look the selected keys back up against the full choice list (not
      // parsed from the key string) so a pick genuinely selected twice
      // (two same-round picks from different original owners) really does
      // send two {season, round} entries to the backend.
      const aChoices = picksFor(teamA);
      const bChoices = picksFor(teamB);
      const parsePicks = (picks: Set<string>, choices: PickChoice[]): { season: number; round: number }[] =>
        choices.filter((c) => picks.has(c.key)).map((c) => ({ season: c.season, round: c.round }));
      const res = await simulateTrade({
        season, teamA, teamB,
        teamAOut: { players: [...aOut.players], picks: parsePicks(aOut.picks, aChoices) },
        teamBOut: { players: [...bOut.players], picks: parsePicks(bOut.picks, bChoices) },
      });
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const otherTeams = useMemo(
    () => (meta?.teams ?? []).filter((t) => t.id !== teamA),
    [meta, teamA],
  );

  return (
    <PasswordGate>
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2>Trade analyzer</h2>
          <span className="label">what-if — nothing here is saved or submitted as a real trade</span>
        </div>

        <div className="two-col" style={{ marginBottom: "1rem" }}>
          <label>
            <span className="label">Your team&nbsp;</span>
            <select className="control" value={teamA ?? ""} onChange={(e) => { setTeamA(Number(e.target.value)); setResult(null); }}>
              <option value="" disabled>Pick a team…</option>
              {(meta?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>
            <span className="label">Trade partner&nbsp;</span>
            <select className="control" value={teamB ?? ""} onChange={(e) => { setTeamB(Number(e.target.value)); setResult(null); }}>
              <option value="" disabled>Pick a team…</option>
              {otherTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>

        {teamA !== null && teamB !== null && (
          <>
            <div className="two-col" style={{ marginBottom: "1rem" }}>
              <AssetPicker
                title={`${teamName(teamA)} gives up`}
                roster={roster.data?.teams[String(teamA)]}
                picks={picksFor(teamA)}
                selection={aOut}
                onToggleplayer={(id) => toggle(setAOut, aOut, "players", id)}
                onTogglePick={(key) => toggle(setAOut, aOut, "picks", key)}
              />
              <AssetPicker
                title={`${teamName(teamB)} gives up`}
                roster={roster.data?.teams[String(teamB)]}
                picks={picksFor(teamB)}
                selection={bOut}
                onToggleplayer={(id) => toggle(setBOut, bOut, "players", id)}
                onTogglePick={(key) => toggle(setBOut, bOut, "picks", key)}
              />
            </div>
            <button type="button" className="control" style={{ cursor: "pointer", background: "var(--paper-2)" }}
              disabled={loading || (aOut.players.size === 0 && aOut.picks.size === 0 && bOut.players.size === 0 && bOut.picks.size === 0)}
              onClick={analyze}>
              {loading ? "Analyzing..." : "Analyze trade"}
            </button>
          </>
        )}

        {error && <div className="error-state" style={{ marginTop: "1rem" }}>{error}</div>}
      </section>

      {result && (
        <>
          <TeamResultCard teamId={result.team_a.team_id} snapshot={result.team_a} />
          <TeamResultCard teamId={result.team_b.team_id} snapshot={result.team_b} />
        </>
      )}
    </PasswordGate>
  );
}
