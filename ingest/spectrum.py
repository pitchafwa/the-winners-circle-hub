"""Contend/rebuild spectrum — where each team sits between "win now" and
"stockpiling for later." No player-age data exists anywhere in this
league's cache (checked; ESPN doesn't expose it and this dynasty league has
never tracked it by hand), so the signal instead compares real numbers
from two different value lenses:

- **Contending** side: `metrics.redraft_lineup_value()` — the current
  roster's best possible starting lineup priced on REDRAFT (this-season)
  value (`valuation.redraft_values_by_name` — keeptradecut.com/fantasy-
  rankings, not the dynasty-rankings page), plus a 10% share of remaining
  bench value, D/ST and K excluded — "how good is this team RIGHT NOW,"
  same methodology and calibration as the playoff-odds roster-strength
  signal (`simulate.roster_strength_prior_shift`), not a flat sum of the
  whole roster (only ~half a roster ever starts in a given week). A
  roster full of aging win-now vets can be dynasty-cheap but redraft-
  strong, which is exactly the signal "contending" should be picking up.
- **Rebuilding** side: a blend of the SAME roster's long-term dynasty
  value (same table that backs draft grades and trade grades, still a
  FLAT full-roster sum — every rostered asset has real trade value
  regardless of whether it could start today) and future draft-pick
  capital (same round-average estimate trade grades use for pick assets),
  weighted 3:1 toward the roster — a team's own dynasty assets are the
  more important half of "banked for the future" than picks are, both
  already KTC-dynasty-scaled so they're directly comparable. Dynasty
  value alone isn't a rebuilding signal by itself (a stacked-but-young
  contender is dynasty-rich too) — it's the blend WITH pick capital that
  reads as "assets banked for the future" rather than "assets playing
  right now."

Posture (`label`) is a genuinely qualitative, two-dimensional read of
those two value lenses, not a single ratio's percentile rank — a team
that ranks near the top on BOTH contending and rebuilding value is
"Balanced" (well-set-up for now AND later), not forced into whichever
side happens to edge out the other. See `_label` below.
"""
from __future__ import annotations

from metrics import redraft_lineup_value
from parse import _normalize_name, pick_values_for_season, values_by_pid

# dynasty roster value counts 3x as much as pick capital toward "rebuilding value"
ROSTER_WEIGHT = 3

# a team in the top third of the league on a given value lens reads as
# genuinely strong there, not just "above average"
HIGH_PCT = 67


def _percentile_rank(values: dict[int, float]) -> dict[int, float]:
    ordered = sorted(values.items(), key=lambda kv: kv[1])
    n = len(ordered)
    return {tid: round(100 * i / max(n - 1, 1), 1) for i, (tid, _) in enumerate(ordered)}


def _label(contending_pct: float, rebuilding_pct: float) -> str:
    high_contend = contending_pct >= HIGH_PCT
    high_rebuild = rebuilding_pct >= HIGH_PCT
    if high_contend and high_rebuild:
        return "Balanced"  # elite on both lenses — set up for now AND later
    if high_contend:
        return "Contending"
    if high_rebuild:
        return "Rebuilding"
    return "Balanced"  # not standout on either lens


def contend_rebuild_spectrum(team_ids: list[int], stints: list[dict], pick_board: list[dict],
                             dynasty_values: dict[str, int], redraft_values: dict[str, int],
                             roster_players: dict[int, list[tuple[int, frozenset[int]]]],
                             starting_slots: list[int], season: int,
                             pick_curves: dict[str, dict[str, list[float]]] | None = None) -> list[dict]:
    dynasty_roster_value: dict[int, float] = {tid: 0.0 for tid in team_ids}
    for s in stints:
        if s["end_season"] is not None:
            continue  # this stint has ended — not on a roster today
        name = _normalize_name(s["name"])
        tid = s["team_id"]
        dynasty_roster_value[tid] = dynasty_roster_value.get(tid, 0.0) + dynasty_values.get(name, 0)

    redraft_by_pid = values_by_pid(season, redraft_values)
    contending_value: dict[int, float] = {
        tid: redraft_lineup_value(roster_players.get(tid, []), redraft_by_pid, starting_slots)
        for tid in team_ids
    }

    values_cache: dict[int, dict] = {}
    pick_capital: dict[int, float] = {tid: 0.0 for tid in team_ids}
    for p in pick_board:
        year = p["season"]
        if year not in values_cache:
            values_cache[year] = pick_values_for_season(year, pick_curves)
        row = values_cache[year].get(str(p["round"]))
        est = (sum(row) / len(row)) if row else 0.0
        pick_capital[p["current_owner_id"]] = pick_capital.get(p["current_owner_id"], 0.0) + est

    rebuilding_value: dict[int, float] = {}
    ratio: dict[int, float] = {}
    for tid in team_ids:
        dv, pc = dynasty_roster_value.get(tid, 0.0), pick_capital.get(tid, 0.0)
        rv = (ROSTER_WEIGHT * dv + pc) / (ROSTER_WEIGHT + 1)
        rebuilding_value[tid] = rv
        cv = contending_value.get(tid, 0.0)
        ratio[tid] = rv / (cv + rv) if (cv + rv) else 0.0
    contending_pct = _percentile_rank(contending_value)
    rebuilding_pct = _percentile_rank(rebuilding_value)

    return [
        {
            "team_id": tid,
            "contending_value": round(contending_value.get(tid, 0.0), 0),
            "dynasty_roster_value": round(dynasty_roster_value.get(tid, 0.0), 0),
            "future_pick_capital": round(pick_capital.get(tid, 0.0), 0),
            "rebuilding_value": round(rebuilding_value[tid], 0),
            "ratio": round(ratio[tid], 3),
            "contending_percentile": contending_pct[tid],
            "rebuilding_percentile": rebuilding_pct[tid],
            "label": _label(contending_pct[tid], rebuilding_pct[tid]),
        }
        for tid in team_ids
    ]
