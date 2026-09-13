"""Compute this league's real fantasy scores for a live/in-progress week,
using ESPN's free public boxscore feed instead of the slow, cookie-gated
private fantasy API. See LIVE_PROJECTION_RESEARCH.md for the full story
— every piece this module orchestrates (`scoring.py`,
`live_public_stats.py`, `live_public_dst_kicking.py`) is individually
validated against real, known-correct scores already.

This is deliberately a thin orchestrator: fetch the week's real games,
run each team's box score through the position-specific translators, and
hand back one flat {player_id: {points, touches, elapsed_fraction}}
dict. The caller decides how to use it (see
`parse.optimal_week_projection`'s `live_score_override` param) — this
module doesn't know anything about lineups, matchups, or reconciliation
with ESPN's own official number.

`touches`/`elapsed_fraction` (added 2026-09-13) feed
`live_projection.py`'s rest-of-game model, on top of the points this
module was already computing — see LIVE_PROJECTION_RESEARCH.md.
"""
import requests

import scoring
from espn_api.football.constant import PRO_TEAM_MAP
import live_public_stats
import live_public_dst_kicking as dst_kicking

SCOREBOARD_URL = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
SUMMARY_URL = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary"

REGULATION_SECONDS = 3600  # 4 x 15-minute quarters — same definition `live_projection.py`'s backtest was built and validated against (nflverse's own game_seconds_remaining), so this has to match, not approximate via wall-clock time since kickoff


def _elapsed_fraction(status: dict) -> float:
    """How far through REGULATION this game is (0, 1] — the same
    game-clock-based definition `backtest_live_projection.py` used, so
    the live model gets fed the same kind of input it was actually
    validated against. `period` 1-4 is a normal quarter; 5+ is OT, which
    this app's backtest never modeled specifically — by OT there's
    already a full game's worth of real sample size, so this just clips
    at 1.0 rather than trying to model OT's own separate clock.

    A real bug caught live (2026-09-14, Tommy: "a little surprised to
    see my team is projected for 147ish... on ESPN it expects 126"):
    once a game reaches STATUS_FINAL, this feed stops including
    `period`/`displayClock` at all — `status.get("period")` silently
    reads as 0, identical to "hasn't started yet," and
    `project_rest_of_game()`'s own `elapsed_fraction <= 0` guard then
    returned several already-finished players' PREGAME number outright,
    discarding their real final score entirely (not even floored by
    `max(actual, ...)` — that floor only applies inside the normal
    blend, not this early-return path). A player who badly missed their
    pregame projection (Drake London: 4 actual vs. 14.9 pregame) got
    silently replaced by the higher, wrong number, inflating the whole
    team's projection. `type.completed` is checked first now — ESPN
    tells us directly when a game is over, a strictly better signal
    than guessing from clock fields that may not even be present."""
    if status.get("type", {}).get("completed"):
        return 1.0
    period = status.get("period") or 0
    if period <= 0:
        return 0.0
    if period > 4:
        return 1.0
    display_clock = status.get("displayClock") or "0:00"
    try:
        minutes, seconds = display_clock.split(":")
        remaining_in_quarter = int(minutes) * 60 + int(seconds)
    except ValueError:
        remaining_in_quarter = 0
    elapsed = (period - 1) * 900 + (900 - remaining_in_quarter)
    return max(0.0, min(1.0, elapsed / REGULATION_SECONDS))

# ESPN fantasy's own convention for a team D/ST's "player" id — confirmed
# against this app's real data (e.g. Chargers D/ST, pro_team_id 24, has
# player_id -16024 throughout sim.json/roster.json already).
DST_PLAYER_ID_OFFSET = -16000

ABBREV_TO_PRO_TEAM_ID = {v: k for k, v in PRO_TEAM_MAP.items() if v != "None"}


def fetch_week_events(season: int, week: int) -> list[dict]:
    """This week's real NFL games (any status — scheduled, in progress,
    or final), from the public scoreboard endpoint."""
    resp = requests.get(SCOREBOARD_URL, params={"year": season, "seasontype": 2, "week": week}, timeout=10)
    resp.raise_for_status()
    return resp.json().get("events", [])


def fetch_game_summary(event_id: str) -> dict:
    resp = requests.get(SUMMARY_URL, params={"event": event_id}, timeout=10)
    resp.raise_for_status()
    return resp.json()


def _team_players_scores(team_statistics: list[dict], position_id_by_pid: dict, rules: dict) -> dict[int, dict]:
    """One team's skill-position players -> {player_id: {points, touches}}.
    `position_id_by_pid` is only consulted for players whose position
    actually needs it (this league has no overrides outside D/ST, so a
    reasonable default works for anyone not already known). `touches` is
    carries+targets, the real sample-size signal `live_projection.py`'s
    model needs — not used for scoring itself."""
    raw_by_player = live_public_stats.player_raw_stats_from_public_boxscore(team_statistics)
    touches_by_player = live_public_stats.player_touches_from_public_boxscore(team_statistics)
    out: dict[int, dict] = {}
    for pid_str, raw in raw_by_player.items():
        pid = int(pid_str)
        position_id = position_id_by_pid.get(pid, 4)  # default: no override applies to any offensive skill position anyway
        pts, _ = scoring.compute_fantasy_points(raw, position_id, rules)
        out[pid] = {"points": pts, "touches": touches_by_player.get(pid_str, 0)}
    return out


