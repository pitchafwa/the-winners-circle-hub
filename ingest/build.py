"""Build entrypoint: fetch (unless --offline) then write the JSON contract
to web/public/data/. The file shapes are documented in DATA.md and mirrored
by web/src/types/data.ts — change all three together or not at all.

Usage:
    python build.py                  # fetch current season + build all cached seasons
    python build.py --offline        # rebuild from cache only, no network
    python build.py --season 2025    # build one specific season (implies no fetch of others)
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

import config
import metrics
import parse
import pick_tracking


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    tmp.replace(path)
    print(f"  wrote {path.relative_to(config.ROOT)}")


def _record_str(w, l, t):
    return f"{w}-{l}" + (f"-{t}" if t else "")


def build_season(season: int, dynasty_values: dict[str, int] | None = None,
                 valuation_updated_at: str | None = None) -> dict:
    """Write every data file for one season. Returns summary for seasons.json."""
    league = parse.load_league(season)
    out_dir = config.DATA_DIR / str(season)
    generated_at = datetime.now(timezone.utc).isoformat()

    coach = metrics.compute_coach(league)
    all_play = metrics.compute_all_play(league)
    awards = metrics.compute_superlatives(league, coach)
    power = metrics.compute_power_rankings(league, all_play)
    trades = metrics.compute_trades(league)
    consistency = metrics.compute_consistency(league)
    # name resolution: global NFL list < current rosters < box scores
    names = {**parse.global_player_names(),
             **parse.roster_player_names(season),
             **metrics.player_names(league)}

    completed = league.completed_weeks()

    # ---- meta.json --------------------------------------------------------
    meta = {
        "generated_at": generated_at,
        "fetched_at": league.fetched_at,
        "season": season,
        "league_id": config.LEAGUE_ID,
        "name": league.name,
        "team_count": league.team_count,
        "reg_season_weeks": league.reg_season_weeks,
        "playoff_team_count": league.playoff_team_count,
        "playoff_seeding_rule": league.playoff_seeding_rule,
        "home_team_bonus": league.home_team_bonus,
        "playoff_home_team_bonus": league.playoff_home_team_bonus,
        "current_matchup_period": league.current_matchup_period,
        "scoring_period_id": league.scoring_period_id,
        "final_scoring_period": league.final_scoring_period,
        # league rule, not an ESPN field: the week-17 game is always this
        # league's championship, regardless of what ESPN's own
        # final_scoring_period says for a given season (see config.py)
        "championship_week": config.FINAL_COUNTED_WEEK,
        "season_over": league.season_over,
        # started = games have been played; box-score caches may be absent for
        # history seasons, so the decided schedule is the fallback evidence
        "season_started": bool(completed) or any(
            s.winner != "UNDECIDED" for s in league.full_schedule),
        "completed_weeks": completed,
        "starting_slots": [parse.SLOT_NAMES[s] for s in league.starting_slots],
        "divisions": [{"id": k, "name": v} for k, v in sorted(league.divisions.items())],
        "previous_seasons": league.previous_seasons,
        "teams": [
            {
                "id": t.team_id, "name": t.name, "abbrev": t.abbrev,
                "logo": t.logo, "owner": t.owner, "division_id": t.division_id,
                "nickname": (parse.owner_aliases().get(t.team_id) or [None])[0],
            }
            for t in league.teams.values()
        ],
    }
    _write(out_dir / "meta.json", meta)

    # ---- standings.json ---------------------------------------------------
    rows = []
    for t in league.teams.values():
        ap = all_play[t.team_id]
        season_coach = coach[t.team_id]["season"]
        rows.append({
            "team_id": t.team_id,
            "seed": t.playoff_seed,
            "final_rank": t.final_rank,
            "wins": t.wins, "losses": t.losses, "ties": t.ties,
            "record": _record_str(t.wins, t.losses, t.ties),
            "win_pct": round((t.wins + 0.5 * t.ties) / max(t.wins + t.losses + t.ties, 1), 4),
            "points_for": t.points_for,
            "points_against": t.points_against,
            "division_id": t.division_id,
            "division_record": _record_str(t.division_wins, t.division_losses, t.division_ties),
            "streak": f"{t.streak_type[0]}{t.streak_length}" if t.streak_type else "",
            "all_play_wins": ap["wins"], "all_play_losses": ap["losses"], "all_play_ties": ap["ties"],
            "all_play_record": _record_str(ap["wins"], ap["losses"], ap["ties"]),
            "all_play_pct": ap["pct"],
            "expected_wins": ap["expected_wins"] if completed else None,
            "luck": ap["luck"],
            # season-long lineup production vs the perfect-lineup ceiling
            "lineup_points": season_coach.get("actual"),
            "optimal_points": season_coach.get("optimal"),
            "coach_rating": season_coach.get("rating"),
            "bench_points_lost": season_coach.get("bench_lost"),
            "consistency": consistency.get(t.team_id),
        })
    rows.sort(key=lambda r: (r["seed"] if r["seed"] else 99))
    _write(out_dir / "standings.json", {"generated_at": generated_at, "rows": rows})

    # ---- power.json -------------------------------------------------------
    _write(out_dir / "power.json", {
        "generated_at": generated_at,
        "weights": metrics.POWER_WEIGHTS,
        "weeks": {str(w): rows_ for w, rows_ in power.items()},
        "latest_week": max(power) if power else None,
    })

    # ---- superlatives.json ------------------------------------------------
    _write(out_dir / "superlatives.json", {
        "generated_at": generated_at,
        "awards_meta": metrics.AWARD_META,
        "awards": [
            {"week": a.week, "key": a.award_key, "team_id": a.team_id,
             "value": a.value, "detail": a.detail}
            for a in awards
        ],
    })

    # ---- matchups/week-N.json --------------------------------------------
    def side_json(tw, week):
        if tw is None:
            return None
        c = coach[tw.team_id]["weeks"][week]
        return {
            "team_id": tw.team_id,
            "total": tw.total,
            "lineup_points": tw.lineup_points,
            "home_bonus": tw.home_bonus,
            "adjustment": tw.adjustment,
            "is_home": tw.is_home,
            "optimal_points": c["optimal"],
            "coach_rating": c["rating"],
            "bench_points_lost": c["bench_lost"],
            "optimal_lineup": c["optimal_assignment"],
            "lineup": [
                {"player_id": p.player_id, "name": p.name, "position": p.position,
                 "slot": p.slot_name, "started": p.started, "actual": p.actual,
                 "projected": p.projected, "played": p.played}
                for p in sorted(tw.lineup, key=lambda x: (not x.started, x.slot_id))
            ],
        }

    # drop stale week files beyond what the league counts (e.g. old week-17s)
    for old in (out_dir / "matchups").glob("week-*.json") if (out_dir / "matchups").exists() else []:
        if int(old.stem.replace("week-", "")) not in completed:
            old.unlink()
    for week in completed:
        _write(out_dir / "matchups" / f"week-{week}.json", {
            "generated_at": generated_at,
            "week": week,
            "matchups": [
                {"matchup_period": m.matchup_period, "winner": m.winner,
                 "is_playoff": m.is_playoff, "playoff_tier": m.playoff_tier,
                 "home": side_json(m.home, week), "away": side_json(m.away, week)}
                for m in league.weeks[week]
            ],
            "late_swings": metrics.compute_late_swings(league, week, parse.pro_game_dates(season, week)),
        })

    # ---- teams.json -------------------------------------------------------
    week_avgs = []
    for w in completed:
        totals = [tw.total for m in league.weeks[w] for tw in (m.home, m.away) if tw]
        week_avgs.append({"week": w, "avg": round(sum(totals) / len(totals), 2) if totals else None})

    teams_out = []
    for tid, t in league.teams.items():
        weekly = []
        for w in completed:
            tw = league.team_week(tid, w)
            if tw is None:
                continue
            m = next(mm for mm in league.weeks[w]
                     if mm.home.team_id == tid or (mm.away and mm.away.team_id == tid))
            opp = m.away if m.home.team_id == tid else m.home
            is_home = m.home.team_id == tid
            won = (m.winner == "HOME") == is_home and m.winner in ("HOME", "AWAY")
            c = coach[tid]["weeks"][w]
            weekly.append({
                "week": w,
                "points": tw.total,
                "lineup_points": tw.lineup_points,
                "opponent_id": opp.team_id if opp else None,
                "opponent_points": opp.total if opp else None,
                "result": "T" if m.winner == "TIE" else ("W" if won else "L"),
                "is_playoff": m.is_playoff,
                "optimal_points": c["optimal"],
                "coach_rating": c["rating"],
                "bench_points_lost": c["bench_lost"],
                "all_play": all_play[tid]["weeks"].get(w),
            })

        # starter actual-vs-projected, aggregated per player
        agg: dict[int, dict] = {}
        for w in completed:
            tw = league.team_week(tid, w)
            if tw is None:
                continue
            for p in tw.starters():
                if p.projected is None:
                    continue
                a = agg.setdefault(p.player_id, {
                    "player_id": p.player_id, "name": p.name, "position": p.position,
                    "starts": 0, "actual": 0.0, "projected": 0.0})
                a["starts"] += 1
                a["actual"] = round(a["actual"] + p.actual, 2)
                a["projected"] = round(a["projected"] + p.projected, 2)
        for a in agg.values():
            a["diff"] = round(a["actual"] - a["projected"], 2)

        upcoming = [
            {"matchup_period": s.matchup_period,
             "opponent_id": s.away_id if s.home_id == tid else s.home_id,
             "is_home": s.home_id == tid}
            for s in league.full_schedule
            if s.winner == "UNDECIDED" and (s.home_id == tid or s.away_id == tid)
        ]

        teams_out.append({
            "team_id": tid,
            "weekly": weekly,
            "projection_report": sorted(agg.values(), key=lambda a: a["diff"]),
            "upcoming": upcoming,
            "season": {
                "coach": coach[tid]["season"],
                "all_play": {k: all_play[tid][k] for k in
                             ("wins", "losses", "ties", "pct", "expected_wins", "luck")},
            },
        })
    _write(out_dir / "teams.json", {
        "generated_at": generated_at,
        "league_weekly_avg": week_avgs,
        "teams": teams_out,
    })

    # ---- activity.json ----------------------------------------------------
    _write(out_dir / "activity.json", {
        "generated_at": generated_at,
        "events": [
            {"date": e.date, "week": e.week, "action": e.action, "team_id": e.team_id,
             "player_id": e.player_id,
             "player_name": names.get(e.player_id, f"Player {e.player_id}"),
             "bid": e.bid, "to_team_id": e.to_team_id}
            for e in league.activity
        ],
        "trades": trades,
        "pick_ownership": [
            {**pick_tracking.resolve(p["season"], p["round"], p["original_team_id"], p["owned_by_team_id"]),
             "via": p.get("via", "")}
            for p in metrics.pick_ownership(season)
        ],
    })

    # ---- extras: swap, positions, recaps, draft, sim ----------------------
    if completed:
        _write(out_dir / "schedule_swap.json", {
            "generated_at": generated_at,
            "rows": metrics.compute_schedule_swap(league),
        })
        _write(out_dir / "positions.json", {
            "generated_at": generated_at,
            **metrics.compute_positions(league),
        })
        _write(out_dir / "recaps.json", {
            "generated_at": generated_at,
            "recaps": {str(w): r for w, r in metrics.compute_recaps(league, awards).items()},
        })

    # Draft grades come ONLY from the hand-entered rookie draft (this dynasty
    # league drafts by text; ESPN's mDraftDetail is the keeper import and lies)
    picks, draft_problems = parse.load_manual_draft(season, league.teams, names)
    for prob in draft_problems:
        print(f"  manual draft {season}: {prob}", file=sys.stderr)
    draft = metrics.compute_draft(league, picks, names, dynasty_values, valuation_updated_at)
    if draft:
        _write(out_dir / "draft.json", {
            "generated_at": generated_at, **draft, "problems": draft_problems})
    else:
        # a stale grade file must not outlive its data source
        (out_dir / "draft.json").unlink(missing_ok=True)

    if not league.season_over and league.full_schedule:
        import simulate
        history = None
        for prev in sorted(league.previous_seasons, reverse=True):
            if (config.CACHE_DIR / str(prev) / "league.json").exists():
                history = parse.load_league(prev)
                break
        sim = simulate.run(league, history)
        if sim:
            _write(out_dir / "sim.json", {"generated_at": generated_at, **sim})

    # ---- schedule.json (full season, for H2H matrix + bump chart) ---------
    _write(out_dir / "schedule.json", {
        "generated_at": generated_at,
        "entries": [
            {"matchup_period": s.matchup_period, "home_id": s.home_id, "away_id": s.away_id,
             "winner": s.winner, "home_score": s.home_score, "away_score": s.away_score,
             "is_playoff": s.is_playoff, "playoff_tier": s.playoff_tier}
            for s in league.full_schedule
        ],
    })

    return {
        "season": season,
        "name": league.name,
        "completed_weeks": len(completed),
        "season_over": league.season_over,
        "season_started": meta["season_started"],
    }


# Badge types — icon/tone rendering is the frontend's job; truth lives here.
BADGE_META = {
    "champion":             {"label": "League Champion",        "tone": "gold"},
    "runner_up":            {"label": "Runner-up",              "tone": "positive"},
    "reg_season_title":     {"label": "#1 Seed",                "tone": "positive"},
    "points_title":         {"label": "Points Title",           "tone": "positive"},
    "superlative_champion": {"label": "Superlative Champion",   "tone": "gold"},
    "best_coach_season":    {"label": "Best Coach",             "tone": "positive"},
    "record_high_week":     {"label": "Single-Week Record",     "tone": "gold"},
    "last_place":           {"label": "Last Place",             "tone": "negative"},
    "record_low_week":      {"label": "Single-Week Low",        "tone": "negative"},
    "bench_king":           {"label": "Most Points Benched",    "tone": "negative"},
}


def build_badges(seasons: list[int]) -> None:
    """Cross-season badge ledger, keyed by franchise (ESPN team id — owner
    changes travel with the slot). Rank-based badges only for finished
    seasons; single-week records span every scored matchup we have."""
    badges: dict[int, list[dict]] = {}
    names_by_season: dict[int, dict[int, str]] = {}

    def award(team_id, btype, season, detail):
        badges.setdefault(team_id, []).append({
            "type": btype, "season": season, "detail": detail,
            "team_name_then": names_by_season.get(season, {}).get(team_id, ""),
        })

    high = low = None  # (score, team_id, season, matchup_period)
    for season in sorted(seasons):
        league = parse.load_league(season)
        names_by_season[season] = {tid: t.name for tid, t in league.teams.items()}

        for s in league.full_schedule:
            if s.winner == "UNDECIDED" or s.away_id is None:
                continue
            # playoff weeks: winners-bracket games only — consolation scores
            # are teams that aren't really playing (also excludes seasons
            # where tier info is unavailable, rather than counting noise)
            if s.matchup_period > league.reg_season_weeks and s.playoff_tier != "WINNERS_BRACKET":
                continue
            for score, tid in ((s.home_score, s.home_id), (s.away_score, s.away_id)):
                if score <= 0:
                    continue  # missing data, not a real shutout
                if high is None or score > high[0]:
                    high = (score, tid, season, s.matchup_period)
                if low is None or score < low[0]:
                    low = (score, tid, season, s.matchup_period)

        if not league.season_over:
            continue

        for t in league.teams.values():
            if t.final_rank == 1:
                award(t.team_id, "champion", season, f"Won the {season} championship")
            elif t.final_rank == 2:
                award(t.team_id, "runner_up", season, f"Lost the {season} final")
            if t.final_rank == league.team_count and league.team_count > 0:
                award(t.team_id, "last_place", season, f"Finished last in {season}")
            if t.playoff_seed == 1:
                award(t.team_id, "reg_season_title", season, f"#1 seed in {season}")

        by_pf = max(league.teams.values(), key=lambda t: t.points_for)
        if by_pf.points_for > 0:
            award(by_pf.team_id, "points_title", season,
                  f"Most points in {season} ({by_pf.points_for:g})")

        coach = metrics.compute_coach(league)
        rated = [(tid, c["season"]) for tid, c in coach.items() if c["season"].get("rating")]
        if rated:
            tid, c = max(rated, key=lambda kv: kv[1]["rating"])
            award(tid, "best_coach_season", season,
                  f"Best coach of {season} ({c['rating']:.1%} of optimal)")
            tid, c = max(rated, key=lambda kv: kv[1]["bench_lost"])
            award(tid, "bench_king", season,
                  f"Left {c['bench_lost']:g} points on the bench in {season}")

            awards_list = metrics.compute_superlatives(league, coach)
            points: dict[int, int] = {}
            for a in awards_list:
                points[a.team_id] = points.get(a.team_id, 0) + metrics.AWARD_META[a.award_key]["points"]
            if points:
                champ = max(points, key=lambda t: points[t])
                award(champ, "superlative_champion", season,
                      f"{season} Superlative Champion ({points[champ]:+d} pts)")

    if high:
        award(high[1], "record_high_week", high[2],
              f"League-record {high[0]:g} points (week {high[3]}, {high[2]})")
    if low:
        award(low[1], "record_low_week", low[2],
              f"League-record low {low[0]:g} points (week {low[3]}, {low[2]})")

    # Hand-entered badges: seasons ESPN no longer serves (2012-2017), plus
    # corrections to auto-computed badges for real-world facts ESPN's own
    # standings can't capture (e.g. a season decided by extenuating
    # circumstances outside the app's data). `suppress` removes an
    # auto-computed badge before the manual `badges` additions are applied,
    # so a correction reads as "replace", not "also show the wrong one."
    manual_path = config.ROOT / "ingest" / "manual_badges.json"
    unassigned: list[dict] = []
    if manual_path.exists():
        with open(manual_path, encoding="utf-8") as f:
            manual = json.load(f)
        for s in manual.get("suppress", []):
            lst = badges.get(s["team_id"])
            if lst is None:
                print(f"  suppress entry for unknown team_id, skipped: {s}", file=sys.stderr)
                continue
            before = len(lst)
            lst[:] = [b for b in lst if not (b["season"] == s["season"] and b["type"] == s["type"])]
            if len(lst) == before:
                print(f"  suppress entry matched nothing (already gone?): {s}", file=sys.stderr)
        for m in manual.get("badges", []):
            if m.get("type") not in BADGE_META:
                print(f"  manual badge with unknown type skipped: {m}", file=sys.stderr)
                continue
            entry = {
                "type": m["type"], "season": m["season"],
                "detail": m.get("detail") or f"{BADGE_META[m['type']]['label']}, {m['season']} (league records)",
                "team_name_then": m.get("team_name_then", ""),
            }
            if m.get("team_id") is not None:
                badges.setdefault(m["team_id"], []).append(entry)
            else:
                unassigned.append(entry)

    for lst in badges.values():
        lst.sort(key=lambda b: (b["season"], b["type"]))
    _write(config.DATA_DIR / "badges.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "badge_meta": BADGE_META,
        "teams": {str(tid): lst for tid, lst in sorted(badges.items())},
        "unassigned": unassigned,
    })


def cached_seasons() -> list[int]:
    if not config.CACHE_DIR.exists():
        return []
    return sorted(
        (int(p.name) for p in config.CACHE_DIR.iterdir()
         if p.is_dir() and (p / "league.json").exists()),
        reverse=True,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="rebuild from cache, no network")
    ap.add_argument("--season", type=int, help="build only this season")
    args = ap.parse_args()

    if not args.offline:
        import fetch
        print(f"Fetching season {config.SEASON}...")
        league = None
        try:
            league, _ = fetch.fetch_season()
        except Exception as e:  # noqa: BLE001
            print(f"FETCH FAILED: {e}", file=sys.stderr)
            print("Continuing with previously cached data.", file=sys.stderr)

        # one-time backfill of past seasons (immutable, cached forever)
        previous = league.previousSeasons if league else []
        for year in previous:
            try:
                if fetch.fetch_history_raw(year) is not None:
                    print(f"  fetched history {year}")
            except Exception as e:  # noqa: BLE001
                print(f"  history {year} unavailable: {e}", file=sys.stderr)

    all_seasons = cached_seasons()
    seasons = [args.season] if args.season else all_seasons
    if not seasons:
        print("No cached seasons found — nothing to build.", file=sys.stderr)
        sys.exit(1)

    import valuation
    print("Fetching dynasty valuation data..." if not args.offline else "Using cached dynasty valuation data...")
    dynasty_values, valuation_updated_at = valuation.values_by_name(offline=args.offline)
    if not dynasty_values:
        print("  no valuation data available — draft grades will be skipped", file=sys.stderr)

    summaries = []
    for season in seasons:
        print(f"Building {season}...")
        summaries.append(build_season(season, dynasty_values, valuation_updated_at))

    # cross-season aggregates always span every season on record, even when
    # --season restricted the per-season build loop above (e.g. the trade/
    # draft admin tools rebuild a single season on each submit) — otherwise
    # a one-season build would silently wipe every other season's badges
    build_badges(all_seasons)

    _write(config.DATA_DIR / "seasons.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "default_season": config.SEASON if any(s["season"] == config.SEASON for s in summaries)
        else max(s["season"] for s in summaries),
        "seasons": summaries,
    })
    print("Build complete.")


if __name__ == "__main__":
    main()
