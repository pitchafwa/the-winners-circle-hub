"""All derived stats: optimal lineups, coach ratings, all-play, luck,
weekly superlatives, power rankings.

Pure math over parsed cache data — no network. Award values are omitted
(not zeroed) when no qualifying candidate exists: a missing number should
look missing.
"""
from __future__ import annotations

import statistics
from collections import defaultdict
from dataclasses import dataclass

import numpy as np
from scipy.optimize import linear_sum_assignment

from parse import IR_SLOT, LeagueData, PlayerWeek, TeamWeek, SLOT_NAMES

# ---------------------------------------------------------------------------
# Power ranking weights — the one place to tune the blend
# ---------------------------------------------------------------------------
POWER_WEIGHTS = {
    "all_play": 0.40,   # all-play win %
    "points_for": 0.30, # normalized PF
    "trend": 0.20,      # last-3-weeks scoring
    "roster": 0.10,     # starters' season averages
}

WAIVER_HERO_WINDOW_MS = 14 * 24 * 3600 * 1000

# Trophy-case point values — tune here. Negative awards cost points, which is
# the entire fun of the Superlative Champion race.
AWARD_META = {
    "highest_score":     {"label": "Highest Score",     "points": 3,
                          "description": "Most points scored by any team this week.",
                          "tone": "gold"},
    "best_coach":        {"label": "Best Coach",        "points": 3,
                          "description": "Highest share of the best possible lineup's points actually started.",
                          "tone": "gold"},
    "blowout":           {"label": "The Blowout",       "points": 2,
                          "description": "Largest margin of victory in a single matchup this week.",
                          "tone": "positive"},
    "projection_buster": {"label": "Projection Buster", "points": 2,
                          "description": "Biggest single-player overperformance vs. their projection.",
                          "tone": "positive"},
    "waiver_hero":       {"label": "Waiver Hero",       "points": 2,
                          "description": "Best-scoring starter picked up off waivers or free agency in the last two weeks.",
                          "tone": "positive"},
    "nail_biter":        {"label": "Nail-biter",        "points": 1,
                          "description": "Smallest margin of victory in a single matchup this week.",
                          "tone": "positive"},
    "luckiest":          {"label": "Luckiest Win",      "points": 1,
                          "description": "Won this week despite scoring below the week's median.",
                          "tone": "neutral"},
    "unluckiest":        {"label": "Hard-luck Loser",   "points": 0,
                          "description": "Lost this week despite scoring above the week's median.",
                          "tone": "neutral"},
    "bust":              {"label": "The Bust",          "points": -1,
                          "description": "Biggest single-player underperformance vs. their projection (min. 10 projected points).",
                          "tone": "negative"},
    "worst_benching":    {"label": "Worst Benching",    "points": -2,
                          "description": "Largest-scoring benched player who outscored a starter eligible for their slot.",
                          "tone": "negative"},
    "lowest_score":      {"label": "Lowest Score",      "points": -2,
                          "description": "Fewest points scored by any team this week.",
                          "tone": "negative"},
}

_FORBIDDEN = -1e9


# ---------------------------------------------------------------------------
# 4.1 Optimal lineup — maximum-weight bipartite matching (players x slots)
# ---------------------------------------------------------------------------
def optimal_lineup(candidates: list[PlayerWeek], starting_slots: list[int]) -> tuple[float, list[tuple[int, PlayerWeek | None]]]:
    """Max-points valid lineup for one team-week.

    candidates: every rosterable player that week EXCEPT those slotted on IR
    (an IR player could not legally have started without a roster move).
    Bench players are candidates; bye/unplayed players score 0 but remain
    eligible. Eligibility comes from ESPN's eligibleSlots, not position.

    Returns (optimal_points, [(slot_id, player_or_None), ...]). A slot is
    returned with None (contributing 0) when no rostered player can fill it —
    or when leaving it empty beats every eligible player (negative scorers).
    """
    n, m = len(candidates), len(starting_slots)
    if m == 0:
        return 0.0, []

    # m dummy rows at cost 0 = the always-legal option of an empty slot
    cost = np.full((n + m, m), _FORBIDDEN)
    cost[n:, :] = 0.0
    for i, p in enumerate(candidates):
        for j, slot in enumerate(starting_slots):
            if slot in p.eligible_slots:
                cost[i, j] = p.actual

    row_ind, col_ind = linear_sum_assignment(cost, maximize=True)
    total = 0.0
    assignment: list[tuple[int, PlayerWeek | None]] = []
    for r, c in zip(row_ind, col_ind):
        slot = starting_slots[c]
        if r < n and cost[r, c] > _FORBIDDEN / 2:
            total += candidates[r].actual
            assignment.append((slot, candidates[r]))
        else:
            assignment.append((slot, None))
    return round(total, 2), assignment


# ---------------------------------------------------------------------------
# 4.1b Static market-value lineup — same matching, priced on a KTC value
# instead of a week's actual score. Shared by the playoff-odds roster-
# strength shift and the contend/rebuild spectrum's "contending value" so
# both reflect one real-world-calibrated notion of team strength.
# ---------------------------------------------------------------------------
DST_SLOT = 16
K_SLOT = 17
# D/ST and K redraft/dynasty market prices are noise, not signal, for
# roster-strength purposes — excluded entirely rather than counted.
VALUATION_EXCLUDED_SLOTS = {DST_SLOT, K_SLOT}
# FantasyPros' own power rankings score starters only, no bench — but
# real bench depth has real (smaller) value as injury/breakout insurance,
# so it's included as a minority share rather than zero or full weight.
BENCH_WEIGHT = 0.10


