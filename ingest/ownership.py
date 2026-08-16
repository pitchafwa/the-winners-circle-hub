"""Roster ownership timeline — continuous per-team-per-player tenure stints.

Joins three things ingest already computes separately (weekly lineups,
activity events, manual trades/drafts) into one thing none of them alone
answers: "who has owned this player, on which team, since when, and was he
starting or riding the bench the whole time." Pure aggregation over
already-cached seasons, run once across every season after the per-season
build completes (same pattern as build_badges).

A stint is one continuous run of one player on one team's roster. It ends
the moment the player stops appearing in that team's weekly lineup — a real
absence (traded/dropped), never a bye: byes still leave a player in the
lineup with played=False, so they don't break a stint. A team with no
matchup data at all for a week (an uneven playoff bracket, most commonly)
is skipped entirely for that week rather than treated as "everyone left."
"""
from __future__ import annotations

import json

import config
import metrics
import parse

MIN_STASH_WEEKS = 10  # tenure floor before "longest bench stash" is meaningful
MIN_BUST_WEEKS = 4    # tenure floor before "biggest headache" is meaningful
LEADERS_PER_TEAM = 5


def _load_manual_trades() -> list[dict]:
    path = config.ROOT / "ingest" / "manual_trades.json"
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f).get("trades", [])


def _season_context(season: int, all_trades: list[dict]):
    league = parse.load_league(season)
    names = {**parse.global_player_names(),
             **parse.roster_player_names(season),
             **metrics.player_names(league)}
    by_name = {parse._normalize_name(n): pid for pid, n in names.items()}

    picks, _problems = parse.load_manual_draft(season, league.teams, names)
    draft_map = {(p["team_id"], p["player_id"]): True for p in picks if p["player_id"] is not None}

    # this season's manual trades, resolved to (week, player_id, from, to) moves
    trade_moves = []
    for t in all_trades:
        if t.get("season") != season:
            continue
        week = int(t.get("week") or 0)
        for a in t.get("assets", []):
            if "player" not in a:
                continue
            pid = by_name.get(parse._normalize_name(a["player"]))
            if pid is None:
                continue  # unmatched names already fail the build loudly elsewhere
            trade_moves.append({"week": week, "player_id": pid, "from": a["from"], "to": a["to"]})

    activity_by_pair: dict[tuple[int, int], list[tuple[int, str]]] = {}
    for e in league.activity:
        activity_by_pair.setdefault((e.team_id, e.player_id), []).append((e.week, e.action))

    return league, draft_map, trade_moves, activity_by_pair


def _acquired_via(week, team_id, player_id, is_first_season,
                  draft_map, trade_moves, activity_by_pair) -> str:
    if is_first_season:
        return "preexisting"
    if draft_map.get((team_id, player_id)):
        return "draft"
    for m in trade_moves:
        if m["player_id"] == player_id and m["to"] == team_id and m["week"] <= week:
            return "trade"
    for w, action in activity_by_pair.get((team_id, player_id), []):
        if w <= week and action in ("WAIVER_ADDED", "FA_ADDED"):
            return "waiver" if action == "WAIVER_ADDED" else "fa"
    return "unknown"


def _departed_via(week, team_id, player_id, trade_moves, activity_by_pair) -> str:
    for m in trade_moves:
        if m["player_id"] == player_id and m["from"] == team_id and m["week"] <= week:
            return "trade"
    return "dropped"


def build_ownership(seasons: list[int]) -> dict:
    seasons = sorted(seasons)
    all_trades = _load_manual_trades()

    open_stints: dict[int, dict] = {}  # player_id -> open stint (one team at a time)
    stints: list[dict] = []
    seen_data_season = False  # box-score/lineup caches don't reach as far back as standings do

    for season in seasons:
        league, draft_map, trade_moves, activity_by_pair = _season_context(season, all_trades)
        if not league.completed_weeks():
            continue
        is_first_season = not seen_data_season
        seen_data_season = True

        for week in league.completed_weeks():
            active_teams = {tid for tid in league.teams if league.team_week(tid, week) is not None}
            rosters: dict[int, dict[int, "parse.PlayerWeek"]] = {
                tid: {p.player_id: p for p in league.team_week(tid, week).lineup}
                for tid in active_teams
            }
            present_pairs = {(tid, pid) for tid, plist in rosters.items() for pid in plist}

            for pid, st in list(open_stints.items()):
                if st["team_id"] in active_teams and (st["team_id"], pid) not in present_pairs:
                    st["departed_via"] = _departed_via(week, st["team_id"], pid, trade_moves, activity_by_pair)
                    st["end_season"], st["end_week"] = season, week
                    stints.append(st)
                    del open_stints[pid]

            for team_id, plist in rosters.items():
                for pid, pw in plist.items():
                    st = open_stints.get(pid)
                    if st is None:
                        st = {
                            "player_id": pid, "name": pw.name, "position": pw.position,
                            "team_id": team_id,
                            "acquired_via": _acquired_via(week, team_id, pid, is_first_season,
                                                          draft_map, trade_moves, activity_by_pair),
                            "start_season": season, "start_week": week,
                            "departed_via": None, "end_season": None, "end_week": None,
                            "weeks_rostered": 0, "weeks_started": 0, "weeks_benched": 0,
                            "points_started": 0.0, "points_projected_started": 0.0, "points_benched": 0.0,
                        }
                        open_stints[pid] = st
                    st["weeks_rostered"] += 1
                    if pw.started:
                        st["weeks_started"] += 1
                        st["points_started"] = round(st["points_started"] + pw.actual, 2)
                        st["points_projected_started"] = round(
                            st["points_projected_started"] + (pw.projected or 0.0), 2)
                    else:
                        st["weeks_benched"] += 1
                        st["points_benched"] = round(st["points_benched"] + pw.actual, 2)

    stints.extend(open_stints.values())  # still on the roster today

    for st in stints:
        st["start_rate"] = (round(st["weeks_started"] / st["weeks_rostered"], 3)
                            if st["weeks_rostered"] else 0.0)

    leaders = {
        "value": _top_per_team(stints, key=lambda s: s["points_started"]),
        "busts": _top_per_team(
            stints, key=lambda s: s["points_projected_started"] - s["points_started"],
            min_weeks=MIN_BUST_WEEKS),
        "stashes": _top_per_team(stints, key=lambda s: -s["start_rate"], min_weeks=MIN_STASH_WEEKS),
    }

    return {"stints": stints, "leaders": leaders}


def _top_per_team(stints: list[dict], key, min_weeks: int = 0) -> list[dict]:
    by_team: dict[int, list[dict]] = {}
    for s in stints:
        if s["weeks_rostered"] < min_weeks:
            continue
        by_team.setdefault(s["team_id"], []).append(s)
    out = []
    for team_id, lst in by_team.items():
        for s in sorted(lst, key=key, reverse=True)[:LEADERS_PER_TEAM]:
            out.append({
                "team_id": team_id, "player_id": s["player_id"], "name": s["name"],
                "position": s["position"],
                "points_started": s["points_started"],
                "points_under_projection": round(s["points_projected_started"] - s["points_started"], 2),
                "weeks_rostered": s["weeks_rostered"], "weeks_started": s["weeks_started"],
                "start_rate": s["start_rate"],
                "start_season": s["start_season"], "start_week": s["start_week"],
                "end_season": s["end_season"], "end_week": s["end_week"],
            })
    return out
