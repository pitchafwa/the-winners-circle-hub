import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { pct, pts } from "../lib/format";
import { useSort, useSorted } from "../lib/useSort";
import EmptyState from "../components/EmptyState";
import PasswordGate from "../components/PasswordGate";
import PlayerCardTrigger from "../components/PlayerCardTrigger";
import PlayerHeadshot from "../components/PlayerHeadshot";
import TeamLink from "../components/TeamLink";
import { fetchBuyLowTargets } from "../lib/tradeAnalyzerApi";
import type { BuyLowCandidate } from "../lib/tradeAnalyzerApi";

function BuyLowTable({ candidates }: { candidates: BuyLowCandidate[] }) {
  const { teamName } = useApp();
  const sort = useSort<BuyLowCandidate>("dip_pct", -1, (r, key) =>
    key === "name" ? r.name : key === "owner" ? teamName(r.owner_team_id) : (r[key as keyof BuyLowCandidate] as number),
  );
  const rows = useSorted(candidates, sort);

  const COLS: { key: string; label: string; numeric: boolean; title?: string }[] = [
    { key: "name", label: "Player", numeric: false },
    { key: "position", label: "Pos", numeric: false },
    { key: "owner", label: "Owner", numeric: false },
    { key: "dynasty_value", label: "Dynasty value", numeric: true },
    { key: "season_ppg", label: "Season PPG", numeric: true },
    { key: "recent_ppg", label: "Last 3 PPG", numeric: true },
    { key: "dip_pct", label: "Dip", numeric: true, title: "How far below their own season average their last 3 games have fallen" },
  ];

  return (
    <div className="table-wrap">
      <table className="stat">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.key} scope="col" className={`sortable${c.numeric ? " num" : ""}`}
                title={c.title}
                aria-sort={sort.ariaSort(c.key)}
                onClick={() => sort.toggle(c.key, c.numeric ? -1 : 1)}>
                {c.label}{sort.marker(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.player_id}>
              <td>
                <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <PlayerHeadshot playerId={r.player_id} position={r.position} className="leaderboard-headshot" />
                  <strong>
                    <PlayerCardTrigger playerId={r.player_id} name={r.name} position={r.position}>
                      {r.name}
                    </PlayerCardTrigger>
                  </strong>
                </span>
              </td>
              <td className="muted">{r.position}</td>
              <td><TeamLink id={r.owner_team_id}>{teamName(r.owner_team_id)}</TeamLink></td>
              <td className="num">{pts(r.dynasty_value, 0)}</td>
              <td className="num">{pts(r.season_ppg)}</td>
              <td className="num neg">{pts(r.recent_ppg)}</td>
              <td className="num neg">{pct(r.dip_pct, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BuyLowPage() {
  const { seasonsIndex, myTeamId } = useApp();
  const season = seasonsIndex?.default_season ?? null;
  const [state, setState] = useState<{ candidates: BuyLowCandidate[] | null; loading: boolean; error: string | null }>({
    candidates: null, loading: true, error: null,
  });

  useEffect(() => {
    if (season === null) return;
    let alive = true;
    setState({ candidates: null, loading: true, error: null });
    fetchBuyLowTargets({ season, excludeTeamId: myTeamId })
      .then((res) => { if (alive) setState({ candidates: res.candidates, loading: false, error: null }); })
      .catch((err: Error) => { if (alive) setState({ candidates: null, loading: false, error: err.message }); });
    return () => { alive = false; };
  }, [season, myTeamId]);

  return (
    <PasswordGate>
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2>Buy-low targets</h2>
          <span className="label">strong dynasty value, production down hard the last 3 games — the market may not have caught up</span>
        </div>
        {state.loading && <p className="muted" style={{ fontStyle: "italic" }}>Loading...</p>}
        {state.error && <div className="error-state">{state.error}</div>}
        {state.candidates && state.candidates.length === 0 && (
          <EmptyState>No real dip candidates on file right now — check back once more of the season is in.</EmptyState>
        )}
        {state.candidates && state.candidates.length > 0 && <BuyLowTable candidates={state.candidates} />}
      </section>
    </PasswordGate>
  );
}
