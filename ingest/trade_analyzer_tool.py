"""Historical CLI bridge for what were originally LOCAL-ONLY (Tommy-only,
`pnpm dev`-only) admin tools. As of 2026-08-28 the frontend no longer calls
any of these commands — Positional Strength, Buy-Low Targets, Trade
Analyzer, and Trade Partners all moved to a pure client-side port
(web/src/lib/teamValue.ts, buyLow.ts, leaguePerformance.ts) reading
player_values.json + pick_futures.json's `value` field, both written by
build.py, so those tools work on the real deployed site instead of only
the dev server. This module is kept as the reference implementation the
TS port was matched against, and stays runnable via the CLI (`python
trade_analyzer_tool.py <command>`, JSON on stdin) for one-off debugging —
but nothing in web/vite-plugins/admin-api.ts routes to it any more.

    simulate_trade   — a pure what-if: swap specific players/picks between
                        two teams (nothing written to disk, no ledger
                        touched) and report each team's contending/
                        rebuilding value and per-position roster-strength
                        ratings, before and after.
    buy_low_targets  — every player rostered by someone else in the league
                        whose real dynasty value is strong but whose last-
                        3-games scoring has fallen well below their own
                        season average — a "the market still respects them,
                        recent results don't" signal for buy-low targets.
    league_positions — every team's per-position starter-tier/depth rating
                        at once, current rosters — a quick-glance league-
                        wide comparison instead of running simulate_trade
                        team by team.
    trade_partners    — for one team, every other team ranked by mutual
                         positional fit: how much their positional surplus
                         overlaps this team's need, and vice versa. Turns
                         "who might actually want to talk trade" from
                         guesswork into a ranked list.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict

import config
import metrics
import parse
import pick_tracking
import valuation

# Raw ESPN slot ids that belong to exactly ONE position (as opposed to a
# shared flex — RB/WR id 3, WR/TE id 5, FLEX id 23 — which could go to more
# than one position group). Counting only these per position is a
# deliberate simplification for "how many of this position's OWN starting
# slots does the league carry" — it undercounts true positional demand
# (ignores flex sharing) but stays simple, stable, and easy to reason about
# for a starter-vs-depth split, rather than trying to solve a per-position
# share of the flex slots (which isn't even a well-defined single number).
DEDICATED_SLOT_TO_POSITION = {0: "QB", 2: "RB", 4: "WR", 6: "TE", 16: "D/ST", 17: "K"}

ROSTER_WEIGHT = 3  # dynasty roster value counts 3x as much as pick capital — matches spectrum.py
DRAFT_ROUNDS = [1, 2, 3, 4]  # matches build.py's DRAFT_ROUNDS
PICK_FUTURES_HORIZON_YEARS = 3  # matches build.py's PICK_FUTURES_HORIZON_YEARS

# "Carries strong dynasty value" floor (0-9999 KTC scale) and "recent dip"
# thresholds for buy_low_targets — Tommy's own read of what counts as
# notable on today's market, not derived from anything statistical.
BUYLOW_VALUE_FLOOR = 3000
BUYLOW_MIN_SEASON_GAMES = 4
BUYLOW_MIN_DIP_PCT = 0.20  # recent-3 PPG at least 20% below season PPG to qualify


def _values(offline: bool = True) -> tuple[dict[str, int], dict[str, int]]:
    dynasty_values, _ = valuation.values_by_name(offline=offline)
    redraft_values, _ = valuation.redraft_values_by_name(offline=offline)
    return dynasty_values, redraft_values


def _position_ratings(
    roster: list[tuple[int, frozenset[int], str]],
    values_by_pid: dict[int, float],
    starting_slots: list[int],
) -> dict[str, dict]:
    """Per position: starter-tier value (top N players' value, N = that
    position's own dedicated-slot count) and depth value (every other
    rostered player at that position, beyond that top tier)."""
    dedicated_count: dict[str, int] = defaultdict(int)
    for slot_id in starting_slots:
        pos = DEDICATED_SLOT_TO_POSITION.get(slot_id)
        if pos:
            dedicated_count[pos] += 1

    by_position: dict[str, list[float]] = defaultdict(list)
    for pid, _elig, position in roster:
        by_position[position].append(values_by_pid.get(pid, 0.0))

    ratings = {}
    for position, values in by_position.items():
        values.sort(reverse=True)
        n = max(dedicated_count.get(position, 0), 1)
        ratings[position] = {
            "starter": round(sum(values[:n]), 0),
            "depth": round(sum(values[n:]), 0),
            "count": len(values),
        }
    return ratings


def _pick_value(season: int, round_: int, pick_curves: dict) -> float:
    row = parse.pick_values_for_season(season, pick_curves).get(str(round_))
    return (sum(row) / len(row)) if row else 0.0


def _team_snapshot(
    roster: list[tuple[int, frozenset[int], str]],
    dynasty_by_pid: dict[int, float],
    redraft_by_pid: dict[int, float],
    starting_slots: list[int],
    pick_capital: float,
) -> dict:
    dynasty_roster_value = sum(dynasty_by_pid.get(pid, 0.0) for pid, _e, _p in roster)
    contending_value = metrics.redraft_lineup_value(
        [(pid, elig) for pid, elig, _p in roster], redraft_by_pid, starting_slots)
    rebuilding_value = (ROSTER_WEIGHT * dynasty_roster_value + pick_capital) / (ROSTER_WEIGHT + 1)
    return {
        "contending_value": round(contending_value, 0),
        "dynasty_roster_value": round(dynasty_roster_value, 0),
        "future_pick_capital": round(pick_capital, 0),
        "rebuilding_value": round(rebuilding_value, 0),
        "positions": _position_ratings(roster, dynasty_by_pid, starting_slots),
    }


def cmd_simulate_trade(payload: dict) -> dict:
    season = payload.get("season") or config.SEASON
    team_a_id = int(payload["team_a"])
    team_b_id = int(payload["team_b"])
    a_out = payload.get("team_a_out") or {}
    b_out = payload.get("team_b_out") or {}
    a_out_players = set(a_out.get("players") or [])
    b_out_players = set(b_out.get("players") or [])
    a_out_picks = a_out.get("picks") or []   # [{season, round}, ...]
    b_out_picks = b_out.get("picks") or []

    league = parse.load_league(season)
    dynasty_values, redraft_values = _values()
    dynasty_by_pid = parse.values_by_pid(season, dynasty_values)
    redraft_by_pid = parse.values_by_pid(season, redraft_values)
    pick_curves, _ = valuation.pick_curve_by_year(offline=True)

    rosters = parse.current_roster_players_with_position(season)
    roster_a = rosters.get(team_a_id, [])
    roster_b = rosters.get(team_b_id, [])
    by_pid_a = {p[0]: p for p in roster_a}
    by_pid_b = {p[0]: p for p in roster_b}

    missing = [pid for pid in a_out_players if pid not in by_pid_a] + \
              [pid for pid in b_out_players if pid not in by_pid_b]
    if missing:
        raise ValueError(f"Player(s) not found on the expected team's current roster: {missing}")

    roster_a_after = [p for p in roster_a if p[0] not in a_out_players] + \
                      [by_pid_b[pid] for pid in b_out_players]
    roster_b_after = [p for p in roster_b if p[0] not in b_out_players] + \
                      [by_pid_a[pid] for pid in a_out_players]

    all_picks = pick_tracking.all_picks_board(
        season, list(league.teams), DRAFT_ROUNDS,
        metrics.pick_ownership(0), horizon_years=PICK_FUTURES_HORIZON_YEARS)
    pick_capital_by_team: dict[int, float] = defaultdict(float)
    for p in all_picks:
        pick_capital_by_team[p["current_owner_id"]] += _pick_value(p["season"], p["round"], pick_curves)

    a_picks_out_value = sum(_pick_value(p["season"], p["round"], pick_curves) for p in a_out_picks)
    b_picks_out_value = sum(_pick_value(p["season"], p["round"], pick_curves) for p in b_out_picks)
    pick_capital_a_after = pick_capital_by_team[team_a_id] - a_picks_out_value + b_picks_out_value
    pick_capital_b_after = pick_capital_by_team[team_b_id] - b_picks_out_value + a_picks_out_value

    return {
        "team_a": {
            "team_id": team_a_id,
            "before": _team_snapshot(roster_a, dynasty_by_pid, redraft_by_pid,
                                      league.starting_slots, pick_capital_by_team[team_a_id]),
            "after": _team_snapshot(roster_a_after, dynasty_by_pid, redraft_by_pid,
                                     league.starting_slots, pick_capital_a_after),
        },
        "team_b": {
            "team_id": team_b_id,
            "before": _team_snapshot(roster_b, dynasty_by_pid, redraft_by_pid,
                                      league.starting_slots, pick_capital_by_team[team_b_id]),
            "after": _team_snapshot(roster_b_after, dynasty_by_pid, redraft_by_pid,
                                     league.starting_slots, pick_capital_b_after),
        },
    }


def cmd_buy_low_targets(payload: dict) -> dict:
    season = payload.get("season") or config.SEASON
    exclude_team_id = payload.get("exclude_team_id")
    league = parse.load_league(season)
    dynasty_values, _ = _values()
    names = parse.global_player_names()
    dynasty_by_pid = parse.values_by_pid(season, dynasty_values)
    rosters = parse.current_roster_players_with_position(season)

    # Rostered-by-someone-else, real dynasty value, real position — build
    # this first so a player who's on nobody's roster in this league (no
    # trade partner possible) never gets considered at all.
    owner_by_pid: dict[int, int] = {}
    position_by_pid: dict[int, str] = {}
    for team_id, roster in rosters.items():
        if team_id == exclude_team_id:
            continue
        for pid, _elig, position in roster:
            owner_by_pid[pid] = team_id
            position_by_pid[pid] = position

    performance = parse.recent_player_performance(league, limit=99)

    candidates = []
    for pid, entries in performance.items():
        if pid not in owner_by_pid:
            continue
        value = dynasty_by_pid.get(pid, 0.0)
        if value < BUYLOW_VALUE_FLOOR:
            continue
        if len(entries) < BUYLOW_MIN_SEASON_GAMES:
            continue
        season_ppg = sum(e["points"] for e in entries) / len(entries)
        if season_ppg <= 0:
            continue
        recent = entries[:3]
        recent_ppg = sum(e["points"] for e in recent) / len(recent)
        dip = season_ppg - recent_ppg
        dip_pct = dip / season_ppg
        if dip_pct < BUYLOW_MIN_DIP_PCT:
            continue
        candidates.append({
            "player_id": pid,
            "name": names.get(pid, f"Player {pid}"),
            "position": position_by_pid.get(pid, "?"),
            "owner_team_id": owner_by_pid[pid],
            "dynasty_value": round(value, 0),
            "season_games": len(entries),
            "season_ppg": round(season_ppg, 1),
            "recent_ppg": round(recent_ppg, 1),
            "dip_pct": round(dip_pct, 3),
        })

    candidates.sort(key=lambda c: c["dip_pct"], reverse=True)
    return {"season": season, "candidates": candidates}


def cmd_league_positions(payload: dict) -> dict:
    """Every team's per-position starter-tier/depth rating, current
    rosters, dynasty value — the same computation `simulate_trade` already
    does for two teams at once, run for all of them, so "who's actually
    strong at RB right now" is a single glance instead of running the
    trade analyzer team-by-team."""
    season = payload.get("season") or config.SEASON
    league = parse.load_league(season)
    dynasty_values, _ = _values()
    dynasty_by_pid = parse.values_by_pid(season, dynasty_values)
    rosters = parse.current_roster_players_with_position(season)

    teams = {
        team_id: _position_ratings(roster, dynasty_by_pid, league.starting_slots)
        for team_id, roster in rosters.items()
    }
    return {"season": season, "teams": teams}


def cmd_trade_partners(payload: dict) -> dict:
    """For `my_team_id`, every other team ranked by mutual positional fit.

    Per position: value = starter + depth (total dynasty value rostered
    there). A team's "need" at a position is how far below the league
    average their value sits (as a fraction of that average); "surplus" is
    how far above. Fit score between two teams sums, over every position,
    (my need * their surplus) + (their need * my surplus) — high when each
    side is strong exactly where the other is thin. Ratios rather than raw
    value differences so positions with very different value scales (RB
    pool vs. TE pool, K/D-ST carrying ~0 either way) compare on the same
    footing without hardcoding a per-position weight."""
    season = payload.get("season") or config.SEASON
    my_team_id = int(payload["my_team_id"])
    league = parse.load_league(season)
    dynasty_values, _ = _values()
    dynasty_by_pid = parse.values_by_pid(season, dynasty_values)
    rosters = parse.current_roster_players_with_position(season)

    if my_team_id not in rosters:
        raise ValueError(f"Team {my_team_id} not found in current rosters")

    ratings_by_team = {
        team_id: _position_ratings(roster, dynasty_by_pid, league.starting_slots)
        for team_id, roster in rosters.items()
    }
    positions = sorted({pos for ratings in ratings_by_team.values() for pos in ratings})
    total_value = {
        team_id: {
            pos: ratings.get(pos, {}).get("starter", 0) + ratings.get(pos, {}).get("depth", 0)
            for pos in positions
        }
        for team_id, ratings in ratings_by_team.items()
    }
    league_avg = {
        pos: sum(total_value[tid][pos] for tid in total_value) / len(total_value)
        for pos in positions
    }

    def need_surplus(team_id: int) -> tuple[dict[str, float], dict[str, float]]:
        need, surplus = {}, {}
        for pos in positions:
            avg = league_avg[pos]
            if avg <= 0:
                need[pos] = surplus[pos] = 0.0
                continue
            diff = (total_value[team_id][pos] - avg) / avg
            need[pos] = max(0.0, -diff)
            surplus[pos] = max(0.0, diff)
        return need, surplus

    my_need, my_surplus = need_surplus(my_team_id)

    partners = []
    for team_id in total_value:
        if team_id == my_team_id:
            continue
        their_need, their_surplus = need_surplus(team_id)
        matches = []
        fit_score = 0.0
        for pos in positions:
            they_help_you = my_need[pos] * their_surplus[pos]
            you_help_them = their_need[pos] * my_surplus[pos]
            if they_help_you > 0:
                matches.append({"position": pos, "direction": "they_help_you", "contribution": round(they_help_you, 3)})
                fit_score += they_help_you
            if you_help_them > 0:
                matches.append({"position": pos, "direction": "you_help_them", "contribution": round(you_help_them, 3)})
                fit_score += you_help_them
        matches.sort(key=lambda m: m["contribution"], reverse=True)
        partners.append({"team_id": team_id, "fit_score": round(fit_score, 3), "matches": matches})

    partners.sort(key=lambda p: p["fit_score"], reverse=True)
    return {"season": season, "my_team_id": my_team_id, "partners": partners}


COMMANDS = {
    "simulate_trade": cmd_simulate_trade,
    "buy_low_targets": cmd_buy_low_targets,
    "league_positions": cmd_league_positions,
    "trade_partners": cmd_trade_partners,
}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(json.dumps({"error": f"usage: trade_analyzer_tool.py {'|'.join(COMMANDS)}  (JSON on stdin)"}))
        sys.exit(1)

    payload = json.loads(sys.stdin.read() or "{}")
    try:
        result = COMMANDS[sys.argv[1]](payload)
    except Exception as e:  # noqa: BLE001 — always return JSON, even on failure
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
