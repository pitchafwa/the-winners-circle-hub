import { loadJson } from "./data";
import type { Activity, Meta, Superlatives, TeamRef, WeekMatchups } from "../types/data";

/** Human label for one matchup's stakes, derived from this league's fixed
 * playoff structure (never inferred loosely by the model) — see
 * Meta.championship_week: a hardcoded league rule, not an ESPN field, since
 * this is exactly the kind of boundary an LLM should be told, not guess at. */
function roundLabel(
  week: number,
  tier: string,
  regSeasonWeeks: number,
  championshipWeek: number,
): { label: string; isChampionship: boolean } {
  if (week <= regSeasonWeeks || tier === "NONE") {
    return { label: "Regular season", isChampionship: false };
  }
  const roundsFromEnd = championshipWeek - week;
  if (tier === "WINNERS_BRACKET") {
    if (roundsFromEnd === 0) return { label: "Championship", isChampionship: true };
    if (roundsFromEnd === 1) return { label: "Semifinal", isChampionship: false };
    if (roundsFromEnd === 2) return { label: "Quarterfinal", isChampionship: false };
    return { label: "Playoffs", isChampionship: false };
  }
  if (tier === "WINNERS_CONSOLATION_LADDER") {
    return roundsFromEnd === 0
      ? { label: "3rd place game", isChampionship: false }
      : { label: "Playoff placement game (already eliminated from the title)", isChampionship: false };
  }
  // LOSERS_CONSOLATION_LADDER — teams that missed the playoffs entirely
  return { label: "Consolation bracket (missed the playoffs)", isChampionship: false };
}

/** Everything the weekly-summary prompt is allowed to talk about — assembled
 * client-side from files already in the static data contract, all team ids
 * resolved to names up front so the model never has to guess one. */
export interface WeekBundle {
  season: number;
  week: number;
  leagueContext: {
    weekLabel: string; // e.g. "Week 17 of 17 — Championship"
    note: string; // explicit framing instruction-ish fact, not just a number
  };
  matchups: {
    home: string;
    away: string;
    homeScore: number;
    awayScore: number;
    winner: "HOME" | "AWAY" | "TIE";
    stakes: string; // "Championship", "Semifinal", "Regular season", etc.
    isChampionship: boolean;
    topHomeScorer: { name: string; points: number } | null;
    topAwayScorer: { name: string; points: number } | null;
  }[];
  storylines: string[]; // Award.detail sentences for this week — already real-number text
  lateSwings: {
    winner: string;
    loser: string;
    keyPlayer: string | null;
    keyPlayerPoints: number | null;
    deficitBeforeFinalDay: number;
    finalMargin: number;
  }[];
  trades: string[]; // one line per trade, plain-English
  waiverAdds: { team: string; player: string; bid: number; waiver: boolean }[];
}

function topScorer(lineup: { name: string; started: boolean; actual: number }[]) {
  const starters = lineup.filter((p) => p.started);
  if (starters.length === 0) return null;
  const best = starters.reduce((a, b) => (b.actual > a.actual ? b : a));
  return { name: best.name, points: best.actual };
}

