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
        # No wildcards: each division's order is separate, and full_order is
        # the whole league by record.
        team_ids = [1, 2, 3, 4]
        divisions = {1: 0, 2: 1, 3: 1, 4: 1}
        wins = {1: 5, 2: 4, 3: 8, 4: 9}
        pf = {1: 1000, 2: 1100, 3: 1200, 4: 1300}
        by_division, order = _seed(team_ids, wins, pf, {}, divisions, random.Random(1))
        assert by_division == {0: [1], 1: [4, 3, 2]}
        assert order == [4, 3, 1, 2]

    def test_h2h_breaks_exact_tie(self):
        team_ids = [1, 2, 3]
        divisions = {1: 0, 2: 0, 3: 0}
        wins = {1: 7, 2: 7, 3: 2}
        pf = {1: 1000, 2: 2000, 3: 900}   # PF favors T2...
        h2h = {(1, 2): 2, (2, 1): 0}      # ...but T1 swept the season series
        _field, order = _seed(team_ids, wins, pf, h2h, divisions, random.Random(1))
        assert order == [1, 2, 3]

    def test_pf_breaks_tie_when_h2h_even(self):
        team_ids = [1, 2]
        divisions = {1: 0, 2: 0}
        wins = {1: 7, 2: 7}
        pf = {1: 900, 2: 1200}
        h2h = {(1, 2): 1, (2, 1): 1}
        _field, order = _seed(team_ids, wins, pf, h2h, divisions, random.Random(1))
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
        """Every outcome of every remaining game x every possible points-for
        ordering (the unbounded adversary), ranked with the REAL shared
        tiebreak (tiebreak.order_by_espn_rules) — must agree exactly with
        clinch_status, including ESPN's equal-games rule and one-at-a-time
        resets."""
        import itertools
        from simulate import clinch_status
        from tiebreak import order_by_espn_rules
        rng = random.Random(11)
        teams = [1, 2, 3, 4, 5]
        div = {t: 0 for t in teams}
        pairs = list(itertools.combinations(teams, 2))
        for _ in range(45):
            base = {t: float(rng.randint(0, 4)) for t in teams}
            h2h = {}
            uniform = rng.choice([0, 1, 2]) if rng.random() < 0.6 else None
            for a, b in pairs:
                g = uniform if uniform is not None else rng.choice([0, 1, 2])
                wa = rng.randint(0, g)
                h2h[(a, b)], h2h[(b, a)] = wa, g - wa
            games = [self._g(*rng.sample(teams, 2)) for _ in range(rng.randint(0, 5))]
            got = clinch_status(games, base, div, 3, h2h)
            nxt = {t: next((e for e in games if t in (e.home_id, e.away_id)), None) for t in teams}
            safe_all = {t: True for t in teams}
            safe_if_win = {t: True for t in teams}
            for res in itertools.product([0, 1], repeat=len(games)):
                w, h = dict(base), dict(h2h)
                winners = {}
                for e, r in zip(games, res):
                    win, lose = (e.home_id, e.away_id) if r else (e.away_id, e.home_id)
                    w[win] += 1
                    h[(win, lose)] = h.get((win, lose), 0) + 1
                    winners[id(e)] = win
                for pf_perm in itertools.permutations(range(5)):
                    order = order_by_espn_rules(teams, w, h, dict(zip(teams, pf_perm)))
                    for t in teams:
                        if order.index(t) >= 3:
                            safe_all[t] = False
                            if nxt[t] is None or winners[id(nxt[t])] == t:
                                safe_if_win[t] = False
            for t in teams:
                assert got[t]["clinched"] == safe_all[t], (base, h2h, t)
                assert got[t]["clinches_if_win_next"] == (safe_all[t] or safe_if_win[t]), (base, h2h, t)


