"""Cross-season trade grades.

Every trade in manual_trades.json scored on the same external dynasty
market that already backs the draft report card (see metrics.compute_draft
/ valuation.py) — reuses that one shared value table rather than inventing
a second baseline.

Player assets resolve directly against the dynasty value table. Pick assets
can't be resolved to a specific draft slot from the trade record alone —
that needs the original-owner + resolved-slot bookkeeping pick_tracking.py
does at read time, which isn't captured per individual historical trade —
so every traded pick is valued at its draft year's ROUND AVERAGE from
pick_values.json and the trade is flagged `has_estimated_asset` so the UI
can be honest that one side of it is an approximation, not a hard number.
"""
from __future__ import annotations

import json
import re
from datetime import datetime

import config
import metrics
import parse

_PICK_RE = re.compile(r"(\d{4}).*?(\d+)(?:st|nd|rd|th)", re.IGNORECASE)


def _parse_pick_text(text: str) -> tuple[int, int] | None:
    """'2027 2nd' -> (2027, 2). None if the free text doesn't match the
    documented convention — never guessed."""
    m = _PICK_RE.search(text)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def _round_average(pick_values: dict, round_: int) -> float | None:
    row = pick_values.get(str(round_))
    if not row:
        return None
    return round(sum(row) / len(row), 1)


def grade_trades(dynasty_values: dict[str, int] | None, valuation_updated_at: str | None) -> dict:
    dynasty_values = dynasty_values or {}
    valuation_available = bool(dynasty_values)

    path = config.ROOT / "ingest" / "manual_trades.json"
    if not path.exists():
        return {"trades": [], "valuation_available": valuation_available,
                "valuation_updated_at": valuation_updated_at}

    with open(path, encoding="utf-8") as f:
        manual = json.load(f)

    names_cache: dict[int, dict[int, str]] = {}

    def names_for(season: int) -> dict[int, str]:
        if season not in names_cache:
            names: dict[int, str] = dict(parse.global_player_names())
            names.update(parse.roster_player_names(season))
            try:
                names.update(metrics.player_names(parse.load_league(season)))
            except FileNotFoundError:
                pass
            names_cache[season] = names
        return names_cache[season]

    out = []
    for t in manual.get("trades", []):
        season = t["season"]
        by_name = {parse._normalize_name(n): pid for pid, n in names_for(season).items()}
        pick_values = parse.pick_values_for_season(season)
        date_ms = int(datetime.fromisoformat(t["date"]).timestamp() * 1000) if t.get("date") else 0

        value_by_team: dict[int, dict[str, float]] = {int(tid): {"gained": 0.0, "lost": 0.0}
                                                       for tid in t.get("teams", [])}
        has_estimated_asset = False
        players_out, picks_out = [], []

        for a in t.get("assets", []):
            if "player" in a:
                norm = parse._normalize_name(a["player"])
                value = dynasty_values.get(norm, 0) if valuation_available else None
                players_out.append({
                    "player_id": by_name.get(norm), "name": a["player"],
                    "from_team_id": a["from"], "to_team_id": a["to"], "value": value,
                })
                if value is not None:
                    value_by_team.setdefault(a["to"], {"gained": 0.0, "lost": 0.0})["gained"] += value
                    value_by_team.setdefault(a["from"], {"gained": 0.0, "lost": 0.0})["lost"] += value
            elif "pick" in a:
                parsed = _parse_pick_text(a["pick"])
                value = _round_average(pick_values, parsed[1]) if parsed and valuation_available else None
                if value is not None:
                    has_estimated_asset = True
                picks_out.append({
                    "pick": a["pick"], "from_team_id": a["from"], "to_team_id": a["to"], "value": value,
                })
                if value is not None:
                    value_by_team.setdefault(a["to"], {"gained": 0.0, "lost": 0.0})["gained"] += value
                    value_by_team.setdefault(a["from"], {"gained": 0.0, "lost": 0.0})["lost"] += value

        winner_team_id = None
        for v in value_by_team.values():
            v["gained"] = round(v["gained"], 1)
            v["lost"] = round(v["lost"], 1)
            v["net"] = round(v["gained"] - v["lost"], 1)
        if valuation_available and value_by_team:
            winner_team_id = max(value_by_team.items(), key=lambda kv: kv[1]["net"])[0]

        out.append({
            "season": season, "date": date_ms, "week": t.get("week", 0),
            "team_ids": sorted(int(x) for x in t.get("teams", [])),
            "players": players_out, "picks": picks_out,
            "value_by_team": {str(k): v for k, v in value_by_team.items()},
            "winner_team_id": winner_team_id,
            "has_estimated_asset": has_estimated_asset,
        })

    out.sort(key=lambda tr: -tr["date"])
    return {"trades": out, "valuation_available": valuation_available,
            "valuation_updated_at": valuation_updated_at}
