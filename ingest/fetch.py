"""Pull raw ESPN data and cache it to .cache/.

Rules:
- ~1 request/sec, exponential backoff on 429s (patched into the library's
  request layer so internal calls are throttled too).
- Completed weeks are immutable: once cached with {"final": true}, never
  re-fetched. Only the current week gets refreshed.
- Every cache file carries a fetched_at timestamp.

Run directly for the Milestone-1 probe:
    python fetch.py            # connect, dump raw JSON, print teams/scores
"""
import json
import sys
import time
from datetime import datetime, timezone

import config

# ---------------------------------------------------------------------------
# Rate limiting + retry, patched over espn_api's request layer so every call
# (including the library's internal ones) goes through it.
# ---------------------------------------------------------------------------
_last_request_at = 0.0


def _install_rate_limiter():
    import requests as _requests

    original_get = _requests.get

    def polite_get(*args, **kwargs):
        global _last_request_at
        for attempt in range(5):
            wait = config.MIN_SECONDS_BETWEEN_REQUESTS - (time.monotonic() - _last_request_at)
            if wait > 0:
                time.sleep(wait)
            _last_request_at = time.monotonic()
            resp = original_get(*args, **kwargs)
            if resp.status_code == 429:
                backoff = 2 ** (attempt + 1)
                print(f"  429 from ESPN, backing off {backoff}s", file=sys.stderr)
                time.sleep(backoff)
                continue
            return resp
        return resp

    _requests.get = polite_get


_install_rate_limiter()

from espn_api.football import League  # noqa: E402  (after patch on purpose)


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------
def cache_path(endpoint: str, week: int | None = None, season: int | None = None):
    name = f"{endpoint}-week{week}.json" if week is not None else f"{endpoint}.json"
    return config.CACHE_DIR / str(season or config.SEASON) / name


def read_cache(endpoint: str, week: int | None = None, season: int | None = None):
    path = cache_path(endpoint, week, season)
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_cache(endpoint: str, payload, week: int | None = None, final: bool = False,
                season: int | None = None):
    path = cache_path(endpoint, week, season)
    path.parent.mkdir(parents=True, exist_ok=True)
    envelope = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "season": season or config.SEASON,
        "week": week,
        "final": final,
        "data": payload,
    }
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(envelope, f)
    tmp.replace(path)
    return path


# ---------------------------------------------------------------------------
# Fetchers
# ---------------------------------------------------------------------------
def connect() -> League:
    return League(
        league_id=config.LEAGUE_ID,
        year=config.SEASON,
        espn_s2=config.ESPN_S2,
        swid=config.SWID,
    )


def fetch_league_raw(league: League):
    """Raw league view (teams, rosters, matchups, settings) — always refreshed."""
    data = league.espn_request.get_league()
    write_cache("league", data)
    return data


def fetch_week_raw(league: League, week: int, current_week: int, is_final: bool | None = None):
    """Raw box-score view for one week. Finalized weeks come from cache."""
    cached = read_cache("boxscores", week)
    if cached and cached.get("final"):
        return cached["data"]

    matchup_period = week
    for mp, scoring_periods in league.settings.matchup_periods.items():
        if week in scoring_periods:
            matchup_period = mp
            break

    params = {"view": ["mMatchupScore", "mScoreboard"], "scoringPeriodId": week}
    filters = {"schedule": {"filterMatchupPeriodIds": {"value": [matchup_period]}}}
    headers = {"x-fantasy-filter": json.dumps(filters)}
    data = league.espn_request.league_get(params=params, headers=headers)
    if "schedule" not in data or not data["schedule"]:
        raise RuntimeError(f"box scores for week {week} returned no schedule — keeping previous cache")

    if is_final is None:
        is_final = week < current_week
    write_cache("boxscores", data, week=week, final=is_final)
    return data


TRANSACTION_TYPE_FILTER = ["FREEAGENT", "WAIVER", "TRADE_ACCEPT", "ROSTER"]


