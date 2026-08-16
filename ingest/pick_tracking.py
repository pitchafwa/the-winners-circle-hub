"""Traded future draft pick ownership and resolution.

A traded pick moves through three states as time passes, and this module
answers "where does it stand right now" at read time — nothing here is
persisted beyond the ownership ledger itself:

  1. UNRESOLVED — the target season hasn't finished, so its draft order
     can't be known yet. All we can say is who currently holds it.
  2. PROJECTED — the target season is final, so draft_order.compute_draft_order
     tells us exactly which overall slot the original owner's pick fell at.
     Still a projection of what it "will become," not what it did.
  3. RESOLVED — that season's actual rookie draft has been entered
     (ingest/manual_draft/{year}.csv), so the exact player is known. This
     is matched by (round, round_pick) alone, independent of team — the
     draft CSV records who ACTUALLY made the pick post-trade, which reflects
     every trade correctly by construction, so we don't need to re-derive it.
"""
from __future__ import annotations

import config
import draft_order
import parse


def current_holder(pick_ownership: list[dict], year: int, round_: int, original_team_id: int) -> int:
    """Who holds this pick right now. Defaults to the original owner if the
    ledger has no entry — i.e., it has never been traded."""
    for p in pick_ownership:
        if p["season"] == year and p["round"] == round_ and p["original_team_id"] == original_team_id:
            return p["owned_by_team_id"]
    return original_team_id


def holdings_of(pick_ownership: list[dict], team_ids: list[int], team_id: int,
                year: int, round_: int) -> list[int]:
    """Every original-owner id whose (year, round) pick TEAM_ID currently
    holds — usually just their own, but can be several after trades stack up.
    Disambiguates which specific pick a vague trade mention refers to."""
    return [
        orig for orig in team_ids
        if current_holder(pick_ownership, year, round_, orig) == team_id
    ]


def upsert_pick_ownership(pick_ownership: list[dict], year: int, round_: int,
                          original_team_id: int, new_owner_id: int, via: str,
                          trade_id: str | None = None) -> None:
    """trade_id tags which trade last touched this pick, so deleting that
    trade later can clean up its own effect on the ledger. The ledger only
    ever holds the CURRENT holder per (year, round, original_team_id) — no
    history — so if a later trade re-touches the same pick, this overwrites
    in place and the earlier trade_id is lost, same as `via` already was."""
    entry = {
        "season": year, "round": round_, "original_team_id": original_team_id,
        "owned_by_team_id": new_owner_id, "via": via,
    }
    if trade_id:
        entry["trade_id"] = trade_id
    for i, p in enumerate(pick_ownership):
        if p["season"] == year and p["round"] == round_ and p["original_team_id"] == original_team_id:
            pick_ownership[i] = entry
            return
    pick_ownership.append(entry)


def all_picks_board(current_season: int, team_ids: list[int], rounds: list[int],
                    pick_ownership: list[dict], horizon_years: int = 3) -> list[dict]:
    """Every team's full slate of picks for the next HORIZON_YEARS drafts,
    starting with the CURRENT (imminent, not-yet-drafted) season — not just
    the picks that have been traded. Untraded picks default to their
    original owner via current_holder(); traded ones resolve through the
    same three-state machine (unresolved/projected/resolved) as the
    per-season pick_ownership view already uses."""
    board = []
    for offset in range(horizon_years):
        year = current_season + offset
        for round_ in rounds:
            for original_team_id in team_ids:
                current_owner = current_holder(pick_ownership, year, round_, original_team_id)
                entry = resolve(year, round_, original_team_id, current_owner)
                entry["via"] = next(
                    (p.get("via", "") for p in pick_ownership
                     if p["season"] == year and p["round"] == round_
                     and p["original_team_id"] == original_team_id),
                    "",
                )
                board.append(entry)

    # year, then round, then the actual pick number within that round once
    # it's known (projected/resolved) — original_team_id as the last
    # tiebreak for anything still fully unresolved, so the order is at
    # least stable rather than whatever team-iteration order fell out above
    board.sort(key=lambda e: (
        e["season"], e["round"],
        e["overall_pick"] if e["overall_pick"] is not None else 10_000,
        e["original_team_id"],
    ))
    return board


def resolve(year: int, round_: int, original_team_id: int, current_owner_id: int) -> dict:
    """Status of one traded pick, computed at read time from whatever data
    is available now. Never fabricates a slot or player before it's real."""
    out = {
        "season": year, "round": round_, "original_team_id": original_team_id,
        "current_owner_id": current_owner_id, "status": "unresolved",
        "overall_pick": None, "player_id": None, "player_name": None,
    }

    order = draft_order.manual_override(year)
    if order is None:
        # a YEAR draft's order is normally set by the PRIOR season's final
        # standings — but a manual override (above) always wins when one's
        # on file, and skips this real-data gate entirely, which is the
        # whole point of it existing.
        try:
            prior_league = parse.load_league(year - 1)
        except FileNotFoundError:
            return out  # prior season hasn't even started being cached yet
        order = draft_order.compute_draft_order(prior_league)
        if order is None:
            return out  # prior season not final — can't know the slot yet

    # slots for round `round_` run consecutively: (round_-1)*team_count + 1 .. round_*team_count
    team_count = len(order)
    try:
        slot_in_round = order.index(original_team_id) + 1
    except ValueError:
        return out
    out["overall_pick"] = (round_ - 1) * team_count + slot_in_round
    out["status"] = "projected"

    try:
        year_teams = parse.load_league(year).teams
    except FileNotFoundError:
        # team_id set is stable year to year, so any cached season is a good
        # enough fallback — prefer the prior season if we already loaded it
        # above (real order, no override), else fall back to the current one
        try:
            year_teams = parse.load_league(year - 1).teams
        except FileNotFoundError:
            year_teams = parse.load_league(config.SEASON).teams

    names = {**parse.global_player_names(), **parse.roster_player_names(year)}
    picks, _problems = parse.load_manual_draft(year, year_teams, names)
    for p in picks:
        if p["round"] == round_ and p["round_pick"] == slot_in_round:
            out["status"] = "resolved"
            out["player_id"] = p["player_id"]
            out["player_name"] = names.get(p["player_id"]) or p.get("player_name_raw")
            break
    return out
