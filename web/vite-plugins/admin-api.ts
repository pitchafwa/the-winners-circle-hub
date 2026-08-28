import type { Plugin, ViteDevServer } from "vite";
import { spawnSync } from "node:child_process";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url)); // .../web/vite-plugins
const INGEST_DIR = path.resolve(PLUGIN_DIR, "..", "..", "ingest"); // .../league-hub/ingest
const PYTHON = path.join(INGEST_DIR, ".venv", "Scripts", "python.exe");

// URL /api/<tool>/<subcommand> -> `python <tool>_tool.py <subcommand>`.
// Whitelisted explicitly — never derive a script path from unchecked user input.
const TOOLS: Record<string, { script: string; subcommands: string[] }> = {
  trade: { script: "trade_tool.py", subcommands: ["resolve", "submit", "list", "delete", "reassign_pick"] },
  draft: { script: "draft_tool.py", subcommands: ["parse", "submit"] },
  draftorder: { script: "draft_order_tool.py", subcommands: ["get", "set", "clear"] },
  data: { script: "data_tool.py", subcommands: ["export", "import"] },
  analyzer: { script: "trade_analyzer_tool.py", subcommands: ["simulate_trade", "buy_low_targets", "league_positions", "trade_partners"] },
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function runTool(script: string, subcommand: string, payload: string): { status: number; body: string } {
  const result = spawnSync(PYTHON, [path.join(INGEST_DIR, script), subcommand], {
    cwd: INGEST_DIR,
    input: payload,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    return { status: 500, body: JSON.stringify({ error: String(result.error) }) };
  }
  const out = (result.stdout || "").trim();
  if (result.status !== 0) {
    return { status: 500, body: out || JSON.stringify({ error: result.stderr }) };
  }
  return { status: 200, body: out };
}

/** Local-dev-only bridge: browser -> Python *_tool.py scripts under ingest/.
 * Never runs in a production build — this app has no live backend once
 * deployed, so the admin tools (trade submission, draft entry) only work
 * when running `pnpm dev` against the checked-out repo. */
export default function adminApiPlugin(): Plugin {
  return {
    name: "admin-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/([a-z]+)\/([a-z_]+)$/);
        if (!match) return next();
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "POST only" }));
          return;
        }
        const [, toolName, subcommand] = match;
        const tool = TOOLS[toolName];
        if (!tool || !tool.subcommands.includes(subcommand)) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "unknown admin endpoint" }));
          return;
        }
        try {
          const body = await readBody(req);
          const { status, body: outBody } = runTool(tool.script, subcommand, body);
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(outBody);
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}
