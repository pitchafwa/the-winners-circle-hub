"""Milestone-2 validation: run all metrics over a cached season and
cross-check them for internal consistency. Not part of the build pipeline.

Usage:  python validate.py [--week N]   (SEASON env var picks the season)
"""
import sys
from collections import Counter

import metrics
import parse


def main():
    league = parse.load_league()
    tname = {tid: t.name for tid, t in league.teams.items()}
    print(f"{league.name} {league.season} — {league.team_count} teams, "
          f"weeks cached: {league.completed_weeks()}")
    print(f"Starting slots: {[parse.SLOT_NAMES[s] for s in league.starting_slots]}\n")

    coach = metrics.compute_coach(league)
    all_play = metrics.compute_all_play(league)
    awards = metrics.compute_superlatives(league, coach)
    power = metrics.compute_power_rankings(league, all_play)

    # --- Consistency checks -------------------------------------------------
    problems = []
    for week in league.completed_weeks():
        for m in league.weeks[week]:
            for tw in (m.home, m.away):
                if tw is None:
                    continue
                c = coach[tw.team_id]["weeks"][week]
                # optimal must never be below what the starters produced
                if c["optimal"] < c["actual"] - 0.01:
                    problems.append(f"week {week} {tname[tw.team_id]}: optimal {c['optimal']} < lineup {c['actual']}")
                # starters + home bonus + adjustment must equal ESPN's official total
                starter_sum = round(sum(p.actual for p in tw.starters()), 2)
                expected = round(starter_sum + tw.home_bonus + tw.adjustment, 2)
                if abs(expected - tw.total) > 0.02:
                    problems.append(
                        f"week {week} {tname[tw.team_id]}: starters {starter_sum} + bonus {tw.home_bonus} "
                        f"+ adj {tw.adjustment} = {expected} != official {tw.total}")

    luck_sum = sum(d["luck"] for d in all_play.values() if d["luck"] is not None)
    if abs(luck_sum) > 0.1:
        problems.append(f"luck index does not sum to ~0: {luck_sum}")

    if problems:
        print("CONSISTENCY PROBLEMS:")
        for p in problems:
            print("  " + p)
        sys.exit(1)
    print("Consistency checks passed: optimal >= lineup points for every team-week; "
          "starters + home bonus + adjustments match ESPN official totals; luck is zero-sum.\n")

    # --- Season tables ------------------------------------------------------
    print("=== All-play / luck (regular season) ===")
    rows = sorted(all_play.items(), key=lambda kv: -(kv[1]["pct"] or 0))
    for tid, d in rows:
        print(f"  {tname[tid]:<28} {d['wins']:>3}-{d['losses']:<3} "
              f"({d['pct']:.3f})  exp W {d['expected_wins']:>5}  luck {d['luck']:+.2f}")

    print("\n=== Coach ratings (season) ===")
    rows = sorted(coach.items(), key=lambda kv: -(kv[1]["season"].get("rating") or 0))
    for tid, d in rows:
        s = d["season"]
        print(f"  {tname[tid]:<28} {s['rating']:.1%}  actual {s['actual']:>7}  "
              f"optimal {s['optimal']:>7}  left on bench {s['bench_lost']:>6}")

    print("\n=== Final power rankings (week {}) ===".format(max(power)))
    for r in power[max(power)]:
        mv = r["movement"]
        arrow = "→" if mv in (None, 0) else (f"↑{mv}" if mv > 0 else f"↓{-mv}")
        print(f"  {r['rank']:>2}. {tname[r['team_id']]:<28} {r['score']:.3f}  {arrow}")

    print("\n=== Superlative counts by team (season trophy case) ===")
    counts = Counter()
    for a in awards:
        counts[(a.team_id, a.award_key)] += 1
    by_team = Counter(a.team_id for a in awards)
    for tid, n in by_team.most_common():
        keys = [f"{k}x{counts[(tid, k)]}" for (t, k) in counts if t == tid]
        print(f"  {tname[tid]:<28} {n:>2} awards")

    week = None
    for i, arg in enumerate(sys.argv):
        if arg == "--week" and i + 1 < len(sys.argv):
            week = int(sys.argv[i + 1])
    if week:
        print(f"\n=== Week {week} superlatives ===")
        for a in awards:
            if a.week == week:
                print(f"  [{a.award_key}] {a.detail}  (value: {a.value})")


if __name__ == "__main__":
    main()
