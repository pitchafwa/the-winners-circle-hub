"""CLI bridge for the local trade-submission UI. Two subcommands, JSON in on
stdin, JSON out on stdout — invoked as a subprocess from the Vite dev server
so the browser never needs its own copy of the name-matching / ledger logic.

    resolve  — raw {team, player, pick} mentions the browser extracted from
               pasted trade text -> matched against real team/player data,
               with anything ambiguous flagged for the review UI to surface.
    submit   — a user-confirmed trade -> appended to manual_trades.json,
               with the pick-ownership ledger updated, then rebuilds the site
               from cache so it's live within seconds.

Local-only by design: there is no live backend for the deployed site, so this
only runs against `pnpm dev` on the machine that has the repo checked out.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone

import config
import parse
import pick_tracking

MANUAL_TRADES_PATH = config.ROOT / "ingest" / "manual_trades.json"

ROUND_WORDS = {
    "first": 1, "1st": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3,
    "fourth": 4, "4th": 4, "fifth": 5, "5th": 5,
}


def _load_manual_trades() -> dict:
    if not MANUAL_TRADES_PATH.exists():
        return {"trades": [], "pick_ownership": []}
    with open(MANUAL_TRADES_PATH, encoding="utf-8") as f:
        return json.load(f)


def _save_manual_trades(data: dict) -> None:
    tmp = MANUAL_TRADES_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    tmp.replace(MANUAL_TRADES_PATH)


def _current_names(season: int) -> dict[int, str]:
    return {**parse.global_player_names(), **parse.roster_player_names(season)}


def cmd_resolve(payload: dict) -> dict:
    season = int(payload["season"])
    league = parse.load_league(season)
    manual = _load_manual_trades()
    pick_ownership = manual["pick_ownership"]

    team_index = parse.team_key_index(league.teams)
    names = _current_names(season)
    player_index = parse.player_key_index(names)
    all_team_ids = list(league.teams)

    resolved_movements = []
    for m in payload["movements"]:
        from_id = team_index.get(parse._normalize_name(m["from"]))
        to_id = team_index.get(parse._normalize_name(m["to"]))
        asset = m["asset"]

        out_asset: dict
        if asset["type"] == "player":
            raw = asset["name"]
            pid = player_index.get(parse._normalize_name(raw))
            out_asset = {
                "type": "player", "raw_name": raw, "player_id": pid,
                "name": names.get(pid) if pid else raw, "matched": pid is not None,
            }
        else:
            year = asset.get("year")
            year_assumed = year is None
            if year_assumed:
                year = season + 1  # "his Nth pick" = the next rookie class
            round_ = asset["round"]
            candidates = (
                pick_tracking.holdings_of(pick_ownership, all_team_ids, from_id, year, round_)
                if from_id is not None else []
            )
            if len(candidates) == 1:
                original_team_id, ambiguous, assumed_original = candidates[0], False, False
            elif len(candidates) == 0:
                original_team_id, ambiguous, assumed_original = from_id, False, True
            else:
                original_team_id, ambiguous, assumed_original = candidates[0], True, False
            out_asset = {
                "type": "pick", "raw_text": asset.get("raw_text", ""),
                "year": year, "year_assumed": year_assumed, "round": round_,
                "original_team_id": original_team_id,
                "original_team_id_ambiguous": ambiguous,
                "original_team_id_assumed": assumed_original,
                "candidates": candidates,
            }

        resolved_movements.append({
            "from_raw": m["from"], "from_team_id": from_id,
            "to_raw": m["to"], "to_team_id": to_id,
            "asset": out_asset,
        })

    return {
        "season": season,
        "teams": [{"id": t.team_id, "name": t.name,
                   "nickname": (parse.owner_aliases().get(t.team_id) or [None])[0]}
                  for t in league.teams.values()],
        "movements": resolved_movements,
    }


def cmd_submit(payload: dict) -> dict:
    season = int(payload["season"])
    league = parse.load_league(season)
    names = _current_names(season)

    manual = _load_manual_trades()
    stored_assets = []
    for a in payload["assets"]:
        if a["type"] == "player":
            if not a.get("player_id"):
                raise ValueError(f"cannot submit unresolved player '{a.get('raw_name')}'")
            stored_assets.append({
                "player": names.get(a["player_id"], a.get("name") or a.get("raw_name")),
                "from": a["from"], "to": a["to"],
            })
        else:
            stored_assets.append({
                "pick": f"{a['year']} {a['round']}{_ordinal_suffix(a['round'])}",
                "from": a["from"], "to": a["to"],
            })
            pick_tracking.upsert_pick_ownership(
                manual["pick_ownership"], a["year"], a["round"], a["original_team_id"],
                a["to"], via=f"traded {payload.get('date', '')}".strip(),
            )

    involved_teams = sorted({a["from"] for a in payload["assets"]} | {a["to"] for a in payload["assets"]})
    manual["trades"].append({
        "season": season,
        "date": payload["date"],
        "week": int(payload.get("week") or 0),
        "teams": involved_teams,
        "assets": stored_assets,
    })
    _save_manual_trades(manual)

    rebuild = subprocess.run(
        [sys.executable, str(config.ROOT / "ingest" / "build.py"), "--offline", "--season", str(season)],
        cwd=str(config.ROOT / "ingest"), capture_output=True, text=True,
    )
    return {
        "ok": rebuild.returncode == 0,
        "rebuild_output": rebuild.stdout + rebuild.stderr,
    }


def _ordinal_suffix(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in ("resolve", "submit"):
        print(json.dumps({"error": "usage: trade_tool.py resolve|submit  (JSON on stdin)"}))
        sys.exit(1)

    payload = json.loads(sys.stdin.read())
    try:
        if sys.argv[1] == "resolve":
            result = cmd_resolve(payload)
        else:
            result = cmd_submit(payload)
    except Exception as e:  # noqa: BLE001 — always return JSON, even on failure
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
