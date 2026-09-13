"""Backtest harness for the live in-game projection model, replaying real
historical NFL games from nflverse's free public play-by-play data.

See LIVE_PROJECTION_RESEARCH.md for the full context: Tommy's core
concern was that a naive "points-per-minute pace" projection breaks on
an early big play (a 20-yard catch 10 seconds into the game isn't a
300-point pace). This script replays real games play by play, so any
candidate projection formula can be checked against what ACTUALLY
happened next, not just plausibility.

Data sources (both free, public, no login — confirmed downloadable
2026-09-13):
- `play_by_play_{year}.csv.gz` — one row per real NFL play, with game
  clock/score state and player attribution
  (github.com/nflverse/nflverse-data/releases/download/pbp/)
- `players.csv` — id crosswalk, `gsis_id` (this data's own player key)
  to `espn_id` (this app's own player_id space) — confirmed exact match
  against two known real players (Puka Nacua, Matthew Stafford) before
  trusting it for anything real
  (github.com/nflverse/nflverse-data/releases/download/players/)

Scope: skill positions only (QB/RB/WR/TE) — kicker/D/ST production
doesn't have the same "pace" concept this model exists to solve, and
both already have a validated live-SCORE (not projection) pipeline of
their own (`live_public_dst_kicking.py`).
"""
import csv
import gzip
from collections import defaultdict

GAME_SECONDS = 3600
CHECKPOINT_FRACTIONS = [0.25, 0.5, 0.75]  # how far through the game each checkpoint sits

# Reuses the exact yards-per-point divisors and TD/reception point values
# already validated in scoring.py / live_public_stats.py against 5,312+
# real ESPN-scored player-weeks — not re-derived here, just applied
# directly to nflverse's per-play yardage instead of ESPN's own stat
# lines, since the underlying scoring RULES are identical either way.
PASSING_YARDS_PER_POINT = 25
RUSHING_YARDS_PER_POINT = 10
RECEIVING_YARDS_PER_POINT = 10
PASSING_TD_POINTS = 4
RUSHING_TD_POINTS = 6
RECEIVING_TD_POINTS = 6
RECEPTION_POINTS = 1
INTERCEPTION_POINTS = -2
LOST_FUMBLE_POINTS = -2
TWO_POINT_POINTS = 2


