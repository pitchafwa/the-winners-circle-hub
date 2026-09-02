"""One-time-frozen, git-committed snapshot of badge/head-to-head facts for
every season that's genuinely done (`season_over`, and not the current
live `config.SEASON`).

Exists because `ingest/.cache/` (raw ESPN API responses) is a GitHub
Actions cache — evictable (7-day-unused, 10GB repo-wide cap) — and
`build_badges()`/`_all_time_h2h()` in build.py used to recompute straight
from that cache every single run. When a past season's cache entry got
evicted, its badges/h2h contribution silently vanished from the very
next run's output — even though that season's own per-page files
(standings.json, matchups/*.json, ...) sat on disk correct and untouched
the whole time. `built_seasons()` (see its own docstring in build.py)
already fixed the equivalent problem for `seasons.json` and the
backfill-skip logic; this file is the same fix for the two outputs that
docstring explicitly, and — it turned out — wrongly, left out: "badges/
h2h aggregation genuinely needs a fresh cache-backed parse.load_league()
per season" was true on 2026-08-25 when written, but stopped being true
the moment the historical-backfill loop started skipping any
already-built year regardless of whether its raw cache was still intact
(2026-08-31, to stop wasteful re-fetching / 429 flooding) — from that
point on, an evicted-and-never-refetched year's badges/h2h contribution
had no way to ever come back. Confirmed live, 2026-09-02: badges.json
had shrunk from 16 badges for team 10 (2026-08-25, full local rebuild)
down to 1 (every automated CI refresh since 2026-08-26).

A finished season's real result never changes, so once frozen here, it's
frozen forever — no future run should ever need that season's raw ESPN
cache again to reproduce its badges/h2h contribution. Only badges.json
and h2h.json are covered here; ownership.json has the same underlying
cache-eviction exposure but doesn't decompose into independent per-
season snapshots the same clean way (a player's ownership stint can
span a season boundary, carried in `open_stints` — freezing it needs a
different design). Flagged as a follow-up in BACKLOG.md, not fixed here.
"""
from __future__ import annotations

import json

import config

PATH = config.ROOT / "ingest" / "frozen_history.json"


def load() -> dict:
    if not PATH.exists():
        return {}
    with open(PATH, encoding="utf-8") as f:
        return json.load(f)


def save(data: dict) -> None:
    tmp = PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
    tmp.replace(PATH)


def freeze_season(data: dict, season: int, badges: list[dict], record_candidate: dict | None,
                   h2h: list[dict]) -> None:
    """Mutates `data` in place — caller decides when to persist via
    save(), so one run that freezes several seasons only writes the file
    once."""
    data[str(season)] = {"badges": badges, "record_candidate": record_candidate, "h2h": h2h}
