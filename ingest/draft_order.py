"""Rookie draft pick order for a completed season — confirmed against real
league data (2024 standings -> 2025 draft order matched exactly once playoff
qualification was read from actual bracket participation instead of a flat
seed cutoff).

Rule, as stated by the league:
  1. Non-playoff teams draft first, worst regular-season record first,
     head-to-head record as the tiebreak for ties.
  2. Playoff teams draft after, in reverse order of how far they got — the
     team that lost earliest in the bracket picks first among this group;
     the champion picks dead last, overall.

"Playoff team" is determined by who actually appeared in a WINNERS_BRACKET
matchup that season (read from real data) rather than re-deriving this
league's division-based qualification rule ourselves — ESPN already
computed it correctly when it built the bracket.
"""
from __future__ import annotations

from collections import defaultdict

from parse import LeagueData


def _playoff_team_ids(league: LeagueData) -> set[int]:
    ids: set[int] = set()
    for m in (m for weeks in league.weeks.values() for m in weeks):
        if m.playoff_tier == "WINNERS_BRACKET":
            ids.add(m.home.team_id)
            if m.away is not None:
                ids.add(m.away.team_id)
    return ids


def _h2h_wins(league: LeagueData, team_ids: set[int]) -> dict[tuple[int, int], int]:
    """wins[(a, b)] = times a beat b in the regular season, among team_ids."""
    wins: dict[tuple[int, int], int] = defaultdict(int)
    for week in league.regular_weeks():
        for m in league.weeks.get(week, []):
            if m.away is None or m.winner not in ("HOME", "AWAY"):
                continue
            h, a = m.home.team_id, m.away.team_id
            if h not in team_ids or a not in team_ids:
                continue
            winner, loser = (h, a) if m.winner == "HOME" else (a, h)
            wins[(winner, loser)] += 1
    return wins


def compute_draft_order(league: LeagueData) -> list[int] | None:
    """Team ids in pick order (pick 1 first). None if the season isn't final
    (bracket participation can't be determined mid-season)."""
    if not league.season_over or not league.weeks:
        return None

    playoff_ids = _playoff_team_ids(league)
    if not playoff_ids:
        return None
    all_ids = set(league.teams)
    non_playoff_ids = all_ids - playoff_ids

    rows = {r["team_id"]: r for r in _standings_rows(league)}
    h2h = _h2h_wins(league, non_playoff_ids)

    def cmp_key(a: int, b: int) -> int:
        """Negative if a should draft before b (a is worse)."""
        wa, wb = rows[a]["wins"] + 0.5 * rows[a]["ties"], rows[b]["wins"] + 0.5 * rows[b]["ties"]
        if wa != wb:
            return -1 if wa < wb else 1
        # tied record: head-to-head decides; the team that lost the series is worse (picks first)
        aw, bw = h2h.get((a, b), 0), h2h.get((b, a), 0)
        if aw != bw:
            return -1 if aw < bw else 1
        return 0

    import functools

    nonplayoff_order = sorted(non_playoff_ids, key=functools.cmp_to_key(cmp_key))
    playoff_order = sorted(playoff_ids, key=lambda t: -rows[t]["final_rank"])  # worst finish (highest rank number) first
    return nonplayoff_order + playoff_order


def _standings_rows(league: LeagueData) -> list[dict]:
    """Minimal per-team regular-season record — avoids importing metrics.py
    (which imports parse.py) to sidestep a circular import."""
    rows = []
    for tid, t in league.teams.items():
        rows.append({
            "team_id": tid, "wins": t.wins, "losses": t.losses, "ties": t.ties,
            "final_rank": t.final_rank or 99,
        })
    return rows
