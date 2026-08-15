import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ingestDir = path.resolve(webDir, "..", "ingest");
// `uv` itself isn't reliably on PATH in every shell even when installed
// (hit exactly this on Windows) — invoke the synced venv's interpreter
// directly instead, same approach the admin-api Vite plugin already uses.
const pythonPath = path.join(
  ingestDir, ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);

export function runIngest() {
  const result = spawnSync(pythonPath, ["build.py"], {
    cwd: ingestDir,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Couldn't run the ingest venv at ${pythonPath}`);
    console.error("Run `uv sync` inside ingest/ first (see README.md).");
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("Ingest failed — see output above.");
    process.exit(result.status ?? 1);
  }
}
