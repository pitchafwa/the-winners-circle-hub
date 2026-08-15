import { post } from "./adminApi";
import type { RawMovement, ResolveResponse, SubmitPayload, SubmitResponse } from "../types/trade";

export function resolveTradeMovements(season: number, movements: RawMovement[]): Promise<ResolveResponse> {
  return post<ResolveResponse>("/api/trade/resolve", { season, movements });
}

export function submitTrade(payload: SubmitPayload): Promise<SubmitResponse> {
  return post<SubmitResponse>("/api/trade/submit", payload);
}
