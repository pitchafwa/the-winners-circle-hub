"""Full browsable player pool for the Players page — every player rostered
on any team in this league right now, plus every free agent/waiver-wire
player, in one flat list with real ESPN ownership and scoring data.

Current season only, same lifecycle as `roster.json`/`sim.json`: this is a
"right now" snapshot (who's rostered, who's available, this week's
ownership%), not a historical record — there's no meaningful "player pool
as of 2019" to reconstruct for a past season.

Rostered players come from the same raw `league.json` cache
(`fetch.fetch_league_raw`'s `mRoster` view) `roster.json` itself already
reads — covers all teams in the league, not just the user's own. Free
agents need a separate raw fetch (`fetch.fetch_free_agents_raw`,
`kona_player_info` view) since `mRoster` never includes anyone off a
roster at all.
"""
from __future__ import annotations

import parse


def _season_stat_totals(player: dict, season: int) -> tuple[float, float, float, float]:
    """(total_points, projected_total_points, avg_points,
    projected_avg_points) for the whole season so far — same
    seasonId/scoringPeriodId==0/statSourceId filtering espn_api's own
    `Player` class uses internally (statSourceId 0 = actual, 1 =
    projected; scoringPeriodId 0 = the season-aggregate stat line, not
    any one week), replicated directly against the raw dict here since
    building a full `Player` object just for these four numbers isn't
    worth it. A player entry can carry a PRIOR season's leftover stat
    blocks alongside this one (confirmed live) — the `seasonId` check is
    what keeps those out."""
    total = projected_total = avg = projected_avg = 0.0
    for s in player.get("stats", []):
        if s.get("seasonId") != season or s.get("scoringPeriodId") != 0:
            continue
        if s.get("statSourceId") == 0:
            total = round(s.get("appliedTotal") or 0.0, 2)
            avg = round(s.get("appliedAverage") or 0.0, 2)
        elif s.get("statSourceId") == 1:
            projected_total = round(s.get("appliedTotal") or 0.0, 2)
            projected_avg = round(s.get("appliedAverage") or 0.0, 2)
    return total, projected_total, avg, projected_avg


def _player_row(pid: int, player: dict, team_id: int | None, season: int, pro_teams: dict) -> dict:
    total, projected_total, avg, projected_avg = _season_stat_totals(player, season)
    pro_info = pro_teams.get(player.get("proTeamId", 0), {})
    ownership = player.get("ownership") or {}
    return {
        "player_id": pid,
        "name": player.get("fullName", ""),
        "position": parse.POSITION_NAMES.get(player.get("defaultPositionId", 0), "?"),
        "pro_team": pro_info.get("abbrev", ""),
        "eligible_slots": sorted({parse.SLOT_NAMES.get(s, str(s)) for s in player.get("eligibleSlots", [])}),
        "team_id": team_id,  # None = free agent / on waivers
        "injury_status": player.get("injuryStatus"),
        "percent_owned": round(ownership.get("percentOwned") or 0.0, 1),
        "percent_started": round(ownership.get("percentStarted") or 0.0, 1),
        "total_points": total,
        "projected_total_points": projected_total,
        "avg_points": avg,
        "projected_avg_points": projected_avg,
    }


def build_player_pool(season: int) -> list[dict]:
    """Returns [] when the raw roster snapshot isn't on file at all (a past
    season, or a current season this app hasn't fetched yet) — build.py
    treats that as "no file to write," never a fabricated empty pool."""
    league_raw = parse._load(season, "league")
    if not league_raw:
        return []
    pro_teams = parse.pro_team_schedule(season)

    rows: dict[int, dict] = {}
    for t in league_raw.get("teams", []):
        team_id = t["id"]
        for e in t.get("roster", {}).get("entries", []):
            player = (e.get("playerPoolEntry") or {}).get("player") or {}
            pid = player.get("id")
            if pid is None:
                continue
            rows[pid] = _player_row(pid, player, team_id, season, pro_teams)

    # Free agents: a rostered player should never also show up in the
    # FREEAGENT/WAIVERS-filtered fetch, but if ESPN's own data is ever
    # briefly inconsistent mid-transaction, the rostered entry above wins
    # — "who owns this player" is the more load-bearing fact of the two.
    fa_raw = parse._load(season, "free_agents")
    if fa_raw:
        for entry in fa_raw.get("players", []):
            player = entry.get("player") or {}
            pid = entry.get("id") or player.get("id")
            if pid is None or pid in rows:
                continue
            rows[pid] = _player_row(pid, player, None, season, pro_teams)

    # Default order: highest-owned first (same landing sort ESPN's own
    # Players tab uses) — meaningful at any point in the season, unlike
    # total_points which is uninformative in week 1. The frontend table
    # is fully sortable by any column; this is just a sane starting point.
    return sorted(rows.values(), key=lambda r: -r["percent_owned"])
