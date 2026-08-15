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
                          original_team_id: int, new_owner_id: int, via: str) -> None:
    for p in pick_ownership:
        if p["season"] == year and p["round"] == round_ and p["original_team_id"] == original_team_id:
            p["owned_by_team_id"] = new_owner_id
            p["via"] = via
            return
    pick_ownership.append({
        "season": year, "round": round_, "original_team_id": original_team_id,
        "owned_by_team_id": new_owner_id, "via": via,
    })


def resolve(year: int, round_: int, original_team_id: int, current_owner_id: int) -> dict:
    """Status of one traded pick, computed at read time from whatever data
    is available now. Never fabricates a slot or player before it's real."""
    out = {
        "season": year, "round": round_, "original_team_id": original_team_id,
        "current_owner_id": current_owner_id, "status": "unresolved",
        "overall_pick": None, "player_id": None, "player_name": None,
    }

    # a YEAR draft's order is set by the PRIOR season's final standings
    prior_league = None
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
        year_teams = prior_league.teams  # team_id set is stable year to year; good enough as a fallback

    names = {**parse.global_player_names(), **parse.roster_player_names(year)}
    picks, _problems = parse.load_manual_draft(year, year_teams, names)
    for p in picks:
        if p["round"] == round_ and p["round_pick"] == slot_in_round:
            out["status"] = "resolved"
            out["player_id"] = p["player_id"]
            out["player_name"] = names.get(p["player_id"]) or p.get("player_name_raw")
            break
    return out
