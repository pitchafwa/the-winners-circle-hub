// Client-side port of ingest/trade_analyzer_tool.py's team-value math, so
// the LM Tools built on top of it (Positional Strength, Trade Analyzer,
// Trade Partners) run entirely off static JSON — no local Python backend
// needed, so they work on the deployed site the same as everywhere else.
// See player_values.json (per-player dynasty/redraft value + real ESPN
// eligible slots) and pick_futures.json's `value` field (this file's data
// source), both written by ingest/build.py.
import type { PlayerValueEntry, PlayerValues, Roster, TeamRoster } from "../types/data";

export interface PositionRating {
  starter: number;
  depth: number;
  count: number;
}

// Slot names that map 1:1 to a single position — mirrors
// trade_analyzer_tool.py's DEDICATED_SLOT_TO_POSITION. Shared/flex slots
// ("RB/WR", "WR/TE", "FLEX") deliberately don't count toward any one
// position's dedicated-slot tally, same simplification as the Python side.
const DEDICATED_POSITIONS = new Set(["QB", "RB", "WR", "TE", "D/ST", "K"]);

// D/ST and K carry no meaningful dynasty market value in this league —
// excluded from both the starting-slot count and the candidate pool for
// contending-value lineup math, mirroring metrics.VALUATION_EXCLUDED_SLOTS.
const VALUATION_EXCLUDED_SLOTS = new Set(["D/ST", "K"]);

export interface RosterPlayer {
  player_id: number;
  position: string;
  eligible_slots: string[];
}

/** Every player currently on a team's roster (starters + bench + IR),
 * cross-referenced against player_values.json for value/position/eligible
 * slots. Players ESPN carries but KTC doesn't rank (no real dynasty
 * market) still appear with value 0 rather than being dropped, matching
 * how the Python side treats an unranked player. */
export function rosterPlayers(roster: TeamRoster | undefined, values: PlayerValues["players"]): RosterPlayer[] {
  if (!roster) return [];
  const ids = [...roster.starters, ...roster.bench, ...roster.ir]
    .map((p) => p.player_id)
    .filter((id): id is number => id !== null);
  return ids.map((id) => {
    const v = values[String(id)];
    return { player_id: id, position: v?.position ?? "?", eligible_slots: v?.eligible_slots ?? [] };
  });
}

function valueOf(pid: number, values: PlayerValues["players"], kind: "dynasty" | "redraft"): number {
  return values[String(pid)]?.[kind] ?? 0;
}

/** Per position: starter-tier value (top N players' value, N = that
 * position's own dedicated-slot count) + depth value (everyone else
 * rostered there) — exact port of trade_analyzer_tool.py's
 * `_position_ratings()`. */
export function positionRatings(
  roster: RosterPlayer[], values: PlayerValues["players"], startingSlots: string[],
): Record<string, PositionRating> {
  const dedicatedCount: Record<string, number> = {};
  for (const slot of startingSlots) {
    if (DEDICATED_POSITIONS.has(slot)) dedicatedCount[slot] = (dedicatedCount[slot] ?? 0) + 1;
  }

  const byPosition = new Map<string, number[]>();
  for (const p of roster) {
    const arr = byPosition.get(p.position) ?? [];
    arr.push(valueOf(p.player_id, values, "dynasty"));
    byPosition.set(p.position, arr);
  }

  const ratings: Record<string, PositionRating> = {};
  for (const [position, vals] of byPosition) {
    const sorted = [...vals].sort((a, b) => b - a);
    const n = Math.max(dedicatedCount[position] ?? 0, 1);
    ratings[position] = {
      starter: Math.round(sorted.slice(0, n).reduce((s, v) => s + v, 0)),
      depth: Math.round(sorted.slice(n).reduce((s, v) => s + v, 0)),
      count: sorted.length,
    };
  }
  return ratings;
}

/** Best-possible starting lineup value (max-weight bipartite matching,
 * players -> eligible slots) + 10% credit for the rest of the roster's
 * value — exact port of metrics.redraft_lineup_value(). Bipartite matching
 * via augmenting paths (Kuhn's algorithm), processing candidates in
 * descending value order: because a player's value is the same no matter
 * which of their eligible slots they fill, "sort by value, greedily
 * augment into any open eligible slot" gives the true maximum — this is
 * the standard result for weighted bipartite matching when weight depends
 * only on one side (a transversal-matroid greedy), not an approximation
 * of scipy's linear_sum_assignment, so it matches Python's answer exactly. */
export function redraftLineupValue(
  roster: RosterPlayer[], values: PlayerValues["players"], startingSlots: string[], benchWeight = 0.10,
): number {
  const slots = startingSlots.filter((s) => !VALUATION_EXCLUDED_SLOTS.has(s));
  const candidates = roster.filter((p) => !p.eligible_slots.some((s) => VALUATION_EXCLUDED_SLOTS.has(s)));
  if (slots.length === 0 || candidates.length === 0) return 0;

  const eligibleByPid = new Map(candidates.map((c) => [c.player_id, new Set(c.eligible_slots)]));
  const sorted = [...candidates].sort(
    (a, b) => valueOf(b.player_id, values, "redraft") - valueOf(a.player_id, values, "redraft"),
  );
  const slotAssignment: (number | null)[] = new Array(slots.length).fill(null);

  function tryAssign(pid: number, visited: Set<number>): boolean {
    const eligible = eligibleByPid.get(pid)!;
    for (let si = 0; si < slots.length; si++) {
      if (visited.has(si) || !eligible.has(slots[si])) continue;
      visited.add(si);
      const occupant = slotAssignment[si];
      if (occupant === null || tryAssign(occupant, visited)) {
        slotAssignment[si] = pid;
        return true;
      }
    }
    return false;
  }

  let filled = 0;
  for (const cand of sorted) {
    if (filled >= slots.length) break;
    if (tryAssign(cand.player_id, new Set())) filled++;
  }

  const assigned = new Set(slotAssignment.filter((pid): pid is number => pid !== null));
  const startingValue = [...assigned].reduce((s, pid) => s + valueOf(pid, values, "redraft"), 0);
  const benchValue = candidates
    .filter((c) => !assigned.has(c.player_id))
    .reduce((s, c) => s + valueOf(c.player_id, values, "redraft"), 0);
  return startingValue + benchWeight * benchValue;
}

