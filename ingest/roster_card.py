"""Live roster cards for the My Team page — starters/bench/IR exactly as
set on ESPN right now, each with next-game info, this week's real ESPN
projection, and up to 3 recent games' actual vs. projected (the basis for
this module's own recent_avg_diff metric — "beating projection lately" is
a signal ESPN doesn't surface directly).

WYSIWYG of the live roster, deliberately unlike parse.optimal_week_projection:
no "best lineup" suggestion logic here — an empty starting slot renders
empty, exactly as the manager left it, since this is a roster display, not
a lineup optimizer.
"""
from __future__ import annotations

import parse


def build_roster_cards(season: int, league: parse.LeagueData) -> dict[int, dict]:
    raw = parse._load(season, "league")
    if not raw:
        return {}
    pro = parse.pro_team_schedule(season)
    recent = parse.recent_player_performance(league)
    current_week = parse.current_fantasy_week(league)

    out: dict[int, dict] = {}
    for t in raw.get("teams", []):
        team_id = t["id"]
        starters_by_slot: dict[int, list[dict]] = {}
        bench: list[dict] = []
        ir: list[dict] = []

        for e in t.get("roster", {}).get("entries", []):
            player = (e.get("playerPoolEntry") or {}).get("player") or {}
            pid = player.get("id")
            if pid is None:
                continue
            slot_id = e.get("lineupSlotId", parse.BENCH_SLOT)
            pro_team_id = player.get("proTeamId", 0)
            pro_info = pro.get(pro_team_id, {})

            week_projection = None
            for stat in player.get("stats", []):
                if (stat.get("scoringPeriodId") == current_week
                        and stat.get("statSplitTypeId") == 1
                        and stat.get("statSourceId") == 1):
                    week_projection = round(stat.get("appliedTotal", 0.0), 2)

            game = pro_info.get("games", {}).get(current_week) if current_week else None
            next_game = None
            if game is not None:
                opp = pro.get(game["opponent_id"], {})
                next_game = {"opponent": opp.get("abbrev", "?"), "is_home": game["is_home"], "date": game["date"]}
            on_bye = game is None and pro_info.get("bye_week") == current_week

            player_recent = recent.get(pid, [])
            diffs = [r["points"] - r["projected"] for r in player_recent if r["projected"] is not None]

            card = {
                "player_id": pid,
                "name": player.get("fullName", ""),
                "position": parse.POSITION_NAMES.get(player.get("defaultPositionId", 0), "?"),
                "pro_team": pro_info.get("abbrev", ""),
                "slot": parse.SLOT_NAMES.get(slot_id, str(slot_id)),
                "injury_status": player.get("injuryStatus"),
                "on_bye": on_bye,
                "next_game": next_game,
                "week_projection": week_projection,
                "recent": player_recent,
                "recent_avg_diff": round(sum(diffs) / len(diffs), 1) if diffs else None,
            }

            if slot_id == parse.BENCH_SLOT:
                bench.append(card)
            elif slot_id == parse.IR_SLOT:
                ir.append(card)
            else:
                starters_by_slot.setdefault(slot_id, []).append(card)

        # One entry per real starting slot, in the league's real slot order
        # (multiplicity and all) — a slot nobody's currently in shows empty
        # (player_id: null) rather than compacting the list, matching how
        # ESPN's own roster page never hides an unfilled starting slot.
        pools = {k: list(v) for k, v in starters_by_slot.items()}
        starters = []
        for slot_id in league.starting_slots:
            pool = pools.get(slot_id)
            starters.append(
                pool.pop(0) if pool else
                {"player_id": None, "name": None, "position": None,
                 "pro_team": None, "slot": parse.SLOT_NAMES.get(slot_id, str(slot_id)),
                 "injury_status": None, "on_bye": False, "next_game": None,
                 "week_projection": None, "recent": [], "recent_avg_diff": None}
            )

        out[team_id] = {"starters": starters, "bench": bench, "ir": ir}
    return out
