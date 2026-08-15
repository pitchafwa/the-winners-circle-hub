"""CLI bridge for the local draft-entry UI. Fully deterministic table
parsing — no LLM call, unlike trade_tool.py. Draft results come from a
fixed spreadsheet layout (Round, Pick, Original owner, Current owner,
Selection) every year, so a hand-rolled parser is reliable here in a way
it isn't for free-text trade announcements.

    parse   — pasted draft table (tab- or comma-separated, straight out of
              a Google Sheets copy-paste) -> structured picks, resolved
              against real team/player data, anything unmatched flagged.
    submit  — user-confirmed picks -> written to
              ingest/manual_draft/{season}.csv, then rebuilds from cache.

Local-only, same as trade_tool.py: no live backend once deployed.
"""
from __future__ import annotations

import csv
import io
import json
import subprocess
import sys

import config
import parse

MANUAL_DRAFT_DIR = config.ROOT / "ingest" / "manual_draft"


def _split_rows(text: str) -> list[list[str]]:
    """Tab-separated (a straight Sheets copy-paste) or comma-separated,
    auto-detected per line so a stray comma in one format doesn't break
    parsing of the other."""
    rows = []
    for line in text.splitlines():
        if not line.strip():
            continue
        delimiter = "\t" if "\t" in line else ","
        row = next(csv.reader(io.StringIO(line), delimiter=delimiter))
        rows.append([c.strip() for c in row])
    return rows


def _current_names(season: int) -> dict[int, str]:
    return {**parse.global_player_names(), **parse.roster_player_names(season)}


def _extract_rows(text: str, has_pick_column: bool) -> tuple[list[dict], list[str]]:
    """Pasted table text -> raw (unresolved) row dicts. No team/player
    matching here — that's a separate step so an edited row can be
    re-resolved without re-parsing the whole paste.

    Two column layouts, explicitly chosen by the caller rather than
    auto-detected — a 4-column row is genuinely ambiguous between them
    (Pick present but Current owner omitted, vs. no Pick column at all):
      has_pick_column=True:  Round, Pick, Original[, Current], Selection
      has_pick_column=False: Round, Original[, Current], Selection —
        pick number is row order within the round, counted here.
    """
    rows = []
    problems = []
    round_counters: dict[int, int] = {}
    for i, row in enumerate(_split_rows(text), start=1):
        if not row or row[0].strip().lower() in ("round", ""):
            continue  # header row or stray blank

        if has_pick_column:
            # 5 cols = Round,Pick,Original,Current,Selection; 4 cols = Current
            # owner omitted entirely when unchanged (some sheet exports do this)
            if len(row) >= 5:
                round_raw, pick_raw, orig_raw, current_raw, selection_raw = row[:5]
            elif len(row) == 4:
                round_raw, pick_raw, orig_raw, selection_raw = row
                current_raw = ""
            else:
                problems.append(f"row {i}: expected 4-5 columns, got {len(row)}: {row}")
                continue
        else:
            # 4 cols = Round,Original,Current,Selection; 3 cols = Current
            # owner omitted entirely when unchanged
            pick_raw = None
            if len(row) >= 4:
                round_raw, orig_raw, current_raw, selection_raw = row[:4]
            elif len(row) == 3:
                round_raw, orig_raw, selection_raw = row
                current_raw = ""
            else:
                problems.append(f"row {i}: expected 3-4 columns, got {len(row)}: {row}")
                continue

        try:
            round_num = int(round_raw)
            pick_num = int(pick_raw) if pick_raw is not None else None
        except ValueError:
            problems.append(f"row {i}: non-numeric round/pick ('{round_raw}', '{pick_raw}')")
            continue

        if pick_num is None:
            # increment BEFORE the vacated check below — a vacated slot still
            # occupies a real position in the round's draft order, so later
            # real picks in the same round must not shift down to fill the gap
            round_counters[round_num] = round_counters.get(round_num, 0) + 1
            pick_num = round_counters[round_num]

        if selection_raw.strip().lower() == "vacated":
            continue  # not a real pick — no player, nothing to record

        rows.append({
            "round": round_num, "round_pick": pick_num,
            "original_owner_raw": orig_raw.strip(),
            "drafting_team_raw": current_raw.strip() or orig_raw.strip(),
            "player_name_raw": selection_raw.strip(),
        })
    return rows, problems


