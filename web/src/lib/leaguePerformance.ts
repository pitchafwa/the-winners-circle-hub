// Client-side port of ingest/parse.py's `recent_player_performance()` —
// scans this league's own real weekly scoring (the same matchups/week-N.json
// files playerGameLog.ts already reads for one player at a time) for EVERY
// player at once, newest week first. Powers the Buy-Low Targets tool
// entirely off static JSON, same reasoning as teamValue.ts.
import { loadJson } from "./data";
import type { LineupPlayer, WeekMatchups } from "../types/data";

const MAX_WEEK = 17; // this league's real season never runs past week 17 (config.FINAL_COUNTED_WEEK)

export interface PerformanceEntry {
  week: number;
  points: number;
  owner_team_id: number;
}

/** player_id -> real weekly {week, points, owner_team_id}, newest first,
 * scanned from every team's lineup that week (bench included) regardless
 * of which fantasy team started them. `played:true` alone isn't a
 * reliable "this player actually suited up" signal — a genuinely
 * inactive/IR player can still carry a real all-zero stat line with
 * played:true — so a real ESPN projection of exactly 0 is treated as the
 * true "didn't play" signal, same fix already applied to the player
 * card's own PPG calc and to `recent_player_performance()` server-side. */
export async function leagueSeasonPerformance(season: number): Promise<Map<number, PerformanceEntry[]>> {
  const weeks = await Promise.all(
    Array.from({ length: MAX_WEEK }, (_, i) => i + 1).map((w) =>
      loadJson<WeekMatchups>(`${season}/matchups/week-${w}.json`, true),
    ),
  );

  const out = new Map<number, PerformanceEntry[]>();
  // Newest week first, matching the Python side's `sorted(..., reverse=True)`.
  for (let i = weeks.length - 1; i >= 0; i--) {
    const wk = weeks[i];
    if (!wk) continue;
    const sides: { teamId: number; lineup: LineupPlayer[] }[] = [];
    for (const m of wk.matchups) {
      sides.push({ teamId: m.home.team_id, lineup: m.home.lineup });
      if (m.away) sides.push({ teamId: m.away.team_id, lineup: m.away.lineup });
    }
    for (const side of sides) {
      for (const p of side.lineup) {
        if (!p.played || p.projected === 0) continue;
        const entries = out.get(p.player_id) ?? [];
        entries.push({ week: wk.week, points: p.actual, owner_team_id: side.teamId });
        out.set(p.player_id, entries);
      }
    }
  }
  return out;
}
