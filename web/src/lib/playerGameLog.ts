import { loadJson } from "./data";
import type { LineupPlayer, WeekMatchups } from "../types/data";

// The league's real season never runs past the championship week (17 for
// this league, per config.FINAL_COUNTED_WEEK) — always shown in full,
// week 1 through 17, even for weeks with no data at all.
const MAX_WEEK = 17;

// Below this many real games played this season, a player's PPG is too
// noisy to rank fairly against a full season's worth of production (one
// huge fluke game would otherwise read as "the best at the position") —
// they still show their own real PPG, just aren't counted into anyone
// else's rank or the qualified pool size.
const MIN_GAMES_FOR_RANK = 3;

export interface PlayerGameLogRow {
  week: number;
  hasData: boolean;
  teamId: number | null;
  started: boolean;
  played: boolean;
  actual: number;
  projected: number | null;
  onFire: boolean;
  onIce: boolean;
}

export interface SeasonPpgSummary {
  ppg: number | null;
  gamesPlayed: number;
  positionRank: number | null;
  positionCount: number;
}

export interface PlayerSeasonData {
  rows: PlayerGameLogRow[];
  summary: SeasonPpgSummary;
}

/** This league's own real fantasy points, week by week, for one player —
 * scanned from the same matchups/week-N.json files the Matchups tab
 * already renders (which team a player was on isn't known in advance, so
 * every team's lineup gets checked each week). While scanning anyway,
 * also tallies every OTHER player at the same position into a season-wide
 * points-per-game ranking — free, since it's the same rows already being
 * read off disk for the target player's own log.
 *
 * Deliberately NOT the ESPN-sourced gameLog used elsewhere on the card:
 * that one only ever reflects the CURRENT real NFL season's raw box-score
 * stats, regardless of which fantasy season this is asked about, and
 * doesn't carry this league's actual scoring. */
export async function fetchPlayerSeasonData(
  season: number,
  playerId: number,
  fallbackPosition: string | null | undefined,
): Promise<PlayerSeasonData> {
  const weeks = await Promise.all(
    Array.from({ length: MAX_WEEK }, (_, i) => i + 1).map((w) =>
      loadJson<WeekMatchups>(`${season}/matchups/week-${w}.json`, true),
    ),
  );

  const byWeek = new Map<number, PlayerGameLogRow>();
  let targetPosition: string | null = fallbackPosition ?? null;
  // position -> player_id -> totals across real games played
  const positionTotals = new Map<string, Map<number, { points: number; games: number }>>();

  for (const wk of weeks) {
    if (!wk) continue;
    const sides: { teamId: number; lineup: LineupPlayer[] }[] = [];
    for (const m of wk.matchups) {
      sides.push({ teamId: m.home.team_id, lineup: m.home.lineup });
      if (m.away) sides.push({ teamId: m.away.team_id, lineup: m.away.lineup });
    }
    for (const side of sides) {
      for (const p of side.lineup) {
        const posMap = positionTotals.get(p.position) ?? new Map();
        if (!posMap.has(p.player_id)) posMap.set(p.player_id, { points: 0, games: 0 });
        if (p.played) {
          const entry = posMap.get(p.player_id)!;
          entry.points += p.actual;
          entry.games += 1;
        }
        positionTotals.set(p.position, posMap);

        if (p.player_id === playerId) {
          targetPosition = p.position;
          byWeek.set(wk.week, {
            week: wk.week, hasData: true, teamId: side.teamId,
            started: p.started, played: p.played, actual: p.actual,
            projected: p.projected, onFire: p.on_fire, onIce: p.on_ice,
          });
        }
      }
    }
  }

  const rows: PlayerGameLogRow[] = Array.from({ length: MAX_WEEK }, (_, i) => i + 1).map((w) =>
    byWeek.get(w) ?? {
      week: w, hasData: false, teamId: null, started: false, played: false,
      actual: 0, projected: null, onFire: false, onIce: false,
    },
  );

  let summary: SeasonPpgSummary = { ppg: null, gamesPlayed: 0, positionRank: null, positionCount: 0 };
  const posMap = targetPosition ? positionTotals.get(targetPosition) : undefined;
  if (posMap) {
    const mine = posMap.get(playerId);
    const gamesPlayed = mine?.games ?? 0;
    const ppg = mine && gamesPlayed > 0 ? mine.points / gamesPlayed : null;
    const ranked = [...posMap.entries()]
      .map(([pid, t]) => ({ pid, ppg: t.games > 0 ? t.points / t.games : 0, games: t.games }))
      .filter((r) => r.games >= MIN_GAMES_FOR_RANK)
      .sort((a, b) => b.ppg - a.ppg);
    const idx = gamesPlayed >= MIN_GAMES_FOR_RANK ? ranked.findIndex((r) => r.pid === playerId) : -1;
    summary = {
      ppg, gamesPlayed,
      positionRank: idx >= 0 ? idx + 1 : null,
      positionCount: ranked.length,
    };
  }

  return { rows, summary };
}
