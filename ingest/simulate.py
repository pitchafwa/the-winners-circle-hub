"""4.5 Monte Carlo playoff odds.

Model: each team-week is a normal draw from the team's lineup-production mean
and stdev, shrunk toward league-wide priors while samples are tiny (< ~3
games). Venue bonuses (+3 regular season, +5 playoffs here — read from
settings) are added to the home side, since they decide real games in this
league. The real remaining schedule is played out; the top 3 in EACH
division make the playoffs (no wildcards — confirmed against real bracket
participation in both 2024 and 2025), tiebroken H2H then points-for. Each
division runs its own 3-team mini-bracket (#1 seed bye, #2v#3 play-in, then
#1 vs that winner for the division title — also confirmed against the real
2024/2025 playoff schedules), and the two division champions meet only at
the very end for the league championship.

Roster strength (redraft/this-season dynasty market value — same source as
the contend/rebuild spectrum's "contending value") nudges each team's PRIOR
mean before real results exist to override it — see
`roster_strength_prior_shift`. This is the one place actual roster quality
enters the model at all; before it, two teams with zero games played looked
statistically identical regardless of whether one had rostered every stud
in the league and the other was replacement-level.

Honesty notes baked into the output: n_sims and standard errors are reported;
a partially-played current week is re-simulated from scratch (the timestamp
tells the reader how stale that is).
"""
from __future__ import annotations

import dataclasses
import math
import random
import statistics
from collections import defaultdict

import numpy as np

from metrics import current_records, redraft_lineup_value
from parse import (
    LeagueData,
    current_roster_players,
    hot_cold_status,
    optimal_week_projection,
    recent_player_performance,
    values_by_pid,
)

N_SIMS = 10_000
SHRINK_GAMES = 3          # sample weight below which priors dominate
MIN_STD = 8.0             # nobody is this consistent; floor the noise
FALLBACK_PRIOR = (120.0, 25.0)

# This-week win probability from a projected-score gap: normal-CDF(diff /
# WIN_PROB_SIGMA). A SEPARATE, simpler model from the season-long Monte
# Carlo simulation above — it only answers "who's favored this one week,"
# fed by the real optimal-lineup projection (see
# parse.optimal_week_projection) rather than our shrunk-to-priors team
# model. Sigma fit by hand against 8 real win-probability numbers pulled
# from ESPN's own app (e.g. a 12-point favorite -> ~63% WP, a 55-point
# favorite -> ~94% WP) — 35 matches all 8 within about a percentage point.
WIN_PROB_SIGMA = 35.0


def _normal_cdf(z: float) -> float:
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))

# How hard roster strength leans on the PRIOR mean, before real games exist
# to override it. Expressed as a fraction of the league's own scoring
# stdev per 1 standard-deviation gap in roster redraft value from the
# league average, so it scales with whatever this league/season's real
# scoring variance actually is rather than a fixed point number that might
# be huge in a low-scoring league and negligible in a high-scoring one.
# Calibrated by hand against real 2026 preseason data: 0.15 puts the
# best-rostered team's preseason playoff odds around 85-90% and the
# worst-rostered around 35-40% — a real, visible edge, but nowhere near a
# lock either way, matching how much randomness actually decides fantasy
# outcomes week to week. (0.5 was tried first and produced a near-certainty
# for the top roster by 14 games in — too deterministic for a signal that's
# only ever a preseason prior, not a guarantee.)
ROSTER_STRENGTH_WEIGHT = 0.15
# Clip how many roster-value standard deviations count, so one absurdly
# stacked (or bare) roster can't single-handedly dominate the field.
ROSTER_STRENGTH_Z_CAP = 2.5


