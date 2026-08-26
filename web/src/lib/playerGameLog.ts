import { loadJson } from "./data";
import type { WeekMatchups } from "../types/data";

// The league's real season never runs past the championship week (17 for
// this league, per config.FINAL_COUNTED_WEEK) — a couple of extra weeks of
// headroom costs nothing (missing weeks just resolve to null and are
// skipped) but keeps this from silently breaking if the league's real
// week count ever changes.
const MAX_WEEK = 19;

export interface PlayerGameLogRow {
  week: number;
  started: boolean;
  played: boolean;
  actual: number;
  projected: number | null;
  onFire: boolean;
  onIce: boolean;
}

/** This league's own real fantasy points for one player across a season —
 * scanned from the same matchups/week-N.json files the Matchups tab
 * already renders (a player's own team isn't known in advance, so both
 * sides of every matchup get checked). Distinct from the ESPN-sourced
 * season-stats section elsewhere on the card: this is OUR scoring, for
 * ANY season the league has real box scores for, not whatever the current
 * real NFL season happens to be. */
export async function fetchPlayerSeasonGameLog(season: number, playerId: number): Promise<PlayerGameLogRow[]> {
  const weeks = await Promise.all(
    Array.from({ length: MAX_WEEK }, (_, i) => i + 1).map((w) =>
      loadJson<WeekMatchups>(`${season}/matchups/week-${w}.json`, true),
    ),
  );
  const rows: PlayerGameLogRow[] = [];
  for (const wk of weeks) {
    if (!wk) continue;
    for (const m of wk.matchups) {
      const p = m.home.lineup.find((lp) => lp.player_id === playerId)
        ?? m.away?.lineup.find((lp) => lp.player_id === playerId);
      if (p) {
        rows.push({
          week: wk.week, started: p.started, played: p.played,
          actual: p.actual, projected: p.projected, onFire: p.on_fire, onIce: p.on_ice,
        });
        break;
      }
    }
  }
  rows.sort((a, b) => b.week - a.week);
  return rows;
}
