"""Fast, no-network check: is a real NFL game plausibly happening RIGHT
NOW? Added 2026-09-20 as an early-exit guard in refresh.yml, once the
job is kicked off by a high-frequency EXTERNAL trigger (cron-job.org —
see refresh.yml's own incident history for why: GitHub's own `schedule:`
trigger has repeatedly, silently stopped firing this season). The
external trigger's own schedule is deliberately kept dead simple (one
static daily time window, no weekly upkeep) rather than trying to mirror
the real, constantly-shifting NFL schedule in a THIRD-PARTY service's
config — that would mean building and maintaining a second sync
pipeline, a second thing that can silently drift stale. Instead, the
precision lives here, in the one place that already tracks the real
schedule and updates itself automatically every week
(generate_refresh_schedule.py, already running on its own cron) — so a
frequent external "are you alive?" nudge costs nothing beyond a few
seconds of guard-check time outside real game windows, never a real
ESPN fetch.

Reuses generate_refresh_schedule.py's own real per-game windows
(computed from the cached NFL schedule) rather than re-deriving a
second, possibly-drifting version of the same logic.

Fails OPEN (True, "run anyway") on anything unexpected — a missing or
stale cache, a parsing error. A false "let's skip" here would silently
recreate the exact class of bug this whole guard exists to route
around; skipping unnecessary work is a nice-to-have, never missing a
real window is the actual requirement.
"""
import sys
from datetime import datetime, timezone

import config
from generate_refresh_schedule import GAME_BUFFER, load_games, windows_by_et_date  # noqa: F401  (GAME_BUFFER re-exported for anyone checking this module's own reasoning)


def is_game_time(now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    try:
        games, _ = load_games(config.SEASON)
        windows = windows_by_et_date(games)
    except SystemExit:
        return True  # no cached schedule yet at all — fail open, let the real build decide
    except Exception:
        return True  # any other real problem loading/parsing the schedule — fail open
    return any(start <= now <= end for start, end in windows.values())


if __name__ == "__main__":
    is_now = is_game_time()
    print("game time" if is_now else "not game time — nothing real to check right now")
    sys.exit(0 if is_now else 1)