export interface TeamSnapshot {
  contending_value: number;
  dynasty_roster_value: number;
  future_pick_capital: number;
  rebuilding_value: number;
  positions: Record<string, PositionRating>;
}

const ROSTER_WEIGHT = 3; // dynasty roster value counts 3x as much as pick capital — matches spectrum.py

/** Exact port of trade_analyzer_tool.py's `_team_snapshot()`. */
export function teamSnapshot(
  roster: RosterPlayer[], values: PlayerValues["players"], startingSlots: string[], pickCapital: number,
): TeamSnapshot {
  const dynastyRosterValue = roster.reduce((s, p) => s + valueOf(p.player_id, values, "dynasty"), 0);
  const contendingValue = redraftLineupValue(roster, values, startingSlots);
  const rebuildingValue = (ROSTER_WEIGHT * dynastyRosterValue + pickCapital) / (ROSTER_WEIGHT + 1);
  return {
    contending_value: Math.round(contendingValue),
    dynasty_roster_value: Math.round(dynastyRosterValue),
    future_pick_capital: Math.round(pickCapital),
    rebuilding_value: Math.round(rebuildingValue),
    positions: positionRatings(roster, values, startingSlots),
  };
}

/** Every team's roster, resolved against player_values.json — the shared
 * starting point for Positional Strength, Trade Partners, and Trade
 * Analyzer's team pickers alike. */
export function allTeamRosters(roster: Roster | null, values: PlayerValues | null): Record<number, RosterPlayer[]> {
  if (!roster || !values) return {};
  const out: Record<number, RosterPlayer[]> = {};
  for (const [teamId, teamRoster] of Object.entries(roster.teams)) {
    out[Number(teamId)] = rosterPlayers(teamRoster, values.players);
  }
  return out;
}

export interface TradePartnerMatch {
  position: string;
  direction: "they_help_you" | "you_help_them";
  contribution: number;
}

export interface TradePartner {
  team_id: number;
  fit_score: number;
  matches: TradePartnerMatch[];
}

/** Exact port of trade_analyzer_tool.py's `cmd_trade_partners()`, given
 * every team's already-computed position ratings. */
export function tradePartners(
  myTeamId: number, ratingsByTeam: Record<number, Record<string, PositionRating>>,
): TradePartner[] {
  const teamIds = Object.keys(ratingsByTeam).map(Number);
  const positions = [...new Set(teamIds.flatMap((id) => Object.keys(ratingsByTeam[id])))];

  const totalValue: Record<number, Record<string, number>> = {};
  for (const id of teamIds) {
    totalValue[id] = {};
    for (const pos of positions) {
      const r = ratingsByTeam[id][pos];
      totalValue[id][pos] = r ? r.starter + r.depth : 0;
    }
  }
  const leagueAvg: Record<string, number> = {};
  for (const pos of positions) {
    leagueAvg[pos] = teamIds.reduce((s, id) => s + totalValue[id][pos], 0) / teamIds.length;
  }

  function needSurplus(teamId: number): { need: Record<string, number>; surplus: Record<string, number> } {
    const need: Record<string, number> = {};
    const surplus: Record<string, number> = {};
    for (const pos of positions) {
      const avg = leagueAvg[pos];
      if (avg <= 0) { need[pos] = 0; surplus[pos] = 0; continue; }
      const diff = (totalValue[teamId][pos] - avg) / avg;
      need[pos] = Math.max(0, -diff);
      surplus[pos] = Math.max(0, diff);
    }
    return { need, surplus };
  }

  const mine = needSurplus(myTeamId);
  const partners: TradePartner[] = [];
  for (const teamId of teamIds) {
    if (teamId === myTeamId) continue;
    const theirs = needSurplus(teamId);
    const matches: TradePartnerMatch[] = [];
    let fitScore = 0;
    for (const pos of positions) {
      const theyHelpYou = mine.need[pos] * theirs.surplus[pos];
      const youHelpThem = theirs.need[pos] * mine.surplus[pos];
      if (theyHelpYou > 0) { matches.push({ position: pos, direction: "they_help_you", contribution: theyHelpYou }); fitScore += theyHelpYou; }
      if (youHelpThem > 0) { matches.push({ position: pos, direction: "you_help_them", contribution: youHelpThem }); fitScore += youHelpThem; }
    }
    matches.sort((a, b) => b.contribution - a.contribution);
    partners.push({ team_id: teamId, fit_score: Math.round(fitScore * 1000) / 1000, matches });
  }
  partners.sort((a, b) => b.fit_score - a.fit_score);
  return partners;
}

export function playerDynastyValue(pid: number, values: PlayerValues["players"]): number {
  return valueOf(pid, values, "dynasty");
}

export function playerValueEntry(pid: number, values: PlayerValues["players"]): PlayerValueEntry | undefined {
  return values[String(pid)];
}
