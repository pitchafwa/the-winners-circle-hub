"""Generate the GitHub Actions cron schedule for ../.github/workflows/refresh.yml
from the REAL NFL game schedule, instead of a static day-of-week guess.

ESPN's pro schedule (`proTeams[].proGamesByScoringPeriod`, already cached by
every normal build as `.cache/{season}/proschedule.json`) has an exact kickoff
timestamp for every game in the season. This groups every real game by the
US-Eastern calendar date it airs on (so an 8:15pm ET Thursday game whose UTC
timestamp already rolls into Friday still counts as "Thursday's window"), then
emits one cron window per date spanning first kickoff to last kickoff + a
buffer for a full game (regulation + likely OT + ESPN's stat-finalization
lag) — covering Thursday/Sunday/Monday and any Saturday/Friday/international
placement without needing to special-case them.

This is a generated artifact, not something that re-derives itself on every
build — run it manually whenever a new season's full schedule is released
(typically ~April/May) or after the in-season flex-scheduling windows lock in
late-season Sunday/Monday game times. A few weeks' worth of games may still
have `startTimeTBD: true` at any given moment (flex scheduling) — those are
skipped this run and picked up whenever this is re-run after they're set;
the existing static Sun/Mon/Tue-Sat fallback windows in refresh.yml cover the
gap in the meantime, so nothing goes un-refreshed while a date is still TBD.

Usage (from ingest/, with the venv active):
    uv run python generate_refresh_schedule.py [season]
Prints the generated cron lines for review — paste them into refresh.yml's
`schedule:` block by hand rather than having this script edit CI config
unsupervised.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import config

ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")
GAME_BUFFER = timedelta(hours=4, minutes=30)  # kickoff -> likely final stats in


def load_games(season: int) -> list[dict]:
    path = config.CACHE_DIR / str(season) / "proschedule.json"
    if not path.exists():
        raise SystemExit(
            f"no cached proschedule.json for {season} — run a normal `build.py` "
            "for this season first (fetch_season() pulls it automatically)")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)["data"]
    seen: dict[int, dict] = {}
    skipped_tbd = 0
    for t in data["settings"]["proTeams"]:
        for games in t.get("proGamesByScoringPeriod", {}).values():
            for g in games:
                if g.get("startTimeTBD"):
                    skipped_tbd += 1
                    continue
                seen[g["id"]] = g  # each game listed under both participating teams
    if skipped_tbd:
        print(f"  ({skipped_tbd // 2} game(s) still startTimeTBD — skipped, "
              "re-run once flex scheduling locks them in)", file=sys.stderr)
    return list(seen.values())


def windows_by_et_date(games: list[dict]) -> dict[object, list[datetime]]:
    by_date: dict[object, list[datetime]] = {}
    for g in games:
        kickoff = datetime.fromtimestamp(g["date"] / 1000, tz=UTC).astimezone(ET)
        end = kickoff + GAME_BUFFER
        d = kickoff.date()
        if d not in by_date:
            by_date[d] = [kickoff, end]
        else:
            by_date[d][0] = min(by_date[d][0], kickoff)
            by_date[d][1] = max(by_date[d][1], end)
    return by_date


def cron_lines_for_window(start_et: datetime, end_et: datetime) -> list[str]:
    start_utc, end_utc = start_et.astimezone(UTC), end_et.astimezone(UTC)
    if start_utc.date() == end_utc.date():
        return [_line(start_utc.date(), start_utc.hour, end_utc.hour, start_et)]
    # Window spans UTC midnight (typical for evening ET kickoffs) — two entries.
    return [
        _line(start_utc.date(), start_utc.hour, 23, start_et),
        _line(end_utc.date(), 0, end_utc.hour, start_et),
    ]


def _line(date, hour_start: int, hour_end: int, start_et: datetime) -> str:
    weekday = start_et.strftime("%a")
    return f'    - cron: "*/15 {hour_start}-{hour_end} {date.day} {date.month} *"  # {weekday} {start_et.date()} ET games'


def main():
    season = int(sys.argv[1]) if len(sys.argv) > 1 else config.SEASON
    games = load_games(season)
    if not games:
        raise SystemExit(f"no games with a real kickoff time on file for {season} yet")
    windows = windows_by_et_date(games)
    lines = [ln for d in sorted(windows) for ln in cron_lines_for_window(*windows[d])]
    print(f"# {len(windows)} game date(s), {len(lines)} cron entries — season {season}", file=sys.stderr)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
