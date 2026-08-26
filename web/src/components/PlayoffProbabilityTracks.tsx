import { useApp } from "../state/AppContext";
import { pct } from "../lib/format";
import TeamLink from "./TeamLink";
import type { SimTeam } from "../types/data";

export default function PlayoffProbabilityTracks({ teams }: { teams: SimTeam[] }) {
  const { teamName } = useApp();
  const sorted = [...teams].sort((a, b) => b.playoff_pct - a.playoff_pct);

  return (
    <div className="playoff-tracks">
      {sorted.map((t) => {
        const cur = t.playoff_pct;
        const lose = t.playoff_pct_if_lose_next;
        const win = t.playoff_pct_if_win_next;
        const hasSwing = lose !== null && win !== null;

        return (
          <div className="playoff-track-row" key={t.team_id}>
            <span className="playoff-track-team">
              <TeamLink id={t.team_id}>{teamName(t.team_id)}</TeamLink>
            </span>
            <div className="playoff-track" aria-hidden="true">
              {hasSwing ? (
                <>
                  <span
                    className="playoff-track-floor"
                    style={{ width: `${Math.max(0, lose!) * 100}%` }}
                  />
                  <span
                    className="playoff-track-risk"
                    style={{ left: `${Math.max(0, lose!) * 100}%`, width: `${Math.max(0, cur - lose!) * 100}%` }}
                  />
                  <span
                    className="playoff-track-upside"
                    style={{ left: `${cur * 100}%`, width: `${Math.max(0, win! - cur) * 100}%` }}
                  />
                </>
              ) : (
                <span className="playoff-track-floor" style={{ width: `${cur * 100}%` }} />
              )}
            </div>
            <span className="num playoff-track-pct">
              {pct(cur, 0)}
              <span className="muted"> · 🏆 {pct(t.title_pct, 1)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
