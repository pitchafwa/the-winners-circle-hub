"""Cross-season trade grades.

Two separate signals, shown side by side rather than blended into one
number (different units — a 0-9999 market score isn't fantasy points):

- **Market value at trade time** — the actual grade. Every asset is priced
  against `ktc_history.py`'s real daily KTC archive (2020-04-01 on), looked
  up on the trade's own real `date` — not today's value, not a value frozen
  at whatever moment the trade happened to be entered into this tool. This
  replaced an earlier "freeze at submission time" design (`trade_tool.py
  cmd_submit` used to snapshot `value` onto each asset right then) once real
  historical data became available 2026-08-31 — that mechanism is retired;
  a trade's grade is now always recomputed fresh from real history on every
  build, never stored/frozen. `value_source` is `"historical"` when the
  archive has real data for that asset on that date, `"unavailable"` when it
  doesn't (predates the archive, or a player/pick the archive never ranked)
  — flagged `has_estimated_asset`, never fabricated.

  This also naturally handles the "team flips the player again before he
  plays a snap" case without any lineage-tracing: each trade is graded
  independently at ITS OWN moment. If Team A gets Player X then flips him
  a month later for Player Y, that's two separately-graded trades whose
  net combines correctly — Team A doesn't need X to have produced anything
  for them to get credit for the flip.

- **Production since the trade** — for a player asset who's STILL on the
  acquiring team's roster (found via a matching `ownership.json` stint,
  never re-traded away since), their actual points started and points vs.
  projection since the trade, shown as context alongside the market grade.
  Deliberately omitted (not zeroed) for anyone who was traded again before
  this build — that's the "team flips it before it contributes" case the
  market-value grade already covers via the SECOND trade's own leg, so
  showing near-zero production here would double-penalize the same asset.

Pick assets can't get a production overlay at all — resolving a pick to
its eventual player needs the original-owner bookkeeping `pick_tracking.py`
does at read time, which isn't captured per individual historical trade.
Every traded pick is valued at its draft year's ROUND AVERAGE on the trade's
real date (`ktc_history.pick_round_average_on_date()` — a traded pick is
usually "a 2nd," no exact slot known yet since the season isn't over) and
the trade is flagged `has_estimated_asset`.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime

import config
import ktc_history
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


def _stints_by_team_player(stints: list[dict]) -> dict[tuple[int, int, int], list[dict]]:
    """(team_id, player_id, start_season) -> that player's stints on that
    team in that season, sorted by start_week — lets a trade find "the
    stint that started at or after me" without needing an exact week match
    (an offseason week-0 trade's resulting stint actually starts whenever
    the new season's first box score lands, not literally week 0)."""
    out: dict[tuple[int, int, int], list[dict]] = defaultdict(list)
    for s in stints:
        if s["acquired_via"] != "trade":
            continue
        out[(s["team_id"], s["player_id"], s["start_season"])].append(s)
    for lst in out.values():
        lst.sort(key=lambda s: s["start_week"])
    return out


def _matching_stint(index: dict[tuple[int, int, int], list[dict]],
                    team_id: int, player_id: int, season: int, week: int) -> dict | None:
    for s in index.get((team_id, player_id, season), []):
        if s["start_week"] >= week:
            return s
    return None


def grade_trades(valuation_updated_at: str | None, stints: list[dict] | None = None) -> dict:
    """`valuation_updated_at` is passed straight through to the output
    unchanged — it's the live KTC fetch timestamp shown elsewhere on the
    site (the footer), unrelated to trade pricing now that every trade is
    priced from ktc_history's real historical archive instead."""
    valuation_available = ktc_history.is_available()
    stint_index = _stints_by_team_player(stints or [])

    path = config.ROOT / "ingest" / "manual_trades.json"
    if not path.exists():
        return {"trades": [], "valuation_available": valuation_available,
                "valuation_updated_at": valuation_updated_at, "team_ledger": []}

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
        week = t.get("week", 0)
        by_name = {parse._normalize_name(n): pid for pid, n in names_for(season).items()}
        trade_date = t.get("date")
        date_ms = int(datetime.fromisoformat(t["date"]).timestamp() * 1000) if t.get("date") else 0

        value_by_team: dict[int, dict[str, float]] = {int(tid): {"gained": 0.0, "lost": 0.0}
                                                       for tid in t.get("teams", [])}
        has_estimated_asset = False
        players_out, picks_out = [], []

        for a in t.get("assets", []):
            if "player" in a:
                norm = parse._normalize_name(a["player"])
                pid = by_name.get(norm)
                value = ktc_history.value_on_date(a["player"], trade_date) if trade_date else None
                value_source = "historical" if value is not None else "unavailable"

                production, flipped_again = None, False
                if pid is not None:
                    stint = _matching_stint(stint_index, a["to"], pid, season, week)
                    if stint is not None:
                        if stint["departed_via"] == "trade":
                            flipped_again = True
                        else:
                            production = {
                                "points_started": stint["points_started"],
                                "points_projected_started": stint["points_projected_started"],
                                "weeks_started": stint["weeks_started"],
                                "still_held": stint["end_season"] is None,
                            }

                players_out.append({
                    "player_id": pid, "name": a["player"],
                    "from_team_id": a["from"], "to_team_id": a["to"],
                    "value": value, "value_source": value_source,
                    "production_since_trade": production, "flipped_again": flipped_again,
                })
                if value is not None:
                    value_by_team.setdefault(a["to"], {"gained": 0.0, "lost": 0.0})["gained"] += value
                    value_by_team.setdefault(a["from"], {"gained": 0.0, "lost": 0.0})["lost"] += value
            elif "pick" in a:
                parsed = _parse_pick_text(a["pick"])
                value = (ktc_history.pick_round_average_on_date(parsed[0], parsed[1], trade_date)
                        if parsed and trade_date else None)
                value_source = "historical" if value is not None else "unavailable"
                if value is not None:
                    has_estimated_asset = True  # always a round average, never a resolved slot
                picks_out.append({
                    "pick": a["pick"], "from_team_id": a["from"], "to_team_id": a["to"],
                    "value": value, "value_source": value_source,
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
            "id": t.get("id"),
            "season": season, "date": date_ms, "week": week,
            "team_ids": sorted(int(x) for x in t.get("teams", [])),
            "players": players_out, "picks": picks_out,
            "value_by_team": {str(k): v for k, v in value_by_team.items()},
            "winner_team_id": winner_team_id,
            "has_estimated_asset": has_estimated_asset,
        })

    out.sort(key=lambda tr: -tr["date"])

    ledger: dict[int, dict[str, float]] = defaultdict(lambda: {"gained": 0.0, "lost": 0.0, "trade_count": 0})
    for tr in out:
        for tid_str, v in tr["value_by_team"].items():
            entry = ledger[int(tid_str)]
            entry["gained"] += v["gained"]
            entry["lost"] += v["lost"]
            entry["trade_count"] += 1
    team_ledger = [
        {"team_id": tid, "gained": round(v["gained"], 1), "lost": round(v["lost"], 1),
         "net": round(v["gained"] - v["lost"], 1), "trade_count": int(v["trade_count"])}
        for tid, v in ledger.items()
    ]
    team_ledger.sort(key=lambda r: -r["net"])

    return {"trades": out, "valuation_available": valuation_available,
            "valuation_updated_at": valuation_updated_at, "team_ledger": team_ledger}
