"""One-time-frozen, git-committed snapshot of `ownership.py`'s per-season
roster-ownership-timeline state, for every season that's genuinely done
(`season_over`, and not the current live `config.SEASON`).

Same root cause and same fix shape as `frozen_history.py` (badges/h2h) —
`ownership.build_ownership()` also reads straight from `ingest/.cache/`
(raw ESPN API responses) per season, an evictable GitHub Actions cache
(7-day-unused, 10GB repo-wide cap). `frozen_history.py`'s own docstring
flagged this exact exposure for `ownership.json` as a known, deliberately
unfixed gap when it shipped — "doesn't decompose into independent per-
season snapshots the same clean way (a player's ownership stint can span
a season boundary, carried in `open_stints` — freezing it needs a
different design)." Confirmed live, 2026-09-09: Tommy — "the dropdown is
showing the option for all the years but the app is again only looking
back to 2024ish for things like roster legends" — exactly this failure
mode, for exactly the reason flagged.

**The different design**: a stint spanning a season boundary can't be
frozen as an independent per-season fact the way one badge or one h2h
record can — so this freezes the FULL RESUMABLE STATE as of the end of
each season instead: every stint that CLOSED during that season (a
small, real delta — same shape `stints[]` already has), plus the
`open_stints` dict (still-active stints, keyed by player_id) as it stood
at that exact moment. A later run replays a frozen season by extending
`stints[]` with its closed delta and OVERWRITING `open_stints` with its
frozen state — exactly reproducing where `build_ownership()`'s loop
would have been after really processing that season, without needing
that season's raw cache to get there. The very next unfrozen season then
resumes the live per-week computation from that replayed `open_stints`
state, same as if every prior season had just been computed fresh.

A finished season's real result never changes, so once frozen here, it's
frozen forever — no future run should ever need that season's raw ESPN
cache again to reproduce its ownership contribution.
"""
from __future__ import annotations

import json

import config

PATH = config.ROOT / "ingest" / "frozen_ownership.json"


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


def freeze_season(data: dict, season: int, closed_stints: list[dict],
                   open_stints: dict[int, dict]) -> None:
    """Mutates `data` in place — caller decides when to persist via
    save(), so one run that freezes several seasons only writes the file
    once. `open_stints` keys are stringified for JSON; `load()`'s caller
    is responsible for converting them back to int player_ids."""
    data[str(season)] = {
        "closed_stints": closed_stints,
        "open_stints": {str(pid): st for pid, st in open_stints.items()},
    }