def best_lineup(players: list[tuple[int, frozenset[int], float]],
                 starting_slots: list[int]) -> tuple[float, set[int], dict[int, int]]:
    """Max-weight legal starting lineup — generic version of the matching
    `optimal_lineup`/`redraft_lineup_value` each run, parameterized directly
    on (player_id, eligible_slots, value) tuples so a caller can feed
    whatever notion of "value" it needs (actual points, projected points,
    a real/projected blend, market price) without this function caring
    which. Returns (total_value, assigned player_ids, {player_id: slot_id})
    — the assigned set is what `optimal_week_projection` needs to separate
    "already played" from "still projected" within the SAME optimal
    lineup, and the per-player slot is what lets a caller show a real
    lineup (who started at QB, who was the FLEX) instead of just a total."""
    n, m = len(players), len(starting_slots)
    if m == 0 or n == 0:
        return 0.0, set(), {}
    cost = np.full((n + m, m), _FORBIDDEN)
    cost[n:, :] = 0.0
    for i, (pid, eligible, value) in enumerate(players):
        for j, slot in enumerate(starting_slots):
            if slot in eligible:
                cost[i, j] = value
    row_ind, col_ind = linear_sum_assignment(cost, maximize=True)
    total = 0.0
    assigned: set[int] = set()
    slot_by_player: dict[int, int] = {}
    for r, c in zip(row_ind, col_ind):
        if r < n and cost[r, c] > _FORBIDDEN / 2:
            total += cost[r, c]
            pid = players[r][0]
            assigned.add(pid)
            slot_by_player[pid] = c  # slot INDEX into starting_slots, not the raw slot id — lets a caller sort a lineup back into the league's real slot order
    return total, assigned, slot_by_player


def redraft_lineup_value(players: list[tuple[int, frozenset[int]]], values_by_pid: dict[int, float],
                          starting_slots: list[int], bench_weight: float = BENCH_WEIGHT) -> float:
    """One roster-strength number: best-possible starting lineup value
    (the dominant signal, via the same max-weight bipartite matching
    `optimal_lineup` uses for a real played week) plus a smaller credit
    for the rest of the roster's value (`bench_weight`, default 10%) —
    real bench depth has some insurance value, just not equal to a
    starter's. D/ST and K are excluded entirely from both the starting-
    slot count and the candidate pool (`VALUATION_EXCLUDED_SLOTS`)."""
    slots = [s for s in starting_slots if s not in VALUATION_EXCLUDED_SLOTS]
    candidates = [(pid, elig) for pid, elig in players if not (elig & VALUATION_EXCLUDED_SLOTS)]
    n, m = len(candidates), len(slots)
    if m == 0 or n == 0:
        return 0.0

    cost = np.full((n + m, m), _FORBIDDEN)
    cost[n:, :] = 0.0
    for i, (pid, eligible) in enumerate(candidates):
        v = values_by_pid.get(pid, 0.0)
        for j, slot in enumerate(slots):
            if slot in eligible:
                cost[i, j] = v

    row_ind, col_ind = linear_sum_assignment(cost, maximize=True)
    assigned: set[int] = set()
    starting_value = 0.0
    for r, c in zip(row_ind, col_ind):
        if r < n and cost[r, c] > _FORBIDDEN / 2:
            starting_value += cost[r, c]
            assigned.add(candidates[r][0])
    bench_value = sum(values_by_pid.get(pid, 0.0) for pid, _ in candidates if pid not in assigned)
    return starting_value + bench_weight * bench_value


# ---------------------------------------------------------------------------
# 4.1c Real (not simulated) division race — current standing under this
# league's actual top-3-per-division, no-wildcards playoff format.
# ---------------------------------------------------------------------------
def current_records(league: LeagueData):
    """Wins/losses (ties=0.5 each), PF, and the H2H win table from decided
    regular-season games — shared by the Monte Carlo sim's per-draw seeding
    (`simulate.py`) and the real, current `division_race` below."""
    wins: dict[int, float] = defaultdict(float)
    losses: dict[int, float] = defaultdict(float)
    pf: dict[int, float] = defaultdict(float)
    h2h: dict[tuple[int, int], float] = defaultdict(float)
    for e in league.full_schedule:
        if (e.winner == "UNDECIDED" or e.away_id is None
                or e.matchup_period > league.reg_season_weeks):
            continue
        pf[e.home_id] += e.home_score
        pf[e.away_id] += e.away_score
        if e.winner == "HOME":
            wins[e.home_id] += 1
            losses[e.away_id] += 1
            h2h[(e.home_id, e.away_id)] += 1
        elif e.winner == "AWAY":
            wins[e.away_id] += 1
            losses[e.home_id] += 1
            h2h[(e.away_id, e.home_id)] += 1
        elif e.winner == "TIE":
            wins[e.home_id] += 0.5
            wins[e.away_id] += 0.5
            losses[e.home_id] += 0.5
            losses[e.away_id] += 0.5
            h2h[(e.home_id, e.away_id)] += 0.5
            h2h[(e.away_id, e.home_id)] += 0.5
    return wins, losses, pf, h2h


def division_race(league: LeagueData) -> dict[int, dict]:
    """Real, CURRENT (not simulated) division standing under this league's
    actual playoff format — top 3 per division make the playoffs, no
    wildcards (see `simulate.py`'s module docstring for how that was
    confirmed against real bracket data). Same tiebreak the Monte Carlo sim
    uses per draw (wins -> head-to-head among the exact-tied group -> PF),
    but with a deterministic team_id fallback instead of a random coin flip
    — this is one real number for display, not one draw among 10,000.

    Returns {team_id: {division_rank (1-based within division), games_back
    (0.0 for a current playoff spot; real GB from the division's 3rd-place
    cutline otherwise), cushion (games ahead of the first team out — only
    set for a playoff-spot team, else None)}}."""
    wins, losses, pf, h2h = current_records(league)

    def order(group: list[int]) -> list[int]:
        by_wins: dict[float, list[int]] = defaultdict(list)
        for t in group:
            by_wins[wins[t]].append(t)
        out = []
        for w in sorted(by_wins, reverse=True):
            tied_group = by_wins[w]
            ranked = sorted(tied_group, key=lambda t: (
                sum(h2h.get((t, o), 0) for o in tied_group if o != t),
                pf[t],
                -t,
            ), reverse=True)
            out.extend(ranked)
        return out

    by_division: dict[int, list[int]] = defaultdict(list)
    for tid, team in league.teams.items():
        by_division[team.division_id].append(tid)

    result: dict[int, dict] = {}
    for group in by_division.values():
        ranked = order(group)
        cutoff = min(3, len(ranked))  # top 3 make it, per the confirmed real format
        first_out_wins = wins[ranked[cutoff]] if len(ranked) > cutoff else None
        first_out_losses = losses[ranked[cutoff]] if len(ranked) > cutoff else None
        cut_wins = wins[ranked[cutoff - 1]] if cutoff >= 1 else 0.0
        cut_losses = losses[ranked[cutoff - 1]] if cutoff >= 1 else 0.0
        for i, tid in enumerate(ranked):
            rank = i + 1
            if rank <= cutoff:
                cushion = (
                    round(((wins[tid] - first_out_wins) + (first_out_losses - losses[tid])) / 2, 1)
                    if first_out_wins is not None else None
                )
                result[tid] = {"division_rank": rank, "games_back": 0.0, "cushion": cushion}
            else:
                gb = round(((cut_wins - wins[tid]) + (losses[tid] - cut_losses)) / 2, 1)
                result[tid] = {"division_rank": rank, "games_back": gb, "cushion": None}
    return result


