import { useApp } from "../state/AppContext";
import { pct } from "../lib/format";
import type { PowerRow } from "../types/data";

function Movement({ m }: { m: number | null }) {
  if (m === null) return <span className="movement flat">·</span>;
  if (m === 0) return <span className="movement flat">→</span>;
  return m > 0 ? (
    <span className="movement up">↑{m}</span>
  ) : (
    <span className="movement down">↓{-m}</span>
  );
}

export default function PowerRankings({ rows }: { rows: PowerRow[] }) {
  const { teamName } = useApp();
  return (
    <ol className="power-list">
      {rows.map((r) => (
        <li key={r.team_id} className="power-row">
          <span className="num power-rank">{r.rank}</span>
          <span className="power-team">{teamName(r.team_id)}</span>
          <span className="muted num" style={{ fontSize: "0.8rem" }}>
            all-play {pct(r.components.all_play, 0)}
          </span>
          <Movement m={r.movement} />
        </li>
      ))}
    </ol>
  );
}
