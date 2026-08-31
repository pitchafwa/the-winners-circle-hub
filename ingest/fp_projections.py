"""FantasyPros weekly player projections (v2 public API, authenticated by
API key) — shown next to ESPN's own projection on the My Team roster,
gated behind LM Tools (same password gate as the rest of that menu). A
second opinion, not a replacement: this is FantasyPros' generic PPR
consensus, not scored against this league's exact custom rules (home-team
bonus, any non-standard scoring items) the way ESPN's own projection is.

**The 10-result cap, confirmed live 2026-08-31**: every browse-style call
to `/projections` (or `/players`) — with or without `position`, `week`,
`limit`, `page`, `offset`, whatever — truncates to exactly 10 players,
regardless of what the response's own `count` field claims. This is a
real free-tier limit, not a pagination param this module was missing:
downloaded and read the actual OpenAPI spec, no `limit`/`page`/`offset`
parameter exists on this endpoint at all. The one thing that DOES work:
an explicit `players=<id1>:<id2>:...` request for specific FantasyPros
player ids returns real data for exactly those ids (tested with players
outside the top-10 browse, e.g. Brock Purdy, Kyler Murray — both came
back with real, non-fabricated projections) — but that same 10-cap still
applies per CALL even to a targeted list (11+ requested ids still only
returns 10), so covering a real roster means chunking requested ids into
batches of <=10 and issuing one call per batch, not one call per
position.

Getting from an ESPN player to a FantasyPros player id in the first
place doesn't cost anything against the 50-req/day budget either: it
reuses valuation.py's existing free HTML-scrape crosswalk
(`fantasypros_player_ids_by_name()`), not the rate-limited API — that
scrape already runs every build for the redraft valuation feature, so
this is a zero-cost lookup layered on top of an existing fetch.

Actual budget: <=10 players per real API call, chunked per position for
however many of this league's rostered players FantasyPros has an id
for (typically full coverage — its cheat-sheet universe runs ~517 deep,
essentially every fantasy-relevant player). A 10-team league's ~150-180
rostered players is roughly 15-18 calls to cover in full, comfortably
inside the 50/day cap even refetched twice a day (MIN_REFETCH_INTERVAL
below, same "be polite" convention valuation.py already uses).

Current season only: `points_by_pid()` is only ever called from
build.py's live-roster-card path, which itself only runs for the season
still being played — a finished season has no "this week's projection"
to show, same reasoning roster.json itself is skipped for a season_over
league.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import config

BASE_URL = "https://api.fantasypros.com/public/v2/json/nfl"
REQUEST_HEADERS = {"User-Agent": "Mozilla/5.0 (league-hub personal dynasty tool)"}
MIN_REFETCH_INTERVAL = timedelta(hours=12)  # be polite; well inside the 50/day cap either way
CHUNK_SIZE = 10  # the hard per-call result cap — see module docstring


def _cache_path(season: int, week: int) -> Path:
    return config.CACHE_DIR / "fp_projections" / f"{season}-wk{week}.json"


MAX_CALLS_PER_FETCH = 45  # hard ceiling well under the 50/day account cap, even if a bug ever
                          # inflated ids_by_position far past a normal ~150-180-player roster set


def _fetch_chunk(season: int, week: int, position: str, ids: list[int]) -> list[dict]:
    r = requests.get(
        f"{BASE_URL}/{season}/projections",
        params={"position": position, "week": week, "players": ":".join(str(i) for i in ids)},
        headers={**REQUEST_HEADERS, "x-api-key": config.FANTASYPROS_API_KEY},
        timeout=20,
    )
    if r.status_code == 429:
        time.sleep(3)  # a short burst-rate limiter, separate from the 50/day account cap — one retry clears it
        r = requests.get(
            f"{BASE_URL}/{season}/projections",
            params={"position": position, "week": week, "players": ":".join(str(i) for i in ids)},
            headers={**REQUEST_HEADERS, "x-api-key": config.FANTASYPROS_API_KEY},
            timeout=20,
        )
    r.raise_for_status()
    return r.json().get("players", [])


def _fetch_all(season: int, week: int, ids_by_position: dict[str, list[int]]) -> dict[str, float]:
    """fpid (as string) -> points_ppr, fetched in <=10-id chunks per
    position — see module docstring for why one request per position
    alone isn't enough. Each chunk fails independently (a bad chunk
    doesn't cost the whole fetch whatever earlier chunks already got),
    and MAX_CALLS_PER_FETCH hard-stops well short of the account's real
    50/day cap regardless of how many ids were actually passed in."""
    all_chunks = [
        (position, ids[i:i + CHUNK_SIZE])
        for position, ids in ids_by_position.items()
        for i in range(0, len(ids), CHUNK_SIZE)
    ]
    if len(all_chunks) > MAX_CALLS_PER_FETCH:
        print(f"  FantasyPros projections: {len(all_chunks)} chunks needed, "
              f"capping at {MAX_CALLS_PER_FETCH} to stay well inside the daily request limit")
        all_chunks = all_chunks[:MAX_CALLS_PER_FETCH]

    out: dict[str, float] = {}
    for i, (position, chunk) in enumerate(all_chunks):
        if i > 0:
            time.sleep(0.5)  # a burst of ~15-18 calls in a row tripped a short-window rate limit once
        try:
            for p in _fetch_chunk(season, week, position, chunk):
                pts = (p.get("stats") or {}).get("points_ppr")
                if pts is not None:
                    out[str(p["fpid"])] = pts
        except Exception as e:  # noqa: BLE001 — one bad chunk shouldn't cost every other chunk's results
            print(f"  FantasyPros projections chunk failed ({position}, {len(chunk)} players): {e}")
    return out


def _read_cache(path: Path) -> tuple[dict[str, float], datetime] | None:
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        envelope = json.load(f)
    return envelope["points"], datetime.fromisoformat(envelope["fetched_at"])


def _write_cache(path: Path, points: dict[str, float], fetched_at: datetime) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"fetched_at": fetched_at.isoformat(), "points": points}, f)
    tmp.replace(path)


def _dst_nickname(name: str) -> str:
    """D/ST names don't line up between sources (ESPN: "Jaguars D/ST",
    FantasyPros scrape: "Jacksonville Jaguars") — match on the nickname
    alone, the last real word once the D/ST marker is stripped.
    Consistent across all 32 teams since every current NFL nickname is
    one word, so no hardcoded city/nickname table is needed."""
    tokens = [t.strip(".,'’/").lower() for t in name.split()]
    tokens = [t for t in tokens if t not in ("d/st", "dst")]
    return tokens[-1] if tokens else name.lower()


def points_by_pid(season: int, week: int, league_names: dict[int, str], offline: bool = False) -> dict[int, float]:
    """espn_player_id -> FantasyPros' PPR-scored points projection for the
    given week, for whichever of `league_names` (typically
    roster_player_names() merged with global_player_names()) FantasyPros
    has both an id for (via the free HTML-scrape crosswalk) and a real
    projection for (via the rate-limited API, chunked — see module
    docstring). Missing, not zero, for anyone unresolved either way — a
    missing number should look missing, same convention as ages_by_pid()."""
    import valuation
    from parse import _normalize_name  # local import: avoid a circular import at module load

    name_to_fp = valuation.fantasypros_player_ids_by_name(offline)
    print(f"  FantasyPros crosswalk: {len(name_to_fp)} names available from the cheat-sheet scrape")

    espn_to_fpid: dict[int, int] = {}
    ids_by_position: dict[str, list[int]] = {}
    for pid, name in league_names.items():
        key = _normalize_name(name)
        hit = name_to_fp.get(key)
        if hit is None:
            nick = _dst_nickname(name)
            hit = next((v for k, v in name_to_fp.items() if v[1] == "DST" and _dst_nickname(k) == nick), None)
        if hit is None:
            continue
        fpid, position = hit
        espn_to_fpid[pid] = fpid
        ids_by_position.setdefault(position, []).append(fpid)
    print(f"  FantasyPros crosswalk: {len(espn_to_fpid)}/{len(league_names)} rostered players matched an id")

    path = _cache_path(season, week)
    cached = _read_cache(path)
    points_by_fpid: dict[str, float] = {}
    if cached and (cached[1] and (datetime.now(timezone.utc) - cached[1]) <= MIN_REFETCH_INTERVAL):
        print(f"  FantasyPros projections: using cache from {cached[1].isoformat()} "
              f"({len(cached[0])} players) — within the {MIN_REFETCH_INTERVAL} refetch interval")
        points_by_fpid = cached[0]
    elif not offline and config.FANTASYPROS_API_KEY:
        print(f"  FantasyPros projections: fetching fresh (cache "
              f"{'absent' if cached is None else 'stale, last ' + cached[1].isoformat()})")
        try:
            points_by_fpid = _fetch_all(season, week, ids_by_position)
            _write_cache(path, points_by_fpid, datetime.now(timezone.utc))
            print(f"  FantasyPros projections: fetched {len(points_by_fpid)} players' worth of data")
        except Exception as e:  # noqa: BLE001 — network failure: fall back, don't crash the build
            print(f"  FantasyPros projections fetch failed ({e}); "
                  f"using cached values" if cached else
                  f"  FantasyPros projections fetch failed ({e}); no cache available")
            points_by_fpid = cached[0] if cached else {}
    elif cached:
        points_by_fpid = cached[0]
    else:
        print(f"  FantasyPros projections: skipped (offline={offline}, "
              f"key {'set' if config.FANTASYPROS_API_KEY else 'missing'}, no cache)")

    result = {
        pid: points_by_fpid[str(fpid)]
        for pid, fpid in espn_to_fpid.items()
        if str(fpid) in points_by_fpid
    }
    print(f"  FantasyPros projections: {len(result)}/{len(league_names)} rostered players have a real week {week} projection")
    return result
