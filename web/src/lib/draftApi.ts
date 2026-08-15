import { post } from "./adminApi";
import type { DraftParseResponse, DraftSubmitPayload, DraftSubmitResponse, ParseDraftRequest } from "../types/draftAdmin";

export function parseDraft(request: ParseDraftRequest): Promise<DraftParseResponse> {
  return post<DraftParseResponse>("/api/draft/parse", request);
}

export function submitDraft(payload: DraftSubmitPayload): Promise<DraftSubmitResponse> {
  return post<DraftSubmitResponse>("/api/draft/submit", payload);
}
