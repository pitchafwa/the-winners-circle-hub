/**
 * TypeScript mirror of the JSON contract written by ingest/build.py.
 * Documented in DATA.md — change both together or not at all.
 */

export interface SeasonSummary {
  season: number;
  name: string;
  completed_weeks: number;
  season_over: boolean;
  season_started: boolean;
}

export interface SeasonsIndex {
  generated_at: string;
  default_season: number;
  seasons: SeasonSummary[];
}

export interface TeamRef {
  id: number;
  name: string;
  abbrev: string;
  logo: string;
  owner: string;
  division_id: number;
  nickname: string | null;
}

export interface Meta {
  generated_at: string;
  fetched_at: string;
  season: number;
  league_id: number;
  name: string;
  team_count: number;
  reg_season_weeks: number;
  playoff_team_count: number;
  playoff_seeding_rule: string;
  home_team_bonus: number;
  playoff_home_team_bonus: number;
  current_matchup_period: number;
  scoring_period_id: number;
  final_scoring_period: number;
  championship_week: number;
  season_over: boolean;
  season_started: boolean;
  completed_weeks: number[];
  starting_slots: string[];
  divisions: { id: number; name: string }[];
  previous_seasons: number[];
  teams: TeamRef[];
}

export interface StandingsRow {
  team_id: number;
  seed: number;
  final_rank: number;
  wins: number;
  losses: number;
  ties: number;
  record: string;
  win_pct: number;
  points_for: number | null;
  points_against: number | null;
  division_id: number;
  division_record: string;
  division_rank: number | null;
  games_back: number | null;
  cushion: number | null;
  streak: string;
  all_play_wins: number;
  all_play_losses: number;
  all_play_ties: number;
  all_play_record: string;
  all_play_pct: number | null;
  expected_wins: number | null;
  luck: number | null;
  lineup_points: number | null;
  optimal_points: number | null;
  coach_rating: number | null;
  bench_points_lost: number | null;
  consistency: number | null;
}

export interface Standings {
  generated_at: string;
  rows: StandingsRow[];
}

export interface PowerComponents {
  all_play: number;
  points_for: number;
  trend: number;
  roster: number;
}

export interface PowerRow {
  team_id: number;
  rank: number;
  score: number;
  movement: number | null;
  components: PowerComponents;
}

export interface Power {
  generated_at: string;
  weights: Record<string, number>;
  weeks: Record<string, PowerRow[]>;
  latest_week: number | null;
}

export type AwardTone = "gold" | "positive" | "neutral" | "negative";

export interface AwardMeta {
  label: string;
  points: number;
  description: string;
  tone: AwardTone;
}

export interface Award {
  week: number;
  key: string;
  team_id: number;
  value: number;
  detail: string;
}

export interface Superlatives {
  generated_at: string;
  awards_meta: Record<string, AwardMeta>;
  awards: Award[];
}

export interface LineupPlayer {
  player_id: number;
  name: string;
  position: string;
  slot: string;
  started: boolean;
  actual: number;
  projected: number | null;
  played: boolean;
}

export interface OptimalSlot {
  slot: string;
  player_id: number | null;
  player: string | null;
  points: number | null;
}

export interface MatchupSide {
  team_id: number;
  total: number;
  lineup_points: number;
  home_bonus: number;
  adjustment: number;
  is_home: boolean;
  optimal_points: number | null;
  coach_rating: number | null;
  bench_points_lost: number | null;
  optimal_lineup: OptimalSlot[];
  lineup: LineupPlayer[];
}

export interface Matchup {
  matchup_period: number;
  winner: "HOME" | "AWAY" | "TIE" | "UNDECIDED";
  is_playoff: boolean;
  playoff_tier: string;
  home: MatchupSide;
  away: MatchupSide | null;
}

export interface LateSwing {
  week: number;
  winner_team_id: number;
  loser_team_id: number;
  deficit_before_final_day: number;
  final_margin: number;
  key_player: string | null;
  key_player_points: number | null;
}

export interface WeekMatchups {
  generated_at: string;
  week: number;
  matchups: Matchup[];
  late_swings: LateSwing[];
}

export interface AllPlayWeek {
  wins: number;
  losses: number;
  ties: number;
  expected_wins: number;
  result: "W" | "L" | "T" | null;
}

export interface TeamWeekRow {
  week: number;
  points: number;
  lineup_points: number;
  opponent_id: number | null;
  opponent_points: number | null;
  result: "W" | "L" | "T";
  is_playoff: boolean;
  optimal_points: number | null;
  coach_rating: number | null;
  bench_points_lost: number | null;
  all_play: AllPlayWeek | null;
}

export interface ProjectionReportRow {
  player_id: number;
  name: string;
  position: string;
  starts: number;
  actual: number;
  projected: number;
  diff: number;
}

export interface UpcomingGame {
  matchup_period: number;
  opponent_id: number | null;
  is_home: boolean;
}

