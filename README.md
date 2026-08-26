# The Winner's Circle — League Hub

A fantasy-football almanac for ESPN league 29471 ("The Winner's Circle"). Python
pulls and computes everything offline into static JSON; a React site reads
that JSON and renders it. No live backend, no database — the whole site is
static files, refreshed on a schedule.

See [`DATA.md`](DATA.md) for the exact shape of every generated file, and the
comments atop `ingest/build.py` for how a build actually runs.

## Prerequisites

- **Python 3.12+** and **[uv](https://docs.astral.sh/uv/)** (dependency manager for `ingest/`)
- **Node.js** and **[pnpm](https://pnpm.io/)** (for `web/`)

If `uv` isn't found once installed, make sure its install directory is on
`PATH` for new shells — on Windows via winget this sometimes needs a shell
restart or a manual PATH entry.

## First-time setup

```bash
# Python side
cd ingest
uv sync

# Frontend side
cd ../web
pnpm install
```

**Optional — unlock 2012–2023 league history:** ESPN gates seasons that old
behind login, all the way back to 2012 (its `leagueHistory` endpoint serves
every past season once authenticated, not just 2018+). Copy `.env.example`
(repo root) to `.env` and fill in `ESPN_S2` / `SWID`, grabbed from your
browser's cookies while logged into `fantasy.espn.com` (DevTools →
Application/Storage → Cookies). Without this, everything from 2024 onward
still works fine — only that older window is affected.

## Running locally

```bash
cd web
pnpm dev
```

This pulls fresh data first *only if* `web/public/data/` is empty (a fresh
clone), then starts the site at **http://localhost:8888**. If data already
exists, it starts immediately — use `pnpm refresh` (below) to force a repull.

Equivalent `make dev` / `make refresh` targets exist at the repo root for
anyone with `make` installed, but they aren't the primary path — `uv` itself
isn't always on `PATH` in every shell (confirmed on Windows during this
project's own setup), so the pnpm scripts invoke the synced venv's Python
interpreter directly and are the more reliable option day to day.

## Re-pulling data without restarting the dev server

```bash
cd web
pnpm refresh
```

Runs the full ingest (fetch + compute + write JSON) for every cached season.
Vite serves `public/data/` live, so a browser reload picks up the refresh —
no restart needed. Pass `--offline` to `ingest/build.py` directly (from
`ingest/`) to rebuild from cache only, with no network calls at all.

## The admin tools (local only)

`/admin/trades` and `/admin/drafts` (password `password123` — a casual gate,
not real security) let you submit trades and draft results straight from the
running site. **These only work while running `pnpm dev` locally** — they
depend on a Vite dev-server middleware (`web/vite-plugins/admin-api.ts`) that
shells out to Python, which doesn't exist in a static production build.
Visiting those routes on the deployed site will load the page, but any
submit action will fail — there is no backend to receive it. If that's ever
wanted on the live site, it would need a real serverless function with its
own secret-holding infrastructure (a GitHub token with repo-write access, at
minimum) — treat this as a known limitation, not a bug, until/unless that's
built.

## Deploying

Live on **GitHub Pages** — `.github/workflows/deploy-pages.yml` builds and
deploys on every push to `main` (both real code pushes and `refresh.yml`'s
automated data-commit pushes trigger it, since both push to `main`).

GitHub Pages was chosen over Netlify specifically because it has no
per-deploy cost or limit — Netlify's credit-based pricing charges per
production deploy, which adds up fast against a refresh cadence of up to
~20 pushes on a single game day. See `deploy-pages.yml`'s own header for
the full reasoning.

One-time setup for a fresh clone of this repo:

1. **Push this repo to GitHub** (must be public, or a paid GitHub plan, for
   Pages to serve it).
2. **Enable Pages via GitHub Actions**: Settings → Pages → Build and
   deployment → Source → "GitHub Actions". Until this is set,
   `deploy-pages.yml`'s deploy step fails even though the build succeeds.
3. **If unlocking 2018–2023 history in CI**, add `ESPN_S2` and `SWID` as
   GitHub repository secrets (Settings → Secrets and variables → Actions).
4. **`WORKFLOW_PAT`** (a PAT with `workflow` scope) as a repo secret — needed
   by `update-refresh-schedule.yml` to push changes under
   `.github/workflows/` (the default `GITHUB_TOKEN` is blocked from that).
5. `refresh.yml`'s schedule is live by default — see that file's header for
   the generated per-game cron windows.

The site's base URL is a GitHub Pages *project* site
(`https://<owner>.github.io/the-winners-circle-hub/`), not a root domain —
`vite.config.ts`'s `base` and `main.tsx`'s router `basename` both key off
the `GITHUB_PAGES` env var `deploy-pages.yml` sets during the build.

## Project structure

```
league-hub/
├── ingest/          Python — fetch, compute, write JSON. Run offline.
│   ├── fetch.py          ESPN API calls, response caching
│   ├── parse.py          raw cache -> typed structures
│   ├── metrics.py        all derived stats (lineup solver, superlatives, ...)
│   ├── simulate.py       Monte Carlo playoff odds
│   ├── draft_order.py    rookie-draft pick-order projection
│   ├── pick_tracking.py  traded future-pick resolution
│   ├── valuation.py      external dynasty value lookup (draft grading)
│   ├── trade_tool.py     backs /admin/trades
│   ├── draft_tool.py     backs /admin/drafts
│   ├── build.py          entrypoint — writes web/public/data/
│   ├── manual_draft/     hand-entered rookie drafts (dynasty league drafts by text)
│   ├── manual_trades.json      hand-entered trades + pick-ownership ledger
│   ├── manual_badges.json      pre-2018 history + corrections to auto badges
│   └── owner_aliases.json      real names -> ESPN team_id
├── web/              Vite + React + TypeScript, static build
│   ├── public/data/       generated JSON — the only data source the UI reads
│   ├── vite-plugins/      local-dev-only admin API bridge
│   └── src/
├── .github/workflows/
│   ├── refresh.yml                  scheduled data refresh (real per-game cron)
│   ├── update-refresh-schedule.yml  weekly re-check of the real NFL schedule
│   └── deploy-pages.yml             build + deploy to GitHub Pages
└── DATA.md           the JSON contract — read this before touching schema
```
