import { useRef, useState } from "react";
import PasswordGate from "../components/PasswordGate";
import { clearJsonCache } from "../lib/data";
import { exportBundle, importBundle } from "../lib/dataAdminApi";
import type { ExportBundle } from "../types/dataAdmin";

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

type Stage = "idle" | "exporting" | "importing" | "done";

export default function DataAdminPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [rebuildLog, setRebuildLog] = useState("");
  const [filesWritten, setFilesWritten] = useState<string[]>([]);

  const doExport = async () => {
    setError(null);
    setStage("exporting");
    try {
      const bundle = await exportBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `league-hub-backup-${todayStamp()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStage("idle");
    } catch (e) {
      setError((e as Error).message);
      setStage("idle");
    }
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file next time
    if (!file) return;

    setError(null);
    let bundle: ExportBundle;
    try {
      const text = await file.text();
      bundle = JSON.parse(text) as ExportBundle;
      if (bundle.app !== "league-hub") {
        throw new Error("not a league-hub backup file");
      }
    } catch {
      setError("Invalid backup file. Make sure you selected a League Hub export.");
      return;
    }

    const fileCount = Object.values(bundle.files ?? {}).filter((v) => v !== null).length
      + Object.keys(bundle.manual_draft_files ?? {}).length;
    const when = bundle.exported_at ? new Date(bundle.exported_at).toLocaleString() : "an unknown time";
    const ok = window.confirm(
      `Replace trades, draft order overrides, badges, owner aliases, and manual draft entries `
      + `(${fileCount} files) with this backup from ${when}? This rebuilds the entire site and can't be undone here.`,
    );
    if (!ok) return;

    setStage("importing");
    try {
      const res = await importBundle(bundle);
      setRebuildLog(res.rebuild_output);
      setFilesWritten(res.files_written);
      clearJsonCache();
      setStage("done");
    } catch (e) {
      setError((e as Error).message);
      setStage("idle");
    }
  };

  return (
    <PasswordGate>
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2>Backup &amp; restore</h2>
          <span className="label">every hand-entered data file — trades, draft order, badges, owner names, manual drafts</span>
        </div>

        <p className="muted" style={{ marginBottom: "1.25rem", maxWidth: "48ch" }}>
          Everything else in the app is computed from these files plus the ESPN cache, so this backup
          is the one thing worth keeping a copy of. Import restores from a previous export and rebuilds
          the whole site from it.
        </p>

        {error && <div className="error-state" style={{ marginBottom: "1rem" }}>{error}</div>}

        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="control"
            style={{ cursor: stage === "exporting" ? "not-allowed" : "pointer", background: "var(--paper-2)" }}
            disabled={stage === "exporting"}
            onClick={doExport}
          >
            {stage === "exporting" ? "Exporting..." : "Export backup"}
          </button>

          <button
            className="control"
            style={{ cursor: stage === "importing" ? "not-allowed" : "pointer", background: "var(--paper-2)" }}
            disabled={stage === "importing"}
            onClick={() => fileInputRef.current?.click()}
          >
            {stage === "importing" ? "Importing..." : "Import backup"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={onFilePicked}
          />
        </div>

        {stage === "done" && (
          <div style={{ marginTop: "1.5rem" }}>
            <p className="pos" style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>
              Restored and rebuilt — {filesWritten.length} file{filesWritten.length === 1 ? "" : "s"} written.
            </p>
            <details>
              <summary className="label" style={{ cursor: "pointer" }}>files written</summary>
              <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.4rem" }}>{filesWritten.join(", ")}</p>
            </details>
            <details style={{ marginTop: "0.5rem" }}>
              <summary className="label" style={{ cursor: "pointer" }}>build output</summary>
              <pre className="mono" style={{ fontSize: "0.75rem", whiteSpace: "pre-wrap", marginTop: "0.5rem" }}>
                {rebuildLog}
              </pre>
            </details>
          </div>
        )}
      </section>
    </PasswordGate>
  );
}
