import { loadJson } from "./data";
import type { LineupPlayer, Roster, RosterPlayerCard, WeekMatchups } from "../types/data";

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

  // `played: true` alone isn't reliable — a player who was actually
  // inactive/out that week can still show played:true with a real stat
  // line of all zeros (confirmed live: a real 2025 injury week, actual 0
  // AND projected 0). A genuine projection of exactly 0 is ESPN's own
  // signal that the player wasn't expected to play, so that's the real
  // "didn't play" check for PPG purposes, not the played flag on its own.
  const addToPositionTotals = (position: string, pid: number, played: boolean, projected: number | null, actual: number) => {
    const posMap = positionTotals.get(position) ?? new Map();
    if (!posMap.has(pid)) posMap.set(pid, { points: 0, games: 0 });
    if (played && projected !== 0) {
      const entry = posMap.get(pid)!;
      entry.points += actual;
      entry.games += 1;
    }
    positionTotals.set(position, posMap);
  };

  for (const wk of weeks) {
    if (!wk) continue;
    const sides: { teamId: number; lineup: LineupPlayer[] }[] = [];
    for (const m of wk.matchups) {
      sides.push({ teamId: m.home.team_id, lineup: m.home.lineup });
      if (m.away) sides.push({ teamId: m.away.team_id, lineup: m.away.lineup });
    }
    for (const side of sides) {
      for (const p of side.lineup) {
        addToPositionTotals(p.position, p.player_id, p.played, p.projected, p.actual);
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

  // The week actually being played right now has no decided
  // matchups/week-N.json yet — that file, by design, only gets written
  // once every matchup in a week is fully decided (see that file's own
  // DATA.md section). Fall back to roster.json instead, which rebuilds
  // continuously all season long regardless of whether the current
  // week's done, so a real in-progress score/projection/hot-cold status
  // shows up here too, instead of reading "data not available" for a
  // week that's actually happening right now. Tommy, 2026-09-14: "now
  // that the 2026 season has started, can we add 2026 gamelogs to the
  // cards?" Only ever fills in the ONE current week — every other week
  // either already has a real decided file above, or genuinely hasn't
  // happened yet.
  const roster = await loadJson<Roster>(`${season}/roster.json`, true);
  if (roster && !byWeek.has(roster.current_week)) {
    for (const [teamIdStr, team] of Object.entries(roster.teams)) {
      const teamId = Number(teamIdStr);
      const groups: [RosterPlayerCard[], boolean][] = [
        [team.starters, true], [team.bench, false], [team.ir, false],
      ];
      for (const [cards, isStarter] of groups) {
        for (const card of cards) {
          if (card.player_id === null || card.position === null) continue;
          const played = card.week_actual !== null;
          const actual = card.week_actual ?? 0;
          addToPositionTotals(card.position, card.player_id, played, card.week_projection, actual);
          if (card.player_id === playerId) {
            targetPosition = card.position;
            byWeek.set(roster.current_week, {
              week: roster.current_week, hasData: true, teamId,
              started: isStarter, played, actual,
              projected: card.week_projection, onFire: card.on_fire, onIce: card.on_ice,
            });
          }
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
