"""D/ST and kicker scoring from ESPN's public boxscore feed — the two
pieces `live_public_stats.py` deliberately left out. See
LIVE_PROJECTION_RESEARCH.md for the full picture; this module covers:

- **D/ST** (this league scores D/ST as ONE team unit, position id 16 —
  never individual defenders, no IDP): points-allowed and yards-allowed
  are read straight off `boxscore.teams` — a team's own "yards allowed"
  is simply its OPPONENT's own `totalYards` in the same game, "points
  allowed" is the opponent's own final/current score. Sacks/interceptions/
  fumble-recoveries for D/ST purposes are the OPPONENT's own conceded
  stats (a defense's sack is the other team's own "sacksYardsLost"
  count) — confirmed real, not inferred: ESPN's team stat block lists
  "interceptions" under BOTH team-stat slots with the identical label
  "Interceptions thrown" (an actual duplicate in their own feed, not two
  different things), so there is no separate "defensive interceptions
  recorded" team stat to read — the opponent's own thrown-interceptions
  count IS the correct number. Defensive/special-teams touchdowns are
  given directly per-team (`defensiveTouchdowns`) — no need to scan
  play-by-play text for pick-sixes/fumble-return TDs at all, much
  simpler than originally planned.

- **Kicker**: field goal and extra point MAKE/ATTEMPT counts come from
  `boxscore.players`' "kicking" stat group (a per-player row, already
  attributed to the right athlete id). That group does NOT break field
  goals down by distance, but this league's real scoring IS tiered by
  distance — so made-field-goal distance is read from the game's
  `scoringPlays` list instead (each field-goal scoring play carries a
  clean `statYardage` field, no text parsing needed).

**Known real gaps, not yet handled — no real example seen yet to build
or validate against**: blocked kicks (statId 97) and safeties (statId
98) aren't present as a direct team-level stat in this feed, and neither
occurred in any live game checked while building this (2026-09-13).
Would need scanning `drives[].plays[].type.text` for "Blocked"/"Safety"
once a real example exists to confirm the right detection pattern —
flagged rather than guessed at.
"""

# (raw_yards_allowed) -> which points-allowed/yards-allowed statId this
# league's real scoring rules credit it to. Boundaries taken directly
# from the statId's own name in espn_api's PLAYER_STATS_MAP (e.g.
# "defensive7To13PointsAllowed") — not a guess. Gaps are real: this
# league's settings have no rule at all for 18-27 points allowed or
# 300-349 yards allowed, so those ranges correctly score 0, matching
# what's actually configured (confirmed by dumping every one of this
# league's 46 real scoring items and finding those ids simply absent).
POINTS_ALLOWED_TIERS = [
    (0, 0, 89), (1, 6, 90), (7, 13, 91), (14, 17, 92),
    (28, 34, 123), (35, 45, 124),
]
POINTS_ALLOWED_45_PLUS_STAT_ID = 125  # 45+ has no upper bound

YARDS_ALLOWED_TIERS = [
    (0, 99, 128), (100, 199, 129), (200, 299, 130),
    (350, 399, 132), (400, 449, 133), (450, 499, 134), (500, 549, 135),
]
YARDS_ALLOWED_550_PLUS_STAT_ID = 136  # 550+ has no upper bound

DST_SACKS_STAT_ID = 99
DST_INTERCEPTIONS_STAT_ID = 95
DST_FUMBLE_RECOVERIES_STAT_ID = 96
DST_TOUCHDOWNS_STAT_ID = 105  # defensivePlusSpecialTeamsTouchdowns — covers any return/blocked-kick TD type; this league scores every TD variant (101-104, 93) at the same 6 points, so one combined count is equivalent to totaling them individually

FG_UNDER_40_STAT_ID = 80
FG_40_TO_49_STAT_ID = 77
FG_50_TO_59_STAT_ID = 198  # not in espn_api's public map (a real gap in that community list) — inferred from this league's own tier progression (<40=3, 40-49=4, THIS=5, 60+=6) and confirmed consistent with the FG-tier ladder shape
FG_60_PLUS_STAT_ID = 201
MISSED_FG_STAT_ID = 85
MADE_XP_STAT_ID = 86


def _team_stat(statistics: list[dict], name: str) -> float:
    for s in statistics:
        if s.get("name") == name:
            try:
                return float(s.get("displayValue", "0").split("-")[0].split("/")[0])
            except ValueError:
                return 0.0
    return 0.0


