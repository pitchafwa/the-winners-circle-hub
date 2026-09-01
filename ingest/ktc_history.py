"""Real historical KTC dynasty values — a daily archive going back to
2020-04-01, letting trade grades and draft grades price an asset at what it
was ACTUALLY worth on the day of the transaction, instead of valuation.py's
always-current snapshot.

Source: a community-maintained Google Sheet
(https://docs.google.com/spreadsheets/d/1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs,
tab "1QB Historical Data") that snapshots KTC's full 1QB dynasty rankings
once a day. Confirmed live 2026-08-31: 2,344 rows (2020-04-01 through the
day of the fetch), 464 named players plus 37 draft-pick columns already
shaped exactly like KTC's live "Early/Mid/Late" round-tier format
valuation.py's `pick_curve_by_year()` already knows how to interpolate
(`_TIER_ANCHOR_SLOT`/`_interpolate_round`, reused here rather than
reimplemented). This league is standard 1QB PPR with no TE premium
(confirmed against real scoring settings) — the plain "1QB" tab is correct;
the sheet's Superflex/TE+/TE++/TE+++ tabs are never used.

One-time fetch, cached forever — same immutable pattern as
fetch.fetch_history_raw() (`if path.exists(): return`, never re-fetched).
This is a real, but unofficial and community-run, external resource with no
uptime/permanence guarantee; pulling it once into our own repo means we're
never dependent on it staying up after that. If it's ever gone and we want
more recent days than what's already cached, that's a deliberate manual
re-fetch (delete the cache file, run online once), never automatic.

Missing means missing, never fabricated: a player/pick not in the archive
for a given date returns None from both lookup functions below, same
convention every other valuation source in this codebase already follows.
"""
from __future__ import annotations

import csv
import io
import json
from bisect import bisect_left
from datetime import date, datetime
from pathlib import Path

import requests

import config
from valuation import _TIER_ANCHOR_SLOT, _interpolate_round, _PICK_ENTRY_RE

SHEET_KEY = "1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs"
SHEET_GID = "699541356"  # "1QB Historical Data" tab
CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_KEY}/export?format=csv&gid={SHEET_GID}"
REQUEST_HEADERS = {"User-Agent": "Mozilla/5.0 (league-hub personal dynasty tool)"}

CACHE_PATH = config.CACHE_DIR / "ktc_history" / "1qb-daily.json"

# A real gap day (the sheet's own daily job skipped a day) or a trade/draft
# date landing on a day the sheet hadn't updated yet both resolve to the
# nearest real day on file within this tolerance, rather than failing outright.
NEAREST_DAY_TOLERANCE = 3


def _fetch_and_parse() -> dict:
    """One real HTTP GET, no auth (confirmed: publicly shared, "Anyone with
    the link"). Returns the compact columnar cache shape written to disk —
    see module docstring. Dates ascending (oldest first) for bisect lookups;
    the sheet itself lists newest-first."""
    r = requests.get(CSV_URL, headers=REQUEST_HEADERS, timeout=60)
    r.raise_for_status()
    rows = list(csv.reader(io.StringIO(r.text)))
    header, data_rows = rows[0], rows[1:]
    data_rows.reverse()  # oldest first

    date_cols = header[1:]
    player_cols: list[tuple[int, str]] = []
    pick_cols: list[tuple[int, str]] = []
    for i, col in enumerate(date_cols, start=1):
        (pick_cols if _PICK_ENTRY_RE.match(col) else player_cols).append((i, col))

    dates: list[str] = []
    players: dict[str, list[float | None]] = {name: [] for _, name in player_cols}
    picks: dict[str, list[float | None]] = {name: [] for _, name in pick_cols}

    from parse import _normalize_name  # local import: avoid a circular import at module load

    players_norm = {name: _normalize_name(name) for _, name in player_cols}
    # last-normalized-name-wins on a rare collision is acceptable here — the
    # same tolerance every other by-name crosswalk in this codebase already has.
    normalized_players: dict[str, list[float | None]] = {}

    for row in data_rows:
        d = row[0]
        try:
            datetime.strptime(d, "%Y-%m-%d")
        except ValueError:
            continue  # a stray non-date row (e.g. a trailing blank line) — skip, don't crash
        dates.append(d)
        for i, name in player_cols:
            raw = row[i] if i < len(row) else ""
            players[name].append(float(raw) if raw.strip() else None)
        for i, name in pick_cols:
            raw = row[i] if i < len(row) else ""
            picks[name].append(float(raw) if raw.strip() else None)

    for name, series in players.items():
        normalized_players[players_norm[name]] = series

    return {"dates": dates, "players": normalized_players, "picks": picks}


def _write_cache(data: dict) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CACHE_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    tmp.replace(CACHE_PATH)