def _kicker_scores(team_players_stats: list[dict], scoring_plays: list[dict], rules: dict) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for group in team_players_stats:
        if group.get("name") != "kicking":
            continue
        for row in group.get("athletes", []):
            pid = int(row["athlete"]["id"])
            name = row["athlete"]["displayName"]
            kicking_stats = dict(zip(group.get("keys", []), row.get("stats", [])))
            distances = [
                dst_kicking.made_field_goal_distance(sp)
                for sp in scoring_plays
                if sp.get("type", {}).get("text") == "Field Goal Good" and name.split()[-1] in sp.get("text", "")
            ]
            distances = [d for d in distances if d is not None]
            raw = dst_kicking.kicker_raw_stats(kicking_stats, distances)
            pts, _ = scoring.compute_fantasy_points(raw, 17, rules)
            out[pid] = {"points": pts, "touches": None}  # no "touches" concept for a kicker — live_projection.py is scoped to skill positions only
    return out


def compute_live_scores_for_week(season: int, week: int, rules: dict) -> dict[int, dict]:
    """{player_id: {points, touches, elapsed_fraction}} for every player
    (offense, D/ST, kicker) in every real NFL game scheduled this
    fantasy week, across whatever real status each game is currently in
    (not started, live, or final).

    `touches` is `None` for D/ST and kickers (see `live_projection.py`'s
    own docstring — it's scoped to skill positions only, a kicker or a
    defense doesn't have the same "opportunity pace" concept a receiver
    or running back does). `elapsed_fraction` (added 2026-09-13, see
    LIVE_PROJECTION_RESEARCH.md's projection-model section) is the same
    game for every player in it, read straight off this game's real live
    clock (`_elapsed_fraction`) — the SAME game-clock-based definition
    the projection model was actually backtested against, not an
    approximation via wall-clock time since kickoff.

    Missing pieces (2-point conversions, blocked kicks, safeties — see
    LIVE_PROJECTION_RESEARCH.md) are simply absent from the raw stats fed
    into `scoring.py`, so they contribute 0 rather than erroring — a
    real, known, documented undercount for the rare cases they'd apply,
    not a crash."""
    out: dict[int, dict] = {}

    for event in fetch_week_events(season, week):
        event_id = event["id"]
        try:
            summary = fetch_game_summary(event_id)
        except requests.RequestException:
            continue  # one game's fetch failing shouldn't take down the whole week

        boxscore = summary.get("boxscore") or {}
        if not boxscore.get("players"):
            continue  # game hasn't started yet — no box score exists at all

        players_by_team = {t["team"]["abbreviation"]: t["statistics"] for t in boxscore["players"]}
        teams_by_abbrev = {t["team"]["abbreviation"]: t["statistics"] for t in boxscore.get("teams", [])}
        scores_by_abbrev = {
            c["team"]["abbreviation"]: float(c.get("score", 0) or 0)
            for c in summary["header"]["competitions"][0]["competitors"]
        }
        scoring_plays = summary.get("scoringPlays", [])
        elapsed_fraction = _elapsed_fraction(summary["header"]["competitions"][0].get("status", {}))

        for abbrev, team_stats in players_by_team.items():
            for pid, entry in _team_players_scores(team_stats, {}, rules).items():
                out[pid] = {**entry, "elapsed_fraction": elapsed_fraction}
            for pid, entry in _kicker_scores(team_stats, scoring_plays, rules).items():
                out[pid] = {**entry, "elapsed_fraction": elapsed_fraction}

            opponent_abbrevs = [a for a in players_by_team if a != abbrev]
            if not opponent_abbrevs:
                continue
            opponent_abbrev = opponent_abbrevs[0]
            if abbrev not in teams_by_abbrev or opponent_abbrev not in teams_by_abbrev:
                continue
            dst_raw = dst_kicking.dst_raw_stats(
                teams_by_abbrev[abbrev], teams_by_abbrev[opponent_abbrev],
                scores_by_abbrev.get(opponent_abbrev, 0.0),
            )
            dst_pts, _ = scoring.compute_fantasy_points(dst_raw, 16, rules)
            pro_team_id = ABBREV_TO_PRO_TEAM_ID.get(abbrev)
            if pro_team_id is not None:
                out[DST_PLAYER_ID_OFFSET - pro_team_id] = {
                    "points": dst_pts, "touches": None, "elapsed_fraction": elapsed_fraction,
                }

    return out
