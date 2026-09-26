"""ESPN's documented regular-season standings tiebreak, in one place.

Source: ESPN Fan Support, "H2H Points League Playoff Seeding: How
Tiebreakers Work" / "Playoff Seeding: How Regular Season Standings
Tiebreakers Work". This league's ESPN setting is playoffSeedingRule
H2H_RECORD; ESPN only exposes that first rule through the API, so the
later steps are ESPN's documented defaults (a league manager can reorder
them on the Edit Playoffs page — not visible to us).

Teams are first grouped by wins. Within a group tied on wins:
  1. Head-to-head record among the tied teams — ONLY valid if every tied
     team has played every other tied team the same number of times;
     otherwise skipped.
  2. Points for (most wins).
  3. Intradivisional record (best win pct in games vs own-division teams).
  4. Points against (most wins — "tougher schedule").
  5. Coin flip.
More than two tied teams are seeded ONE AT A TIME: find the top team,
remove it, restart from step 1 for whoever is left.

Stdlib only, so it can run before the project's dependencies are installed.
"""
from __future__ import annotations

from collections import defaultdict
from itertools import combinations


def games_between(h2h, a, b) -> float:
    return h2h.get((a, b), 0) + h2h.get((b, a), 0)


def h2h_top(cands: list[int], h2h, games=None) -> list[int]:
    """Step 1 only: candidates left after the head-to-head step (all of
    them if the step is invalid or doesn't separate anyone). `games(a, b)`
    overrides the played-games count (used to ask about a full season
    before it's finished); default counts decided games in `h2h`."""
    if len(cands) < 2:
        return list(cands)
    g = games or (lambda a, b: games_between(h2h, a, b))
    first = g(cands[0], cands[1])
    if any(g(a, b) != first for a, b in combinations(cands, 2)):
        return list(cands)
    score = {t: sum(h2h.get((t, o), 0) for o in cands if o != t) for t in cands}
    best = max(score.values())
    return [t for t in cands if score[t] == best]


def top_candidates(cands: list[int], h2h, pf, pa=None, div_pct=None, games=None) -> list[int]:
    """Steps 1-4: whoever is still tied for the top spot afterwards (a
    single team, or several if only the step-5 coin flip could separate
    them). Missing pa/div_pct just skip that step."""
    c = h2h_top(cands, h2h, games)
    if len(c) == 1:
        return c
    for metric in (pf, div_pct, pa):
        if metric is None:
            continue
        vals = {t: round(metric.get(t, 0.0), 6) for t in c}
        best = max(vals.values())
        c = [t for t in c if vals[t] == best]
        if len(c) == 1:
            return c
    return c


def order_by_espn_rules(group: list[int], wins, h2h, pf, pa=None, div_pct=None, rng=None) -> list[int]:
    """Best-to-worst order of `group`. `rng` (a random.Random) makes the
    step-5 coin flip a real one for simulation; without it the flip
    resolves deterministically to the lowest team id, for stable display."""
    by_wins: dict[float, list[int]] = defaultdict(list)
    for t in group:
        by_wins[wins[t]].append(t)
    out: list[int] = []
    for w in sorted(by_wins, reverse=True):
        remaining = list(by_wins[w])
        while len(remaining) > 1:
            top = top_candidates(remaining, h2h, pf, pa, div_pct)
            pick = min(top) if rng is None else rng.choice(sorted(top))
            out.append(pick)
            remaining.remove(pick)
        out.extend(remaining)
    return out


def division_pct(div_w: dict, div_g: dict) -> dict[int, float]:
    return {t: (div_w.get(t, 0.0) / g if g else 0.0) for t, g in div_g.items()}