def league_priors(history: LeagueData | None) -> tuple[float, float]:
    """League-wide weekly mean/std from the most recent season with data."""
    if history is None:
        return FALLBACK_PRIOR
    scores = []
    for week in history.completed_weeks():
        for m in history.weeks[week]:
            for tw in (m.home, m.away):
                if tw is not None:
                    scores.append(tw.lineup_points)
    if len(scores) < 10:
        # schedule-only history seasons: official totals minus nothing — good enough
        scores = [
            s
            for e in history.full_schedule
            if e.winner != "UNDECIDED" and e.away_id is not None
            for s in (e.home_score, e.away_score)
            if s > 0
        ]
    if len(scores) < 10:
        return FALLBACK_PRIOR
    return (statistics.mean(scores), statistics.pstdev(scores))


def roster_strength_prior_shift(league: LeagueData, redraft_values: dict[str, int] | None,
                                prior_std: float) -> dict[int, float]:
    """Points to nudge each team's PRIOR scoring mean by, based on this-
    season (redraft) roster strength — the one signal `team_models()`'s
    shrinkage otherwise has no way to see (the flat league-wide prior
    treats a stacked roster and a bare one identically until real results
    accumulate). Only the PRIOR side of the shrinkage blend is touched, so
    this fades out on its own as a team plays real games — n games of
    actual results already dominate that blend past ~3 weeks regardless.

    Roster strength is `metrics.redraft_lineup_value()` — each team's best
    possible starting lineup value (dominant signal) plus a 10% share of
    remaining bench value (real but secondary insurance value), D/ST and K
    excluded entirely. NOT a flat sum of the whole roster — only ~half a
    roster starts in any given week, so a deep bench of replacement-level
    players shouldn't out-rank a thinner roster stacked with elite
    starters. (A flat roster-sum version of this shift used to ship here;
    Tommy flagged it was ranking roster DEPTH over roster STARTING POWER,
    cross-checked against FantasyPros' own weekly power rankings — which
    score starters only, no bench — as a real-world reference point.)

    Reads the CURRENT roster straight from the live league.json snapshot
    (works preseason too, unlike anything derived from completed box
    scores — the exact moment this signal matters most, since there's no
    game data yet to fall back on). Returns all-zero shifts if no redraft
    valuation data is available, rather than fabricating a signal."""
    if not redraft_values:
        return {tid: 0.0 for tid in league.teams}

    rosters = current_roster_players(league.season)
    pid_values = values_by_pid(league.season, redraft_values)
    roster_value: dict[int, float] = {
        tid: redraft_lineup_value(rosters.get(tid, []), pid_values, league.starting_slots)
        for tid in league.teams
    }

    values = list(roster_value.values())
    if len(values) < 2 or statistics.pstdev(values) == 0:
        return {tid: 0.0 for tid in league.teams}
    mean_v = statistics.mean(values)
    std_v = statistics.pstdev(values)

    shift = {}
    for tid, v in roster_value.items():
        z = (v - mean_v) / std_v
        z = max(-ROSTER_STRENGTH_Z_CAP, min(ROSTER_STRENGTH_Z_CAP, z))
        shift[tid] = z * ROSTER_STRENGTH_WEIGHT * prior_std
    return shift


def team_models(league: LeagueData, prior: tuple[float, float],
                roster_shift: dict[int, float] | None = None) -> dict[int, tuple[float, float]]:
    prior_mean, prior_std = prior
    roster_shift = roster_shift or {}
    models = {}
    for tid in league.teams:
        scores = []
        for w in league.regular_weeks():
            tw = league.team_week(tid, w)
            if tw is not None:
                scores.append(tw.lineup_points)
        n = len(scores)
        m = statistics.mean(scores) if n else prior_mean
        s = statistics.stdev(scores) if n > 1 else prior_std
        weight = n / (n + SHRINK_GAMES)
        team_prior_mean = prior_mean + roster_shift.get(tid, 0.0)
        models[tid] = (
            weight * m + (1 - weight) * team_prior_mean,
            max(weight * s + (1 - weight) * prior_std, MIN_STD),
        )
    return models


