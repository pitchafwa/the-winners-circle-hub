"""Optimal lineup solver tests, including a roster where greedy is wrong."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from metrics import optimal_lineup
from parse import PlayerWeek, BENCH_SLOT

QB, RB, RBWR, WR, TE, DST, K, FLEX = 0, 2, 3, 4, 6, 16, 17, 23


def player(name, pts, eligible, position="?", slot=BENCH_SLOT, projected=None):
    return PlayerWeek(
        player_id=abs(hash(name)) % 10**6, name=name, position=position,
        slot_id=slot, eligible_slots=frozenset(eligible),
        actual=pts, played=pts > 0, projected=projected,
    )


# Realistic eligibility: RBs -> RB, RB/WR, FLEX; WRs -> WR, RB/WR, FLEX;
# TEs -> TE, FLEX only (NOT RB/WR). Everyone is bench-eligible.
def rb(name, pts):
    return player(name, pts, {RB, RBWR, FLEX, BENCH_SLOT}, "RB")


def wr(name, pts):
    return player(name, pts, {WR, RBWR, FLEX, BENCH_SLOT}, "WR")


def te(name, pts):
    return player(name, pts, {TE, FLEX, BENCH_SLOT}, "TE")


def greedy_lineup(candidates, slots):
    """The wrong way: highest scorer first, first open eligible slot in
    the league's slot order. Kept here only to prove the solver beats it."""
    open_slots = list(slots)
    total = 0.0
    for p in sorted(candidates, key=lambda x: -x.actual):
        for i, s in enumerate(open_slots):
            if s is not None and s in p.eligible_slots:
                total += p.actual
                open_slots[i] = None
                break
    return round(total, 2)


class TestGreedyIsWrong:
    def test_flex_blocks_te_greedy_fails(self):
        # Slots: TE, FLEX, RB/WR (in that order). Greedy sends the 19-pt WR
        # to FLEX, leaving the 18-pt TE stranded (TE taken, RB/WR rejects TEs).
        # Correct answer: WR belongs in RB/WR so the TE can take FLEX.
        slots = [TE, FLEX, RBWR]
        roster = [te("Elite TE", 20.0), wr("Good WR", 19.0), te("Second TE", 18.0), wr("Weak WR", 5.0)]
        assert greedy_lineup(roster, slots) == 44.0  # 20 + 19 + 5 — the wrong answer
        optimal, _ = optimal_lineup(roster, slots)
        assert optimal == 57.0  # 20 + 18 + 19

    def test_solver_never_below_actual_style_greedy(self):
        slots = [QB, RB, RB, RBWR, WR, WR, TE, FLEX, DST, K]
        roster = [
            player("QB1", 22.1, {QB, BENCH_SLOT}, "QB"),
            rb("RB1", 25.0), rb("RB2", 3.2), rb("RB3", 14.8),
            wr("WR1", 21.0), wr("WR2", 11.5), wr("WR3", 12.2), wr("WR4", 9.9),
            te("TE1", 4.0), te("TE2", 16.5),
            player("DST1", 8.0, {DST, BENCH_SLOT}, "D/ST"),
            player("K1", 7.0, {K, BENCH_SLOT}, "K"),
        ]
        optimal, assignment = optimal_lineup(roster, slots)
        # QB 22.1 + DST 8 + K 7 + TE2 16.5 + RB1 25, RB3 14.8 in RB +
        # WR1 21, WR3 12.2 in WR + WR2 11.5 in RB/WR + WR4 9.9 in FLEX
        assert optimal == 148.0
        assert greedy_lineup(roster, slots) <= optimal


class TestEdgeCases:
    def test_bye_week_players_still_eligible(self):
        slots = [RB, FLEX]
        roster = [rb("Played", 10.0), rb("OnBye", 0.0)]
        optimal, assignment = optimal_lineup(roster, slots)
        assert optimal == 10.0
        assert len(assignment) == 2  # both slots filled (bye guy scores 0)

    def test_unfillable_slot_is_empty_not_faked(self):
        slots = [QB, RB]
        roster = [rb("Only RB", 12.0)]
        optimal, assignment = optimal_lineup(roster, slots)
        assert optimal == 12.0
        empty = [s for s, p in assignment if p is None]
        assert empty == [QB]

    def test_fewer_players_than_slots(self):
        slots = [RB, RB, WR, FLEX]
        roster = [rb("A", 9.0), wr("B", 8.0)]
        optimal, _ = optimal_lineup(roster, slots)
        assert optimal == 17.0

    def test_empty_roster(self):
        optimal, assignment = optimal_lineup([], [RB, WR])
        assert optimal == 0.0
        assert all(p is None for _, p in assignment)

    def test_negative_scorers_lose_to_empty_slot(self):
        # An empty slot (0 pts) is legal, so the optimal lineup benches a
        # negative-scoring D/ST rather than starting it.
        slots = [DST]
        roster = [player("Bad DST", -4.0, {DST, BENCH_SLOT}, "D/ST"),
                  player("Worse DST", -9.0, {DST, BENCH_SLOT}, "D/ST")]
        optimal, assignment = optimal_lineup(roster, slots)
        assert assignment[0][1] is None
        assert optimal == 0.0