export async function buildWeekBundle(
  season: number,
  week: number,
  teamsById: Map<number, TeamRef>,
): Promise<WeekBundle> {
  const teamName = (id: number) => teamsById.get(id)?.name ?? `Team ${id}`;

  const [matchupsData, superlatives, activity, meta] = await Promise.all([
    loadJson<WeekMatchups>(`${season}/matchups/week-${week}.json`),
    loadJson<Superlatives>(`${season}/superlatives.json`),
    loadJson<Activity>(`${season}/activity.json`),
    loadJson<Meta>(`${season}/meta.json`),
  ]);
  if (!matchupsData) throw new Error(`No matchup data for week ${week}.`);
  if (!meta) throw new Error(`No league metadata for season ${season}.`);

  const matchups = matchupsData.matchups
    .filter((m) => m.away !== null)
    .map((m) => {
      const { label, isChampionship } = roundLabel(
        week, m.playoff_tier, meta.reg_season_weeks, meta.championship_week,
      );
      return {
        home: teamName(m.home.team_id),
        away: teamName(m.away!.team_id),
        homeScore: m.home.total,
        awayScore: m.away!.total,
        winner: m.winner as "HOME" | "AWAY" | "TIE",
        stakes: label,
        isChampionship,
        topHomeScorer: topScorer(m.home.lineup),
        topAwayScorer: topScorer(m.away!.lineup),
      };
    });

  const hasChampionship = matchups.some((m) => m.isChampionship);
  const weekLabel = week > meta.reg_season_weeks
    ? `Week ${week} of ${meta.championship_week} — ${hasChampionship ? "Championship week" : "Playoffs"}`
    : `Week ${week} of ${meta.reg_season_weeks} — Regular season`;
  const note = hasChampionship
    ? `Week ${meta.championship_week} is always this league's championship — the WINNERS_BRACKET matchup this week (stakes: "Championship") decided the title outright. Any other matchups this same week are lower-stakes placement/consolation games happening in parallel, not part of an ongoing playoff race — do not describe the field as "taking shape" or the outcome as still undecided elsewhere.`
    : week > meta.reg_season_weeks
      ? `This is a playoff week, but NOT the championship (that's always week ${meta.championship_week}). Only the matchup(s) tagged "stakes" as Semifinal/Quarterfinal are live playoff-race drama; anything tagged as a placement or consolation game no longer affects who wins the title.`
      : `This is a regular-season week (playoffs start week ${meta.reg_season_weeks + 1}, championship is week ${meta.championship_week}). Don't describe regular-season games using playoff language.`;

  const storylines = (superlatives?.awards ?? [])
    .filter((a) => a.week === week)
    .map((a) => a.detail);

  const lateSwings = (matchupsData.late_swings ?? []).map((s) => ({
    winner: teamName(s.winner_team_id),
    loser: teamName(s.loser_team_id),
    keyPlayer: s.key_player,
    keyPlayerPoints: s.key_player_points,
    deficitBeforeFinalDay: s.deficit_before_final_day,
    finalMargin: s.final_margin,
  }));

  const trades = (activity?.trades ?? [])
    .filter((t) => t.week === week)
    .map((t) => {
      const byTeam = new Map<number, string[]>();
      for (const p of t.players) {
        const label = `${p.name} (to ${teamName(p.to_team_id)})`;
        byTeam.set(p.from_team_id, [...(byTeam.get(p.from_team_id) ?? []), label]);
      }
      for (const p of t.picks) {
        const label = `${p.pick} pick (to ${teamName(p.to_team_id)})`;
        byTeam.set(p.from_team_id, [...(byTeam.get(p.from_team_id) ?? []), label]);
      }
      return [...byTeam.entries()]
        .map(([fromId, assets]) => `${teamName(fromId)} sent ${assets.join(", ")}`)
        .join("; ");
    });

  const waiverAdds = (activity?.events ?? [])
    .filter((e) => e.week === week && (e.action === "FA_ADDED" || e.action === "WAIVER_ADDED"))
    .map((e) => ({
      team: teamName(e.team_id),
      player: e.player_name,
      bid: e.bid,
      waiver: e.action === "WAIVER_ADDED",
    }))
    .sort((a, b) => b.bid - a.bid);

  return {
    season, week,
    leagueContext: { weekLabel, note },
    matchups, storylines, lateSwings, trades, waiverAdds,
  };
}

const SYSTEM_PROMPT = `You write a short weekly recap for a competitive dynasty fantasy football league's group chat. You will be given a JSON bundle of everything that's known to have happened in one week: league context establishing what this week actually means (regular season / playoffs / championship), every matchup's final score, stakes, and top scorer per side, a list of pre-written storyline sentences (already fact-checked, real numbers), any matchups where the week's final wave of games (usually Monday Night Football) flipped who was winning, trades executed that week, and waiver-wire/free-agent adds.

Rules:
- Use ONLY facts present in the bundle. Never invent a player, score, team name, or event that isn't in the data. If a category (trades, waiver adds, late swings) is empty, don't mention it — don't apologize for its absence either, just skip it.
- ALWAYS read leagueContext.note first and follow it exactly — it tells you what this week's games actually mean and overrides any assumption you'd otherwise make. Never call a playoff picture "still taking shape" or a bracket "wide open" during the championship week — the season is deciding its winner right now, not building toward one.
- Every matchup has a "stakes" field ("Championship", "Semifinal", "Quarterfinal", "3rd place game", a consolation label, or "Regular season"). If any matchup is isChampionship: true, that game IS the season finale — lead the entire recap with it, say outright that it decided the league championship, and name the winner as champion. Games elsewhere that same week (3rd place, consolation) are real but clearly lower stakes — a sentence each at most, never framed as equally dramatic.
- Outside a championship week, only describe a game as meaningful playoff drama if its stakes say so (Semifinal/Quarterfinal); a "Regular season" or consolation-bracket game doesn't have playoff-race stakes and shouldn't be written as if it does.
- Write 150-300 words, a few short paragraphs. Engaging, a little playful, but grounded — real numbers, not vibes.
- Beyond the lead, cover the players who carried their teams (use topHomeScorer/topAwayScorer and storylines).
- If lateSwings has entries, call out at least one by name — a team trailing before the week's final games who won anyway (or the reverse) is a marquee "how it was won" storyline, doubly so if it's the championship game.
- Weave in trades and waiver adds near the end as shorter hits, only if present.
- No markdown headers, no bullet lists — prose only, like a beat writer's recap. No preamble like "Here's the recap" — just start writing it.`;

export async function generateWeeklySummary(bundle: WeekBundle, apiKey: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(bundle) }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as { content: { text: string }[] };
  return data.content[0].text.trim();
}