def team_week_coach(tw: TeamWeek, starting_slots: list[int]) -> dict:
    """Coach quality is judged on lineup production only — the home-field
    bonus and commissioner adjustments in the official total aren't coaching."""
    candidates = [p for p in tw.lineup if p.slot_id != IR_SLOT]
    optimal, assignment = optimal_lineup(candidates, starting_slots)
    actual = tw.lineup_points
    rating = round(actual / optimal, 4) if optimal > 0 else None
    return {
        "actual": actual,
        "official_total": tw.total,
        "optimal": optimal,
        "rating": rating,
        "bench_lost": round(max(optimal - actual, 0.0), 2),
        "optimal_assignment": [
            {"slot": SLOT_NAMES.get(s, str(s)), "player_id": p.player_id if p else None,
             "player": p.name if p else None, "points": p.actual if p else None}
            for s, p in assignment
        ],
    }


def compute_coach(league: LeagueData) -> dict[int, dict]:
    """Per-team: weekly coach data + season aggregates."""
    out: dict[int, dict] = {t: {"weeks": {}, "season": {}} for t in league.teams}
    for week in league.completed_weeks():
        for m in league.weeks[week]:
            for tw in (m.home, m.away):
                if tw is None:
                    continue
                out[tw.team_id]["weeks"][week] = team_week_coach(tw, league.starting_slots)
    for team_id, data in out.items():
        weeks = data["weeks"]
        if not weeks:
            continue
        total_actual = round(sum(w["actual"] for w in weeks.values()), 2)
        total_optimal = round(sum(w["optimal"] for w in weeks.values()), 2)
        data["season"] = {
            "actual": total_actual,
            "optimal": total_optimal,
            "rating": round(total_actual / total_optimal, 4) if total_optimal else None,
            "bench_lost": round(sum(w["bench_lost"] for w in weeks.values()), 2),
        }
    return out


# ---------------------------------------------------------------------------
# 4.3 All-play & luck
# ---------------------------------------------------------------------------
def _weekly_scores(league: LeagueData) -> dict[int, tuple[dict[int, float], dict[int, str]]]:
    """(scores, results) per regular-season week. Prefers box-score data;
    falls back to the schedule scores for seasons without box-score caches
    (pre-2025 history), where matchup totals are all ESPN still serves."""
    weeks: dict[int, tuple[dict[int, float], dict[int, str]]] = {}
    if league.weeks:
        for week in league.regular_weeks():
            scores: dict[int, float] = {}
            results: dict[int, str] = {}
            for m in league.weeks[week]:
                scores[m.home.team_id] = m.home.total
                if m.away is not None:
                    scores[m.away.team_id] = m.away.total
                    if m.winner == "HOME":
                        results[m.home.team_id], results[m.away.team_id] = "W", "L"
                    elif m.winner == "AWAY":
                        results[m.home.team_id], results[m.away.team_id] = "L", "W"
                    elif m.winner == "TIE":
                        results[m.home.team_id] = results[m.away.team_id] = "T"
            weeks[week] = (scores, results)
        return weeks

    for s in league.full_schedule:
        if (s.winner == "UNDECIDED" or s.is_playoff or s.away_id is None
                or s.matchup_period > league.reg_season_weeks):
            continue
        if s.home_score == 0 and s.away_score == 0:
            continue  # decided matchup with no score data — treat as missing
        scores, results = weeks.setdefault(s.matchup_period, ({}, {}))
        scores[s.home_id], scores[s.away_id] = s.home_score, s.away_score
        if s.winner == "HOME":
            results[s.home_id], results[s.away_id] = "W", "L"
        elif s.winner == "AWAY":
            results[s.home_id], results[s.away_id] = "L", "W"
        elif s.winner == "TIE":
            results[s.home_id] = results[s.away_id] = "T"
    return weeks


def compute_all_play(league: LeagueData) -> dict[int, dict]:
    """Regular-season all-play records, expected wins, and luck index."""
    out = {t: {"weeks": {}, "wins": 0, "losses": 0, "ties": 0,
               "actual_wins": 0.0, "expected_wins": 0.0} for t in league.teams}

    for week, (scores, results) in sorted(_weekly_scores(league).items()):
        n = len(scores)
        if n < 2:
            continue
        for tid, s in scores.items():
            wins = sum(1 for o, os_ in scores.items() if o != tid and s > os_)
            ties = sum(1 for o, os_ in scores.items() if o != tid and s == os_)
            losses = n - 1 - wins - ties
            expected = (wins + 0.5 * ties) / (n - 1)
            out[tid]["weeks"][week] = {"wins": wins, "losses": losses, "ties": ties,
                                       "expected_wins": round(expected, 4),
                                       "result": results.get(tid)}
            out[tid]["wins"] += wins
            out[tid]["losses"] += losses
            out[tid]["ties"] += ties
            out[tid]["expected_wins"] += expected
            r = results.get(tid)
            if r == "W":
                out[tid]["actual_wins"] += 1
            elif r == "T":
                out[tid]["actual_wins"] += 0.5

    for tid, d in out.items():
        games = d["wins"] + d["losses"] + d["ties"]
        d["pct"] = round((d["wins"] + 0.5 * d["ties"]) / games, 4) if games else None
        d["expected_wins"] = round(d["expected_wins"], 2)
        d["luck"] = round(d["actual_wins"] - d["expected_wins"], 2) if games else None
    return out


