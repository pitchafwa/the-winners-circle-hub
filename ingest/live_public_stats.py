"""Translate ESPN's PUBLIC site API (site.web.api.espn.com — no login,
real-time, distinct from the private fantasy league API this app already
uses) into the same statId-space raw stat counts `scoring.py` expects.

See LIVE_PROJECTION_RESEARCH.md for why this exists: the private fantasy
API's `projected` field is frozen once a game starts, and its own live
`actual` number only refreshes on our own ~15-minute fetch cadence. This
public feed is free, has no rate-limit key, and refreshes live — so it
lets us compute live scores ourselves, as often as we want, using the
validated formula in `scoring.py`.

Status (2026-09-13): passing/rushing/receiving/fumbles for offensive
skill players is built and validated end-to-end against a real finished
game. NOT yet built: D/ST team-defense scoring (points-allowed/yards-
allowed tiers, sacks/INTs/fumble-recoveries attributed to the team unit,
not individual defenders — this league scores D/ST as one team-level
"player", never IDPs), kicking distance tiers (this feed's kicking group
only gives combined make/attempt counts, not per-kick distance — needs
parsing individual field-goal plays out of `drives[].plays[].text`), and
2-point conversions (not present anywhere in this feed's structured
stats at all — also needs play-text parsing). None of those are used by
every player, so the skill-position piece built here is already useful
on its own; those are the next concrete pieces to add.

Confirmed NOT needed for this league: forced fumbles (statId 106) has no
points value in this league's real scoring settings at all — one of the
gaps the Reddit thread flagged for a general-purpose tool turned out not
to matter here.
"""

# Bucket divisors for ESPN's "every N yards = 1 point" categories.
# Confirmed empirically (2026-09-13) against 2024-2025 cached box scores
# by comparing the private API's own pre-bucketed raw stat (e.g. statId
# 28) against the plain yardage stat for the same player-week, across
# thousands of real samples — these are the real divisors ESPN uses, not
# a guess: passing 1pt/25yds, rushing and receiving both 1pt/10yds.
PASSING_YARDS_PER_POINT = 25
RUSHING_YARDS_PER_POINT = 10
RECEIVING_YARDS_PER_POINT = 10

# statId (scoring.py / espn_api's PLAYER_STATS_MAP space) each raw public-
# feed stat group key feeds into. Only keys this league's real scoring
# rules actually use nonzero points for are mapped — see
# LIVE_PROJECTION_RESEARCH.md for the full real scoring-rules dump this
# was built from.
PASSING_TD_STAT_ID = 4
PASSING_INT_STAT_ID = 20
RUSHING_TD_STAT_ID = 25
RECEIVING_TD_STAT_ID = 43
RECEPTIONS_STAT_ID = 53
FUMBLES_LOST_STAT_ID = 72


def _num(stat_value) -> float:
    """Public feed stat values are display strings ('132', '14/17',
    '3-20') — plain numeric ones parse straight through; composite ones
    aren't used by this function (callers pick out the sub-value they
    need before calling, e.g. splitting 'C/ATT' themselves)."""
    try:
        return float(stat_value)
    except (TypeError, ValueError):
        return 0.0


def _bucket(yards: float, divisor: int) -> float:
    """floor(yards / divisor) toward zero, not toward -infinity — a QB
    kneel or a negative scramble can leave `yards` negative, and Python's
    `//` floors toward -infinity (-3 // 10 == -1), which would wrongly
    dock a point. Found via real validation 2026-09-13: Matthew Stafford
    scored 1 point lower than the real, known-correct total until this
    was fixed (`int(-3 // 10)` = -1 instead of the correct 0)."""
    return float(int(yards / divisor))


def player_raw_stats_from_public_boxscore(team_stat_groups: list[dict]) -> dict[int, dict[str, float]]:
    """One team's `boxscore.players[i].statistics` (the public feed's
    per-category athlete tables) -> {player_id: {statId: raw_count}},
    in the same unit-space `scoring.compute_fantasy_points` expects.
    Skill positions only (passing/rushing/receiving/fumbles) — D/ST and
    kicking are handled separately, see module docstring."""
    out: dict[int, dict[str, float]] = {}

    def entry(pid: str) -> dict:
        return out.setdefault(pid, {})

    for group in team_stat_groups:
        name = group.get("name")
        keys = group.get("keys", [])

        for athlete_row in group.get("athletes", []):
            pid = athlete_row["athlete"]["id"]
            values = dict(zip(keys, athlete_row.get("stats", [])))
            raw = entry(pid)

            if name == "passing":
                yards = _num(values.get("passingYards"))
                raw[8] = _bucket(yards, PASSING_YARDS_PER_POINT)
                raw[PASSING_TD_STAT_ID] = _num(values.get("passingTouchdowns"))
                raw[PASSING_INT_STAT_ID] = _num(values.get("interceptions"))

            elif name == "rushing":
                yards = _num(values.get("rushingYards"))
                raw[28] = _bucket(yards, RUSHING_YARDS_PER_POINT)
                raw[RUSHING_TD_STAT_ID] = _num(values.get("rushingTouchdowns"))

            elif name == "receiving":
                yards = _num(values.get("receivingYards"))
                raw[48] = _bucket(yards, RECEIVING_YARDS_PER_POINT)
                raw[RECEIVING_TD_STAT_ID] = _num(values.get("receivingTouchdowns"))
                raw[RECEPTIONS_STAT_ID] = _num(values.get("receptions"))

            elif name == "fumbles":
                raw[FUMBLES_LOST_STAT_ID] = _num(values.get("fumblesLost"))

    return out
