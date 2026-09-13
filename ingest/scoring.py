"""Compute this league's real fantasy points ourselves, from raw per-stat
counts, instead of trusting ESPN's own precomputed `appliedTotal`.

Why this exists: see LIVE_PROJECTION_RESEARCH.md. ESPN's private fantasy
API (the one this whole app is built on) only refreshes a live game's
`projected`/`actual` numbers on our own fetch cadence, and its `projected`
field is frozen the moment the game kicks off (confirmed live, see
BACKLOG.md). ESPN also runs a completely separate PUBLIC, no-login API
(site.web.api.espn.com) with real-time per-player stat lines and drive-
level play-by-play — but that feed doesn't hand us a precomputed fantasy
score, just raw counting stats. This module is what turns raw stats into
this league's actual point value, so we can score that public feed
ourselves and no longer be bottlenecked by the private feed's refresh
cadence for live scores.

Validated 2026-09-13 against every real player-week ESPN has ever scored
for this league in 2024 and 2025 (5,312 player-weeks, every position that
appears in real data): computing points this way from raw stat counts
matches ESPN's own `appliedTotal` exactly (within float rounding) in
100% of cases. See ingest/LIVE_PROJECTION_RESEARCH.md for the validation
script this was built from.

Key discovery that made this simple: ESPN's raw per-statId stat counts
are ALREADY the exact scoring unit for bucketed categories — e.g. the
raw stat at statId 28 is already floor(rushingYards / 10), not the raw
yardage itself. So scoring from the PRIVATE feed's raw stats is purely
linear (raw_count * points_per_unit, summed) with no bucketing math
needed on our end at all. The PUBLIC feed (site.web.api.espn.com) does
NOT pre-bucket its numbers this way — it reports plain totals (e.g. real
receiving yards, not a pre-divided-by-10 count) — so a caller scoring
from that feed needs to do the yards-per-N bucketing itself before
calling into this module. That translation lives in a separate module
once built (see LIVE_PROJECTION_RESEARCH.md's next steps), not here —
this module only knows about statId-space raw counts, regardless of
which feed they came from.
"""
from espn_api.football.constant import PLAYER_STATS_MAP  # noqa: F401  (re-exported for callers that want stat names)


def build_rules(scoring_items: list[dict]) -> dict[int, dict]:
    """league.settings.scoringSettings.scoringItems -> {statId: {"points": base,
    "overrides": {position_id_str: points}}}. `overrides` covers cases like
    D/ST (position id 16) scoring points-allowed/yards-allowed tiers that
    read as 0 for every other position."""
    return {
        it["statId"]: {"points": it["points"], "overrides": it.get("pointsOverrides", {})}
        for it in scoring_items
    }


def compute_fantasy_points(
    raw_stats: dict[int, float], position_id: int, rules: dict[int, dict],
) -> tuple[float, dict[int, float]]:
    """(total_points, {statId: contribution}) for one player's one stat
    line. `raw_stats` is statId -> raw count, already in the same
    scoring-unit space ESPN's own private API stat lines use (see module
    docstring — a caller working from the public site API must bucket its
    raw yardage into this same unit space first)."""
    total = 0.0
    breakdown: dict[int, float] = {}
    for stat_id, raw_val in raw_stats.items():
        rule = rules.get(stat_id)
        if rule is None:
            continue
        pts_per_unit = rule["overrides"].get(str(position_id), rule["points"])
        if pts_per_unit == 0:
            continue
        contribution = raw_val * pts_per_unit
        if contribution != 0:
            total += contribution
            breakdown[stat_id] = round(contribution, 4)
    return round(total, 4), breakdown
