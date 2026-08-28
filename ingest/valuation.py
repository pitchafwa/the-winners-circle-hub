"""External player values — independent baselines for draft grading and the
contend/rebuild spectrum. Three sources:

- **Dynasty** (`keeptradecut.com/dynasty-rankings`) — long-term keeper/trade
  asset value. Backs the draft report card, trade grades, and the "held
  assets" side of the contend/rebuild spectrum.
- **Redraft** (`fantasypros.com/nfl/rankings/ppr-cheatsheets.php`) —
  this-season value, from FantasyPros' consensus expert rank (ECR) rather
  than KeepTradeCut's own redraft market. Switched 2026-08-28 at Tommy's
  request: KTC's redraft numbers kept producing contending-value/roster-
  strength rankings he didn't buy (a team he felt was clearly mid-pack
  reading as top-2) — a second, independently-sourced opinion on "who's
  actually good this year" was the fix, not a different formula over the
  same opinion. `_ecr_rank_to_value()` below converts FantasyPros' rank
  onto roughly the same 0-9999 scale KTC's redraft values used (anchored
  against KTC's own real redraft curve, sampled 2026-08-28), so everything
  downstream that assumes that scale (spectrum.py's dollar-level
  thresholds in particular) keeps working unmodified — only WHO ranks
  where changes, not the numeric range values live in. Backs the
  "contending" side of the contend/rebuild spectrum — a team's CURRENT
  roster judged on what it's worth to win NOW, not what it'll be worth in
  three years. (`redraft_values_by_name()` — the original KTC-sourced
  version — is kept below, unused by build.py now, in case this ever
  needs reverting or comparing against.)

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
from collections.abc import Callable
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
    parser: Callable[[str], list[dict]]


def _parse_players_array(html: str) -> list[dict]:
    m = re.search(r"var playersArray = (\[.*?\]);", html, re.DOTALL)
    if not m:
        raise ValueError("player list not found in valuation source page — site structure may have changed")
    return json.loads(m.group(1))


def _parse_ecr_players(html: str) -> list[dict]:
    """FantasyPros embeds its full ranked list the same way KTC does — a
    JS object assigned directly in the server-rendered HTML, no JS
    execution needed (confirmed by fetching with plain requests)."""
    m = re.search(r"var ecrData = (\{.*?\});", html, re.DOTALL)
    if not m:
        raise ValueError("player list not found in FantasyPros rankings page — site structure may have changed")
    return json.loads(m.group(1))["players"]


DYNASTY = _Source(
    url="https://keeptradecut.com/dynasty-rankings",
    cache_path=config.CACHE_DIR / "valuation" / "dynasty-rankings.json",
    parser=_parse_players_array,
)
REDRAFT = _Source(
    url="https://keeptradecut.com/fantasy-rankings",
    cache_path=config.CACHE_DIR / "valuation" / "fantasy-rankings.json",
    parser=_parse_players_array,
)
FANTASYPROS_REDRAFT = _Source(
    url="https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php",
    cache_path=config.CACHE_DIR / "valuation" / "fantasypros-ppr-cheatsheets.json",
    parser=_parse_ecr_players,
)


def _fetch_fresh(source: _Source) -> list[dict]:
    r = requests.get(source.url, headers=REQUEST_HEADERS, timeout=20)
    r.raise_for_status()
    return source.parser(r.text)


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


_PICK_ENTRY_RE = re.compile(r"^(\d{4}) (Early|Mid|Late) (\d+)(?:st|nd|rd|th)$")
_TIER_ANCHOR_SLOT = {"Early": 2, "Mid": 5, "Late": 8}  # pick # within a 10-team round


def _interpolate_round(anchor_values: dict[int, float]) -> list[float]:
    """3 known points (pick 2/5/8, from KTC's Early/Mid/Late tiers) -> a
    full 10-pick curve. Piecewise-linear between the anchors; the two end
    segments extend that same slope out to picks 1 and 9-10, clamped at 0 —
    KTC doesn't publish a value for every single slot, and this league
    already treats a hand-curated version of exactly this shape
    (`pick_values.json`) as the standard, so a small local interpolation is
    consistent with how the static fallback curve was built in the first
    place, just re-derived from a live source instead of typed in by hand."""
    anchors = sorted(anchor_values.items())
    values = []
    for slot in range(1, 11):
        if slot <= anchors[0][0]:
            (x0, y0), (x1, y1) = anchors[0], anchors[1]
        elif slot >= anchors[-1][0]:
            (x0, y0), (x1, y1) = anchors[-2], anchors[-1]
        else:
            (x0, y0), (x1, y1) = next(
                (a, b) for a, b in zip(anchors, anchors[1:]) if a[0] <= slot <= b[0])
        t = (slot - x0) / (x1 - x0)
        values.append(max(round(y0 + t * (y1 - y0)), 0))
    return values


def pick_curve_by_year(offline: bool = False) -> tuple[dict[str, dict[str, list[float]]], str | None]:
    """Live rookie-pick value curve, derived from the SAME dynasty-rankings
    fetch `values_by_name()` already makes — KeepTradeCut lists future picks
    (position "RDP") right alongside players, three tiers per round ("2027
    Early 1st" / "Mid" / "Late"), so no extra request is needed. Returns
    {year: {round: [10 values, pick 1 first]}}, only for years/rounds KTC
    actually published this fetch (currently the next 3 draft years x
    rounds 1-4) — callers fall back to the static `pick_values.json` curve
    for anything outside that range, same "nearest year on file" clamp
    `parse.pick_values_for_season` already does for the static-only case."""
    players, fetched_at = _get_players(DYNASTY, offline)
    raw: dict[str, dict[str, dict[int, float]]] = {}
    for p in players:
        if p.get("position") != "RDP":
            continue
        m = _PICK_ENTRY_RE.match(p["playerName"])
        if not m:
            continue
        year, tier, round_ = m.group(1), m.group(2), m.group(3)
        slot = _TIER_ANCHOR_SLOT[tier]
        raw.setdefault(year, {}).setdefault(round_, {})[slot] = p["oneQBValues"]["value"]
    curves = {
        year: {round_: _interpolate_round(anchors) for round_, anchors in rounds.items() if len(anchors) >= 2}
        for year, rounds in raw.items()
    }
    return curves, fetched_at


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


# rank -> value anchors, sampled from KTC's own real redraft curve
# (2026-08-28 snapshot: rank 1 -> 9999 down to rank 375 -> 0, KTC's ranked
# universe at the time) — see this module's docstring for why FantasyPros'
# rank gets remapped onto this scale rather than used as a raw 1-517
# number. Piecewise-linear between anchors, flat-clamped past either end
# (so anything past rank 375 reads 0, same "no meaningful market value"
# convention as an unranked D/ST or deep dart-throw).
_ECR_VALUE_ANCHORS: list[tuple[int, float]] = [
    (1, 9999), (10, 8207), (25, 7274), (50, 6468), (75, 5625),
    (100, 5136), (150, 4175), (200, 3253), (250, 2487), (300, 1699),
    (350, 400), (375, 0),
]


def _interp_curve(anchors: list[tuple[int, float]], x: float) -> float:
    if x <= anchors[0][0]:
        return anchors[0][1]
    if x >= anchors[-1][0]:
        return anchors[-1][1]
    for (x0, y0), (x1, y1) in zip(anchors, anchors[1:]):
        if x0 <= x <= x1:
            t = (x - x0) / (x1 - x0)
            return y0 + t * (y1 - y0)
    return anchors[-1][1]  # unreachable — satisfies type checkers


def _ecr_rank_to_value(rank: int) -> int:
    return max(0, round(_interp_curve(_ECR_VALUE_ANCHORS, rank)))


def fantasypros_redraft_values_by_name(offline: bool = False) -> tuple[dict[str, int], str | None]:
    """normalized_name -> this-season value (0-9999-ish), derived from
    FantasyPros' consensus expert rank (ECR) on their PPR draft cheat
    sheet — see this module's docstring for why this replaced
    `redraft_values_by_name()` above as build.py's actual redraft source.
    Same missing-player convention as every other lookup here: a player
    outside FantasyPros' ~517-deep ranked universe is simply absent, never
    fabricated as 0 vs. genuinely-unranked."""
    from parse import _normalize_name  # local import: avoid a circular import at module load

    players, fetched_at = _get_players(FANTASYPROS_REDRAFT, offline)
    values = {_normalize_name(p["player_name"]): _ecr_rank_to_value(p["rank_ecr"]) for p in players}
    return values, fetched_at


def ages_by_name(offline: bool = False) -> tuple[dict[str, float], str | None]:
    """normalized_name -> real age (fractional years, e.g. 24.4), from the
    SAME dynasty-rankings fetch values_by_name() already makes — no extra
    request needed, KTC's playersArray carries `age` right alongside value.
    Age is a "right now" fact, not season-scoped or historical, same
    reasoning as player_card's live ESPN fetch. Players outside KTC's
    ranked universe (D/ST, deep dart-throws) simply have no entry."""
    from parse import _normalize_name  # local import: avoid a circular import at module load

    players, fetched_at = _get_players(DYNASTY, offline)
    ages = {
        _normalize_name(p["playerName"]): p["age"]
        for p in players if p.get("age") is not None
    }
    return ages, fetched_at
