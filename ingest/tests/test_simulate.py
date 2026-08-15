"""Seeding/tiebreaker and schedule-swap tests."""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from metrics import compute_schedule_swap
from simulate import _seed
from test_all_play import build_league, matchup


class TestSeeding:
    def test_division_winners_get_top_seeds(self):
        # T4 has the best record overall, but T1 wins division 0 and T3 wins
        # division 1 — they take seeds 1 and 2 regardless.
        team_ids = [1, 2, 3, 4]
        divisions = {1: 0, 2: 1, 3: 1, 4: 1}
        wins = {1: 5, 2: 4, 3: 8, 4: 9}
        pf = {1: 1000, 2: 1100, 3: 1200, 4: 1300}
        # T4 tops division 1... wait, then T4 is the division winner. Make T3
        # the div-1 winner and put T4's 9 wins in division 0 behind T1? Can't —
        # keep it honest: T4 9 wins IS div-1 winner; T3 8 wins is wildcard.
        field, order = _seed(team_ids, wins, pf, {}, divisions, 2, random.Random(1))
        assert field == [4, 1]           # both division winners, best first
        assert order == [4, 1, 3, 2]     # then wildcards by record

    def test_h2h_breaks_exact_tie(self):
        team_ids = [1, 2, 3]
        divisions = {1: 0, 2: 0, 3: 0}
        wins = {1: 7, 2: 7, 3: 2}
        pf = {1: 1000, 2: 2000, 3: 900}   # PF favors T2...
        h2h = {(1, 2): 2, (2, 1): 0}      # ...but T1 swept the season series
        _field, order = _seed(team_ids, wins, pf, h2h, divisions, 1, random.Random(1))
        assert order == [1, 2, 3]

    def test_pf_breaks_tie_when_h2h_even(self):
        team_ids = [1, 2]
        divisions = {1: 0, 2: 0}
        wins = {1: 7, 2: 7}
        pf = {1: 900, 2: 1200}
        h2h = {(1, 2): 1, (2, 1): 1}
        _field, order = _seed(team_ids, wins, pf, h2h, divisions, 1, random.Random(1))
        assert order == [2, 1]


class TestScheduleSwap:
    def test_own_schedule_equals_actual_record(self):
        league = build_league()
        # Week 1: T1=100 v T2=90, T3=80 v T4=70. Week 2: T1=50 v T3=60, T2=95 v T4=55.
        swap = compute_schedule_swap(league)
        t1 = next(r for r in swap if r["team_id"] == 1)
        assert t1["records"]["1"] == {"wins": 1, "losses": 1, "ties": 0}  # actual 1-1

    def test_swapped_schedule(self):
        league = build_league()
        swap = compute_schedule_swap(league)
        # T4 (70, 55) on T1's schedule: wk1 T1 played T2(90) -> 70<90 L;
        # wk2 T1 played T3(60) -> 55<60 L. 0-2.
        t4 = next(r for r in swap if r["team_id"] == 4)
        assert t4["records"]["1"] == {"wins": 0, "losses": 2, "ties": 0}
        # T2 (90, 95) on T4's schedule: wk1 T4 played T3(80) -> 90>80 W;
        # wk2 T4 played T2 -> T2 faces T4's score 55 -> 95>55 W. 2-0.
        t2 = next(r for r in swap if r["team_id"] == 2)
        assert t2["records"]["4"] == {"wins": 2, "losses": 0, "ties": 0}


def test_matchup_helper_still_works():
    m = matchup(1, 1, 2, 10, 8)
    assert m.winner == "HOME"