def _points_allowed_stat_id(points: float) -> int | None:
    for lo, hi, stat_id in POINTS_ALLOWED_TIERS:
        if lo <= points <= hi:
            return stat_id
    if points >= 46:
        return POINTS_ALLOWED_45_PLUS_STAT_ID
    return None  # a real gap in this league's tier ladder (18-27) — correctly scores nothing


def _yards_allowed_stat_id(yards: float) -> int | None:
    for lo, hi, stat_id in YARDS_ALLOWED_TIERS:
        if lo <= yards <= hi:
            return stat_id
    if yards >= 550:
        return YARDS_ALLOWED_550_PLUS_STAT_ID
    return None  # a real gap in this league's tier ladder (300-349) — correctly scores nothing


def dst_raw_stats(
    own_team_statistics: list[dict], opponent_team_statistics: list[dict],
    opponent_score: float,
) -> dict[int, float]:
    """One team's D/ST raw stat line (statId -> count), scored at
    position_id=16 via `scoring.compute_fantasy_points`. Needs the
    OPPONENT's own `boxscore.teams[i].statistics` (their conceded stats
    are this defense's credited stats) plus the opponent's real game
    score."""
    raw: dict[int, float] = {}

    pts_id = _points_allowed_stat_id(opponent_score)
    if pts_id is not None:
        raw[pts_id] = 1.0

    opp_yards = _team_stat(opponent_team_statistics, "totalYards")
    yds_id = _yards_allowed_stat_id(opp_yards)
    if yds_id is not None:
        raw[yds_id] = 1.0

    raw[DST_SACKS_STAT_ID] = _team_stat(opponent_team_statistics, "sacksYardsLost")
    raw[DST_INTERCEPTIONS_STAT_ID] = _team_stat(opponent_team_statistics, "interceptions")
    raw[DST_FUMBLE_RECOVERIES_STAT_ID] = _team_stat(opponent_team_statistics, "fumblesLost")
    raw[DST_TOUCHDOWNS_STAT_ID] = _team_stat(own_team_statistics, "defensiveTouchdowns")

    return raw


import re

_FG_DISTANCE_RE = re.compile(r"(\d+)\s*Yd Field Goal")


def made_field_goal_distance(scoring_play: dict) -> float | None:
    """A made field goal's real distance from one `scoringPlays` entry.
    `statYardage` carries this cleanly on some games but was found NULL
    on others during validation (2026-09-13, Patriots @ Seahawks) despite
    the play text always having it ("Jason Myers 30 Yd Field Goal") — so
    this falls back to parsing the text rather than trusting the
    structured field alone."""
    yardage = scoring_play.get("statYardage")
    if yardage is not None:
        return float(yardage)
    match = _FG_DISTANCE_RE.search(scoring_play.get("text", ""))
    return float(match.group(1)) if match else None


def _fg_tier_stat_id(distance: float) -> int:
    if distance < 40:
        return FG_UNDER_40_STAT_ID
    if distance < 50:
        return FG_40_TO_49_STAT_ID
    if distance < 60:
        return FG_50_TO_59_STAT_ID
    return FG_60_PLUS_STAT_ID


def kicker_raw_stats(
    kicking_group_athlete_stats: dict,  # {key: value} for this kicker's row in the "kicking" stat group
    made_field_goal_distances: list[float],  # this kicker's own made-FG distances, from scoringPlays' statYardage
) -> dict[int, float]:
    """One kicker's raw stat line (statId -> count)."""
    raw: dict[int, float] = {}

    fg_made_att = kicking_group_athlete_stats.get("fieldGoalsMade/fieldGoalAttempts", "0/0")
    made_str, att_str = fg_made_att.split("/")
    made, attempted = int(made_str), int(att_str)
    raw[MISSED_FG_STAT_ID] = float(attempted - made)

    for distance in made_field_goal_distances:
        stat_id = _fg_tier_stat_id(distance)
        raw[stat_id] = raw.get(stat_id, 0.0) + 1.0

    xp_made_att = kicking_group_athlete_stats.get("extraPointsMade/extraPointAttempts", "0/0")
    xp_made_str, _ = xp_made_att.split("/")
    raw[MADE_XP_STAT_ID] = float(xp_made_str)

    return raw