def ensure_fetched(offline: bool = False) -> bool:
    """One-time fetch — does nothing if the cache already exists (immutable,
    matches fetch.fetch_history_raw()'s "if path.exists(): return" pattern
    exactly, for exactly the same reason: this data never needs a second
    fetch once captured). Returns True if a live fetch actually happened."""
    if CACHE_PATH.exists():
        return False
    if offline:
        return False
    data = _fetch_and_parse()
    _write_cache(data)
    return True


def is_available() -> bool:
    return CACHE_PATH.exists()


_cache: dict | None = None


def _load() -> dict | None:
    global _cache
    if _cache is not None:
        return _cache
    if not CACHE_PATH.exists():
        return None
    with open(CACHE_PATH, encoding="utf-8") as f:
        _cache = json.load(f)
    return _cache


def _nearest_date_index(dates: list[str], target: str) -> int | None:
    """Index of the closest date on file to `target`, within
    NEAREST_DAY_TOLERANCE days. `dates` is ascending. None if `target` is
    further from every date on file than the tolerance allows (e.g. a trade
    from 2019, before the archive starts at all)."""
    i = bisect_left(dates, target)
    candidates = [j for j in (i - 1, i) if 0 <= j < len(dates)]
    if not candidates:
        return None
    target_d = date.fromisoformat(target)
    best = min(candidates, key=lambda j: abs((date.fromisoformat(dates[j]) - target_d).days))
    if abs((date.fromisoformat(dates[best]) - target_d).days) > NEAREST_DAY_TOLERANCE:
        return None
    return best


def value_on_date(name: str, iso_date: str) -> float | None:
    """Real KTC 1QB dynasty value for a player, on (or within
    NEAREST_DAY_TOLERANCE days of) the given date. None if the archive has
    no entry at all for this player (never ranked, or a name the crosswalk
    can't resolve) or the date is out of range — never fabricated."""
    data = _load()
    if data is None:
        return None
    from parse import _normalize_name

    series = data["players"].get(_normalize_name(name))
    if series is None:
        return None
    idx = _nearest_date_index(data["dates"], iso_date)
    if idx is None:
        return None
    return series[idx]


def _curve_on_date(pick_year: int, round_: int, iso_date: str) -> list[float] | None:
    """The full 10-pick interpolated curve for one round OF `pick_year`'s
    draft class, read off the archive row nearest `iso_date` — same
    `_interpolate_round()` math valuation.py's live curve uses, against a
    historical day's Early/Mid/Late anchors instead of today's.

    `pick_year` (which draft class — the COLUMN) and `iso_date` (which day's
    snapshot — the ROW) are deliberately two different things: a traded pick
    is very often a FUTURE class relative to the trade itself (e.g. a
    "2026 1st" traded in November 2025), so the column to read is the
    pick's own designated year, never derived from the lookup date. Using
    the lookup date's year for both was a real bug caught during
    verification — every future-year pick in a real trade came back
    `None` even though the archive plainly had that data on the trade's own
    date, because it was reading "<trade year> Early 1st" (never a real
    column) instead of "<pick's own year> Early 1st".

    None if that round has fewer than 2 tiers on file for the nearest date
    (can't interpolate — either genuinely too far out for KTC to have
    ranked yet, or the date is out of the archive's range)."""
    data = _load()
    if data is None:
        return None
    idx = _nearest_date_index(data["dates"], iso_date)
    if idx is None:
        return None
    anchors: dict[int, float] = {}
    for tier, slot in _TIER_ANCHOR_SLOT.items():
        col = f"{pick_year} {tier} {_ordinal(round_)}"
        series = data["picks"].get(col)
        if series is not None and series[idx] is not None:
            anchors[slot] = series[idx]
    if len(anchors) < 2:
        return None
    return _interpolate_round(anchors)


def pick_value_on_date(pick_year: int, round_: int, round_pick: int, iso_date: str) -> float | None:
    """Real KTC value for one exact pick slot (1-10 within `round_` of
    `pick_year`'s class) on (or near) the given date — for a real draft
    pick, which lands at one known slot. See _curve_on_date() for the None
    cases."""
    if not (1 <= round_pick <= 10):
        return None
    curve = _curve_on_date(pick_year, round_, iso_date)
    return curve[round_pick - 1] if curve else None


def pick_round_average_on_date(pick_year: int, round_: int, iso_date: str) -> float | None:
    """Average value across all 10 slots of a round (of `pick_year`'s
    class), on (or near) the given date — for a TRADED pick, which is
    usually "a 2nd" with no known exact slot yet (the season isn't over,
    draft order isn't set). Same "average across the round" convention
    trade_grades.py's old `_round_average()` used against the live curve."""
    curve = _curve_on_date(pick_year, round_, iso_date)
    return round(sum(curve) / len(curve), 1) if curve else None


def _ordinal(n: int) -> str:
    suffix = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"
