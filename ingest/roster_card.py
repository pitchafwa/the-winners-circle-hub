"""Live roster cards for the My Team page — starters/bench/IR exactly as
set on ESPN right now, each with next-game info, this week's real ESPN
projection, and up to 3 recent games' actual vs. projected (the basis for
this module's own recent_avg_diff metric — "beating projection lately" is
a signal ESPN doesn't surface directly).

Mostly WYSIWYG of the live roster: a starting slot the manager HAS set
shows exactly that player, never second-guessed. The one exception —
Tommy's explicit ask — is a slot the manager has left genuinely BLANK:
that gets auto-filled with the best available bench player for the slot
(via metrics.best_lineup(), the same matching parse.optimal_week_projection
already uses for the same situation), flagged `suggested: true` so the
frontend can render it visibly different from a real, manager-set starter.
"""
from __future__ import annotations

import parse


def build_roster_cards(season: int, league: parse.LeagueData) -> dict[int, dict]:
    raw = parse._load(season, "league")
    if not raw:
        return {}
    from metrics import best_lineup  # deferred: metrics imports from parse, dodges a circular import at load time

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

            week_actual, week_projection = None, None
            for stat in player.get("stats", []):
                if stat.get("scoringPeriodId") != current_week or stat.get("statSplitTypeId") != 1:
                    continue
                if stat.get("statSourceId") == 0:
                    week_actual = round(stat.get("appliedTotal", 0.0), 2)
                elif stat.get("statSourceId") == 1:
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
                "on_fire": parse.is_on_fire(player_recent),
                "suggested": False,
                # kept off the final card — only needed for the bench-fill
                # valuation pass below, stripped before this dict is used
                "_eligible": frozenset(player.get("eligibleSlots", [])),
                "_value": week_actual if week_actual is not None else (week_projection or 0.0),
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
        starters: list[dict | None] = []
        for slot_id in league.starting_slots:
            pool = pools.get(slot_id)
            starters.append(pool.pop(0) if pool else None)
        empty_indices = [i for i, s in enumerate(starters) if s is None]

        if empty_indices and bench:
            empty_slot_ids = [league.starting_slots[i] for i in empty_indices]
            candidates = [(b["player_id"], b["_eligible"], b["_value"]) for b in bench]
            _, _assigned, slot_index_by_player = best_lineup(candidates, empty_slot_ids)
            bench_by_pid = {b["player_id"]: b for b in bench}
            filled_pids: set[int] = set()
            for pid, rel_i in slot_index_by_player.items():
                idx = empty_indices[rel_i]
                filled_slot_id = league.starting_slots[idx]
                starters[idx] = {
                    **bench_by_pid[pid],
                    "slot": parse.SLOT_NAMES.get(filled_slot_id, str(filled_slot_id)),
                    "suggested": True,
                }
                filled_pids.add(pid)
            bench = [b for b in bench if b["player_id"] not in filled_pids]

        for i, slot_id in enumerate(league.starting_slots):
            if starters[i] is None:
                starters[i] = {
                    "player_id": None, "name": None, "position": None,
                    "pro_team": None, "slot": parse.SLOT_NAMES.get(slot_id, str(slot_id)),
                    "injury_status": None, "on_bye": False, "next_game": None,
                    "week_projection": None, "recent": [], "recent_avg_diff": None,
                    "on_fire": False, "suggested": False,
                }

        for group in (starters, bench, ir):
            for card in group:
                card.pop("_eligible", None)
                card.pop("_value", None)

        out[team_id] = {"starters": starters, "bench": bench, "ir": ir}
    return out
