"""All-play record and luck index tests on a hand-built 4-team league."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from metrics import compute_all_play
from parse import LeagueData, MatchupWeek, TeamInfo, TeamWeek


def team_week(tid, week, total):
    return TeamWeek(team_id=tid, week=week, total=total, lineup=[])


def matchup(week, home, away, h, a):
    winner = "HOME" if h > a else ("AWAY" if a > h else "TIE")
    return MatchupWeek(week=week, matchup_period=week,
                       home=team_week(home, week, h), away=team_week(away, week, a),
                       is_playoff=False, playoff_tier="NONE", winner=winner)


def build_league():
    teams = {i: TeamInfo(i, f"Team {i}", f"T{i}", "", "", 0) for i in range(1, 5)}
    league = LeagueData(
        season=2025, name="Test", team_count=4, reg_season_weeks=14,
        playoff_team_count=2, playoff_seeding_rule="H2H_RECORD",
        home_team_bonus=0, playoff_home_team_bonus=0,
        starting_slots=[0], teams=teams, weeks={},
    )
    # Week 1 scores: T1=100, T2=90, T3=80, T4=70.  T1v2, T3v4.
    league.weeks[1] = [matchup(1, 1, 2, 100, 90), matchup(1, 3, 4, 80, 70)]
    # Week 2 scores: T1=50, T2=95, T3=60, T4=55.  T1v3, T2v4.
    # T1 loses to T3 despite... no: 50 < 60, real loss. T4 55 loses to T2.
    league.weeks[2] = [matchup(2, 1, 3, 50, 60), matchup(2, 2, 4, 95, 55)]
    return league


class TestAllPlay:
    def test_records(self):
        ap = compute_all_play(build_league())
        # Week 1: T1 3-0, T2 2-1, T3 1-2, T4 0-3
        # Week 2: T2 3-0, T3 2-1, T4 1-2, T1 0-3
        assert (ap[1]["wins"], ap[1]["losses"]) == (3, 3)
        assert (ap[2]["wins"], ap[2]["losses"]) == (5, 1)
        assert (ap[3]["wins"], ap[3]["losses"]) == (3, 3)
        assert (ap[4]["wins"], ap[4]["losses"]) == (1, 5)

    def test_luck_index(self):
        ap = compute_all_play(build_league())
        # Expected wins = all-play wins / 3 per week.
        # T1: actual 1 (beat T2, lost to T3), expected 3/3 + 0/3 = 1.0 -> luck 0
        # T2: actual 1, expected 2/3 + 3/3 = 1.67 -> luck -0.67
        # T3: actual 2 (beat T4 and T1), expected 1/3 + 2/3 = 1.0 -> luck +1.0
        # T4: actual 0, expected 0/3 + 1/3 = 0.33 -> luck -0.33
        assert ap[1]["luck"] == 0.0
        assert ap[2]["luck"] == -0.67
        assert ap[3]["luck"] == 1.0
        assert ap[4]["luck"] == -0.33

    def test_luck_sums_near_zero_when_no_ties(self):
        # Total actual wins == total expected wins across the league,
        # so luck is zero-sum (up to rounding).
        ap = compute_all_play(build_league())
        assert abs(sum(ap[t]["luck"] for t in ap)) < 0.02

    def test_tie_handling(self):
        league = build_league()
        league.weeks[3] = [matchup(3, 1, 2, 88, 88), matchup(3, 3, 4, 90, 20)]
        ap = compute_all_play(league)
        w3 = ap[1]["weeks"][3]
        assert w3["ties"] == 1
        assert w3["result"] == "T"
        assert w3["expected_wins"] == 0.5  # 1 win (T4) + 0.5 tie (T2) over 3
        # hmm: T1=88 beats T4=20, ties T2=88, loses to T3=90 -> (1 + 0.5)/3 = 0.5