export interface TeamSeason {
  coach: {
    actual?: number;
    optimal?: number;
    rating?: number | null;
    bench_lost?: number;
  };
  all_play: {
    wins: number;
    losses: number;
    ties: number;
    pct: number | null;
    expected_wins: number;
    luck: number | null;
  };
}

export interface TeamData {
  team_id: number;
  weekly: TeamWeekRow[];
  projection_report: ProjectionReportRow[];
  upcoming: UpcomingGame[];
  season: TeamSeason;
}

export interface Teams {
  generated_at: string;
  league_weekly_avg: { week: number; avg: number | null }[];
  teams: TeamData[];
}

export type ActivityAction = "FA_ADDED" | "WAIVER_ADDED" | "DROPPED" | "TRADED";

export interface ActivityEvent {
  date: number;
  week: number;
  action: ActivityAction;
  team_id: number;
  player_id: number;
  player_name: string;
  bid: number;
  to_team_id: number | null;
}

export interface TradePlayer {
  player_id: number;
  name: string;
  from_team_id: number;
  to_team_id: number;
  post_trade_started_points: number;
}

export interface TradePick {
  pick: string;
  from_team_id: number;
  to_team_id: number;
}

export interface Trade {
  date: number;
  week: number;
  team_ids: number[];
  players: TradePlayer[];
  picks: TradePick[];
  source: "espn" | "manual";
  started_points_gained: Record<string, number>;
}

export type PickResolutionStatus = "unresolved" | "projected" | "resolved";

export interface PickOwnership {
  season: number;
  round: number;
  original_team_id: number;
  current_owner_id: number;
  via: string;
  status: PickResolutionStatus;
  overall_pick: number | null;
  player_id: number | null;
  player_name: string | null;
}

export interface Activity {
  generated_at: string;
  events: ActivityEvent[];
  trades: Trade[];
  pick_ownership: PickOwnership[];
}

export interface ScheduleEntry {
  matchup_period: number;
  home_id: number;
  away_id: number | null;
  winner: "HOME" | "AWAY" | "TIE" | "UNDECIDED";
  home_score: number;
  away_score: number;
  is_playoff: boolean;
  playoff_tier: string;
}

export interface Schedule {
  generated_at: string;
  entries: ScheduleEntry[];
}

export interface SimTeam {
  team_id: number;
  playoff_pct: number;
  playoff_se: number;
  title_pct: number;
  title_se: number;
  avg_final_wins: number;
  seed_dist: Record<string, number>;
  playoff_pct_if_win_next: number | null;
  playoff_pct_if_lose_next: number | null;
  playoff_pct_by_final_wins: Record<string, number>;
}

export type ProjectionSource = "espn" | "model";

export interface WeekLineupPlayer {
  player_id: number | null;
  name: string | null;
  position: string | null;
  slot: string;
  actual: number | null;
  projected: number | null;
  played: boolean;
}

export interface SimMatchup {
  matchup_period: number;
  home_id: number;
  away_id: number;
  home_current: number | null;
  away_current: number | null;
  home_projected: number;
  away_projected: number;
  home_win_pct: number;
  started: boolean;
  home_lineup: WeekLineupPlayer[];
  away_lineup: WeekLineupPlayer[];
  home_remaining: number;
  away_remaining: number;
  home_total_starters: number;
  away_total_starters: number;
  projection_source: ProjectionSource;
  playoff_impact_score: number;
}

export interface Sim {
  generated_at: string;
  n_sims: number;
  remaining_matchups: number;
  model: string;
  roster_strength_active: boolean;
  teams: SimTeam[];
  this_week_matchups: SimMatchup[];
}

export interface SwapRecord {
  wins: number;
  losses: number;
  ties: number;
}

export interface ScheduleSwap {
  generated_at: string;
  rows: { team_id: number; records: Record<string, SwapRecord> }[];
}

export interface H2HPair {
  team_a: number;
  team_b: number;
  a_wins: number;
  b_wins: number;
  ties: number;
}

export interface H2H {
  generated_at: string;
  pairs: H2HPair[];
}

export interface Positions {
  generated_at: string;
  positions: string[];
  league_avg: Record<string, number>;
  rows: { team_id: number; values: Record<string, { avg: number; diff: number } | null> }[];
}

export interface Recaps {
  generated_at: string;
  recaps: Record<string, string>;
}

export interface DraftPick {
  overall: number;
  round: number;
  round_pick: number;
  team_id: number;
  player_id: number | null; // null = manual entry we couldn't match to a player
  keeper: boolean;
  bid: number;
  name: string;
  position: string;
  // external dynasty market value — what grading is actually based on
  value: number | null;
  expected_value: number | null;
  value_diff: number | null;
  // informational only, not used for grading
  points: number | null;
  expected: number | null;
  diff: number | null;
}

export interface DraftGrade {
  team_id: number;
  grade: string;
}

export interface HaulGrade extends DraftGrade {
  total_value: number;
  share_pct: number | null;
}

