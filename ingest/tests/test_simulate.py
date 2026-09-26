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


class TestClinch:
    """simulate.clinch_status: exact worst-case clinch under wins -> head-to-head
    -> points-for, checked against brute force over every outcome."""

    @staticmethod
    def _g(a, b):
        from types import SimpleNamespace
        return SimpleNamespace(home_id=a, away_id=b, matchup_period=1)

    def test_clear_lead_clinches_and_tight_pack_does_not(self):
        from simulate import clinch_status
        div = {t: (0 if t <= 5 else 1) for t in range(1, 11)}
        rem = [self._g(1, 6), self._g(2, 7), self._g(3, 8), self._g(4, 9), self._g(5, 10)]
        base = lambda d: {**d, **{t: 5 for t in range(6, 11)}}
        assert clinch_status(rem, base({1: 8, 2: 3, 3: 3, 4: 2, 5: 2}), div, 3)[1]["clinched"]
        tight = clinch_status(rem, base({1: 5, 2: 5, 3: 5, 4: 5, 5: 5}), div, 3)[1]
        assert not tight["clinched"] and not tight["clinches_if_win_next"]

    def test_head_to_head_tiebreak_can_lock_a_clinch(self):
        from simulate import clinch_status
        # Div of 5; T=1 has beaten every rival already. Each rival can at best
        # finish tied with T on wins, and T holds head-to-head over all of
        # them, so T is safe even though a plain "ties lose" check would say no.
        div = {t: (0 if t <= 5 else 1) for t in range(1, 11)}
        rem = [self._g(2, 6), self._g(3, 7), self._g(4, 8), self._g(5, 9)]
        wins = {1: 4, 2: 4, 3: 4, 4: 4, 5: 3, **{t: 5 for t in range(6, 11)}}
        h2h = {(1, x): 1 for x in (2, 3, 4, 5)}
        with_h2h = clinch_status(rem, wins, div, 3, h2h)[1]
        without = clinch_status(rem, wins, div, 3, {})[1]
        # 2,3,4 can reach 5 wins vs T's 4; T is only safe if fewer than 3 finish ahead
        assert not without["clinched"]
        assert not with_h2h["clinched"]   # 2,3,4 all above T on wins -> genuinely not safe
        wins2 = {1: 5, 2: 4, 3: 4, 4: 4, 5: 3, **{t: 5 for t in range(6, 11)}}
        assert clinch_status(rem, wins2, div, 3, h2h)[1]["clinched"]     # ties only, T holds h2h
        assert not clinch_status(rem, wins2, div, 3, {})[1]["clinched"]  # no h2h -> ties count against

    def test_matches_brute_force_on_random_scenarios(self):
        import itertools
        from simulate import clinch_status
        rng = random.Random(7)
        teams = [1, 2, 3, 4, 5]
        div = {t: 0 for t in teams}
        for _ in range(150):
            base = {t: float(rng.randint(0, 4)) for t in teams}
            h2h = {}
            for a, b in itertools.permutations(teams, 2):
                h2h[(a, b)] = rng.choice([0, 0, 1, 2])
            games = [self._g(*rng.sample(teams, 2)) for _ in range(rng.randint(0, 7))]
            got = clinch_status(games, base, div, 3, h2h)
            for t in teams:
                # brute force over every outcome, ties resolved WORST case for T
                # after head-to-head (points-for is the unbounded adversary)
                def safe(force):
                    nxt = next((e for e in games if t in (e.home_id, e.away_id)), None)
                    for res in itertools.product([0, 1], repeat=len(games)):
                        w, h = dict(base), dict(h2h)
                        ok = True
                        for e, r in zip(games, res):
                            win, lose = (e.home_id, e.away_id) if r else (e.away_id, e.home_id)
                            if force and e is nxt and lose == t:
                                ok = False   # this outcome contradicts "T wins next"
                            w[win] += 1
                            h[(win, lose)] = h.get((win, lose), 0) + 1
                        if not ok:
                            continue
                        ahead = 0
                        for x in teams:
                            if x == t:
                                continue
                            if w[x] > w[t]:
                                ahead += 1
                            elif w[x] == w[t]:
                                grp = [y for y in teams if w[y] == w[t]]
                                sx = sum(h.get((x, y), 0) for y in grp if y != x)
                                st = sum(h.get((t, y), 0) for y in grp if y != t)
                                if sx >= st:
                                    ahead += 1
                        if ahead >= 3:
                            return False
                    return True
                # "clinched": T may lose everything -> brute force over outcomes is
                # a superset, so the exact answer is safe-in-ALL-outcomes.
                assert got[t]["clinched"] == safe(False), (base, t)
                assert got[t]["clinches_if_win_next"] == (safe(False) or safe(True)), (base, t)
