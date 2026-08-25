import type { H2HPair } from "../types/data";

/** teamId's all-time record against opponentId, from the flat pairs list
 * (`h2h.json`, canonically ordered team_a < team_b) — resolved to
 * whichever team is asking, so callers don't have to think about pair
 * ordering. null if these two have never played (a genuinely possible
 * state, not just missing data). */
export function h2hLookup(
  pairs: H2HPair[],
  teamId: number,
  opponentId: number,
): { wins: number; losses: number; ties: number } | null {
  const lo = Math.min(teamId, opponentId);
  const hi = Math.max(teamId, opponentId);
  const pair = pairs.find((p) => p.team_a === lo && p.team_b === hi);
  if (!pair) return null;
  const teamIsA = teamId === lo;
  return {
    wins: teamIsA ? pair.a_wins : pair.b_wins,
    losses: teamIsA ? pair.b_wins : pair.a_wins,
    ties: pair.ties,
  };
}
