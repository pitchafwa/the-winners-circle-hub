export interface ParsedDraftPick {
  round: number;
  round_pick: number;
  original_owner_raw: string;
  drafting_team_raw: string;
  team_id: number | null;
  player_name_raw: string;
  player_id: number | null;
  player_name: string | null;
}

export interface DraftParseResponse {
  season: number;
  teams: { id: number; name: string; nickname: string | null }[];
  picks: ParsedDraftPick[];
  problems: string[];
  existing_file: boolean;
}

export type ParseDraftRequest =
  | { season: number; text: string; has_pick_column: boolean }
  | {
      season: number;
      picks: Pick<ParsedDraftPick, "round" | "round_pick" | "original_owner_raw" | "drafting_team_raw" | "player_name_raw">[];
    };

export interface DraftSubmitPayload {
  season: number;
  overwrite?: boolean;
  picks: ParsedDraftPick[];
}

export interface DraftSubmitResponse {
  ok: boolean;
  needs_overwrite?: boolean;
  message?: string;
  picks_written?: number;
  rebuild_output?: string;
}
