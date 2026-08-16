"""CLI bridge for backing up / restoring every hand-entered data file this
league depends on. Everything else in web/public/data/ is fully derived —
delete it and `build.py` regenerates it from these files plus the ESPN
cache — so these are the only files that can't be recreated from nothing:

    manual_trades.json        — trades + traded-pick ownership ledger
    manual_draft_order.json   — manual draft-order overrides
    manual_badges.json        — badge corrections (2012-17 co-championship etc.)
    owner_aliases.json        — real-name/nickname -> team_id map
    manual_draft/{season}.csv — hand-entered rookie draft results, per season
                                (TEMPLATE.csv is a reference file, not data —
                                excluded from both export and import)

    export — bundle all of the above into one JSON blob for download.
    import — given a previously exported bundle, overwrite these files and
             do a FULL rebuild (every cached season, not just the current
             one — a restored backup can touch any season's draft/trade
             history, unlike a single trade/pick submission).

Local-only by design, same as trade_tool.py / draft_tool.py / draft_order_tool.py.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone

import config

MANUAL_DRAFT_DIR = config.ROOT / "ingest" / "manual_draft"
FILES = {
    "manual_trades": config.ROOT / "ingest" / "manual_trades.json",
    "manual_draft_order": config.ROOT / "ingest" / "manual_draft_order.json",
    "manual_badges": config.ROOT / "ingest" / "manual_badges.json",
    "owner_aliases": config.ROOT / "ingest" / "owner_aliases.json",
}


def _read_json(path) -> dict | None:
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _manual_draft_files() -> dict[str, str]:
    if not MANUAL_DRAFT_DIR.exists():
        return {}
    out = {}
    for path in sorted(MANUAL_DRAFT_DIR.glob("*.csv")):
        if path.stem.upper() == "TEMPLATE":
            continue
        out[path.name] = path.read_text(encoding="utf-8-sig")
    for path in sorted(MANUAL_DRAFT_DIR.glob("*.json")):
        out[path.name] = path.read_text(encoding="utf-8")
    return out


def cmd_export(_payload: dict) -> dict:
    return {
        "app": "league-hub",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "files": {key: _read_json(path) for key, path in FILES.items()},
        "manual_draft_files": _manual_draft_files(),
    }


def cmd_import(payload: dict) -> dict:
    if payload.get("app") != "league-hub":
        raise ValueError("this doesn't look like a league-hub backup file")

    files = payload.get("files", {})
    written = []
    for key, content in files.items():
        if key not in FILES or content is None:
            continue
        path = FILES[key]
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(content, f, indent=2)
        tmp.replace(path)
        written.append(path.name)

    draft_files = payload.get("manual_draft_files", {})
    for name, text in draft_files.items():
        if not name or "/" in name or "\\" in name or name.upper().startswith("TEMPLATE"):
            continue  # never write outside manual_draft/, never overwrite the reference template
        path = MANUAL_DRAFT_DIR / name
        tmp = path.with_suffix(path.suffix + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        tmp.replace(path)
        written.append(f"manual_draft/{name}")

    rebuild = subprocess.run(
        [sys.executable, str(config.ROOT / "ingest" / "build.py"), "--offline"],
        cwd=str(config.ROOT / "ingest"), capture_output=True, text=True,
    )
    return {
        "ok": rebuild.returncode == 0,
        "files_written": written,
        "rebuild_output": rebuild.stdout + rebuild.stderr,
    }


COMMANDS = {"export": cmd_export, "import": cmd_import}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(json.dumps({"error": f"usage: data_tool.py {'|'.join(COMMANDS)}  (JSON on stdin)"}))
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
