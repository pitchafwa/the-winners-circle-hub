import { post } from "./adminApi";
import type { ExportBundle, ImportResponse } from "../types/dataAdmin";

export function exportBundle(): Promise<ExportBundle> {
  return post<ExportBundle>("/api/data/export", {});
}

export function importBundle(bundle: ExportBundle): Promise<ImportResponse> {
  return post<ImportResponse>("/api/data/import", bundle);
}