# ---------------------------------------------------------------------------
# 4.2 Weekly superlatives
# ---------------------------------------------------------------------------
@dataclass
class Award:
    week: int
    award_key: str
    team_id: int
    value: float
    detail: str


def _fmt(x: float) -> str:
    return f"{x:.1f}" if x == round(x, 1) else f"{x:.2f}"


def compute_superlatives(league: LeagueData, coach: dict[int, dict]) -> list[Award]:
    awards: list[Award] = []
    tname = {tid: t.name for tid, t in league.teams.items()}

    for week in league.completed_weeks():
        matchups = league.weeks[week]
        # playoff weeks: only teams still alive are really playing — consolation
        # games don't earn (or suffer) awards
        if any(m.is_playoff for m in matchups):
            matchups = [m for m in matchups if m.playoff_tier == "WINNERS_BRACKET"]
        # Regular-season-only past this point, with three exceptions: playoff
        # teams play strictly fewer real opponents than the field did all
        # year, so letting them keep racking up highest-score/blowout/etc.
        # trophies in the playoffs would unfairly pad their trophy count vs.
        # teams whose season ended in week reg_season_weeks. Worst benching,
        # the bust, and the projection buster are single-decision/single-player
        # mistakes rather than "did you have the best week" wins, so those
        # keep accumulating every week, playoffs included.
        reg_season_only = week <= league.reg_season_weeks
        team_weeks: list[TeamWeek] = []
        margins: list[tuple[float, TeamWeek, TeamWeek]] = []  # (margin, winner, loser)
        winners: list[TeamWeek] = []
        losers: list[TeamWeek] = []
        for m in matchups:
            team_weeks.append(m.home)
            if m.away is None:
                continue
            team_weeks.append(m.away)
            if m.winner == "HOME":
                margins.append((round(m.home.total - m.away.total, 2), m.home, m.away))
                winners.append(m.home)
                losers.append(m.away)
            elif m.winner == "AWAY":
                margins.append((round(m.away.total - m.home.total, 2), m.away, m.home))
                winners.append(m.away)
                losers.append(m.home)
            elif m.winner == "TIE":
                margins.append((0.0, m.home, m.away))

        if not team_weeks:
            continue

        if reg_season_only:
            # Highest / lowest score
            hi = max(team_weeks, key=lambda t: t.total)
            lo = min(team_weeks, key=lambda t: t.total)
            awards.append(Award(week, "highest_score", hi.team_id, hi.total,
                                f"{tname[hi.team_id]} put up {_fmt(hi.total)}, the week's top score"))
            awards.append(Award(week, "lowest_score", lo.team_id, lo.total,
                                f"{tname[lo.team_id]} managed just {_fmt(lo.total)}"))

            # Best coach — highest rating, tiebreak fewer bench points lost
            rated = [(tid, coach[tid]["weeks"][week]) for tid in coach
                     if week in coach[tid]["weeks"] and coach[tid]["weeks"][week]["rating"] is not None]
            if rated:
                tid, cw = max(rated, key=lambda kv: (kv[1]["rating"], -kv[1]["bench_lost"]))
                awards.append(Award(week, "best_coach", tid, round(cw["rating"] * 100, 1),
                                    f"{tname[tid]} started {_fmt(cw['actual'])} of a possible "
                                    f"{_fmt(cw['optimal'])} ({cw['rating']:.1%})"))

        # Worst benching — largest benched score that beat an eligible starter
        best_bench: tuple[float, float, int, PlayerWeek, PlayerWeek] | None = None
        for tw in team_weeks:
            for b in tw.bench():
                eligible_starters = [s for s in tw.starters() if s.slot_id in b.eligible_slots]
                if not eligible_starters:
                    continue
                worst_starter = min(eligible_starters, key=lambda s: s.actual)
                if b.actual > worst_starter.actual:
                    key = (b.actual, b.actual - worst_starter.actual)
                    if best_bench is None or key > (best_bench[0], best_bench[1]):
                        best_bench = (b.actual, b.actual - worst_starter.actual,
                                      tw.team_id, worst_starter, b)
        if best_bench:
            _, _, tid, s, b = best_bench
            awards.append(Award(week, "worst_benching", tid, b.actual,
                                f"{tname[tid]} started {s.name} for {_fmt(s.actual)} "
                                f"and sat {b.name} for {_fmt(b.actual)}"))

        if reg_season_only:
            # Blowout / nail-biter
            if margins:
                mg, w_, l_ = max(margins, key=lambda x: x[0])
                awards.append(Award(week, "blowout", w_.team_id, mg,
                                    f"{tname[w_.team_id]} beat {tname[l_.team_id]} by {_fmt(mg)} "
                                    f"({_fmt(w_.total)}–{_fmt(l_.total)})"))
                mg, w_, l_ = min(margins, key=lambda x: x[0])
                detail = (f"{tname[w_.team_id]} and {tname[l_.team_id]} tied at {_fmt(w_.total)}"
                          if mg == 0.0 and any(m.winner == "TIE" for m in matchups)
                          else f"{tname[w_.team_id]} edged {tname[l_.team_id]} by {_fmt(mg)} "
                               f"({_fmt(w_.total)}–{_fmt(l_.total)})")
                awards.append(Award(week, "nail_biter", w_.team_id, mg, detail))

            # Luck: unluckiest / luckiest vs the week's median
            scores = [t.total for t in team_weeks]
            median = statistics.median(scores)
            if losers:
                above = [t for t in losers if t.total > median]
                pick = max(above, key=lambda t: t.total) if above else max(losers, key=lambda t: t.total)
                qual = "lost despite beating the weekly median" if above else "was the week's highest-scoring loser"
                awards.append(Award(week, "unluckiest", pick.team_id, pick.total,
                                    f"{tname[pick.team_id]} {qual} with {_fmt(pick.total)}"))
            if winners:
                below = [t for t in winners if t.total < median]
                pick = min(below, key=lambda t: t.total) if below else min(winners, key=lambda t: t.total)
                qual = "won while scoring below the weekly median" if below else "was the week's lowest-scoring winner"
                awards.append(Award(week, "luckiest", pick.team_id, pick.total,
                                    f"{tname[pick.team_id]} {qual} with {_fmt(pick.total)}"))

        # Projection buster / bust (starters only)
        projected = [(tw.team_id, p) for tw in team_weeks for p in tw.starters()
                     if p.projected is not None]
        if projected:
            tid, p = max(projected, key=lambda kv: kv[1].actual - kv[1].projected)
            diff = round(p.actual - p.projected, 2)
            if diff > 0:
                awards.append(Award(week, "projection_buster", tid, diff,
                                    f"{p.name} scored {_fmt(p.actual)} against a "
                                    f"{_fmt(p.projected)} projection for {tname[tid]}"))
            busts = [(tid_, p_) for tid_, p_ in projected if p_.projected >= 10]
            if busts:
                tid, p = min(busts, key=lambda kv: kv[1].actual - kv[1].projected)
                diff = round(p.actual - p.projected, 2)
                if diff < 0:
                    awards.append(Award(week, "bust", tid, diff,
                                        f"{p.name} was projected {_fmt(p.projected)} "
                                        f"but scored {_fmt(p.actual)} for {tname[tid]}"))

        # Waiver hero — best starter added via waivers/FA in the last 14 days
        week_end = league.week_end_dates.get(week)
        if reg_season_only and week_end and league.adds:
            heroes = []
            for tw in team_weeks:
                for p in tw.starters():
                    dates = league.adds.get((tw.team_id, p.player_id), [])
                    if any(0 <= week_end - d <= WAIVER_HERO_WINDOW_MS for d in dates):
                        heroes.append((tw.team_id, p))
            if heroes:
                tid, p = max(heroes, key=lambda kv: kv[1].actual)
                awards.append(Award(week, "waiver_hero", tid, p.actual,
                                    f"{p.name}, a fresh pickup for {tname[tid]}, "
                                    f"scored {_fmt(p.actual)}"))

    return awards


