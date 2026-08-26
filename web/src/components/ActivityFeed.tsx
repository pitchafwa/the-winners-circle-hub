import { useApp } from "../state/AppContext";
import { pts, shortDate, signed } from "../lib/format";
import PlayerCardTrigger from "./PlayerCardTrigger";
import PlayerHeadshot from "./PlayerHeadshot";
import TeamLink from "./TeamLink";
import type { Activity } from "../types/data";

const VERB: Record<string, string> = {
  FA_ADDED: "signed",
  WAIVER_ADDED: "claimed",
  DROPPED: "dropped",
  TRADED: "traded",
};

export default function ActivityFeed({ activity, limit = 12 }: { activity: Activity; limit?: number }) {
  const { teamName } = useApp();
  const events = activity.events.filter((e) => e.action !== "TRADED").slice(0, limit);
  const trades = activity.trades.slice(0, 3);

  if (events.length === 0 && trades.length === 0) {
    return <div className="empty-state">No transactions yet this season.</div>;
  }

  return (
    <div className="activity">
      {trades.length > 0 && (
        <div className="trade-cards">
          {trades.map((t) => {
            const [a, b] = t.team_ids;
            const ga = t.started_points_gained[String(a)] ?? 0;
            const gb = t.started_points_gained[String(b)] ?? 0;
            const diff = ga - gb;
            const leader = diff >= 0 ? a : b;
            return (
              <div key={`${t.date}-${t.team_ids.join("-")}`} className="trade-card">
                <div className="label">Trade · week {t.week}</div>
                <div className="trade-teams">
                  <TeamLink id={a}>{teamName(a)}</TeamLink> <span className="muted">↔</span> <TeamLink id={b}>{teamName(b)}</TeamLink>
                </div>
                <ul className="trade-players muted">
                  {t.players.map((p) => (
                    <li key={p.player_id} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <PlayerHeadshot playerId={p.player_id} className="leaderboard-headshot" />
                      <PlayerCardTrigger playerId={p.player_id} name={p.name}>{p.name}</PlayerCardTrigger>{" "}
                      → <TeamLink id={p.to_team_id}>{teamName(p.to_team_id)}</TeamLink>{" "}
                      <span className="num">({pts(p.post_trade_started_points)} started pts)</span>
                    </li>
                  ))}
                  {t.picks.map((p, i) => (
                    <li key={`pick-${i}`}>
                      {p.pick} pick → <TeamLink id={p.to_team_id}>{teamName(p.to_team_id)}</TeamLink>
                    </li>
                  ))}
                </ul>
                <div className="trade-verdict num">
                  {diff === 0 ? "dead even so far" : <>{signed(Math.abs(diff))} for <TeamLink id={leader}>{teamName(leader)}</TeamLink> so far</>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ul className="feed">
        {events.map((e, i) => (
          <li key={`${e.date}-${e.player_id}-${i}`} className="feed-row">
            <span className="muted num feed-date">{shortDate(e.date)}</span>
            <PlayerHeadshot playerId={e.player_id} className="leaderboard-headshot" />
            <span>
              <strong><TeamLink id={e.team_id}>{teamName(e.team_id)}</TeamLink></strong> {VERB[e.action] ?? e.action.toLowerCase()}{" "}
              <PlayerCardTrigger playerId={e.player_id} name={e.player_name}>{e.player_name}</PlayerCardTrigger>
              {e.action === "WAIVER_ADDED" && e.bid > 0 ? (
                <span className="muted num"> (bid {e.bid})</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {activity.pick_ownership.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <h3 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>Traded draft picks</h3>
          <ul className="feed">
            {activity.pick_ownership.map((p, i) => (
              <li key={i} className="feed-row">
                <span className="muted num feed-date">{p.season} R{p.round}</span>
                <span>
                  <TeamLink id={p.original_team_id}>{teamName(p.original_team_id)}</TeamLink>'s pick → held by{" "}
                  <strong><TeamLink id={p.current_owner_id}>{teamName(p.current_owner_id)}</TeamLink></strong>
                  {p.status === "resolved" && p.player_name && (
                    <> — became <strong>{p.player_name}</strong> <span className="muted">(pick {p.overall_pick})</span></>
                  )}
                  {p.status === "projected" && (
                    <span className="muted"> — projected pick {p.overall_pick}, {p.season} draft not yet entered</span>
                  )}
                  {p.status === "unresolved" && (
                    <span className="muted"> — TBD, {p.season} season not final</span>
                  )}
                  {p.via && <span className="muted"> ({p.via})</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
