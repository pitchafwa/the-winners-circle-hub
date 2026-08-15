/** Raw entities extracted from pasted trade text — no ID resolution yet,
 * that happens server-side (locally) against real team/player data. */
export interface RawAsset {
  type: "player" | "pick";
  name?: string; // player
  round?: number; // pick
  year?: number | null; // pick — null means "implied next class"
  raw_text?: string; // pick — original phrase, shown in the review UI
}

export interface RawMovement {
  from: string; // team mention as written ("Tyus", "TrayLew", "dae"...)
  to: string;
  asset: RawAsset;
}

export interface RawExtraction {
  movements: RawMovement[];
}

/** Resolved against real data by trade_tool.py resolve. */
export interface ResolvedPlayerAsset {
  type: "player";
  raw_name: string;
  player_id: number | null;
  name: string;
  matched: boolean;
}

export interface ResolvedPickAsset {
  type: "pick";
  raw_text: string;
  year: number;
  year_assumed: boolean;
  round: number;
  original_team_id: number | null;
  original_team_id_ambiguous: boolean;
  original_team_id_assumed: boolean;
  candidates: number[];
}

export type ResolvedAsset = ResolvedPlayerAsset | ResolvedPickAsset;

export interface ResolvedMovement {
  from_raw: string;
  from_team_id: number | null;
  to_raw: string;
  to_team_id: number | null;
  asset: ResolvedAsset;
}

export interface ResolveResponse {
  season: number;
  teams: { id: number; name: string; nickname: string | null }[];
  movements: ResolvedMovement[];
}

export interface SubmitAssetPlayer {
  type: "player";
  player_id: number;
  name: string;
  raw_name: string;
  from: number;
  to: number;
}

export interface SubmitAssetPick {
  type: "pick";
  year: number;
  round: number;
  original_team_id: number;
  from: number;
  to: number;
}

export type SubmitAsset = SubmitAssetPlayer | SubmitAssetPick;

export interface SubmitPayload {
  season: number;
  date: string; // YYYY-MM-DD
  week: number;
  assets: SubmitAsset[];
}

export interface SubmitResponse {
  ok: boolean;
  rebuild_output: string;
}