def load_gsis_to_espn(players_csv_path: str) -> dict[str, int]:
    out = {}
    with open(players_csv_path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            gsis, espn = row.get("gsis_id"), row.get("espn_id")
            if gsis and espn:
                try:
                    out[gsis] = int(espn)
                except ValueError:
                    continue
    return out


def _bucket(yards: float, divisor: int) -> int:
    """Truncate-toward-zero bucket — see live_public_dst_kicking.py's
    `_bucket` docstring for why this matters (negative-yardage plays)."""
    if not yards:
        return 0
    return int(float(yards) / divisor)


def play_point_deltas(row: dict, cum_yards: dict[tuple[str, str], float]) -> dict[str, float]:
    """{gsis_id: fantasy points from this one play} for every skill
    player involved. Only ever called with real, already-happened plays
    — this computes what actually happened, the ground truth the
    projection model gets checked against.

    `cum_yards` is `(gsis_id, category)` -> cumulative yards THIS GAME
    so far, mutated in place by this call. Yardage points are bucketed
    off the RUNNING TOTAL, not summed per-play — ESPN buckets a whole
    game's accumulated yards (confirmed empirically against the private
    feed: statId 28/48's raw counts are pre-bucketed TOTALS, see
    scoring.py/live_public_stats.py), and bucketing each individual
    play's yardage separately instead loses real points at every
    10/25-yard boundary a play doesn't happen to land on exactly — caught
    via real validation (2026-09-13): Jonathan Taylor's real week 1 2025
    score came out exactly HALF what ESPN actually gave him (6 instead of
    12) before this fix, because his real yardage arrived in a string of
    plays that individually undershot each bucket boundary even though
    the cumulative total crossed it repeatedly."""
    deltas: defaultdict[str, float] = defaultdict(float)

    def _yardage_points(gsis: str, category: str, yards_gained: float, divisor: int) -> float:
        key = (gsis, category)
        before = cum_yards.get(key, 0.0)
        after = before + yards_gained
        cum_yards[key] = after
        return _bucket(after, divisor) - _bucket(before, divisor)

    if row.get("complete_pass") == "1":
        receiver = row.get("receiver_player_id")
        passer = row.get("passer_player_id")
        rec_yards = float(row.get("receiving_yards") or 0)
        pass_yards = float(row.get("passing_yards") or 0)
        if receiver:
            deltas[receiver] += RECEPTION_POINTS
            deltas[receiver] += _yardage_points(receiver, "receiving", rec_yards, RECEIVING_YARDS_PER_POINT)
        if passer:
            deltas[passer] += _yardage_points(passer, "passing", pass_yards, PASSING_YARDS_PER_POINT)
        if row.get("pass_touchdown") == "1":
            if receiver:
                deltas[receiver] += RECEIVING_TD_POINTS
            if passer:
                deltas[passer] += PASSING_TD_POINTS

    elif row.get("interception") == "1":
        passer = row.get("passer_player_id")
        if passer:
            deltas[passer] += INTERCEPTION_POINTS

    if row.get("rush_attempt") == "1":
        rusher = row.get("rusher_player_id")
        rush_yards = float(row.get("rushing_yards") or 0)
        if rusher:
            deltas[rusher] += _yardage_points(rusher, "rushing", rush_yards, RUSHING_YARDS_PER_POINT)
            if row.get("rush_touchdown") == "1":
                deltas[rusher] += RUSHING_TD_POINTS

    if row.get("fumble_lost") == "1":
        fumbler = row.get("fumbled_1_player_id")
        if fumbler:
            deltas[fumbler] += LOST_FUMBLE_POINTS

    if row.get("two_point_conv_result") == "success":
        for key in ("receiver_player_id", "rusher_player_id"):
            pid = row.get(key)
            if pid:
                deltas[pid] += TWO_POINT_POINTS

    return dict(deltas)


def _touch(row: dict) -> str | None:
    """Which player this play counts as a real "opportunity" for — a
    carry, a target (thrown at, whether caught or not — a target is the
    real opportunity signal, not just a completion), or a pass attempt
    for the QB themselves. Used for the shrinkage model's sample-size
    weighting, not for scoring."""
    if row.get("rush_attempt") == "1":
        return row.get("rusher_player_id")
    if row.get("pass_attempt") == "1" and row.get("sack") != "1":
        return row.get("receiver_player_id")  # a target, whether it's caught, incomplete, or intercepted
    return None


def replay_games(pbp_csv_gz_path: str, gsis_to_espn: dict[str, int]):
    """Yields one dict per (game, player) with points/touches-at-each-
    checkpoint and the real final — the raw material a backtest compares
    a candidate model's predictions against. Regulation-time checkpoints
    only (game_seconds_remaining resets/behaves oddly in OT, and this
    league's real scoring doesn't need OT-specific handling for what
    this backtest is checking)."""
    running: dict[tuple[str, str], float] = {}  # (game_id, gsis_id) -> points so far
    touches: dict[tuple[str, str], int] = {}  # (game_id, gsis_id) -> touches so far
    checkpoints_hit: dict[tuple[str, str], set[float]] = defaultdict(set)
    checkpoint_values: dict[tuple[str, str], dict[float, tuple[float, int]]] = defaultdict(dict)
    cum_yards: dict[tuple[str, str], float] = {}  # (gsis_id, category) -> cumulative yards, reset per game below

    current_game_id = None
    with gzip.open(pbp_csv_gz_path, "rt", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            game_id = row["game_id"]
            if game_id != current_game_id:
                cum_yards.clear()  # a new game — cumulative yardage buckets don't carry across games
                current_game_id = game_id
            try:
                secs_remaining = float(row.get("game_seconds_remaining") or -1)
            except ValueError:
                secs_remaining = -1
            in_regulation = 0 <= secs_remaining <= GAME_SECONDS

            deltas = play_point_deltas(row, cum_yards)
            for gsis, delta in deltas.items():
                if gsis not in gsis_to_espn:
                    continue
                key = (game_id, gsis)
                running[key] = running.get(key, 0.0) + delta

            touch_gsis = _touch(row)
            if touch_gsis and touch_gsis in gsis_to_espn:
                key = (game_id, touch_gsis)
                touches[key] = touches.get(key, 0) + 1
                running.setdefault(key, 0.0)  # a touch with 0 points so far still needs to exist for checkpointing

            if in_regulation:
                elapsed_fraction = (GAME_SECONDS - secs_remaining) / GAME_SECONDS
                for key, total in running.items():
                    if key[0] != game_id:
                        continue
                    for frac in CHECKPOINT_FRACTIONS:
                        if elapsed_fraction >= frac and frac not in checkpoints_hit[key]:
                            checkpoints_hit[key].add(frac)
                            checkpoint_values[key][frac] = (total, touches.get(key, 0))

    for key, total in running.items():
        game_id, gsis = key
        if not checkpoint_values[key]:
            continue  # never reached a checkpoint with any points recorded — not useful for the backtest
        yield {
            "game_id": game_id,
            "espn_id": gsis_to_espn[gsis],
            "checkpoints": dict(checkpoint_values[key]),  # frac -> (points_so_far, touches_so_far)
            "final": total,
            "final_touches": touches.get(key, 0),
        }
