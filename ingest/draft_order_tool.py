"""CLI bridge for manually overriding a future season's rookie-draft order.

Local admin tool: Tommy doesn't want to backdate every real pick-swap trade
just to get the pick futures board's projected slots right, so this lets
him type in the actual/intended order directly instead. When present, an
override always wins over the computed real-standings order in
pick_tracking.resolve() (see draft_order.manual_override) — and unlike the
computed order, it doesn't need the prior season to be final first.

    get    — the order currently in effect for a season: the override if
             one's saved, else the computed real order if the prior season
             is final, else just the plain team list (nothing to prefill).
    set    — save a full override order (every team id exactly once, pick
             1 first), then rebuild.
    clear  — remove the override for a season, reverting to the computed
             order, then rebuild.

Local-only by design: there is no live backend for the deployed site, so
this only runs against `pnpm dev` on the machine that has the repo checked
out — same as trade_tool.py / draft_tool.py.
"""
from __future__ import annotations

import json
import subprocess
import sys

import config
import draft_order
import parse

OVERRIDE_PATH = config.ROOT / "ingest" / "manual_draft_order.json"

README = [
    "Manual override of a future season's rookie-draft order.",
    "Wins over the computed real-standings order in pick_tracking.resolve()",
    "whenever present for that season, and doesn't need the prior season to",
    "be final first — used when Tommy wants the pick futures board to reflect",
    "an order that isn't established by real ESPN standings yet (or a",
    "correction), without backdating every pick-swap trade to get there.",
    'overrides: {"<season>": [team_id, ...]} — pick 1 first, one entry per team.',
]


def _load() -> dict:
    if not OVERRIDE_PATH.exists():
        return {"_readme": README, "overrides": {}}
    with open(OVERRIDE_PATH, encoding="utf-8") as f:
        return json.load(f)


def _save(data: dict) -> None:
    tmp = OVERRIDE_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    tmp.replace(OVERRIDE_PATH)


def _teams() -> list[dict]:
    league = parse.load_league(config.SEASON)
    return [
        {"id": t.team_id, "name": t.name, "nickname": (parse.owner_aliases().get(t.team_id) or [None])[0]}
        for t in league.teams.values()
    ]


def cmd_get(payload: dict) -> dict:
    year = int(payload["season"])
    teams = _teams()

    override = _load().get("overrides", {}).get(str(year))
    if override:
        return {"season": year, "order": override, "source": "override", "teams": teams}

    try:
        computed = draft_order.compute_draft_order(parse.load_league(year - 1))
    except FileNotFoundError:
        computed = None
    if computed:
        return {"season": year, "order": computed, "source": "computed", "teams": teams}

    return {"season": year, "order": [t["id"] for t in teams], "source": "none", "teams": teams}


def cmd_set(payload: dict) -> dict:
    year = int(payload["season"])
    order = [int(x) for x in payload["order"]]
    valid_ids = {t["id"] for t in _teams()}
    if len(order) != len(valid_ids) or set(order) != valid_ids:
        raise ValueError("order must contain every team exactly once")

    data = _load()
    data.setdefault("overrides", {})[str(year)] = order
    _save(data)

    rebuild = _rebuild()
    return {"ok": rebuild.returncode == 0, "rebuild_output": rebuild.stdout + rebuild.stderr}


def cmd_clear(payload: dict) -> dict:
    year = int(payload["season"])
    data = _load()
    data.setdefault("overrides", {}).pop(str(year), None)
    _save(data)

    rebuild = _rebuild()
    return {"ok": rebuild.returncode == 0, "rebuild_output": rebuild.stdout + rebuild.stderr}


def _rebuild() -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(config.ROOT / "ingest" / "build.py"), "--offline", "--season", str(config.SEASON)],
        cwd=str(config.ROOT / "ingest"), capture_output=True, text=True,
    )


COMMANDS = {"get": cmd_get, "set": cmd_set, "clear": cmd_clear}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(json.dumps({"error": f"usage: draft_order_tool.py {'|'.join(COMMANDS)}  (JSON on stdin)"}))
        sys.exit(1)

    payload = json.loads(sys.stdin.read() or "{}")
    try:
        result = COMMANDS[sys.argv[1]](payload)
    except Exception as e:  # noqa: BLE001 — always return JSON, even on failure
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
