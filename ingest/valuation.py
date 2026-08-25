"""External player values — independent baselines for draft grading and the
contend/rebuild spectrum. Two sources, same site, same page structure:

- **Dynasty** (`keeptradecut.com/dynasty-rankings`) — long-term keeper/trade
  asset value. Backs the draft report card, trade grades, and the "held
  assets" side of the contend/rebuild spectrum.
- **Redraft** (`keeptradecut.com/fantasy-rankings`) — this-season value
  (their `oneQBValues.value`/`startSitValue` fields carry ADP/start-sit
  context here, not dynasty trade context, even though the field names are
  shared across both pages). Backs the "contending" side of the
  contend/rebuild spectrum — a team's CURRENT roster judged on what it's
  worth to win NOW, not what it'll be worth in three years.

Fixes a structural bug in a same-draft self-referential model for the
dynasty case: matching the k-th drafted player against the k-th BEST
OUTCOME (fully resorted by value) is a zero-sum permutation of one team's
own picks against itself, so a team that drafts several elite players at
one position can see its own LATER pick's high output "steal" the expected
value from its own EARLIER pick — punishing exactly the GMs who dominated
a position. An external market value removes the self-reference entirely.

Not season-scoped — one snapshot serves every season's draft grade, since
the question ("how good is this asset today") is inherently a today
question, not a historical one. Per user decision: DECAY IS HANDLED BY
NORMALIZING WITHIN EACH SEASON'S OWN DRAFT CLASS (share of that class's
total current value), never by comparing raw values across different
draft years — a rookie class from several years ago will naturally show
lower raw value today than a fresh one (careers end), and that is not a
reflection of draft skill.

Both source pages embed their full player list as a JS array directly in
the server-rendered HTML — no JS execution needed, confirmed by fetching
with plain requests and grepping for it. If a page's structure ever
changes, this fails loudly (no fake data) and falls back to the last
successful cache.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import config

MIN_REFETCH_INTERVAL = timedelta(hours=12)  # be polite; values don't move that fast
REQUEST_HEADERS = {"User-Agent": "Mozilla/5.0 (league-hub personal dynasty tool)"}


@dataclass(frozen=True)
class _Source:
    url: str
    cache_path: Path


DYNASTY = _Source(
    url="https://keeptradecut.com/dynasty-rankings",
    cache_path=config.CACHE_DIR / "valuation" / "dynasty-rankings.json",
)
REDRAFT = _Source(
    url="https://keeptradecut.com/fantasy-rankings",
    cache_path=config.CACHE_DIR / "valuation" / "fantasy-rankings.json",
)


def _parse_players_array(html: str) -> list[dict]:
    m = re.search(r"var playersArray = (\[.*?\]);", html, re.DOTALL)
    if not m:
        raise ValueError("player list not found in valuation source page — site structure may have changed")
    return json.loads(m.group(1))


def _fetch_fresh(source: _Source) -> list[dict]:
    r = requests.get(source.url, headers=REQUEST_HEADERS, timeout=20)
    r.raise_for_status()
    return _parse_players_array(r.text)


def _read_cache(source: _Source) -> tuple[list[dict], datetime] | None:
    if not source.cache_path.exists():
        return None
    with open(source.cache_path, encoding="utf-8") as f:
        envelope = json.load(f)
    return envelope["players"], datetime.fromisoformat(envelope["fetched_at"])


def _write_cache(source: _Source, players: list[dict], fetched_at: datetime) -> None:
    source.cache_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = source.cache_path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"fetched_at": fetched_at.isoformat(), "players": players}, f)
    tmp.replace(source.cache_path)


def _get_players(source: _Source, offline: bool = False) -> tuple[list[dict], str | None]:
    """Returns (players, fetched_at_iso). players is [] if nothing is
    available yet — callers must treat that as an explicit missing-data
    state, never fabricate values."""
    cached = _read_cache(source)

    if not offline:
        stale = cached is None or (datetime.now(timezone.utc) - cached[1]) > MIN_REFETCH_INTERVAL
        if stale:
            try:
                players = _fetch_fresh(source)
                now = datetime.now(timezone.utc)
                _write_cache(source, players, now)
                return players, now.isoformat()
            except Exception as e:  # noqa: BLE001 — network/parse failure: fall back, don't crash the build
                print(f"Valuation fetch failed ({e}); using cached values" if cached else
                      f"Valuation fetch failed ({e}); no cache available", flush=True)

    if cached:
        return cached[0], cached[1].isoformat()
    return [], None


def get_players(offline: bool = False) -> tuple[list[dict], str | None]:
    """Dynasty players — kept for backwards compatibility with existing callers."""
    return _get_players(DYNASTY, offline)


def values_by_name(offline: bool = False) -> tuple[dict[str, int], str | None]:
    """normalized_name -> 1QB dynasty value (0-9999). Players outside the
    source's ranked universe (essentially all D/ST and K, and deep
    dart-throws) are simply absent — callers should treat a missing lookup
    as 0, which is an honest read: the market judges these to carry no
    meaningful dynasty asset value."""
    from parse import _normalize_name  # local import: avoid a circular import at module load

    players, fetched_at = _get_players(DYNASTY, offline)
    values = {_normalize_name(p["playerName"]): p["oneQBValues"]["value"] for p in players}
    return values, fetched_at


def redraft_values_by_name(offline: bool = False) -> tuple[dict[str, int], str | None]:
    """normalized_name -> 1QB REDRAFT (this-season) value (0-9999), from
    keeptradecut.com/fantasy-rankings — a separate page from dynasty-rankings,
    priced on this-season production/ADP context rather than long-term
    keeper value. Same missing-player convention as values_by_name: absent
    means the market assigns no meaningful redraft value (D/ST, K, deep
    bench dart-throws), never fabricated as 0 vs. actually-unranked."""
    from parse import _normalize_name  # local import: avoid a circular import at module load

    players, fetched_at = _get_players(REDRAFT, offline)
    values = {_normalize_name(p["playerName"]): p["oneQBValues"]["value"] for p in players}
    return values, fetched_at
