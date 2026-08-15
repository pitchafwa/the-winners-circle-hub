// Cross-platform equivalent of the Makefile's "ingest once if empty" step —
// used by `pnpm dev` so Windows users without `make` installed get the same
// one-command experience described in the README.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runIngest } from "./run-ingest.mjs";

const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const marker = path.join(webDir, "public", "data", "seasons.json");

if (!existsSync(marker)) {
  console.log("No data yet — running the ingest once...");
  runIngest();
} else {
  console.log("Data already present — skipping ingest (run `pnpm refresh` to re-pull).");
}
