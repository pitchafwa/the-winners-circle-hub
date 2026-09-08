"""One-command sync for a locally-entered change (trade, draft pick, manual
roster/badge edit, etc.) with the live, bot-refreshed repo.

Why this exists: the admin tools (trade_tool.py, draft_tool.py, ...) only
ever touch local files -- by design, a local dev tool shouldn't silently
push to production. But refresh.yml now runs every 6h (more on game days),
so the local checkout goes stale fast, and syncing a hand-entered change
used to mean a real multi-step dance every time: pull whatever the bot's
done since, rebuild fresh on top of it (not the hours-stale local
snapshot), then figure out by hand which of the ~300 files that touches
are real content changes vs. just a generated_at timestamp every build
always rewrites -- see BACKLOG.md, 2026-09-07 ("Is that the most
efficient way for us to register trades moving forward?"). This script
is that whole dance, in one command, with the same review checkpoint as
before (a human still decides when to run it and reviews the commit
message) -- it does NOT run itself automatically after an admin-tool
submit.

Usage (from ingest/, with the venv active):
    python sync_and_push.py "Commit message"
    python sync_and_push.py "Commit message" --offline   # skip the live fetch; rebuild from cache only

What it does, in order:
1. Fetches origin/main. Refuses to continue if the local branch has
   diverged in a way a plain fast-forward pull can't resolve -- a real
   merge conflict needs a human, not this script.
2. Discards any local, uncommitted changes under web/public/data/ -- that
   directory is 100% build output, always reproducible, never hand-
   edited, so a stale local rebuild sitting there is safe to throw away
   before pulling. Never touches anything outside web/public/data/, so a
   real source-of-truth edit (ingest/manual_trades.json, a code change,
   etc.) is untouched by this step.
3. Pulls (fast-forward) whatever the bot has pushed since.
4. Rebuilds -- live by default (so the new trade/pick lands alongside
   today's real data, not a stale cache); --offline skips the network
   fetch and rebuilds from whatever's already in ingest/.cache/ instead,
   for a faster sync when the live data itself hasn't changed.
5. Diffs every changed file under web/public/data/ against HEAD, ignoring
   `generated_at` (the one field every build always rewrites even when
   nothing else did) -- discards whichever files come back identical
   otherwise, stages whichever have a real content change.
6. Stages every changed file OUTSIDE web/public/data/ too (the real
   source-of-truth edit(s) that prompted this run in the first place),
   commits everything under one commit with the given message, and
   pushes. Prints exactly which files got committed.

If the push is rejected because someone else (almost always the refresh
bot -- confirmed live 2026-09-08, a race between this script's own pull
and push, refresh.yml now runs every 6h and much more often on a game
day) pushed first, the local commit is undone (the real source-edit that
prompted this run is never touched) and the whole cycle above retries
from a fresh fetch, up to 3 times, rather than failing on a push a
simple retry-just-the-push couldn't have fixed anyway (the data that
commit held was built against a base that's now stale too).

Refuses to run (prints why, exits non-zero, touches nothing) if: there's
no commit message argument, the fast-forward pull would conflict, the
rebuild fails, a real (non-race) push failure happens, or -- after all
of the above -- there's nothing real to commit at all.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # league-hub/
DATA_DIR = ROOT / "web" / "public" / "data"


def run(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, **kwargs)


def die(msg: str) -> None:
    print(f"sync_and_push: {msg}", file=sys.stderr)
    sys.exit(1)


def strip_generated_at(d):
    if isinstance(d, dict):
        return {k: strip_generated_at(v) for k, v in d.items() if k != "generated_at"}
    if isinstance(d, list):
        return [strip_generated_at(x) for x in d]
    return d


def content_changed(rel_path: str) -> bool:
    """True if the working-tree file's content differs from HEAD's, once
    `generated_at` is ignored. Non-JSON or unparseable content falls back
    to a real byte diff (never silently treated as unchanged). A file that
    existed at HEAD but is gone from the working tree (a build that now
    correctly omits it -- e.g. a file whose gating condition changed) is
    always a real change, never silently skipped as noise; the reverse, a
    file newly created by this build, is likewise always real."""
    old_raw = run(["git", "show", f"HEAD:{rel_path}"]).stdout
    new_path = ROOT / rel_path
    if not new_path.exists() or not old_raw:
        return True
    try:
        old = json.loads(old_raw)
        new = json.loads(new_path.read_text(encoding="utf-8"))
    except Exception:
        return new_path.read_bytes() != old_raw.encode("utf-8")
    return strip_generated_at(old) != strip_generated_at(new)


MAX_ATTEMPTS = 3  # covers a bot refresh landing mid-sync (refresh.yml runs every 6h,
                  # much more often on a game day) -- a real race, not a hypothetical
                  # one: confirmed live 2026-09-08, a push rejected non-fast-forward
                  # because a "Refresh league data" commit landed between this
                  # script's own pull and its push. Retrying the WHOLE cycle (not
                  # just the push) is what actually fixes it: the data this script
                  # committed was built against the base that's now stale too, so a
                  # naive retry-just-the-push would either fail the same way again
                  # or silently push data one refresh cycle behind the one that
                  # just landed.


def sync_once(message: str, offline: bool) -> str:
    """One full attempt. Returns "pushed", "nothing" (nothing real to
    commit), or "retry" (push was rejected because someone else — almost
    always the refresh bot — pushed first; the local commit has already
    been undone, ready for main()'s loop to re-run this from a fresh
    fetch). Raises SystemExit (via die()) for anything else — a real
    failure (build broke, a genuine merge conflict, ...) still needs a
    human immediately, not three silent retries."""
    print("Fetching origin/main...")
    fetch = run(["git", "fetch", "origin", "main"])
    if fetch.returncode != 0:
        die(f"git fetch failed:\n{fetch.stderr}")

    print("Discarding any stale local rebuild under web/public/data/...")
    checkout = run(["git", "checkout", "--", "web/public/data"])
    if checkout.returncode != 0:
        die(f"git checkout failed:\n{checkout.stderr}")

    print("Pulling (fast-forward only)...")
    pull = run(["git", "merge", "--ff-only", "origin/main"])
    if pull.returncode != 0:
        die(
            "fast-forward pull failed -- this needs a human, not this script "
            f"(likely a real merge conflict):\n{pull.stderr}"
        )
    print(pull.stdout.strip() or "  already up to date")

    print(f"Rebuilding ({'offline' if offline else 'live'})...")
    build_args = [str(ROOT / "ingest" / ".venv" / "Scripts" / "python.exe"), "build.py"]
    if offline:
        build_args.append("--offline")
    build = subprocess.run(build_args, cwd=ROOT / "ingest", text=True, capture_output=True)
    if build.returncode != 0:
        die(f"build.py failed -- nothing committed:\n{build.stdout[-4000:]}\n{build.stderr[-2000:]}")
    print("  build complete")

    status = run(["git", "status", "--porcelain"]).stdout
    changed = [line[3:] for line in status.splitlines() if line[3:]]
    data_changed = [f for f in changed if f.replace("\\", "/").startswith("web/public/data/")]
    other_changed = [f for f in changed if not f.replace("\\", "/").startswith("web/public/data/")]

    print(f"Checking {len(data_changed)} changed data file(s) for real content changes...")
    real_data_changes = [f for f in data_changed if content_changed(f.replace("\\", "/"))]
    noise = [f for f in data_changed if f not in real_data_changes]
    if noise:
        print(f"  discarding {len(noise)} file(s) that only changed generated_at")
        run(["git", "checkout", "--"] + noise)

    to_commit = other_changed + real_data_changes
    if not to_commit:
        print("Nothing real to commit -- already in sync. Nothing pushed.")
        return "nothing"

    print(f"Committing {len(to_commit)} file(s):")
    for f in to_commit:
        print(f"  {f}")
    add = run(["git", "add", "--"] + to_commit)
    if add.returncode != 0:
        die(f"git add failed:\n{add.stderr}")

    full_message = f"{message}\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
    commit = run(["git", "commit", "-m", full_message])
    if commit.returncode != 0:
        die(f"git commit failed:\n{commit.stderr}")

    print("Pushing...")
    push = run(["git", "push", "origin", "main"])
    if push.returncode == 0:
        print("Pushed.")
        return "pushed"

    if "non-fast-forward" not in push.stderr and "fetch first" not in push.stderr:
        die(f"git push failed (commit is local, not lost):\n{push.stderr}")

    # Someone else (almost always the refresh bot) pushed in the gap
    # between this attempt's own pull and its push. The commit we just
    # made is real but now sits on a stale base, so undoing just the
    # commit (never the working-tree edit that prompted this whole run)
    # and letting main()'s loop re-fetch/rebuild/recommit/push from
    # scratch is the actual fix -- see MAX_ATTEMPTS' comment for why a
    # bare retry-the-push wouldn't be enough.
    print("  push rejected -- another commit landed first, retrying the full sync...")
    reset = run(["git", "reset", "--soft", "HEAD~1"])
    if reset.returncode != 0:
        die(f"push was rejected AND undoing the local commit failed -- needs a human:\n{reset.stderr}")
    run(["git", "restore", "--staged", "."])
    run(["git", "checkout", "--", "web/public/data"])
    return "retry"


def main() -> None:
    args = sys.argv[1:]
    offline = "--offline" in args
    args = [a for a in args if a != "--offline"]
    if not args:
        die('missing commit message -- usage: python sync_and_push.py "message" [--offline]')
    message = args[0]

    for attempt in range(1, MAX_ATTEMPTS + 1):
        if attempt > 1:
            print(f"\n--- retry {attempt}/{MAX_ATTEMPTS} ---")
        outcome = sync_once(message, offline)
        if outcome != "retry":
            return
    die(f"still losing the race after {MAX_ATTEMPTS} attempts -- "
        "the bot is refreshing faster than this script can sync; try again, "
        "or run with --offline to skip the slower live fetch")


if __name__ == "__main__":
    main()