def _seed(team_ids, wins, pf, h2h, divisions, playoff_count, rng):
    """Top N per division make the playoffs — NO wildcards. Confirmed
    against real bracket participation in both 2024 and 2025 (exactly 3-3
    by division each year — not the division-leader-plus-overall-wildcard
    mix a lot of other ESPN league formats use, which is what this used to
    assume before Tommy flagged it and real bracket data settled it).

    Returns (by_division, full_order): by_division{div_id: teams in that
    division, best record first} for running each division's own
    mini-bracket, and full_order (all teams, division ignored, best record
    first) for display ranks and "which division champ hosts the final"."""
    def order(group: list[int]) -> list[int]:
        # exact-tie groups get an internal h2h table
        by_wins: dict[float, list[int]] = defaultdict(list)
        for t in group:
            by_wins[wins[t]].append(t)
        out = []
        for w in sorted(by_wins, reverse=True):
            tied = by_wins[w]
            if len(tied) > 1:
                # snapshot: list.sort() empties the list during sorting, so the
                # key lambda must not iterate `tied` itself
                group = list(tied)
                tied.sort(key=lambda t: (
                    sum(h2h.get((t, o), 0) for o in group if o != t),
                    pf[t],
                    rng.random(),
                ), reverse=True)
            out.extend(tied)
        return out

    by_division = {d: order([t for t in team_ids if divisions[t] == d]) for d in sorted(set(divisions.values()))}
    full_order = order(team_ids)
    return by_division, full_order


def _division_bracket(seeded3: list[int], playoff_game) -> int:
    """One division's 3-team bracket: the #1 seed gets a bye, #2 plays #3
    (#2 hosts), then #1 hosts the winner for the division title. Confirmed
    against the real 2024/2025 playoff schedules — this is genuinely how
    each division runs its own mini-bracket; the two division champions
    only meet each other at the very end, for the league championship."""
    one, two, three = seeded3
    r1_winner = playoff_game(two, three, home=two)
    return playoff_game(one, r1_winner, home=one)


