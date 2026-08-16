import { post } from "./adminApi";
import type {
  DeleteTradeResponse,
  ListTradesResponse,
  RawMovement,
  ReassignPickPayload,
  ReassignPickResponse,
  ResolveResponse,
  SubmitPayload,
  SubmitResponse,
} from "../types/trade";

export function resolveTradeMovements(season: number, movements: RawMovement[]): Promise<ResolveResponse> {
  return post<ResolveResponse>("/api/trade/resolve", { season, movements });
}

export function submitTrade(payload: SubmitPayload): Promise<SubmitResponse> {
  return post<SubmitResponse>("/api/trade/submit", payload);
}

export function listTrades(): Promise<ListTradesResponse> {
  return post<ListTradesResponse>("/api/trade/list", {});
}

export function deleteTrade(id: string): Promise<DeleteTradeResponse> {
  return post<DeleteTradeResponse>("/api/trade/delete", { id });
}

export function reassignPick(payload: ReassignPickPayload): Promise<ReassignPickResponse> {
  return post<ReassignPickResponse>("/api/trade/reassign_pick", payload);
}
