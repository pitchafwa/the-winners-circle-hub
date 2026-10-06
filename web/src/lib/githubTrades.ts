/** Reads/writes ingest/manual_trades.json straight through GitHub's
 * Contents API, from the browser — the deployed site has no backend, so the
 * only way a static page can record a trade is to commit it itself. Needs a
 * fine-grained personal access token (this repo only; Contents + Actions
 * read/write) saved in this browser's localStorage by the LM Tools page —
 * never in the code, never sent anywhere except api.github.com.
 *
 * The file is the same one the old local-only tool (ingest/trade_tool.py)
 * wrote: trades[] plus pick_ownership[], the current-holder ledger every
 * traded future pick moves through. Writing a trade means appending to
 * trades[] AND upserting that ledger in the same commit — the ledger half
 * is what makes the Pick Futures board and pick pricing reflect the trade.
 * The data files themselves are rebuilt by the refresh workflow, not here. */

export const GITHUB_REPO = "pitchafwa/the-winners-circle-hub";
const FILE_PATH = "ingest/manual_trades.json";
const BRANCH = "main";
const TOKEN_KEY = "league-hub:v1:github-token";
const API = `https://api.github.com/repos/${GITHUB_REPO}`;

export interface ManualAsset {
  player?: string;
  pick?: string;
  from: number;
  to: number;
}

export interface ManualTrade {
  id: string;
  season: number;
  date: string;
  week: number;
  teams: number[];
  assets: ManualAsset[];
}

export interface PickLedgerEntry {
  season: number;
  round: number;
  original_team_id: number;
  owned_by_team_id: number;
  via: string;
  trade_id?: string;
}

export interface ManualTradesFile {
  trades: ManualTrade[];
  pick_ownership: PickLedgerEntry[];
  [key: string]: unknown;
}

export interface SubmitAsset {
  kind: "player" | "pick";
  from: number;
  to: number;
  playerName?: string;
  year?: number;
  round?: number;
  originalTeamId?: number;
}

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked — nothing to persist to */ }
}

async function gh(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  if (!token) throw new Error("No GitHub token saved yet — add one in the Token box above.");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) throw new Error("GitHub rejected the token (expired or mistyped) — replace it in the Token box.");
  if (res.status === 403 || res.status === 404) {
    throw new Error(`GitHub says no access (${res.status}) — check the token covers ${GITHUB_REPO} with Contents read/write.`);
  }
  return res;
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function load(): Promise<{ data: ManualTradesFile; sha: string }> {
  const res = await gh(`/contents/${FILE_PATH}?ref=${BRANCH}`);
  if (!res.ok) throw new Error(`Couldn't read manual_trades.json (HTTP ${res.status}).`);
  const body = await res.json();
  const data = JSON.parse(base64ToUtf8(body.content)) as ManualTradesFile;
  data.trades = data.trades ?? [];
  data.pick_ownership = data.pick_ownership ?? [];
  // Same migration the old Python tool did on load — a trade needs a stable id to be deletable.
  for (const t of data.trades) if (!t.id) t.id = newId();
  return { data, sha: body.sha };
}

async function save(data: ManualTradesFile, sha: string, message: string): Promise<void> {
  const res = await gh(`/contents/${FILE_PATH}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: utf8ToBase64(JSON.stringify(data, null, 2) + "\n"),
      sha,
      branch: BRANCH,
    }),
  });
  if (res.status === 409 || res.status === 422) {
    throw new Error("The file changed on GitHub while you were editing — reload the page and try again.");
  }
  if (!res.ok) throw new Error(`Couldn't save the trade (HTTP ${res.status}).`);
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

function ordinal(n: number): string {
  if (n % 100 >= 10 && n % 100 <= 20) return "th";
  return ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
}

/** Mirrors pick_tracking.upsert_pick_ownership: the ledger holds only the
 * CURRENT holder per (season, round, original team), overwritten in place. */
function upsertLedger(
  ledger: PickLedgerEntry[], year: number, round: number, originalTeamId: number,
  newOwnerId: number, via: string, tradeId?: string,
): void {
  const entry: PickLedgerEntry = {
    season: year, round, original_team_id: originalTeamId, owned_by_team_id: newOwnerId, via,
  };
  if (tradeId) entry.trade_id = tradeId;
  const i = ledger.findIndex((p) => p.season === year && p.round === round && p.original_team_id === originalTeamId);
  if (i >= 0) ledger[i] = entry;
  else ledger.push(entry);
}

export async function listTrades(): Promise<ManualTrade[]> {
  const { data } = await load();
  return [...data.trades].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export async function submitTrade(
  p: { season: number; date: string; week: number; assets: SubmitAsset[] },
): Promise<void> {
  if (p.assets.length === 0) throw new Error("Pick at least one player or pick to trade.");
  const { data, sha } = await load();
  const id = newId();
  const stored: ManualAsset[] = [];
  for (const a of p.assets) {
    if (a.kind === "player") {
      stored.push({ player: a.playerName!, from: a.from, to: a.to });
    } else {
      stored.push({ pick: `${a.year} ${a.round}${ordinal(a.round!)}`, from: a.from, to: a.to });
      upsertLedger(data.pick_ownership, a.year!, a.round!, a.originalTeamId!, a.to, `traded ${p.date}`, id);
    }
  }
  const teams = [...new Set(p.assets.flatMap((a) => [a.from, a.to]))].sort((x, y) => x - y);
  data.trades.push({ id, season: p.season, date: p.date, week: p.week, teams, assets: stored });
  await save(data, sha, `Add trade ${p.date} (via LM Tools)`);
}

/** Removes a trade and rolls back the ledger entries IT set — unless a later
 * trade already overwrote the same pick (the ledger keeps no history, so
 * there's nothing left of this one to undo). */
export async function deleteTrade(id: string): Promise<{ revertedPicks: number }> {
  const { data, sha } = await load();
  if (!data.trades.some((t) => t.id === id)) throw new Error(`No trade on file with id '${id}'.`);
  const before = data.pick_ownership.length;
  data.trades = data.trades.filter((t) => t.id !== id);
  data.pick_ownership = data.pick_ownership.filter((p) => p.trade_id !== id);
  await save(data, sha, `Remove trade ${id} (via LM Tools)`);
  return { revertedPicks: before - data.pick_ownership.length };
}

/** Kicks the refresh workflow so the site rebuilds now instead of waiting
 * for the next scheduled run. workflow_dispatch always runs for real (it
 * bypasses the game-window guard). Needs the token's Actions read/write. */
export async function rebuildSite(): Promise<void> {
  const res = await gh("/actions/workflows/refresh.yml/dispatches", {
    method: "POST",
    body: JSON.stringify({ ref: BRANCH }),
  });
  if (res.status !== 204) {
    throw new Error(`Couldn't start the rebuild (HTTP ${res.status}) — the token may be missing Actions read/write.`);
  }
}
