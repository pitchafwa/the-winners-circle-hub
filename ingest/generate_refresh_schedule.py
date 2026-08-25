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

A few weeks' worth of games may still have `startTimeTBD: true` at any given
moment (flex scheduling) — those are skipped this run and picked up
whenever this is re-run after they're set; the always-on fallback entries in
refresh.yml cover the gap in the meantime, so nothing goes un-refreshed
while a date is still TBD.

`update-refresh-schedule.yml` runs this weekly with `--write`, so in normal
operation nothing here needs a human — flex games resolve on their own, and
a new season's schedule gets picked up automatically once SEASON is bumped
for the year (see that workflow / refresh.yml's own header for the one-time
PAT setup this needs, since GITHUB_TOKEN can't push to .github/workflows/).

Usage (from ingest/, with the venv active):
    uv run python generate_refresh_schedule.py [season]           # print only
    uv run python generate_refresh_schedule.py [season] --write   # rewrite
        refresh.yml's marked block in place (between the "BEGIN GENERATED
        SCHEDULE" / "END GENERATED SCHEDULE" comments — anything outside
        those markers, including the 3 always-on fallback entries, is left
        untouched). Exits 0 either way; prints whether anything changed, so
        the calling workflow can skip a commit on a no-op week.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import config

BEGIN_MARKER = "# BEGIN GENERATED SCHEDULE"
END_MARKER = "# END GENERATED SCHEDULE"

ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")
GAME_BUFFER = timedelta(hours=4, minutes=30)  # kickoff -> likely final stats in


def load_games(season: int) -> tuple[list[dict], int]:
    path = config.CACHE_DIR / str(season) / "proschedule.json"
    if not path.exists():
        raise SystemExit(
            f"no cached proschedule.json for {season} — run a normal `build.py` "
            "for this season first (fetch_season() pulls it automatically)")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)["data"]
    seen: dict[int, dict] = {}
    tbd_ids: set[int] = set()
    for t in data["settings"]["proTeams"]:
        for games in t.get("proGamesByScoringPeriod", {}).values():
            for g in games:
                if g.get("startTimeTBD"):
                    tbd_ids.add(g["id"])
                    continue
                seen[g["id"]] = g  # each game listed under both participating teams
    return list(seen.values()), len(tbd_ids)


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


def write_in_place(lines: list[str], skipped_tbd: int) -> bool:
    """Replace everything between the BEGIN/END marker comments in
    refresh.yml with `lines`. Returns True if the cron entries actually
    changed (so a CI caller can skip an empty commit on a no-op week) —
    the trailing "N still TBD as of <today>" note always gets rewritten
    with the current date, but that alone doesn't count as a real change,
    or every weekly run would commit even when nothing moved."""
    path = config.ROOT / ".github" / "workflows" / "refresh.yml"
    text = path.read_text(encoding="utf-8")
    start = text.find(BEGIN_MARKER)
    end = text.find(END_MARKER)
    if start == -1 or end == -1 or end < start:
        raise SystemExit(
            "refresh.yml's BEGIN/END GENERATED SCHEDULE markers weren't found "
            "as expected — not touching the file. Check it wasn't hand-edited "
            "into a shape this script no longer recognizes.")
    begin_line_start = text.rfind("\n", 0, start) + 1
    indent = text[begin_line_start:start]
    end_line_end = text.find("\n", end) + 1
    # Trailer = every following line that's still part of the TBD footnote
    # comment (indented, starts with '#') — stops at the first blank/
    # non-comment line (the blank line before `permissions:`).
    trailer_end = end_line_end
    while text[trailer_end:trailer_end + len(indent) + 1] == indent + "#":
        trailer_end = text.find("\n", trailer_end) + 1

    old_cron_lines = text[text.find("\n", start) + 1:end].rstrip()
    body = "\n".join(lines)
    changed = body != old_cron_lines
    if not changed:
        return False  # nothing to rewrite — leaves last week's TBD-count/date note as-is too

    new_trailer = (
        f"{indent}# ({skipped_tbd} game(s) still startTimeTBD as of "
        f"{datetime.now(UTC).date().isoformat()} — picked up automatically "
        "once the weekly regenerate job sees a real kickoff time for them. "
        "Every-6h fallback above covers them until then.)\n"
        if skipped_tbd else ""
    )
    new_block = (
        indent + BEGIN_MARKER
        + " (generate_refresh_schedule.py --write; do not hand-edit between these markers)\n"
        + body + "\n"
        + indent + END_MARKER + "\n"
        + new_trailer
    )
    new_text = text[:begin_line_start] + new_block + text[trailer_end:]
    if new_text != text:
        path.write_text(new_text, encoding="utf-8", newline="\n")
    return changed


def main():
    args = [a for a in sys.argv[1:] if a != "--write"]
    write = "--write" in sys.argv
    season = int(args[0]) if args else config.SEASON

    games, skipped_tbd = load_games(season)
    if skipped_tbd:
        print(f"  ({skipped_tbd} game(s) still startTimeTBD — skipped, "
              "re-run once flex scheduling locks them in)", file=sys.stderr)
    if not games:
        raise SystemExit(f"no games with a real kickoff time on file for {season} yet")

    windows = windows_by_et_date(games)
    lines = [ln for d in sorted(windows) for ln in cron_lines_for_window(*windows[d])]
    print(f"# {len(windows)} game date(s), {len(lines)} cron entries — season {season}", file=sys.stderr)

    if write:
        changed = write_in_place(lines, skipped_tbd)
        print("changed" if changed else "no change", file=sys.stderr)
    else:
        print("\n".join(lines))


if __name__ == "__main__":
    main()