def run(league: LeagueData, history: LeagueData | None = None,
       redraft_values: dict[str, int] | None = None) -> dict | None:
    remaining = [
        e for e in league.full_schedule
        if e.winner == "UNDECIDED" and e.away_id is not None
        and e.matchup_period <= league.reg_season_weeks
    ]
    if league.season_over or not league.full_schedule:
        return None

    prior = league_priors(history if history is not None else None)
    roster_shift = roster_strength_prior_shift(league, redraft_values, prior[1])
    models = team_models(league, prior, roster_shift)
    base_wins, _, base_pf, base_h2h = current_records(league)
    team_ids = list(league.teams)
    divisions = {t: league.teams[t].division_id for t in team_ids}
    playoff_count = league.playoff_team_count
    bonus = league.home_team_bonus
    p_bonus = league.playoff_home_team_bonus

    rng = random.Random(29471)
    np_rng = np.random.default_rng(29471)

    # pre-draw all regular-season noise: [sims, matchups, 2]
    mus = np.array([[models[e.home_id][0] + bonus, models[e.away_id][0]] for e in remaining])
    sigmas = np.array([[models[e.home_id][1], models[e.away_id][1]] for e in remaining])
    draws = (np_rng.standard_normal((N_SIMS, len(remaining), 2)) * sigmas + mus
             if remaining else np.zeros((N_SIMS, 0, 2)))

    made = defaultdict(int)
    titles = defaultdict(int)
    seeds = defaultdict(lambda: defaultdict(int))
    final_wins_sum = defaultdict(float)
    next_game: dict[int, int] = {}   # team -> index of their first remaining matchup
    for i, e in enumerate(remaining):
        next_game.setdefault(e.home_id, i)
        next_game.setdefault(e.away_id, i)
    cond = {t: {"win": [0, 0], "loss": [0, 0]} for t in team_ids}   # [made, total]
    by_final_wins = {t: defaultdict(lambda: [0, 0]) for t in team_ids}

    def playoff_game(a, b, home, mu_sig=models):
        sa = rng.gauss(*mu_sig[a]) + (p_bonus if home == a else 0)
        sb = rng.gauss(*mu_sig[b]) + (p_bonus if home == b else 0)
        return a if sa >= sb else b

    for s in range(N_SIMS):
        wins = dict(base_wins)
        pf = dict(base_pf)
        h2h = dict(base_h2h)
        for t in team_ids:
            wins.setdefault(t, 0.0)
            pf.setdefault(t, 0.0)
        won_next: dict[int, bool] = {}
        for i, e in enumerate(remaining):
            hs, as_ = draws[s, i, 0], draws[s, i, 1]
            pf[e.home_id] += hs
            pf[e.away_id] += as_
            winner, loser = (e.home_id, e.away_id) if hs >= as_ else (e.away_id, e.home_id)
            wins[winner] += 1
            h2h[(winner, loser)] = h2h.get((winner, loser), 0) + 1
            if next_game.get(e.home_id) == i:
                won_next[e.home_id] = winner == e.home_id
            if next_game.get(e.away_id) == i:
                won_next[e.away_id] = winner == e.away_id

        by_division, full_order = _seed(team_ids, wins, pf, h2h, divisions, playoff_count, rng)
        per_division = playoff_count // len(by_division) if by_division else 0
        field = [t for lst in by_division.values() for t in lst[:per_division]]

        if len(by_division) == 2 and per_division == 3:
            div_champs = [_division_bracket(lst[:3], playoff_game) for lst in by_division.values()]
            champ = playoff_game(
                div_champs[0], div_champs[1],
                home=div_champs[0] if full_order.index(div_champs[0]) < full_order.index(div_champs[1])
                else div_champs[1],
            )
        else:
            # Every real season this league has run is 2 divisions x 3 —
            # this is a deliberately simple fallback (no bracket, straight
            # to the best remaining seed) for any other shape rather than a
            # generalized bracket engine nobody's needed yet.
            champ = next((t for t in full_order if t in field), None)

        for rank, t in enumerate(full_order, start=1):
            seeds[t][rank] += 1
        for t in field:
            made[t] += 1
        if champ is not None:
            titles[champ] += 1
        for t in team_ids:
            final_wins_sum[t] += wins[t]
            key = "win" if won_next.get(t) else "loss"
            if t in won_next:
                cond[t][key][1] += 1
                if t in field:
                    cond[t][key][0] += 1
            wt = int(round(wins[t]))
            by_final_wins[t][wt][1] += 1
            if t in field:
                by_final_wins[t][wt][0] += 1

    def pct(n):
        return round(n / N_SIMS, 4)

    def se(p):
        return round(float(np.sqrt(p * (1 - p) / N_SIMS)), 4)

    teams_out = []
    for t in team_ids:
        p_make = pct(made[t])
        p_title = pct(titles[t])
        cw = cond[t]["win"]
        cl = cond[t]["loss"]
        teams_out.append({
            "team_id": t,
            "playoff_pct": p_make,
            "playoff_se": se(p_make),
            "title_pct": p_title,
            "title_se": se(p_title),
            "avg_final_wins": round(final_wins_sum[t] / N_SIMS, 2),
            "seed_dist": {str(r): pct(n) for r, n in sorted(seeds[t].items())},
            "playoff_pct_if_win_next": round(cw[0] / cw[1], 4) if cw[1] else None,
            "playoff_pct_if_lose_next": round(cl[0] / cl[1], 4) if cl[1] else None,
            "playoff_pct_by_final_wins": {
                str(w): round(m / n, 4)
                for w, (m, n) in sorted(by_final_wins[t].items()) if n >= 50
            },
        })

    # This week's games: projected-final score and win probability prefer
    # the real optimal-lineup projection (parse.optimal_week_projection —
    # every rostered player's real ESPN actual-if-played-else-projected
    # value, assigned to the best legal lineup, so a team that hasn't set
    # its lineup yet doesn't read as "projected for 0") fed through the
    # WIN_PROB_SIGMA normal-CDF model above — falls back to the season-long
    # team-strength model + this-exact-matchup's own Monte Carlo draws only
    # when that cache isn't available yet (a fully offline build before any
    # live fetch has pulled this week). Playoff impact score is unrelated
    # to either — the combined swing in playoff odds for BOTH teams between
    # winning and losing this game, reusing the playoff_pct_if_win_next/
    # playoff_pct_if_lose_next each team already got above (valid here
    # because "this week" is by construction each involved team's next
    # remaining game).
    by_team = {r["team_id"]: r for r in teams_out}
    this_week_period = min((e.matchup_period for e in remaining), default=None)
    this_week_matchups = []
    if this_week_period is not None:
        week_proj = optimal_week_projection(league.season, this_week_period, league.starting_slots)
        # on_fire/on_ice (parse.hot_cold_status) computed once here, same
        # as roster.json, and merged into each lineup entry below rather
        # than threading it through optimal_week_projection() itself —
        # that function has one other caller-independent shape to keep
        # stable, and this is purely additive at the call site. Current-
        # moment recent-performance lookup is correct here (not a
        # per-week upto_week scope) since this is always THE live/current
        # week, never a past one.
        recent_by_pid = recent_player_performance(league)

        def _with_hot_cold(lineup):
            out_lineup = []
            for p in lineup:
                on_fire, on_ice = hot_cold_status(
                    p["position"], p["played"],
                    p["actual"] if p["played"] else None, p["projected"],
                    recent_by_pid.get(p["player_id"], []),
                )
                out_lineup.append({**p, "on_fire": on_fire, "on_ice": on_ice})
            return out_lineup
        for i, e in enumerate(remaining):
            if e.matchup_period != this_week_period:
                continue
            home_week, away_week = week_proj.get(e.home_id), week_proj.get(e.away_id)
            if home_week is not None and away_week is not None:
                # No home bonus on `current` — it's real accumulated play
                # only, so "current: 3.0" can't show before anyone's
                # actually scored a point. The bonus still belongs in the
                # final total, so it's added to `projected_final` below.
                home_current = round(home_week["current"], 1)
                away_current = round(away_week["current"], 1)
                home_projected = round(home_week["projected_final"] + bonus, 1)
                away_projected = round(away_week["projected_final"], 1)
                home_win_pct = round(_normal_cdf((home_projected - away_projected) / WIN_PROB_SIGMA), 4)
                started = home_week["started"] or away_week["started"]
                projection_source = "espn"
                home_lineup = _with_hot_cold(home_week["lineup"])
                away_lineup = _with_hot_cold(away_week["lineup"])
                home_remaining, away_remaining = home_week["remaining"], away_week["remaining"]
                home_total_starters, away_total_starters = home_week["total_starters"], away_week["total_starters"]
            else:
                home_current = None
                away_current = None
                home_projected = round(models[e.home_id][0] + bonus, 1)
                away_projected = round(models[e.away_id][0], 1)
                home_win_pct = pct(float(np.sum(draws[:, i, 0] >= draws[:, i, 1])))
                started = False
                projection_source = "model"
                home_lineup, away_lineup = [], []
                home_remaining, away_remaining = 0, 0
                home_total_starters, away_total_starters = 0, 0
            impact = 0.0
            for r in (by_team.get(e.home_id), by_team.get(e.away_id)):
                if r and r["playoff_pct_if_win_next"] is not None and r["playoff_pct_if_lose_next"] is not None:
                    impact += abs(r["playoff_pct_if_win_next"] - r["playoff_pct_if_lose_next"])
            this_week_matchups.append({
                "matchup_period": e.matchup_period,
                "is_playoff": e.is_playoff, "playoff_tier": e.playoff_tier,
                "home_id": e.home_id, "away_id": e.away_id,
                "home_current": home_current,
                "away_current": away_current,
                "home_projected": home_projected,
                "away_projected": away_projected,
                "home_win_pct": home_win_pct,
                "started": started,
                "home_lineup": home_lineup, "away_lineup": away_lineup,
                "home_remaining": home_remaining, "away_remaining": away_remaining,
                "home_total_starters": home_total_starters, "away_total_starters": away_total_starters,
                "projection_source": projection_source,
                "playoff_impact_score": round(impact, 4),
            })
        this_week_matchups.sort(key=lambda m: -m["playoff_impact_score"])

    roster_strength_active = any(v != 0.0 for v in roster_shift.values())
    return {
        "n_sims": N_SIMS,
        "remaining_matchups": len(remaining),
        "model": "normal(team lineup mean, stdev) shrunk to league priors below "
                 f"{SHRINK_GAMES} games; venue bonuses applied; top 3 per division make the "
                 "playoffs, no wildcards; H2H tiebreak within exact-tie groups, then PF"
                 + ("; prior mean nudged by this-season roster strength, fading out as real "
                    "results accumulate" if roster_strength_active else ""),
        "roster_strength_active": roster_strength_active,
        "teams": teams_out,
        "this_week_matchups": this_week_matchups,
    }