def fetch_transactions_raw(league: League, week: int, is_final: bool):
    """mTransactions2 for one scoring period — adds, drops, waiver claims,
    trades, with dates and bid amounts.

    This is the only acquisition-date source that works for archived seasons
    (the communication endpoint 404s on them, and historical mRoster nulls
    out acquisitionType/Date). Finalized weeks come from cache.
    """
    cached = read_cache("transactions", week)
    if cached and cached.get("final"):
        return cached["data"]

    filters = {"transactions": {"filterType": {"value": TRANSACTION_TYPE_FILTER}}}
    headers = {"x-fantasy-filter": json.dumps(filters)}
    data = league.espn_request.league_get(
        params={"view": "mTransactions2", "scoringPeriodId": week}, headers=headers)
    if "transactions" not in data:
        data = {"transactions": []}  # quiet weeks legitimately have none
    write_cache("transactions", data, week=week, final=is_final)
    return data


def fetch_history_raw(year: int):
    """League view for a past season — standings, records, schedule, settings.

    One request, cached forever (past seasons are immutable). Uses the raw
    endpoint directly: no need for the library's full player/draft fetches,
    and pre-2018 seasons live on a different endpoint shape anyway.
    """
    import requests

    path = config.CACHE_DIR / str(year) / "league.json"
    if path.exists():
        return None  # immutable — never re-fetch

    views = "view=mTeam&view=mSettings&view=mStandings&view=mMatchup"
    if year < 2018:
        url = (f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/"
               f"leagueHistory/{config.LEAGUE_ID}?seasonId={year}&{views}")
    else:
        url = (f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/"
               f"seasons/{year}/segments/0/leagues/{config.LEAGUE_ID}?{views}")
    cookies = None
    if config.ESPN_S2 and config.SWID:
        cookies = {"espn_s2": config.ESPN_S2, "SWID": config.SWID}
    r = requests.get(url, cookies=cookies)
    if r.status_code != 200:
        raise RuntimeError(f"history {year}: HTTP {r.status_code}")
    data = r.json()
    if isinstance(data, list):
        data = data[0] if data else None
    if not data or "teams" not in data:
        raise RuntimeError(f"history {year}: no team data in response")

    write_cache("league", data, season=year)
    return data


def fetch_player_names(league: League):
    """Global NFL player-id -> name map (kona player list). One request;
    stored at the cache root since names aren't season-specific. This is the
    only way to name players who were dropped and never appeared in any
    cached box score or roster."""
    data = league.espn_request.get_pro_players()
    names = {str(p["id"]): p.get("fullName", "") for p in data if p.get("id")}
    path = config.CACHE_DIR / "players.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"fetched_at": datetime.now(timezone.utc).isoformat(), "names": names}, f)
    tmp.replace(path)
    return names


def fetch_draft_raw(league: League):
    """mDraftDetail — immutable once the draft has happened."""
    cached = read_cache("draft")
    if cached and cached.get("final"):
        return cached["data"]
    data = league.espn_request.league_get(params={"view": "mDraftDetail"})
    drafted = bool(data.get("draftDetail", {}).get("drafted"))
    write_cache("draft", data, final=drafted)
    return data


def fetch_pro_schedule_raw(league: League):
    """NFL pro schedule (game dates per scoring period) — refreshed each run."""
    data = league.espn_request.get_pro_schedule()
    if "settings" not in data:
        raise RuntimeError("pro schedule response missing 'settings' — keeping previous cache")
    write_cache("proschedule", data)
    return data


def completed_weeks(league: League) -> list[int]:
    """Scoring periods with at least one decided matchup, capped at the last
    week this league counts."""
    weeks = []
    for w in range(1, min(league.current_week, config.FINAL_COUNTED_WEEK) + 1):
        for t in league.teams:
            if len(t.outcomes) >= w and t.outcomes[w - 1] in ("W", "L", "T"):
                weeks.append(w)
                break
    return weeks


