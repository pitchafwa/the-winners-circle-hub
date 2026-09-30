"""future_strength.py — the n+2 (e.g. 2028) heuristic pick-value proxy,
used when a pick's governing season (n+1) hasn't been played yet so
simulate.run() has nothing real to project from."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from future_strength import projected_slot_dist, projected_strength_rank


class TestProjectedStrengthRank:
    def test_strongest_team_ranks_first_on_every_signal(self):
        team_ids = [1, 2, 3]
        contending = {1: 100.0, 2: 50.0, 3: 10.0}
        dynasty = {1: 100.0, 2: 50.0, 3: 10.0}
        picks = {1: 100.0, 2: 50.0, 3: 10.0}
        assert projected_strength_rank(team_ids, contending, dynasty, picks) == [1, 2, 3]

    def test_current_strength_dominates_the_blend(self):
        # Team 1 crushes on current strength but is last on everything
        # else; team 2 is the reverse. Tommy's own stated priority (current
        # strength matters most) should still put team 1 ahead.
        team_ids = [1, 2]
        contending = {1: 100.0, 2: 0.0}
        dynasty = {1: 0.0, 2: 100.0}
        picks = {1: 0.0, 2: 100.0}
        assert projected_strength_rank(team_ids, contending, dynasty, picks) == [1, 2]

    def test_ties_break_on_team_id_deterministically(self):
        team_ids = [3, 1, 2]
        flat = {1: 5.0, 2: 5.0, 3: 5.0}
        assert projected_strength_rank(team_ids, flat, flat, flat) == [1, 2, 3]

    def test_all_zero_inputs_dont_crash(self):
        team_ids = [1, 2, 3]
        zero = {t: 0.0 for t in team_ids}
        assert projected_strength_rank(team_ids, zero, zero, zero) == [1, 2, 3]


class TestProjectedSlotDist:
    def test_sums_to_one_and_centers_on_the_right_slot(self):
        # 10 teams, rank_order best-to-worst; team at rank 1 (strongest)
        # should center on slot 10 (picks last); rank 10 (weakest) on slot 1.
        rank_order = list(range(1, 11))  # team 1 = rank 1 (strongest) ... team 10 = rank 10 (weakest)
        strongest = projected_slot_dist(1, rank_order)
        weakest = projected_slot_dist(10, rank_order)
        assert abs(sum(strongest.values()) - 1.0) < 1e-3
        assert abs(sum(weakest.values()) - 1.0) < 1e-3
        assert max(strongest, key=strongest.get) == "10"
        assert max(weakest, key=weakest.get) == "1"

    def test_meaningfully_wider_than_a_point_estimate(self):
        # The whole point is real, wide uncertainty — the center slot
        # should NOT hold anywhere near all the probability mass.
        rank_order = list(range(1, 11))
        dist = projected_slot_dist(5, rank_order)
        assert max(dist.values()) < 0.5

    def test_extreme_ranks_still_produce_a_valid_distribution(self):
        # The clear favorite and the clear bottom team are edge cases for
        # a kernel centered near the boundary — must still sum to 1, no
        # separate clipping step to get wrong.
        rank_order = list(range(1, 11))
        for team in (1, 10):
            dist = projected_slot_dist(team, rank_order)
            assert abs(sum(dist.values()) - 1.0) < 1e-3
            assert all(v >= 0 for v in dist.values())
