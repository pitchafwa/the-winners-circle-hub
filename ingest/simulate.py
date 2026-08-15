"""4.5 Monte Carlo playoff odds.

Model: each team-week is a normal draw from the team's lineup-production mean
and stdev, shrunk toward league-wide priors while samples are tiny (< ~3
games). Venue bonuses (+3 regular season, +5 playoffs here — read from
settings) are added to the home side, since they decide real games in this
league. The real remaining schedule is played out, seeds follow the league's
division-winners-first rule with its tiebreaker hierarchy (H2H approximated
within exact-tie groups, then points-for), and the 3-round bracket is played
to a champion.

Honesty notes baked into the output: n_sims and standard errors are reported;
a partially-played current week is re-simulated from scratch (the timestamp
tells the reader how stale that is).
"""
from __future__ import annotations

import random
import statistics
from collections import defaultdict

import numpy as np

from parse import LeagueData

N_SIMS = 10_000
SHRINK_GAMES = 3          # sample weight below which priors dominate
MIN_STD = 8.0             # nobody is this consistent; floor the noise
FALLBACK_PRIOR = (120.0, 25.0)


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


def team_models(league: LeagueData, prior: tuple[float, float]) -> dict[int, tuple[float, float]]:
    prior_mean, prior_std = prior
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
        models[tid] = (
            weight * m + (1 - weight) * prior_mean,
            max(weight * s + (1 - weight) * prior_std, MIN_STD),
        )
    return models


def _current_state(league: LeagueData):
    """Wins (ties=0.5), PF, and the H2H win table from decided regular-season games."""
    wins: dict[int, float] = defaultdict(float)
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
            h2h[(e.home_id, e.away_id)] += 1
        elif e.winner == "AWAY":
            wins[e.away_id] += 1
            h2h[(e.away_id, e.home_id)] += 1
        elif e.winner == "TIE":
            wins[e.home_id] += 0.5
            wins[e.away_id] += 0.5
            h2h[(e.home_id, e.away_id)] += 0.5
            h2h[(e.away_id, e.home_id)] += 0.5
    return wins, pf, h2h


def _seed(team_ids, wins, pf, h2h, divisions, playoff_count, rng):
    """Division winners first, then wildcards; H2H settles exact win ties."""
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

    div_winners = []
    for div in set(divisions.values()):
        members = [t for t in team_ids if divisions[t] == div]
        div_winners.append(order(members)[0])
    seeded = order(div_winners)
    rest = order([t for t in team_ids if t not in seeded])
    full = seeded + rest
    return full[:playoff_count], full


def run(league: LeagueData, history: LeagueData | None = None) -> dict | None:
    remaining = [
        e for e in league.full_schedule
        if e.winner == "UNDECIDED" and e.away_id is not None
        and e.matchup_period <= league.reg_season_weeks
    ]
    if league.season_over or not league.full_schedule:
        return None

    prior = league_priors(history if history is not None else None)
    models = team_models(league, prior)
    base_wins, base_pf, base_h2h = _current_state(league)
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

        field, full_order = _seed(team_ids, wins, pf, h2h, divisions, playoff_count, rng)

        # 6-team bracket: 1,2 byes; 3v6 4v5; reseed; better seed hosts
        if len(field) == 6:
            sf1 = playoff_game(field[2], field[5], home=field[2])
            sf2 = playoff_game(field[3], field[4], home=field[3])
            low = sf1 if field.index(sf1) > field.index(sf2) else sf2
            high = sf2 if low == sf1 else sf1
            f1 = playoff_game(field[0], low, home=field[0])
            f2 = playoff_game(field[1], high, home=field[1])
            champ = playoff_game(f1, f2, home=f1 if full_order.index(f1) < full_order.index(f2) else f2)
        elif len(field) == 4:
            f1 = playoff_game(field[0], field[3], home=field[0])
            f2 = playoff_game(field[1], field[2], home=field[1])
            champ = playoff_game(f1, f2, home=f1 if full_order.index(f1) < full_order.index(f2) else f2)
        else:
            champ = field[0] if field else None

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

    return {
        "n_sims": N_SIMS,
        "remaining_matchups": len(remaining),
        "model": "normal(team lineup mean, stdev) shrunk to league priors below "
                 f"{SHRINK_GAMES} games; venue bonuses applied; division winners seeded first; "
                 "H2H tiebreak within exact-tie groups, then PF",
        "teams": teams_out,
    }
