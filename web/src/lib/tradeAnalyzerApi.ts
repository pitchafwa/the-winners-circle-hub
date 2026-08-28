import { post } from "./adminApi";

export interface PositionRating {
  starter: number;
  depth: number;
  count: number;
}

export interface TeamSnapshot {
  contending_value: number;
  dynasty_roster_value: number;
  future_pick_capital: number;
  rebuilding_value: number;
  positions: Record<string, PositionRating>;
}

export interface TeamSimResult {
  team_id: number;
  before: TeamSnapshot;
  after: TeamSnapshot;
}

export interface SimulateTradeResponse {
  team_a: TeamSimResult;
  team_b: TeamSimResult;
}

export interface PickAsset {
  season: number;
  round: number;
}

export interface TradeSide {
  players: number[];
  picks: PickAsset[];
}

export function simulateTrade(params: {
  season: number;
  teamA: number;
  teamB: number;
  teamAOut: TradeSide;
  teamBOut: TradeSide;
}): Promise<SimulateTradeResponse> {
  return post<SimulateTradeResponse>("/api/analyzer/simulate_trade", {
    season: params.season,
    team_a: params.teamA,
    team_b: params.teamB,
    team_a_out: { players: params.teamAOut.players, picks: params.teamAOut.picks },
    team_b_out: { players: params.teamBOut.players, picks: params.teamBOut.picks },
  });
}

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

export interface BuyLowResponse {
  season: number;
  candidates: BuyLowCandidate[];
}

export function fetchBuyLowTargets(params: { season: number; excludeTeamId?: number | null }): Promise<BuyLowResponse> {
  return post<BuyLowResponse>("/api/analyzer/buy_low_targets", {
    season: params.season,
    exclude_team_id: params.excludeTeamId ?? null,
  });
}

export interface LeaguePositionsResponse {
  season: number;
  teams: Record<string, Record<string, PositionRating>>;
}

export function fetchLeaguePositions(season: number): Promise<LeaguePositionsResponse> {
  return post<LeaguePositionsResponse>("/api/analyzer/league_positions", { season });
}

/** direction is from "my" team's point of view: "they_help_you" means their
 * surplus at `position` offsets my need there; "you_help_them" is the
 * reverse. `contribution` is that one position's share of the pair's total
 * fit_score — always > 0, sorted descending. */
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

export interface TradePartnersResponse {
  season: number;
  my_team_id: number;
  partners: TradePartner[];
}

export function fetchTradePartners(params: { season: number; myTeamId: number }): Promise<TradePartnersResponse> {
  return post<TradePartnersResponse>("/api/analyzer/trade_partners", {
    season: params.season,
    my_team_id: params.myTeamId,
  });
}
