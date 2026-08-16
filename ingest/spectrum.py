"""Contend/rebuild spectrum — where each team sits between "win now" and
"stockpiling for later." No player-age data exists anywhere in this
league's cache (checked; ESPN doesn't expose it and this dynasty league has
never tracked it by hand), so the signal instead compares two numbers that
ARE real: what a team's current roster is worth today (dynasty market
value, same table that backs draft grades and trade grades), and how much
future draft-pick capital it's holding (same round-average estimate used
for pick assets in trade grades).
"""
from __future__ import annotations

from parse import _normalize_name, pick_values_for_season


def _percentile_rank(values: dict[int, float]) -> dict[int, float]:
    ordered = sorted(values.items(), key=lambda kv: kv[1])
    n = len(ordered)
    return {tid: round(100 * i / max(n - 1, 1), 1) for i, (tid, _) in enumerate(ordered)}


def _label(pct: float) -> str:
    if pct <= 33:
        return "Contending"
    if pct >= 67:
        return "Rebuilding"
    return "Balanced"


def contend_rebuild_spectrum(team_ids: list[int], stints: list[dict], pick_board: list[dict],
                             dynasty_values: dict[str, int]) -> list[dict]:
    roster_value: dict[int, float] = {tid: 0.0 for tid in team_ids}
    for s in stints:
        if s["end_season"] is not None:
            continue  # this stint has ended — not on a roster today
        roster_value[s["team_id"]] = roster_value.get(s["team_id"], 0.0) + dynasty_values.get(
            _normalize_name(s["name"]), 0)

    values_cache: dict[int, dict] = {}
    pick_capital: dict[int, float] = {tid: 0.0 for tid in team_ids}
    for p in pick_board:
        year = p["season"]
        if year not in values_cache:
            values_cache[year] = pick_values_for_season(year)
        row = values_cache[year].get(str(p["round"]))
        est = (sum(row) / len(row)) if row else 0.0
        pick_capital[p["current_owner_id"]] = pick_capital.get(p["current_owner_id"], 0.0) + est

    ratio = {}
    for tid in team_ids:
        rv, pc = roster_value.get(tid, 0.0), pick_capital.get(tid, 0.0)
        ratio[tid] = pc / (rv + pc) if (rv + pc) else 0.0
    percentile = _percentile_rank(ratio)

    return [
        {
            "team_id": tid,
            "current_roster_value": round(roster_value.get(tid, 0.0), 0),
            "future_pick_capital": round(pick_capital.get(tid, 0.0), 0),
            "ratio": round(ratio[tid], 3),
            "percentile": percentile[tid],
            "label": _label(percentile[tid]),
        }
        for tid in team_ids
    ]