def _resolve_rows(season: int, rows: list[dict]) -> list[dict]:
    league = parse.load_league(season)
    team_index = parse.team_key_index(league.teams)
    names = _current_names(season)
    player_index = parse.player_key_index(names)

    picks = []
    for r in rows:
        team_id = team_index.get(parse._normalize_name(r["drafting_team_raw"]))
        player_id = player_index.get(parse._normalize_name(r["player_name_raw"]))
        picks.append({
            **r, "team_id": team_id, "player_id": player_id,
            "player_name": names.get(player_id) if player_id else None,
        })
    picks.sort(key=lambda p: (p["round"], p["round_pick"]))
    return picks


def cmd_parse(payload: dict) -> dict:
    season = int(payload["season"])
    league = parse.load_league(season)

    if "text" in payload:
        rows, problems = _extract_rows(payload["text"], payload.get("has_pick_column", True))
    else:
        rows, problems = payload["picks"], []
    picks = _resolve_rows(season, rows)

    existing = (MANUAL_DRAFT_DIR / f"{season}.csv").exists() or (MANUAL_DRAFT_DIR / f"{season}.json").exists()
    return {
        "season": season,
        "teams": [{"id": t.team_id, "name": t.name,
                   "nickname": (parse.owner_aliases().get(t.team_id) or [None])[0]}
                  for t in league.teams.values()],
        "picks": picks,
        "problems": problems,
        "existing_file": existing,
    }


def cmd_submit(payload: dict) -> dict:
    season = int(payload["season"])
    names = _current_names(season)

    path_csv = MANUAL_DRAFT_DIR / f"{season}.csv"
    if path_csv.exists() and not payload.get("overwrite"):
        return {"ok": False, "needs_overwrite": True,
                "message": f"{season}.csv already exists — resubmit with overwrite confirmed"}

    rows = []
    for p in payload["picks"]:
        if not p.get("team_id"):
            raise ValueError(f"pick {p['round']}.{p['round_pick']}: no team assigned")
        if not p.get("player_id"):
            raise ValueError(f"pick {p['round']}.{p['round_pick']}: no player matched ('{p.get('player_name_raw')}')")
        team_key = (parse.owner_aliases().get(p["team_id"]) or [str(p["team_id"])])[0]
        rows.append({
            "round": p["round"], "pick": p["round_pick"],
            "team": team_key, "player": names.get(p["player_id"], p.get("player_name_raw", "")),
        })
    rows.sort(key=lambda r: (r["round"], r["pick"]))

    MANUAL_DRAFT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path_csv.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["round", "pick", "team", "player"])
        writer.writeheader()
        writer.writerows(rows)
    tmp.replace(path_csv)

    rebuild = subprocess.run(
        [sys.executable, str(config.ROOT / "ingest" / "build.py"), "--offline", "--season", str(season)],
        cwd=str(config.ROOT / "ingest"), capture_output=True, text=True,
    )
    return {
        "ok": rebuild.returncode == 0,
        "picks_written": len(rows),
        "rebuild_output": rebuild.stdout + rebuild.stderr,
    }


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in ("parse", "submit"):
        print(json.dumps({"error": "usage: draft_tool.py parse|submit  (JSON on stdin)"}))
        sys.exit(1)

    payload = json.loads(sys.stdin.read())
    try:
        if sys.argv[1] == "parse":
            result = cmd_parse(payload)
        else:
            result = cmd_submit(payload)
    except Exception as e:  # noqa: BLE001 — always return JSON, even on failure
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