class TestDraftOrder:
    """simulate._draft_order_for_draw / _division_bracket / _nonplayoff_draft_order —
    the projected-pick-order model (added 2026-09-30, feeds pick_futures.json's
    expected-value pricing of an unresolved future pick)."""

    def test_division_bracket_reports_every_exit_round(self):
        from simulate import _division_bracket
        # Deterministic playoff_game: higher team_id always wins.
        pg = lambda a, b, home: max(a, b)
        champ, r1_loser, final_loser = _division_bracket([3, 2, 1], pg)  # seeds 1,2,3 = teams 3,2,1
        assert champ == 3          # 1-seed (team 3) always wins
        assert r1_loser == 1       # 3-seed (team 1) loses the 2-vs-3 game
        assert final_loser == 2    # 2-seed (team 2) loses the division final

    def test_nonplayoff_order_matches_real_draft_order_rule(self):
        # Mirrors draft_order.py's own cmp_key exactly: wins ascending,
        # then head-to-head (the team that lost the series is worse).
        from simulate import _nonplayoff_draft_order
        wins = {1: 3.0, 2: 3.0, 3: 5.0}
        h2h = {(1, 2): 0, (2, 1): 1}  # 2 beat 1 -> 1 is worse, drafts first
        assert _nonplayoff_draft_order([1, 2, 3], wins, h2h) == [1, 2, 3]

    def test_full_draft_order_matches_draft_order_py_on_a_real_shape(self):
        # Build a completed-season LeagueData matching draft_order.py's own
        # real rule (non-playoff worst-first, then playoff teams worst-
        # finish-first) and confirm simulate._draft_order_for_draw agrees
        # when fed the same bracket outcome directly (not simulated).
        from simulate import _draft_order_for_draw
        team_ids = list(range(1, 11))
        divisions = {t: (0 if t <= 5 else 1) for t in team_ids}
        field = [1, 2, 3, 6, 7, 8]  # top 3 each division
        full_order = [1, 6, 2, 7, 3, 8, 4, 9, 5, 10]  # best to worst, overall record
        wins = {t: (11 - full_order.index(t)) for t in team_ids}  # consistent with full_order
        h2h = {}
        # Bracket: div A (1,2,3) -> champ 1, r1_loser 3, divfinal_loser 2
        #          div B (6,7,8) -> champ 6, r1_loser 8, divfinal_loser 7
        # Final: 1 beats 6 -> champ=1, runner_up=6
        order = _draft_order_for_draw(
            team_ids, field, full_order, wins, h2h,
            r1_losers=[3, 8], divfinal_losers=[2, 7], runner_up=6, champ=1,
        )
        non_playoff = [10, 5, 9, 4]  # worst-to-best by wins (full_order-consistent)
        assert order[:4] == non_playoff
        # r1_losers tier: worse regular-season finish drafts first -> 8 (rank 6) before 3 (rank 5)
        assert order[4:6] == [8, 3]
        # divfinal_losers tier: 7 (rank 4) before 2 (rank 3)
        assert order[6:8] == [7, 2]
        assert order[8:] == [6, 1]

    def test_run_produces_draft_slot_dist_matching_seed_dist_shape(self):
        # End-to-end smoke test on a real 10-team, 2-division, 6-playoff-spot
        # league (this league's real shape): draft_slot_dist should be a
        # full permutation distribution, probabilities summing to ~1 per
        # team, same as seed_dist already does — and worth checking as its
        # own field, since `run()` only populates it when track_draft_order
        # is True.
        import simulate
        from parse import LeagueData, ScheduleEntry, TeamInfo

        team_ids = list(range(1, 11))
        teams = {t: TeamInfo(t, f"Team {t}", f"T{t}", "", "", 0 if t <= 5 else 1) for t in team_ids}
        full_schedule = []
        # Weeks 1-2: decided (round-robin-ish pairing, home always wins by 10).
        for week in (1, 2):
            for i in range(0, 10, 2):
                a, b = team_ids[i], team_ids[i + 1]
                full_schedule.append(ScheduleEntry(
                    matchup_period=week, home_id=a, away_id=b, winner="HOME",
                    home_score=110.0, away_score=100.0, is_playoff=False, playoff_tier="NONE"))
                teams[a].wins += 1
                teams[b].losses += 1
                teams[a].points_for += 110.0
                teams[b].points_for += 100.0
        # Week 3: remaining (UNDECIDED) — what the sim actually draws over.
        for i in range(0, 10, 2):
            a, b = team_ids[i], team_ids[i + 1]
            full_schedule.append(ScheduleEntry(
                matchup_period=3, home_id=a, away_id=b, winner="UNDECIDED",
                home_score=0.0, away_score=0.0, is_playoff=False, playoff_tier="NONE"))
        league = LeagueData(
            season=2026, name="Test", team_count=10, reg_season_weeks=3,
            playoff_team_count=6, playoff_seeding_rule="H2H_RECORD",
            home_team_bonus=0, playoff_home_team_bonus=0,
            starting_slots=[0], teams=teams, weeks={}, full_schedule=full_schedule,
            scoring_period_id=3, final_scoring_period=17,
        )
        result = simulate.run(league)
        assert result is not None
        for row in result["teams"]:
            assert row["draft_slot_dist"] is not None
            total = sum(row["draft_slot_dist"].values())
            assert abs(total - 1.0) < 0.01, (row["team_id"], total)