# ---------------------------------------------------------------------------
# §6 extras: schedule swap, consistency, positional heatmap
# ---------------------------------------------------------------------------
def compute_schedule_swap(league: LeagueData) -> list[dict]:
    """records[a][b] = A's record if A had played B's schedule.

    Week by week, A's actual score faces B's opponent's actual score; when
    B's opponent that week was A itself, A faces B's score instead.
    """
    weekly = _weekly_scores(league)
    # opponents must come from the same source (and week keys) as _weekly_scores
    opponents: dict[int, dict[int, int]] = {t: {} for t in league.teams}
    if league.weeks:
        for week in league.regular_weeks():
            for m in league.weeks[week]:
                if m.away is None:
                    continue
                opponents[m.home.team_id][week] = m.away.team_id
                opponents[m.away.team_id][week] = m.home.team_id
    else:
        for e in league.full_schedule:
            if (e.winner == "UNDECIDED" or e.away_id is None
                    or e.matchup_period > league.reg_season_weeks):
                continue
            opponents[e.home_id][e.matchup_period] = e.away_id
            opponents[e.away_id][e.matchup_period] = e.home_id

    out = []
    for a in league.teams:
        records = {}
        for b in league.teams:
            w = l = t = 0
            for week, (scores, _results) in weekly.items():
                if a not in scores:
                    continue
                opp = opponents.get(b, {}).get(week)
                if opp is None:
                    continue
                target = b if opp == a else opp
                if target == a or target not in scores:
                    continue
                if scores[a] > scores[target]:
                    w += 1
                elif scores[a] < scores[target]:
                    l += 1
                else:
                    t += 1
            records[str(b)] = {"wins": w, "losses": l, "ties": t}
        out.append({"team_id": a, "records": records})
    return out


def compute_consistency(league: LeagueData) -> dict[int, float | None]:
    """Stdev of weekly scores, regular season. Lower = steadier."""
    weekly = _weekly_scores(league)
    out: dict[int, float | None] = {}
    for tid in league.teams:
        scores = [s[tid] for s, _ in weekly.values() if tid in s]
        out[tid] = round(statistics.stdev(scores), 2) if len(scores) > 1 else None
    return out


def compute_positions(league: LeagueData) -> dict:
    """Per team x position: average started points per week vs league average."""
    per: dict[int, dict[str, list[float]]] = {t: {} for t in league.teams}
    for week in league.completed_weeks():
        if week > league.reg_season_weeks:
            continue
        for m in league.weeks[week]:
            for tw in (m.home, m.away):
                if tw is None:
                    continue
                by_pos: dict[str, float] = {}
                for p in tw.starters():
                    by_pos[p.position] = by_pos.get(p.position, 0.0) + p.actual
                for pos, total in by_pos.items():
                    per[tw.team_id].setdefault(pos, []).append(total)

    positions = sorted({pos for d in per.values() for pos in d},
                       key=lambda p: ["QB", "RB", "WR", "TE", "D/ST", "K"].index(p)
                       if p in ["QB", "RB", "WR", "TE", "D/ST", "K"] else 99)
    league_avg = {
        pos: round(statistics.mean([v for d in per.values() for v in d.get(pos, [])]), 2)
        for pos in positions if any(d.get(pos) for d in per.values())
    }
    rows = []
    for tid, d in per.items():
        values = {}
        for pos in positions:
            if d.get(pos):
                avg = round(statistics.mean(d[pos]), 2)
                values[pos] = {"avg": avg, "diff": round(avg - league_avg[pos], 2)}
            else:
                values[pos] = None
        rows.append({"team_id": tid, "values": values})
    return {"positions": positions, "league_avg": league_avg, "rows": rows}


