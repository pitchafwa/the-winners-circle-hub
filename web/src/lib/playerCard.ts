// ESPN's general sports site API, not the private fantasy league API the
// rest of this app calls — no ESPN_S2/SWID cookie needed, CORS is wide
// open (confirmed live), so this is fetched directly from the browser on
// click rather than baked into the ingest pipeline. Fetching this for
// every rostered player at build time would be slow and mostly wasted,
// since most players' cards never get opened.
const BASE_URL = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes";

export interface StatSplit {
  displayName: string;
  stats: string[];
}

export interface StatisticsSection {
  displayName: string;
  labels: string[];
  splits: StatSplit[];
}

export interface GameLogEventMeta {
  week: number;
  atVs: string;
  gameDate: string;
  gameResult: string;
  score: string;
  opponent?: { abbreviation: string };
}

export interface GameLogCategory {
  displayName: string;
  labels: string[];
  events: Record<string, { stats: string[] }>;
}

export interface GameLogSection {
  events: Record<string, GameLogEventMeta>;
  statistics: GameLogCategory[];
}

export interface NewsItem {
  headline: string;
  description?: string;
  lastModified?: string;
  links?: { web?: { href: string } };
}

export interface RotowireNote {
  headline: string;
  story: string;
  published: string;
}

export interface FantasyOverview {
  draftRank?: string;
  positionRank?: string;
  percentOwned?: string;
  last7Days?: string;
  projection?: string;
}

export interface AwardEntry {
  name: string;
  displayCount: string;
  seasons: string[];
}

export interface NextGameEvent {
  name: string;
  shortName: string;
  date: string;
  weekText?: string;
}

export interface PlayerOverview {
  statistics?: StatisticsSection;
  gameLog?: GameLogSection;
  news?: NewsItem[];
  rotowire?: RotowireNote;
  fantasy?: FantasyOverview;
  awards?: AwardEntry[];
  nextGame?: { league?: { events?: NextGameEvent[] } };
}

// Session-lifetime cache, keyed by player_id — re-opening the same card
// doesn't refetch. A failed request is evicted so a later retry (e.g. a
// transient network blip) gets a real second attempt instead of an
// instantly-rejecting cached promise.
const cache = new Map<number, Promise<PlayerOverview>>();

export function fetchPlayerOverview(playerId: number): Promise<PlayerOverview> {
  const cached = cache.get(playerId);
  if (cached) return cached;
  const promise = fetch(`${BASE_URL}/${playerId}/overview`)
    .then((res) => {
      if (!res.ok) {
        throw new Error(res.status === 404 ? "ESPN has no data on file for this player." : `ESPN request failed (${res.status}).`);
      }
      return res.json() as Promise<PlayerOverview>;
    })
    .catch((err) => {
      cache.delete(playerId);
      throw err;
    });
  cache.set(playerId, promise);
  return promise;
}