export interface EfficiencyGrade extends DraftGrade {
  total_diff: number;
}

export interface Draft {
  generated_at: string;
  picks: DraftPick[];
  haul_grades: HaulGrade[];
  efficiency_grades: EfficiencyGrade[];
  valuation_available: boolean;
  valuation_updated_at: string | null;
  class_total_value: number | null;
  problems: string[];
}

export type BadgeType =
  | "champion"
  | "runner_up"
  | "reg_season_title"
  | "points_title"
  | "superlative_champion"
  | "best_coach_season"
  | "record_high_week"
  | "last_place"
  | "record_low_week"
  | "bench_king";

export interface Badge {
  type: BadgeType;
  season: number;
  detail: string;
  team_name_then: string;
}

export interface Badges {
  generated_at: string;
  badge_meta: Record<BadgeType, { label: string; tone: AwardTone }>;
  teams: Record<string, Badge[]>;
  /** Manual badges whose franchise no longer exists (2012-17 era). */
  unassigned: Badge[];
}

export type AcquiredVia = "draft" | "trade" | "waiver" | "fa" | "preexisting" | "unknown";
export type DepartedVia = "trade" | "dropped" | null;

export interface OwnershipStint {
  player_id: number;
  name: string;
  position: string;
  team_id: number;
  acquired_via: AcquiredVia;
  start_season: number;
  start_week: number;
  departed_via: DepartedVia;
  end_season: number | null;
  end_week: number | null;
  weeks_rostered: number;
  weeks_started: number;
  weeks_benched: number;
  /** Of weeks_started, how many actually had a real ESPN projection —
   * 2017 has none at all, so this is the honest denominator for any
   * over/under-projection stat (weeks_started would silently understate
   * the projection as 0 for weeks it never existed). */
  weeks_projected: number;
  points_started: number;
  points_projected_started: number;
  points_benched: number;
  /** Sum of actual points for just the weeks_projected weeks — the
   * matching numerator for points_projected_started, so the two can be
   * diffed without a season with no projections skewing the result. */
  points_started_projected_weeks: number;
  start_rate: number;
}

export interface OwnershipLeader {
  team_id: number;
  player_id: number;
  name: string;
  position: string;
  points_started: number;
  points_under_projection: number | null;
  weeks_rostered: number;
  weeks_started: number;
  start_rate: number;
  start_season: number;
  start_week: number;
  end_season: number | null;
  end_week: number | null;
}

export interface Ownership {
  generated_at: string;
  stints: OwnershipStint[];
  leaders: {
    value: OwnershipLeader[];
    busts: OwnershipLeader[];
    stashes: OwnershipLeader[];
  };
}

export type TradeValueSource = "snapshot" | "current_fallback" | "unavailable";

export interface TradeProductionSinceTrade {
  points_started: number;
  points_projected_started: number;
  weeks_started: number;
  still_held: boolean;
}

export interface TradeGradeAsset {
  player_id?: number | null;
  name?: string;
  pick?: string;
  from_team_id: number;
  to_team_id: number;
  value: number | null;
  value_source: TradeValueSource;
  /** Players only — absent (undefined) on pick assets. */
  production_since_trade?: TradeProductionSinceTrade | null;
  /** Players only — true if this player was traded again before this build,
   * in which case production_since_trade is intentionally omitted (their
   * value continues in that later trade's own grade instead). */
  flipped_again?: boolean;
}

export interface TradeValueSide {
  gained: number;
  lost: number;
  net: number;
}

export interface TradeGrade {
  id: string | null;
  season: number;
  date: number;
  week: number;
  team_ids: number[];
  players: TradeGradeAsset[];
  picks: TradeGradeAsset[];
  value_by_team: Record<string, TradeValueSide>;
  winner_team_id: number | null;
  has_estimated_asset: boolean;
  uses_current_value_fallback: boolean;
}

export interface TradeLedgerRow {
  team_id: number;
  gained: number;
  lost: number;
  net: number;
  trade_count: number;
}

export interface TradeGrades {
  generated_at: string;
  trades: TradeGrade[];
  valuation_available: boolean;
  valuation_updated_at: string | null;
  team_ledger: TradeLedgerRow[];
}

export interface PickFuturesEntry {
  season: number;
  round: number;
  original_team_id: number;
  current_owner_id: number;
  status: PickResolutionStatus;
  overall_pick: number | null;
  player_id: number | null;
  player_name: string | null;
  via: string;
}

export interface PickFutures {
  generated_at: string;
  board: PickFuturesEntry[];
}

export type SpectrumLabel = "Contending" | "Balanced" | "Rebuilding";

export interface SpectrumTeam {
  team_id: number;
  contending_value: number;
  dynasty_roster_value: number;
  future_pick_capital: number;
  rebuilding_value: number;
  ratio: number;
  label: SpectrumLabel;
}

export interface Spectrum {
  generated_at: string;
  redraft_valuation_updated_at: string | null;
  teams: SpectrumTeam[];
}