# ---------------------------------------------------------------------------
# §6 draft report card
# ---------------------------------------------------------------------------
def _letter_grade(rank: int, n: int) -> str:
    letters = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"]
    return letters[min(rank * len(letters) // max(n, 1), len(letters) - 1)]


def _pick_expected_value(pick_values: dict, round_: int, round_pick: int) -> float | None:
    """Standardized value-curve lookup (see ingest/pick_values.json) — a
    pick's expected value is a fixed external number (KeepTradeCut's real
    rookie-pick dynasty market, 1QB format), not derived from what this
    specific class's players turned out to be worth. That's the deliberate
    fix for comparing draft classes across different years: the old
    within-class approach made 1.01's "expected value" whatever this year's
    class happened to produce, so a strong class and a weak class weren't
    comparable to each other at all, even at the same pick number.
    None (never a fabricated number) when the pick falls outside what's on
    file — beyond round 4, or round_pick > 10 for a lookup context that only
    ever has a 10-team round anyway.
    """
    row = pick_values.get(str(round_))
    if not row or round_pick < 1 or round_pick > len(row):
        return None
    return row[round_pick - 1]


def compute_draft(league: LeagueData, picks: list[dict],
                  names: dict[int, str] | None = None,
                  dynasty_values: dict[str, int] | None = None,
                  valuation_updated_at: str | None = None,
                  pick_values: dict | None = None) -> dict | None:
    """Draft report card, graded on external dynasty market value — a
    baseline independent of this league's own season, so it can't fall into
    the self-referential trap above. Two separate grades, per league request:

    - HAUL: each team's share of the whole draft class's total current
      value. Answers "who ended up with the best assets," full stop, with no
      regard for what it cost in picks/trades to get there. Normalized to a
      share of that SEASON's class total (not a raw point total) specifically
      so a draft from years ago doesn't get retroactively punished as its
      players' careers wind down — every class decays, so relative share
      within the class stays meaningful no matter how much time has passed.
    - EFFICIENCY: each pick graded against a fixed, standardized pick-value
      curve (see ingest/pick_values.json / _pick_expected_value) — did this
      specific selection beat what that DRAFT SLOT itself is worth as an
      asset, using a real external market (KeepTradeCut rookie picks) that's
      the same regardless of which season's draft is being graded. This
      replaced an earlier within-class approach (comparing a pick to nearby
      same-position picks in that same draft) specifically because it made
      "expected value" drift with how strong or weak that one class
      happened to be — 1.01 in a stacked class and 1.01 in a weak class
      graded on different baselines, so different seasons' report cards
      weren't comparable to each other at all, even pick-for-pick.

    Also carries each pick's actual fantasy production (points/expected/diff)
    as informational context — real, but not what determines the grade.
    Unmatched players (manual entry we couldn't resolve to a player) and
    players outside the valuation source's ranked universe (essentially all
    D/ST and K — this dynasty league's users shouldn't expect keeper value
    there anyway) get explicit nulls or an honest 0, never a fabricated
    production estimate.
    """
    if not picks:
        return None

    names = {**player_names(league), **(names or {})}
    dynasty_values = dynasty_values or {}
    valuation_available = bool(dynasty_values)
    pick_values = pick_values or {}

    positions: dict[int, str] = {}
    totals: dict[int, float] = defaultdict(float)
    for week in league.completed_weeks():
        for m in league.weeks[week]:
            for tw in (m.home, m.away):
                if tw is None:
                    continue
                for p in tw.lineup:
                    positions.setdefault(p.player_id, p.position)
                    if p.played:
                        totals[p.player_id] += p.actual

    from parse import _normalize_name

    by_pos: dict[str, list[dict]] = defaultdict(list)
    unmatched_rows = []
    for p in picks:
        if p["player_id"] is None:
            unmatched_rows.append({
                **p, "name": p.get("player_name_raw") or "?", "position": "?",
                "points": None, "expected": None, "diff": None,
                "value": None, "expected_value": None, "value_diff": None,
            })
            continue
        pos = positions.get(p["player_id"], "?")
        by_pos[pos].append(p)

    rows = []
    for pos, plist in by_pos.items():
        plist.sort(key=lambda x: x["overall"])

        # informational only — real fantasy production, best-of-position
        # resort, kept for context but NOT used for grading (this is the
        # exact resort-matching shape that caused the original within-class
        # value bug, which is also why grading no longer resorts by value)
        fantasy_pts = [round(totals.get(p["player_id"], 0.0), 1) for p in plist] if league.weeks else None
        fantasy_expected = sorted(fantasy_pts, reverse=True) if fantasy_pts is not None else None

        for i, p in enumerate(plist):
            value = (dynasty_values.get(_normalize_name(names.get(p["player_id"]) or p.get("player_name_raw") or ""), 0)
                     if valuation_available else None)
            expected_value = _pick_expected_value(pick_values, p["round"], p["round_pick"])
            rows.append({
                **p,
                "name": names.get(p["player_id"]) or p.get("player_name_raw") or f"Player {p['player_id']}",
                "position": pos,
                "points": fantasy_pts[i] if fantasy_pts is not None else None,
                "expected": fantasy_expected[i] if fantasy_expected is not None else None,
                "diff": round(fantasy_pts[i] - fantasy_expected[i], 1) if fantasy_pts is not None else None,
                "value": value,
                "expected_value": expected_value,
                "value_diff": round(value - expected_value, 1)
                              if value is not None and expected_value is not None else None,
            })
    rows.extend(unmatched_rows)
    rows.sort(key=lambda x: x["overall"])

    # value-based grades need real valuation data — an empty lookup (fetch
    # failed, no cache yet) means an honest "not available" state, not
    # degenerate all-zero grades
    haul_grades: list[dict] = []
    efficiency_grades: list[dict] = []
    class_total = sum(r["value"] or 0 for r in rows)

    if valuation_available:
        # HAUL: share of the season's total value, normalized so aging
        # classes don't retroactively look like every pick busted
        team_value: dict[int, float] = defaultdict(float)
        for r in rows:
            team_value[r["team_id"]] += r["value"] or 0
        haul_ranked = sorted(team_value.items(), key=lambda kv: -kv[1])
        haul_grades = [
            {"team_id": tid, "total_value": round(v, 0),
             "share_pct": round(100 * v / class_total, 1) if class_total else None,
             "grade": _letter_grade(i, len(haul_ranked))}
            for i, (tid, v) in enumerate(haul_ranked)
        ]

        # EFFICIENCY: sum of value_diff — did you beat your slot
        team_diff: dict[int, float] = defaultdict(float)
        for r in rows:
            if r["value_diff"] is not None:
                team_diff[r["team_id"]] += r["value_diff"]
        eff_ranked = sorted(team_diff.items(), key=lambda kv: -kv[1])
        efficiency_grades = [
            {"team_id": tid, "total_diff": round(d, 1), "grade": _letter_grade(i, len(eff_ranked))}
            for i, (tid, d) in enumerate(eff_ranked)
        ]

    return {
        "picks": rows,
        "haul_grades": haul_grades,
        "efficiency_grades": efficiency_grades,
        "valuation_available": valuation_available,
        "valuation_updated_at": valuation_updated_at,
        "class_total_value": round(class_total, 0) if valuation_available else None,
    }


# ---------------------------------------------------------------------------
# §6b late-game swings — did the week's final games flip a matchup?
# ---------------------------------------------------------------------------
def compute_late_swings(league: LeagueData, week: int, pro_game_dates: dict[int, int]) -> list[dict]:
    """Matchups whose leader changed once the week's final wave of games (in
    practice, almost always Monday Night Football — but this buckets by
    whichever calendar day actually had the latest kickoff that week, so it
    still works for a holiday schedule quirk or a bye-heavy week) is counted.

    Needs pro_game_dates (see parse.pro_game_dates) — empty for any season
    that has no cached pro schedule, in which case this returns nothing
    rather than guessing.
    """
    if not pro_game_dates:
        return []
    to_day = lambda ms: ms // 86_400_000  # UTC calendar day
    final_day = max(to_day(d) for d in pro_game_dates.values())

    def split(tw: TeamWeek) -> tuple[float, float, list[PlayerWeek]]:
        early = late = 0.0
        late_players = []
        for p in tw.starters():
            if not p.played:
                continue
            game_date = pro_game_dates.get(p.pro_team_id)
            if game_date is not None and to_day(game_date) == final_day:
                late += p.actual
                late_players.append(p)
            else:
                early += p.actual
        return early, late, late_players

    swings = []
    for m in league.weeks.get(week, []):
        if m.away is None or m.winner not in ("HOME", "AWAY"):
            continue
        home_early, home_late, home_late_players = split(m.home)
        away_early, away_late, away_late_players = split(m.away)
        if home_late == 0 and away_late == 0:
            continue  # nobody had games left on the final day

        if home_early == away_early:
            continue
        leader_before = "HOME" if home_early > away_early else "AWAY"
        if leader_before == m.winner:
            continue  # no flip — final-day games didn't change the outcome

        mover_players = home_late_players if m.winner == "HOME" else away_late_players
        mover_players.sort(key=lambda p: p.actual, reverse=True)
        winner_tw, loser_tw = (m.home, m.away) if m.winner == "HOME" else (m.away, m.home)
        swings.append({
            "week": week,
            "winner_team_id": winner_tw.team_id,
            "loser_team_id": loser_tw.team_id,
            "deficit_before_final_day": round(abs(home_early - away_early), 2),
            "final_margin": round(abs(m.home.total - m.away.total), 2),
            "key_player": mover_players[0].name if mover_players else None,
            "key_player_points": mover_players[0].actual if mover_players else None,
        })
    return swings


# ---------------------------------------------------------------------------
# §7 weekly recap — template-driven, real numbers only, beat-writer register
# ---------------------------------------------------------------------------
def compute_recaps(league: LeagueData, awards: list[Award]) -> dict[int, str]:
    tname = {tid: t.name for tid, t in league.teams.items()}
    by_week: dict[int, dict[str, Award]] = {}
    for a in awards:
        by_week.setdefault(a.week, {})[a.award_key] = a

    recaps: dict[int, str] = {}
    for week, wk in sorted(by_week.items()):
        # rank the stories: benchings and blowouts lead if they're big enough
        stories: list[str] = []

        hi = wk.get("highest_score")
        lo = wk.get("lowest_score")
        bench = wk.get("worst_benching")
        blowout = wk.get("blowout")
        biter = wk.get("nail_biter")
        lucky = wk.get("luckiest")
        unlucky = wk.get("unluckiest")
        bust = wk.get("bust")
        hero = wk.get("waiver_hero")
        coach = wk.get("best_coach")

        if hi:
            stories.append(
                f"{tname[hi.team_id]} led the week at {_fmt(hi.value)}, "
                f"which is the kind of number that wins arguments in the group chat.")
        if bench and bench.value >= 20:
            stories.append(f"The benching of the week: {bench.detail} — "
                           "a decision that will not appear in anyone's coaching portfolio.")
        if blowout and blowout.value >= 35:
            stories.append(f"{blowout.detail}. It was over by the early window.")
        elif biter and biter.value <= 5:
            stories.append(f"{biter.detail} — the margin was {_fmt(biter.value)}, "
                           "and somebody's kicker has thoughts.")
        if unlucky and lucky and len(stories) < 3:
            stories.append(
                f"{unlucky.detail}, while {tname[lucky.team_id]} got away with one "
                f"at {_fmt(lucky.value)}. The schedule giveth.")
        if bust and len(stories) < 3:
            stories.append(f"{bust.detail}. Projections are a suggestion.")
        if hero and len(stories) < 3:
            stories.append(f"{hero.detail} — the waiver wire remains undefeated.")
        if lo and len(stories) < 3:
            stories.append(f"At the other end, {lo.detail.lower()}.")
        if coach and len(stories) < 4:
            stories.append(f"Tip of the cap: {coach.detail}.")

        recaps[week] = f"Week {week}. " + " ".join(stories[:4])
    return recaps


# ---------------------------------------------------------------------------
# 4.4 Power rankings
# ---------------------------------------------------------------------------
def player_names(league: LeagueData) -> dict[int, str]:
    """player_id -> name for every player who ever appeared on a roster."""
    names: dict[int, str] = {}
    for week in league.completed_weeks():
        for m in league.weeks[week]:
            for tw in (m.home, m.away):
                if tw is None:
                    continue
                for p in tw.lineup:
                    names[p.player_id] = p.name
    return names


# ---------------------------------------------------------------------------
# 4.7 Trade scorecard
# ---------------------------------------------------------------------------
def compute_trades(league: LeagueData) -> list[dict]:
    """Trade scorecard, sourced exclusively from ingest/manual_trades.json —
    scores each side by the points the acquired players have STARTED for
    their new team since the swap (bench stash points don't count — they
    never helped anybody win).

    ESPN's own trade records are deliberately ignored, even when a trade
    happens to go through ESPN's accept flow instead of the commissioner's
    LM tools: this league enters every trade manually going forward (one
    consistent source avoids the same trade appearing twice, and ESPN's
    trade events carry weaker player-name data than the manual path — a
    player who hasn't appeared in a completed box score yet has no name to
    resolve against on the ESPN side).
    """
    # (team_id, player_id) -> {week: actual} for started weeks only
    started: dict[tuple[int, int], dict[int, float]] = {}
    for week in league.completed_weeks():
        for m in league.weeks[week]:
            for tw in (m.home, m.away):
                if tw is None:
                    continue
                for p in tw.starters():
                    started.setdefault((tw.team_id, p.player_id), {})[week] = p.actual

    trades = _manual_trades(league, started)
    trades.sort(key=lambda t: -t["date"])
    return trades


def _manual_trades(league: LeagueData, started: dict[tuple[int, int], dict[int, float]]) -> list[dict]:
    """LM-tool trades from ingest/manual_trades.json — players scored the same
    way as ESPN trades; picks carried as text assets."""
    import json as _json
    from datetime import datetime as _dt

    import config as _config

    path = _config.ROOT / "ingest" / "manual_trades.json"
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        manual = _json.load(f)

    from parse import _normalize_name, global_player_names, roster_player_names

    all_names = {**global_player_names(), **roster_player_names(league.season), **player_names(league)}
    by_name = {_normalize_name(n): pid for pid, n in all_names.items()}

    out = []
    for t in manual.get("trades", []):
        if t.get("season") != league.season:
            continue
        date_ms = int(_dt.fromisoformat(t["date"]).timestamp() * 1000) if t.get("date") else 0
        week = int(t.get("week") or 0)
        players, picks = [], []
        gains: dict[int, float] = {int(tid): 0.0 for tid in t.get("teams", [])}
        for a in t.get("assets", []):
            if "pick" in a:
                picks.append({"pick": a["pick"], "from_team_id": a["from"], "to_team_id": a["to"]})
                continue
            pid = by_name.get(_normalize_name(a["player"]))
            if pid is None:
                raise ValueError(
                    f"manual_trades.json: unmatched player name '{a['player']}' "
                    f"in {league.season} trade dated {t.get('date')}")
            pts = round(sum(v for w, v in started.get((a["to"], pid), {}).items() if w >= week), 2)
            gains[a["to"]] = round(gains.get(a["to"], 0.0) + pts, 2)
            players.append({
                "player_id": pid, "name": all_names.get(pid, a["player"]),
                "from_team_id": a["from"], "to_team_id": a["to"],
                "post_trade_started_points": pts,
            })
        out.append({
            "date": date_ms,
            "week": week,
            "team_ids": sorted(int(x) for x in t.get("teams", [])),
            "players": players,
            "picks": picks,
            "source": "manual",
            "started_points_gained": {str(k): v for k, v in gains.items()},
        })
    return out


def pick_ownership(season: int) -> list[dict]:
    """Future-pick ledger from manual_trades.json (commissioner's notes)."""
    import json as _json

    import config as _config

    path = _config.ROOT / "ingest" / "manual_trades.json"
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        manual = _json.load(f)
    return [p for p in manual.get("pick_ownership", []) if p.get("season", season) >= season]


def _minmax(values: dict[int, float]) -> dict[int, float]:
    lo, hi = min(values.values()), max(values.values())
    if hi == lo:
        return {k: 0.5 for k in values}
    return {k: (v - lo) / (hi - lo) for k, v in values.items()}


def compute_power_rankings(league: LeagueData, all_play: dict[int, dict]) -> dict[int, list[dict]]:
    """Rankings per regular-season week, with week-over-week movement.

    Roster strength uses each starter's season-to-date average from our own
    box data (weeks they actually played), so early-season rankings aren't
    contaminated by future performance.
    """
    # player -> {week: actual} across all rosters, played games only
    player_scores: dict[int, dict[int, float]] = {}
    for week in league.completed_weeks():
        for m in league.weeks[week]:
            for tw in (m.home, m.away):
                if tw is None:
                    continue
                for p in tw.lineup:
                    if p.played:
                        player_scores.setdefault(p.player_id, {})[week] = p.actual

    weeks = league.regular_weeks()
    rankings: dict[int, list[dict]] = {}
    prev_rank: dict[int, int] = {}

    for w in weeks:
        upto = [x for x in weeks if x <= w]
        ap, pf, trend, roster = {}, {}, {}, {}
        for tid in league.teams:
            wk = {x: all_play[tid]["weeks"][x] for x in upto if x in all_play[tid]["weeks"]}
            games = sum(v["wins"] + v["losses"] + v["ties"] for v in wk.values())
            ap[tid] = (sum(v["wins"] + 0.5 * v["ties"] for v in wk.values()) / games) if games else 0.0

            totals = [league.team_week(tid, x).total for x in upto if league.team_week(tid, x)]
            pf[tid] = sum(totals)
            trend[tid] = statistics.mean(totals[-3:]) if totals else 0.0

            tw = league.team_week(tid, w)
            strength = 0.0
            if tw:
                for p in tw.starters():
                    hist = [v for x, v in player_scores.get(p.player_id, {}).items() if x <= w]
                    if hist:
                        strength += statistics.mean(hist)
            roster[tid] = strength

        napf, napf_, ntrend, nroster = _minmax(ap), _minmax(pf), _minmax(trend), _minmax(roster)
        scored = {
            tid: POWER_WEIGHTS["all_play"] * napf[tid]
            + POWER_WEIGHTS["points_for"] * napf_[tid]
            + POWER_WEIGHTS["trend"] * ntrend[tid]
            + POWER_WEIGHTS["roster"] * nroster[tid]
            for tid in league.teams
        }
        ordered = sorted(scored, key=lambda t: scored[t], reverse=True)
        week_list = []
        for rank, tid in enumerate(ordered, start=1):
            week_list.append({
                "team_id": tid,
                "rank": rank,
                "score": round(scored[tid], 4),
                "movement": (prev_rank[tid] - rank) if tid in prev_rank else None,
                "components": {"all_play": round(ap[tid], 4), "points_for": round(pf[tid], 2),
                               "trend": round(trend[tid], 2), "roster": round(roster[tid], 2)},
            })
        rankings[w] = week_list
        prev_rank = {r["team_id"]: r["rank"] for r in week_list}

    return rankings
