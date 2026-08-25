"""CLI bridge for the local trade-submission UI. Two subcommands, JSON in on
stdin, JSON out on stdout — invoked as a subprocess from the Vite dev server
so the browser never needs its own copy of the name-matching / ledger logic.

    resolve  — raw {team, player, pick} mentions the browser extracted from
               pasted trade text -> matched against real team/player data,
               with anything ambiguous flagged for the review UI to surface.
    submit   — a user-confirmed trade -> appended to manual_trades.json,
               with the pick-ownership ledger updated, then rebuilds the site
               from cache so it's live within seconds.
    list     — every trade on file, with team names resolved, for the
               password-gated "manage trades" admin view.
    delete   — remove one trade by id (see `list`), roll back any pick-
               ownership entries it created, then rebuild.
    reassign_pick — directly set (or clear) who currently holds a future
               draft pick, bypassing the trade flow entirely. For when
               backdating a real trade just to fix the pick futures board
               isn't worth the effort — this writes straight to the same
               pick_ownership ledger a trade would, with no player/other-
               asset side effects.

Local-only by design: there is no live backend for the deployed site, so this
only runs against `pnpm dev` on the machine that has the repo checked out.
"""
from __future__ import annotations

import json
import subprocess
import sys
import uuid
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
        manual = json.load(f)
    # migrate: every trade needs a stable id so it can be deleted later.
    # Trades entered before this existed don't have one — assign on first
    # load rather than requiring a one-off migration script.
    for t in manual.get("trades", []):
        t.setdefault("id", uuid.uuid4().hex[:8])
    return manual


def _save_manual_trades(data: dict) -> None:
    tmp = MANUAL_TRADES_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    tmp.replace(MANUAL_TRADES_PATH)


def _load_and_persist_ids() -> dict:
    """list/delete need every trade's id to already be saved to disk before
    they can be referenced — plain _load_manual_trades() only assigns ids
    in memory."""
    manual = _load_manual_trades()
    _save_manual_trades(manual)
    return manual


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

    # Freeze market value at the moment of the trade, straight onto the
    # record — trade_grades.py reads this back forever after, rather than
    # re-pricing old trades against whatever the market happens to be on
    # each future rebuild. offline=True: use whatever's already cached
    # (refreshed at least every 12h by normal builds) rather than blocking
    # trade submission on a network round-trip.
    import valuation
    from trade_grades import _round_average
    dynasty_values, valuation_updated_at = valuation.values_by_name(offline=True)
    pick_curves, _pick_curves_fetched_at = valuation.pick_curve_by_year(offline=True)

    manual = _load_manual_trades()
    trade_id = uuid.uuid4().hex[:8]
    stored_assets = []
    for a in payload["assets"]:
        if a["type"] == "player":
            if not a.get("player_id"):
                raise ValueError(f"cannot submit unresolved player '{a.get('raw_name')}'")
            name = names.get(a["player_id"], a.get("name") or a.get("raw_name"))
            value = dynasty_values.get(parse._normalize_name(name)) if dynasty_values else None
            stored_assets.append({
                "player": name,
                "from": a["from"], "to": a["to"],
                "value": value,
            })
        else:
            pick_values = parse.pick_values_for_season(a["year"], pick_curves)
            stored_assets.append({
                "pick": f"{a['year']} {a['round']}{_ordinal_suffix(a['round'])}",
                "from": a["from"], "to": a["to"],
                "value": _round_average(pick_values, a["round"]),
            })
            pick_tracking.upsert_pick_ownership(
                manual["pick_ownership"], a["year"], a["round"], a["original_team_id"],
                a["to"], via=f"traded {payload.get('date', '')}".strip(), trade_id=trade_id,
            )

    involved_teams = sorted({a["from"] for a in payload["assets"]} | {a["to"] for a in payload["assets"]})
    manual["trades"].append({
        "id": trade_id,
        "season": season,
        "date": payload["date"],
        "week": int(payload.get("week") or 0),
        "teams": involved_teams,
        "assets": stored_assets,
        "valuation_snapshot_at": valuation_updated_at,
    })
    _save_manual_trades(manual)
    rebuild = _rebuild(season)
    return {
        "ok": rebuild.returncode == 0,
        "rebuild_output": rebuild.stdout + rebuild.stderr,
    }


