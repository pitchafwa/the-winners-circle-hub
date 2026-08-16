export type DraftOrderSource = "override" | "computed" | "none";

export interface DraftOrderResponse {
  season: number;
  order: number[];
  source: DraftOrderSource;
  teams: { id: number; name: string; nickname: string | null }[];
}

export interface DraftOrderActionResponse {
  ok: boolean;
  rebuild_output: string;
}