def _league_as_of_week(league: LeagueData, week: int) -> LeagueData:
    """A shallow copy of `league` as if only weeks <= `week` had happened —
    the same truncate-by-matchup_period idea metrics.standings_by_week()
    already uses for the analogous "standings as of week N" feature.

    Nothing in this module's Monte Carlo engine (run()/team_models()/
    league_priors()) trusts league.current_matchup_period/scoring_period_id
    as ground truth for "how much of the season has happened" — every one
    of those infers it by inspecting league.weeks (dict keys) and
    league.full_schedule (winner field) directly. That's what makes this
    truncation sufficient to reuse run() completely unchanged for a past
    week's odds, rather than needing a second simulation engine.

    One known, accepted simplification: roster_strength_prior_shift()
    always reads TODAY's live roster (parse.current_roster_players() reads
    the live cache off disk directly, not anything week-scoped) — so a
    reconstructed "as of week N" run reflects what was actually decided
    through week N, but nudges its priors using today's roster
    composition, not week N's. Only matters around a since-happened
    trade, and only before real results dominate the shrinkage; not worth
    reconstructing historical rosters to fix."""
    weeks = {w: v for w, v in league.weeks.items() if w <= week}
    full_schedule = [
        e if e.matchup_period <= week else dataclasses.replace(e, winner="UNDECIDED")
        for e in league.full_schedule
    ]
    return dataclasses.replace(league, weeks=weeks, full_schedule=full_schedule)


