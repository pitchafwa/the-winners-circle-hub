import { post } from "./adminApi";
import type { DraftOrderActionResponse, DraftOrderResponse } from "../types/draftOrder";

export function getDraftOrder(season: number): Promise<DraftOrderResponse> {
  return post<DraftOrderResponse>("/api/draftorder/get", { season });
}

export function setDraftOrder(season: number, order: number[]): Promise<DraftOrderActionResponse> {
  return post<DraftOrderActionResponse>("/api/draftorder/set", { season, order });
}

export function clearDraftOrder(season: number): Promise<DraftOrderActionResponse> {
  return post<DraftOrderActionResponse>("/api/draftorder/clear", { season });
}