def cmd_list(_payload: dict) -> dict:
    manual = _load_and_persist_ids()
    season = config.SEASON
    try:
        league = parse.load_league(season)
        team_name = {tid: t.name for tid, t in league.teams.items()}
    except FileNotFoundError:
        team_name = {}

    def label(tid: int) -> str:
        return team_name.get(tid, f"Team {tid}")

    trades = []
    for t in sorted(manual.get("trades", []), key=lambda x: x.get("date", ""), reverse=True):
        assets = [
            (f"{a['player']} → {label(a['to'])}" if "player" in a else f"{a['pick']} → {label(a['to'])}")
            for a in t.get("assets", [])
        ]
        trades.append({
            "id": t["id"], "season": t["season"], "date": t["date"], "week": t.get("week", 0),
            "team_names": [label(tid) for tid in t.get("teams", [])],
            "assets": assets,
        })
    return {"trades": trades}


def cmd_delete(payload: dict) -> dict:
    trade_id = payload["id"]
    manual = _load_and_persist_ids()
    trade = next((t for t in manual["trades"] if t["id"] == trade_id), None)
    if trade is None:
        raise ValueError(f"no trade on file with id '{trade_id}'")

    manual["trades"] = [t for t in manual["trades"] if t["id"] != trade_id]
    # roll back any pick-ownership entries this trade set — but only if
    # nothing later re-touched the same pick (the ledger holds only the
    # CURRENT holder, no history, so if a later trade already overwrote
    # this one's effect there's nothing to undo).
    reverted = [
        p for p in manual["pick_ownership"] if p.get("trade_id") == trade_id
    ]
    manual["pick_ownership"] = [p for p in manual["pick_ownership"] if p.get("trade_id") != trade_id]
    _save_manual_trades(manual)

    rebuild = _rebuild(int(trade["season"]))
    return {
        "ok": rebuild.returncode == 0,
        "rebuild_output": rebuild.stdout + rebuild.stderr,
        "reverted_picks": [
            f"{p['season']} round {p['round']} (was traded, now back to original owner)" for p in reverted
        ],
    }


def cmd_reassign_pick(payload: dict) -> dict:
    year = int(payload["season"])
    round_ = int(payload["round"])
    original_team_id = int(payload["original_team_id"])
    new_owner_id = int(payload["new_owner_id"])
    note = (payload.get("note") or "manually reassigned").strip()

    manual = _load_manual_trades()
    if new_owner_id == original_team_id:
        # back to the original owner — remove the ledger entry entirely
        # rather than writing an owner==original entry, so it reads
        # identically to "never traded" everywhere else (current_holder()
        # already defaults to original_team_id when no entry exists).
        manual["pick_ownership"] = [
            p for p in manual["pick_ownership"]
            if not (p["season"] == year and p["round"] == round_ and p["original_team_id"] == original_team_id)
        ]
    else:
        pick_tracking.upsert_pick_ownership(
            manual["pick_ownership"], year, round_, original_team_id, new_owner_id, via=note,
        )
    _save_manual_trades(manual)

    rebuild = _rebuild(config.SEASON)
    return {"ok": rebuild.returncode == 0, "rebuild_output": rebuild.stdout + rebuild.stderr}


def _rebuild(season: int) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(config.ROOT / "ingest" / "build.py"), "--offline", "--season", str(season)],
        cwd=str(config.ROOT / "ingest"), capture_output=True, text=True,
    )


def _ordinal_suffix(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


COMMANDS = {
    "resolve": cmd_resolve,
    "submit": cmd_submit,
    "list": cmd_list,
    "delete": cmd_delete,
    "reassign_pick": cmd_reassign_pick,
}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(json.dumps({"error": f"usage: trade_tool.py {'|'.join(COMMANDS)}  (JSON on stdin)"}))
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