def playoff_pct_by_week(league: LeagueData, history: LeagueData | None,
                        redraft_values: dict[str, int] | None,
                        cached_weeks: dict[int, dict[int, float]] | None = None,
                        ) -> dict[int, dict[int, float]]:
    """{week: {team_id: playoff_pct}} for every completed regular-season
    week of the CURRENT season — the "as of week N" trend behind the
    League page's overlaid chart and My Team's single-team version.

    Expensive to compute (a full 10,000-sim Monte Carlo run PER week), so
    this only ever recomputes what it has to: a week already present in
    `cached_weeks` (the previous build's own output, read back by the
    caller) is reused as-is UNLESS it's the single most-recently-completed
    week — same "completed weeks are immutable, only the current one
    refreshes" convention fetch.py's own module docstring already
    establishes for box-score fetching. Every earlier week computes
    exactly once, ever."""
    cached_weeks = cached_weeks or {}
    weeks = league.regular_weeks()
    if not weeks:
        return {}
    latest = weeks[-1]

    out: dict[int, dict[int, float]] = {}
    for w in weeks:
        if w != latest and w in cached_weeks:
            out[w] = cached_weeks[w]
            continue
        result = run(_league_as_of_week(league, w), history, redraft_values)
        out[w] = {t["team_id"]: t["playoff_pct"] for t in result["teams"]} if result else {}
    return out
