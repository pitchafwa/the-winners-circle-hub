export interface ExportBundle {
  app: "league-hub";
  exported_at: string;
  files: Record<string, unknown>;
  manual_draft_files: Record<string, string>;
}

export interface ImportResponse {
  ok: boolean;
  files_written: string[];
  rebuild_output: string;
}