def fetch_season(league: League | None = None):
    """Pull everything the metrics layer needs into .cache/{season}/.

    Finalized weeks are never re-fetched. A failed week fetch raises after
    logging, leaving any previous cache for that week intact.
    """
    league = league or connect()
    fetch_league_raw(league)
    fetch_pro_schedule_raw(league)
    fetch_player_names(league)

    season_over = league.scoringPeriodId > league.finalScoringPeriod
    weeks = completed_weeks(league)
    current = league.current_week
    # In true preseason, current_week is 0 (nothing has kicked off), but
    # currentMatchupPeriod already points at the upcoming week 1 — fall back
    # to that so we still know which week's projections to fetch below.
    upcoming = current if current >= 1 else league.currentMatchupPeriod
    # Always include the upcoming week even if nothing in it has been
    # decided yet — that's the ONLY way to get ESPN's real per-player
    # projections for a week that hasn't kicked off (used for the weekly
    # matchup-projection cards). completed_weeks() alone would leave a
    # preseason/early-week build with no box-score cache at all for it.
    target_weeks = sorted(set(weeks) | ({upcoming} if 1 <= upcoming <= config.FINAL_COUNTED_WEEK else set()))
    errors = []
    # week 0 = preseason transactions (post-draft pickups before week 1)
    for w in [0] + target_weeks:
        is_final = season_over or w < current
        try:
            if w > 0:
                fetch_week_raw(league, w, current, is_final=is_final)
            fetch_transactions_raw(league, w, is_final=is_final)
        except Exception as e:  # noqa: BLE001 — fail loudly but finish other weeks
            errors.append((w, e))
            print(f"ERROR fetching week {w}: {e}", file=sys.stderr)
    if errors:
        raise RuntimeError(
            f"{len(errors)} week(s) failed to fetch: {[w for w, _ in errors]}. "
            "Previous cache files for those weeks were left untouched."
        )
    return league, weeks


# ---------------------------------------------------------------------------
# Milestone-1 probe
# ---------------------------------------------------------------------------
def probe():
    print(f"Connecting to ESPN league {config.LEAGUE_ID}, season {config.SEASON}...")
    league = connect()

    s = league.settings
    print(f"\nLeague: {s.name}")
    print(f"Teams: {len(league.teams)} | Regular season: {s.reg_season_count} weeks | "
          f"Playoff teams: {s.playoff_team_count}")
    print(f"Current scoring period: {league.scoringPeriodId} | "
          f"Current matchup period: {league.currentMatchupPeriod}")
    drafted = bool(league.draft)
    print(f"Draft complete: {'yes' if drafted else 'no'}")

    raw = fetch_league_raw(league)
    print(f"\nRaw league JSON cached to {cache_path('league')}")

    completed = [w for w in range(1, league.current_week + 1)
                 if any(t.outcomes[w - 1] in ("W", "L", "T") for t in league.teams if len(t.outcomes) >= w)]
    print(f"Completed weeks so far: {completed if completed else 'none'}")

    print("\nTeams:")
    for team in league.teams:
        owners = ", ".join(o.get("displayName", "?") for o in team.owners) or "—"
        print(f"  [{team.team_id:2d}] {team.team_name}  ({team.wins}-{team.losses}"
              f"{f'-{team.ties}' if team.ties else ''})  owner: {owners}")

    if completed:
        week = completed[-1]
        fetch_week_raw(league, week, league.current_week)
        print(f"\nWeek {week} scores (raw JSON cached to {cache_path('boxscores', week)}):")
        for m in league.box_scores(week):
            if m.home_team and m.away_team:
                print(f"  {m.away_team.team_name} {m.away_score:.1f} @ "
                      f"{m.home_team.team_name} {m.home_score:.1f}")
    else:
        print("\nNo completed weeks yet (season hasn't started) — skipping box scores.")
        print("The connection, settings read, and raw dump above prove the pipeline works.")


if __name__ == "__main__":
    probe()
