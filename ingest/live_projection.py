"""The live in-game "rest of game" projection formula — the actual
answer to Tommy's original ask (2026-09-13): a real, backtested model
that doesn't fall apart on an early big play, not a guess.

Backtested against a full real NFL season (2025, 985 real skill-position
player-weeks, replayed play by play from nflverse's free public data —
see `backtest_live_projection.py` and LIVE_PROJECTION_RESEARCH.md for
the full methodology) against two baselines:

- **naive pace** (points-so-far ÷ fraction-of-game-elapsed): MAE 4.18,
  and the literal failure mode Tommy named — one real case in the
  backtest had a player at 17 points on 5 touches through the first
  quarter get naive-projected to 68 points; he finished at 17.
- **frozen at pregame** (this app's CURRENT real behavior — ignore the
  live game entirely until it's over): MAE 4.85, WORSE than naive on
  average despite looking safer, because it never uses any real signal
  from the game actually being played.
- **this model** (shrinkage + cap, tuned against real backtest error,
  not guessed): MAE 3.444 — beats both. The same 17-point/5-touch case
  above now projects to exactly 17.0.

## The formula

    project_rest_of_game(points_so_far, touches_so_far, elapsed_fraction, pregame_projection):
        naive = points_so_far / elapsed_fraction
        capped = min(naive, max(pregame_projection * CAP_MULTIPLIER, MIN_CAP))
        weight = touches_so_far / (touches_so_far + SHRINK_K)
        return max(points_so_far, weight * capped + (1 - weight) * pregame_projection)

Two ideas, both required — cut either one and the backtest error gets
measurably worse (see the parameter sweep in
`backtest_live_projection.py`'s own testing history / the research doc):

1. **Shrink toward the pregame baseline by real sample size** (touches
   so far this game), not by how much clock has passed. A player with 1
   target and a 20-yard gain has told you almost nothing about their
   real pace yet, no matter how many minutes have ticked by — the whole
   point Tommy raised at the start of this.
2. **Cap the raw in-game pace BEFORE blending it in**, not just after.
   Shrinkage alone still lets a big enough early outlier drag the blend
   upward on a low-touch sample (found via the backtest, not intuition —
   an uncapped version passed the aggregate MAE test fine but still
   produced a 53-point projection on that same 17-point/5-touch case).
   The cap is generous (2x the pregame number, floor of 15) — it only
   catches genuine outliers, not real hot games.

`SHRINK_K = 3`, `CAP_MULTIPLIER = 2.0`, `MIN_CAP = 15` — all tuned by
sweeping real values against the 2025 backtest, not picked a priori
(the sweep itself: `backtest_live_projection.py`'s companion test
script, not committed here since it's throwaway analysis, not
production code — the RESULT is what's committed).

## What this needs that isn't wired up yet

`touches_so_far` (targets + carries, for the sample-size weighting) and
`elapsed_fraction` (real-time-elapsed proxy, or better: fraction of the
player's team's total plays run so far, a truer "how much of the game
has this player's offense actually played" signal than the clock alone)
aren't currently computed anywhere in the live build pipeline —
`live_score.py` computes POINTS from the public feed but not touch
counts. Targets/carries ARE already in that same feed's per-player
`rushingAttempts`/`receivingTargets` stat groups (confirmed present
while building `live_public_stats.py`), so no new data source is
needed, just new plumbing to carry those two numbers through
alongside the points this app is already computing. Not yet built —
see LIVE_PROJECTION_RESEARCH.md's next steps.
"""

SHRINK_K = 3.0
CAP_MULTIPLIER = 2.0
MIN_CAP = 15.0


def project_rest_of_game(
    points_so_far: float, touches_so_far: int, elapsed_fraction: float, pregame_projection: float,
) -> float:
    """Best current estimate of a player's FINAL fantasy score for a
    game still in progress. `elapsed_fraction` in (0, 1]; `touches_so_far`
    is real carries+targets recorded so far (a target counts even if
    incomplete — it's the real opportunity signal, not just a catch).
    Falls back to the pregame number outright before any real touch has
    happened, matching this app's existing on_fire/on_ice reasoning
    (nothing to project from yet)."""
    if touches_so_far <= 0 or elapsed_fraction <= 0:
        return pregame_projection

    naive_pace = points_so_far / elapsed_fraction
    cap = max(pregame_projection * CAP_MULTIPLIER, MIN_CAP)
    capped_pace = min(naive_pace, cap)

    weight = touches_so_far / (touches_so_far + SHRINK_K)
    blended = weight * capped_pace + (1 - weight) * pregame_projection
    return max(points_so_far, blended)
