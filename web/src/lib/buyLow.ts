// Client-side port of trade_analyzer_tool.py's `cmd_buy_low_targets()`.
import { leagueSeasonPerformance } from "./leaguePerformance";
import type { PlayerValues, Roster } from "../types/data";

// Same thresholds as the Python side — Tommy's own read of what counts as
// notable on today's market, not derived from anything statistical.
const VALUE_FLOOR = 3000;
const MIN_SEASON_GAMES = 4;
const MIN_DIP_PCT = 0.20;

export interface BuyLowCandidate {
  player_id: number;
  name: string;
  position: string;
  owner_team_id: number;
  dynasty_value: number;
  season_games: number;
  season_ppg: number;
  recent_ppg: number;
  dip_pct: number;
}

export async function computeBuyLowTargets(params: {
  season: number;
  values: PlayerValues;
  roster: Roster;
  excludeTeamId?: number | null;
}): Promise<BuyLowCandidate[]> {
  const { season, values, roster, excludeTeamId } = params;

  // Current ownership + name, straight from the roster (not from game-log
  // "who were they on THAT week" data — a player traded since their last
  // game should show their real current owner) — exact mirror of the
  // Python side's `owner_by_pid`/`names` built from
  // `current_roster_players_with_position()`.
  const nameByPid = new Map<number, string>();
  const ownerByPid = new Map<number, number>();
  for (const [teamIdStr, team] of Object.entries(roster.teams)) {
    const teamId = Number(teamIdStr);
    if (teamId === excludeTeamId) continue;
    for (const p of [...team.starters, ...team.bench, ...team.ir]) {
      if (p.player_id === null) continue;
      if (p.name) nameByPid.set(p.player_id, p.name);
      ownerByPid.set(p.player_id, teamId);
    }
  }

  const performance = await leagueSeasonPerformance(season);
  const candidates: BuyLowCandidate[] = [];

  for (const [pid, entries] of performance) {
    const entry = values.players[String(pid)];
    if (!entry) continue; // not on any current roster
    const ownerTeamId = ownerByPid.get(pid);
    if (ownerTeamId === undefined) continue; // rostered by nobody eligible (or excluded team)
    if (entry.dynasty < VALUE_FLOOR) continue;
    if (entries.length < MIN_SEASON_GAMES) continue;

    const seasonPpg = entries.reduce((s, e) => s + e.points, 0) / entries.length;
    if (seasonPpg <= 0) continue;
    const recent = entries.slice(0, 3);
    const recentPpg = recent.reduce((s, e) => s + e.points, 0) / recent.length;
    const dipPct = (seasonPpg - recentPpg) / seasonPpg;
    if (dipPct < MIN_DIP_PCT) continue;

    candidates.push({
      player_id: pid,
      name: nameByPid.get(pid) ?? `Player ${pid}`,
      position: entry.position,
      owner_team_id: ownerTeamId,
      dynasty_value: entry.dynasty,
      season_games: entries.length,
      season_ppg: Math.round(seasonPpg * 10) / 10,
      recent_ppg: Math.round(recentPpg * 10) / 10,
      dip_pct: Math.round(dipPct * 1000) / 1000,
    });
  }

  candidates.sort((a, b) => b.dip_pct - a.dip_pct);
  return candidates;
}
