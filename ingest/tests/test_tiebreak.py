"""ESPN's documented standings tiebreak (tiebreak.py): H2H (only if equal
games among tied teams) -> PF -> intradivisional -> PA -> coin flip, seeded
one team at a time with a reset after each."""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tiebreak import order_by_espn_rules


def order(group, wins, h2h, pf, pa=None, div_pct=None, rng=None):
    return order_by_espn_rules(group, wins, h2h, pf, pa, div_pct, rng)


class TestEspnTiebreak:
    def test_more_wins_beats_everything(self):
        assert order([1, 2], {1: 5, 2: 6}, {}, {1: 999, 2: 1}) == [2, 1]

    def test_h2h_beats_points_when_games_equal(self):
        h2h = {(1, 2): 2, (2, 1): 0}
        assert order([1, 2], {1: 5, 2: 5}, h2h, {1: 100, 2: 900}) == [1, 2]

    def test_split_h2h_falls_to_points_for(self):
        h2h = {(1, 2): 1, (2, 1): 1}
        assert order([1, 2], {1: 5, 2: 5}, h2h, {1: 100, 2: 900}) == [2, 1]

    def test_h2h_invalid_when_tied_teams_played_unequal_times(self):
        # 1 beat 2 and 3; 2 and 3 never met -> unequal games among the group,
        # so h2h is skipped for the top seed and points-for decides (3 has the
        # most). Then the reset: {1, 2} did play equally (once), so h2h applies
        # again and 1 (who beat 2) takes second despite fewer points.
        h2h = {(1, 2): 1, (1, 3): 1}
        assert order([1, 2, 3], {1: 5, 2: 5, 3: 5}, h2h, {1: 100, 2: 200, 3: 300}) == [3, 1, 2]

    def test_three_way_tie_seeds_one_at_a_time_with_reset(self):
        # Cycle: 1 beat 2, 2 beat 3, 3 beat 1 -> everyone equal on h2h, so the
        # top seed goes to most points (team 1). Then the RESET: among {2, 3}
        # h2h applies again, and 2 beat 3 — even though 3 has more points.
        h2h = {(1, 2): 1, (2, 3): 1, (3, 1): 1}
        pf = {1: 900, 2: 200, 3: 300}
        assert order([1, 2, 3], {1: 5, 2: 5, 3: 5}, h2h, pf) == [1, 2, 3]

    def test_intradivisional_then_points_against(self):
        h2h = {(1, 2): 1, (2, 1): 1}
        pf = {1: 500, 2: 500}
        assert order([1, 2], {1: 5, 2: 5}, h2h, pf, {1: 10, 2: 10}, {1: 0.4, 2: 0.6}) == [2, 1]
        assert order([1, 2], {1: 5, 2: 5}, h2h, pf, {1: 10, 2: 99}, {1: 0.5, 2: 0.5}) == [2, 1]

    def test_coin_flip_only_when_everything_ties(self):
        h2h = {(1, 2): 1, (2, 1): 1}
        pf = {1: 500, 2: 500}
        assert order([1, 2], {1: 5, 2: 5}, h2h, pf, {1: 1, 2: 1}, {1: 0.5, 2: 0.5}) == [1, 2]   # display: lowest id
        seen = {tuple(order([1, 2], {1: 5, 2: 5}, h2h, pf, {1: 1, 2: 1}, {1: 0.5, 2: 0.5}, random.Random(s)))
                for s in range(30)}
        assert seen == {(1, 2), (2, 1)}
