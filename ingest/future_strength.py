"""Heuristic n+2 pick-value proxy.

`simulate.run()`'s real Monte Carlo (`draft_slot_dist`) can price a pick
governed by the LIVE season's own standings — but a pick governed by the
season AFTER that (e.g. a 2028 pick, whose draft order is set by 2027's
final standings) can't be simulated for real: 2027 hasn't been played, or
even started, yet. Tommy, 2026-09-30, asked for an approximation anyway:
"we will have much less certainty about where the picks will end up but
we can approximate the strength of a team for the following season" from
three signals, in his own stated order of importance:

1. Current roster strength (`spectrum.contending_values` — the SAME
   number the Contend/Rebuild page shows) — the primary driver: "teams
   with really strong rosters right now are likely to be good next year."
2. Dynasty roster strength (`spectrum.dynasty_roster_values`, same
   reasoning) — a smaller, positive signal: "likely to slightly improve."
3. That team's OWN draft capital for the upcoming (not this) draft — the
   smallest signal, and — since KTC's own pick-value curve is already
   steeply concave — naturally concentrated at the very top of round 1
   without needing a separate top-picks-only calculation, matching
   Tommy's own observation: "this impact is likely concentrated at the
   very top of the first round."

This is explicitly a hand-tuned composite score, not a fitted model —
there's no real 2-years-out outcome data on file to fit against — and it
never claims otherwise: `pick_futures.json`'s `value_basis` for a pick
priced this way reads `"n2_heuristic"`, distinct from `"projected_distribution"`
(the real 1-year-out Monte Carlo). The moment 2027 becomes the live
season, `simulate.run()`'s real `draft_slot_dist` takes over for THAT
season's projection exactly as it already does for 2027 picks today, and
this heuristic only ever applies one year further out than the real sim
reaches.
"""
from __future__ import annotations

import math

# Tommy's own stated weighting (2026-09-30) — current strength matters
# most, dynasty strength a real but smaller amount, next season's own
# pick capital least of all. A judgment call, not a fitted model, and
# meant to be revisited by feel rather than treated as precise.
WEIGHT_CURRENT_STRENGTH = 0.55
WEIGHT_DYNASTY_STRENGTH = 0.30
WEIGHT_NEXT_SEASON_PICK_CAPITAL = 0.15

# How widely to spread the resulting projected draft-slot distribution —
# deliberately much wider than a real one-season-out Monte Carlo draw
# would ever produce ("we will have much less certainty about where the
# picks will end up"), while still preserving real separation between a
# clearly-strong and clearly-weak team (Tommy's own example: "I
# definitely know with high confidence that my 2028 first is worth less
# than Daevion's"). In a 10-team league this spreads real probability
# across roughly half the slots around a team's projected center —
# noticeably flatter than a real simulated distribution, on purpose.
SLOT_SPREAD = 3.0


def _normalize(values: dict[int, float], team_ids: list[int]) -> dict[int, float]:
    """Min-max rescale to [0, 1] across THIS league's own teams — puts
    contending value (redraft-scale), dynasty value (KTC-scale), and pick
    capital (KTC-scale, but a different total range) on one comparable
    axis before blending. Deliberately league-relative (unlike
    `metrics.power_score_1_100`'s fixed anchors): this only ever needs to
    rank this league's own 10 teams against each other for one season's
    projection, not compare across leagues or seasons. 0.5 for every team
    on the rare all-equal input (span == 0) rather than a division error."""
    vals = [values.get(t, 0.0) for t in team_ids]
    lo, hi = min(vals), max(vals)
    span = hi - lo
    return {t: ((values.get(t, 0.0) - lo) / span) if span else 0.5 for t in team_ids}


def projected_strength_rank(
    team_ids: list[int], contending_value: dict[int, float],
    dynasty_roster_value: dict[int, float], next_season_pick_capital: dict[int, float],
) -> list[int]:
    """Best-to-worst (strongest projected NEXT season first) — a plain
    composite score, not a simulation. Ties (realistically only from
    all-zero inputs) break on team_id for a deterministic order."""
    n_current = _normalize(contending_value, team_ids)
    n_dynasty = _normalize(dynasty_roster_value, team_ids)
    n_picks = _normalize(next_season_pick_capital, team_ids)
    score = {
        t: (WEIGHT_CURRENT_STRENGTH * n_current[t] + WEIGHT_DYNASTY_STRENGTH * n_dynasty[t]
            + WEIGHT_NEXT_SEASON_PICK_CAPITAL * n_picks[t])
        for t in team_ids
    }
    return sorted(team_ids, key=lambda t: (-score[t], t))


def projected_slot_dist(team_id: int, rank_order: list[int]) -> dict[str, float]:
    """A synthetic (not simulated) draft-slot distribution for one team,
    centered on its composite-strength rank. Draft slot 1 goes to the
    WORST projected team, so the strongest team (rank 1 in `rank_order`)
    centers on the LAST slot, not the first. Spread via SLOT_SPREAD, a
    discretized Gaussian-shaped kernel renormalized over the real
    1..team_count slot range — decays smoothly toward the boundary, so a
    clear favorite or a clear bottom team doesn't need separate clipping."""
    n = len(rank_order)
    rank = rank_order.index(team_id) + 1  # 1 = strongest
    center = n + 1 - rank
    raw = {s: math.exp(-((s - center) ** 2) / (2 * SLOT_SPREAD ** 2)) for s in range(1, n + 1)}
    total = sum(raw.values())
    return {str(s): round(v / total, 4) for s, v in raw.items()}
