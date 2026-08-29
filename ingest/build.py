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
import time
from datetime import datetime, timezone

import config
import metrics
import ownership
import parse
import pick_tracking
import roster_card
import spectrum
import trade_grades

# Rookie draft rounds this league has ever run — matches ingest/pick_values.json
DRAFT_ROUNDS = [1, 2, 3, 4]
PICK_FUTURES_HORIZON_YEARS = 3

# ESPN's box-score API still returns per-player lineup + points data for
# these seasons even though the box-score web page stops displaying it —
# confirmed by reconciling summed starter points against ESPN's own recorded
# team totals. 2018 is full quality (same shape as 2019+, real bench). 2017
# is real but reduced: starters only, no bench, no exact lineup slot
# (parse.py falls back to the player's default position). 2012-2016 were
# tested and rejected — ESPN's archive for those years is missing a
# meaningful, inconsistent fraction of player entries per week (worse the
# further back), so summed lineups don't reconcile against the real team
# score and there's no reliable way to detect/fill the gaps.
#
# Upper bound is config.SEASON (exclusive), not a fixed year — fetch_season()
# only ever fetches box scores for the CURRENT live season, so once a season
# stops being current (2024, 2025, ...) it needs this same historical path
# to stay regenerable at all, especially on a cache-cold environment (CI)
# that can't just rely on a box-score cache fetched back when that season
# WAS current (2026-08-26: this exact gap silently wiped 2024/2025's
# matchups data on the first automated CI run, since nothing re-fetched
# them and the stale-file cleanup below took the resulting empty
# completed_weeks() as "these weeks don't exist" instead of "couldn't
# check this run").
HISTORICAL_BOXSCORE_YEARS = range(2017, config.SEASON)


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    # OneDrive sync (and, for files under active dev, the Vite file watcher
    # holding a read handle) intermittently locks the target just long
    # enough to fail an atomic rename on Windows — genuinely transient, so
    # retry with backoff rather than aborting the whole build over it.
    max_attempts = 20
    for attempt in range(max_attempts):
        try:
            tmp.replace(path)
            break
        except PermissionError:
            if attempt == max_attempts - 1:
                raise
            time.sleep(0.5)
    print(f"  wrote {path.relative_to(config.ROOT)}")


def _record_str(w, l, t):
    return f"{w}-{l}" + (f"-{t}" if t else "")


def build_season(season: int, dynasty_values: dict[str, int] | None = None,
                 valuation_updated_at: str | None = None,
                 redraft_values: dict[str, int] | None = None,
                 pick_curves: dict[str, dict[str, list[float]]] | None = None) -> dict:
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
    race = metrics.division_race(league)
    rows = []
    for t in league.teams.values():
        ap = all_play[t.team_id]
        season_coach = coach[t.team_id]["season"]
        team_race = race.get(t.team_id, {})
        rows.append({
            "team_id": t.team_id,
            "seed": t.playoff_seed,
            "final_rank": t.final_rank,
            "wins": t.wins, "losses": t.losses, "ties": t.ties,
            "record": _record_str(t.wins, t.losses, t.ties),
            "win_pct": round((t.wins + 0.5 * t.ties) / max(t.wins + t.losses + t.ties, 1), 4),
            # 0 before week 1 is a real ESPN value but not a meaningful one —
            # null so the frontend renders "—" the same way it already does
            # for every other not-yet-meaningful preseason stat below.
            "points_for": t.points_for if completed else None,
            "points_against": t.points_against if completed else None,
            "division_id": t.division_id,
            "division_record": _record_str(t.division_wins, t.division_losses, t.division_ties),
            "division_rank": team_race.get("division_rank"),
            "games_back": team_race.get("games_back"),
            "cushion": team_race.get("cushion"),
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
    # Same cache-cold hazard as the matchups cleanup above: `awards` comes
    # from `league.weeks` (via compute_superlatives), so a run that couldn't
    # fetch this season's box scores computes an empty award list — writing
    # that unconditionally would silently erase a season's real award
    # history. Only skip the write when there's already a real file to
    # protect; a genuinely new season with no games yet still gets one.
    if completed or not (out_dir / "superlatives.json").exists():
        _write(out_dir / "superlatives.json", {
            "generated_at": generated_at,
            "awards_meta": metrics.AWARD_META,
            "awards": [
                {"week": a.week, "key": a.award_key, "team_id": a.team_id,
                 "value": a.value, "detail": a.detail,
                 "player_id": a.player_id, "player_name": a.player_name}
                for a in awards
            ],
        })

    # ---- matchups/week-N.json --------------------------------------------
    pro_abbrev = {tid: info["abbrev"] for tid, info in parse.pro_team_schedule(season).items()}

    def side_json(tw, week, recent_by_pid):
        if tw is None:
            return None
        c = coach[tw.team_id]["weeks"][week]

        def _player_json(p):
            on_fire, on_ice = parse.hot_cold_status(
                p.position, p.played, p.actual if p.played else None, p.projected,
                recent_by_pid.get(p.player_id, []),
            )
            return {"player_id": p.player_id, "name": p.name, "position": p.position,
                    "pro_team": pro_abbrev.get(p.pro_team_id, ""),
                    "slot": p.slot_name, "started": p.started, "actual": p.actual,
                    "projected": p.projected, "played": p.played,
                    "on_fire": on_fire, "on_ice": on_ice}

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
                _player_json(p)
                for p in sorted(tw.lineup, key=lambda x: (not x.started, x.slot_id))
            ],
        }

    # drop stale week files beyond what the league counts (e.g. old week-17s)
    # — but only when this run actually has real box-score data to compare
    # against. `completed` empty doesn't mean "this season has no weeks," it
    # can just as easily mean "the box-score cache for this season wasn't
    # available this run" (a cache-cold environment — CI never persists
    # ingest/.cache/ between runs — and this season isn't the one live
    # fetch_season() covers). Wiping every real matchup file on that
    # ambiguity actually happened once (2026-08-26, cost 2024/2025's real
    # historical data); only clean up once we have positive evidence
    # (completed is non-empty) that we're looking at real, current data.
    if completed:
        for old in (out_dir / "matchups").glob("week-*.json") if (out_dir / "matchups").exists() else []:
            if int(old.stem.replace("week-", "")) not in completed:
                old.unlink()
    for week in completed:
        # "As of week W," not "as of right now" — see recent_player_performance's
        # own docstring for why a rewritten-every-build historical box score
        # can't just reuse a single global on-fire/on-ice snapshot. Feeds
        # the PRE_GAME (hasn't-played-yet) side of hot_cold_status only —
        # a player who HAS played that week is judged on that week's own
        # actual/projected instead, so this lookup only matters for a
        # still-in-progress "week" (bye entries just fail the len<3 check
        # harmlessly).
        recent_by_pid = parse.recent_player_performance(league, upto_week=week)
        _write(out_dir / "matchups" / f"week-{week}.json", {
            "generated_at": generated_at,
            "week": week,
            "matchups": [
                {"matchup_period": m.matchup_period, "winner": m.winner,
                 "is_playoff": m.is_playoff, "playoff_tier": m.playoff_tier,
                 "home": side_json(m.home, week, recent_by_pid), "away": side_json(m.away, week, recent_by_pid)}
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
                "is_home": is_home,
                "result": "T" if m.winner == "TIE" else ("W" if won else "L"),
                "is_playoff": m.is_playoff,
                "optimal_points": c["optimal"],
                "coach_rating": c["rating"],
                "bench_points_lost": c["bench_lost"],
                "all_play": all_play[tid]["weeks"].get(w),
                "top_scorers": [
                    {"player_id": p.player_id, "name": p.name, "position": p.position,
                     "pro_team": pro_abbrev.get(p.pro_team_id, ""), "points": p.actual}
                    for p in sorted(tw.starters(), key=lambda p: -p.actual)[:3]
                ],
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
                    "pro_team": pro_abbrev.get(p.pro_team_id, ""),
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
    # Same cache-cold hazard as matchups/superlatives/activity above —
    # `weekly`/`projection_report` come from the per-week box-score cache,
    # so an empty `completed` would otherwise wipe a season's real
    # week-by-week team history.
    if completed or not (out_dir / "teams.json").exists():
        _write(out_dir / "teams.json", {
            "generated_at": generated_at,
            "league_weekly_avg": week_avgs,
            "teams": teams_out,
        })

    # ---- activity.json ------------------------------------------------------
    # `events` comes from `transactions-week*.json` (`fetch_transactions_raw`)
    # — a genuinely independent fetch from the box-score cache that gates
    # `completed`/matchups/superlatives. Gating this write on `completed`
    # (real GAME weeks finished) was copied from that guard but doesn't fit:
    # waiver adds/drops/trades happen all preseason, well before any game
    # week completes, so during preseason `completed` is permanently empty
    # and this guard silently froze the whole activity feed at whatever it
    # was the moment the file first got created — a real bug found
    # 2026-08-26 (9 days of real preseason transactions missing, because a
    # rebuild had run once with `completed` empty and every run since just
    # skipped the write). `league.activity` itself is the right signal: a
    # live fetch (cache-cold or not) always returns this season's real
    # to-date transactions since that call doesn't depend on any box-score
    # cache, so a non-empty result here is trustworthy even preseason — the
    # only case this should still preserve the existing file is a truly
    # empty local cache (e.g. an `--offline` run before any live fetch has
    # ever populated `.cache`), which also yields empty `league.activity`.
    if league.activity or completed or not (out_dir / "activity.json").exists():
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
    draft = metrics.compute_draft(league, picks, names, dynasty_values, valuation_updated_at,
                                  parse.pick_values_for_season(season, pick_curves))
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
        sim = simulate.run(league, history, redraft_values)
        if sim:
            _write(out_dir / "sim.json", {"generated_at": generated_at, **sim})
    else:
        # A finished season has no "playoff odds" left to show — and a
        # sim.json from back when this season was still live would just
        # sit there forever, stale, once season_over flips true (this
        # block only ever regenerates it, never revisits an old one). Same
        # "stale file must not outlive its data source" rule as draft.json.
        (out_dir / "sim.json").unlink(missing_ok=True)

    # ---- roster.json (live roster cards, current season only) -------------
    # "Current roster" only means something for the season still being
    # played — a finished season has no live lineup to show, and the raw
    # league.json roster snapshot this reads doesn't reflect a past
    # season's roster anyway (it's always TODAY'S roster). Same
    # stale-file-must-not-outlive-its-data-source rule as sim.json/draft.json.
    if not league.season_over:
        cards = roster_card.build_roster_cards(season, league)
        if cards:
            _write(out_dir / "roster.json", {
                "generated_at": generated_at,
                "current_week": parse.current_fantasy_week(league),
                "teams": cards,
            })
        else:
            (out_dir / "roster.json").unlink(missing_ok=True)
    else:
        (out_dir / "roster.json").unlink(missing_ok=True)

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
            # regular season only — playoff teams play strictly more real
            # games than the field did all year, so letting a playoff week
            # set the all-time single-week record would be an unfair extra
            # shot at it purely for having stayed alive
            if s.matchup_period > league.reg_season_weeks:
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


def built_seasons() -> list[int]:
    """Every season with a real, already-built meta.json sitting in
    DATA_DIR — a superset of cached_seasons() whenever this run's
    ingest/.cache/ doesn't hold every season's raw league.json (e.g. a CI
    run whose actions/cache restore is stale, partial, or evicted: GitHub
    evicts caches over the 10GB repo cap or after 7 days unused, and this
    workflow's per-run unique cache key means storage only ever grows
    until that happens — 2026-08-29 confirmed live: seasons.json quietly
    shrank from all 15 real seasons down to just 3 over several automated
    runs, even though 2012-2023's own JSON files sat on disk untouched
    and correct the whole time, because seasons.json's own season list
    was built from cached_seasons() alone). Used ONLY for seasons.json's
    listing, not for all_seasons (badges/h2h aggregation genuinely needs
    a fresh cache-backed parse.load_league() per season, so those stay
    scoped to whatever's cache-available this run) — this makes the
    *listing* self-healing against a thin cache without ever silently
    computing cross-season stats from stale/partial data. build_season()
    is guarded elsewhere to never overwrite real per-season data with an
    empty result on a cache-miss run, so a season showing up here always
    has trustworthy JSON behind it, cache or no cache this run."""
    if not config.DATA_DIR.exists():
        return []
    return sorted(
        (int(p.name) for p in config.DATA_DIR.iterdir()
         if p.is_dir() and p.name.isdigit() and (p / "meta.json").exists()),
        reverse=True,
    )


def _season_summary(season: int) -> dict:
    """Read a season's seasons.json summary straight back off its own
    meta.json — used so seasons.json can always list every cached season,
    not just whichever ones this particular build run happened to rebuild."""
    with open(config.DATA_DIR / str(season) / "meta.json", encoding="utf-8") as f:
        meta = json.load(f)
    return {
        "season": season,
        "name": meta["name"],
        "completed_weeks": len(meta["completed_weeks"]),
        "season_over": meta["season_over"],
        "season_started": meta["season_started"],
    }


def _all_time_h2h(all_seasons: list[int]) -> list[dict]:
    """Every team pair's real all-time head-to-head record, aggregated
    across every cached season — regular season AND playoffs (a playoff
    meeting is still real history, no reason to exclude it). Keyed by
    team_id, which is stable across seasons for this league's real
    franchises. Reads straight from `parse.load_league()` (cache-backed,
    no network) rather than the just-written per-season JSON files, so
    this works the same whether it runs after a full rebuild or a
    single-season admin-tool rebuild — same convention `build_badges` and
    the ownership timeline already use for the same reason."""
    pairs: dict[tuple[int, int], dict[str, int]] = {}
    for season in all_seasons:
        league = parse.load_league(season)
        for e in league.full_schedule:
            if e.winner == "UNDECIDED" or e.away_id is None:
                continue
            a, b = sorted((e.home_id, e.away_id))
            rec = pairs.setdefault((a, b), {"a_wins": 0, "b_wins": 0, "ties": 0})
            a_is_home = e.home_id == a
            if e.winner == "TIE":
                rec["ties"] += 1
            elif (e.winner == "HOME") == a_is_home:
                rec["a_wins"] += 1
            else:
                rec["b_wins"] += 1
    return [
        {"team_a": a, "team_b": b, "a_wins": v["a_wins"], "b_wins": v["b_wins"], "ties": v["ties"]}
        for (a, b), v in sorted(pairs.items())
    ]


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

        # per-player box scores + transactions for the seasons ESPN's box-score
        # API still has full lineup/points data for, even though the box-score
        # web page stops displaying it — everything from 2024 on already comes
        # through fetch_season() above as the "current" season of its year.
        for year in HISTORICAL_BOXSCORE_YEARS:
            try:
                n = fetch.fetch_history_boxscores(year)
                if n:
                    print(f"  fetched {n} box-score week(s) for {year}")
            except Exception as e:  # noqa: BLE001
                print(f"  box scores {year} unavailable: {e}", file=sys.stderr)
            try:
                n = fetch.fetch_history_transactions(year)
                if n:
                    print(f"  fetched {n} transaction week(s) for {year}")
            except Exception as e:  # noqa: BLE001
                print(f"  transactions {year} unavailable: {e}", file=sys.stderr)

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

    # FantasyPros' consensus rank (ECR), not KTC's own redraft market — see
    # valuation.py's module docstring for why this switched 2026-08-28.
    print("Fetching redraft valuation data (FantasyPros ECR)..." if not args.offline else "Using cached redraft valuation data...")
    redraft_values, redraft_updated_at = valuation.fantasypros_redraft_values_by_name(offline=args.offline)
    if not redraft_values:
        print("  no redraft valuation data available — contend/rebuild spectrum will read 0 for the contending side", file=sys.stderr)

    # Same dynasty-rankings fetch as values_by_name() above (cached, no
    # extra request) — KTC lists future picks alongside players, so the
    # pick-value curve stays as live as the player values do instead of
    # only ever moving when someone hand-edits pick_values.json.
    pick_curves, pick_curves_updated_at = valuation.pick_curve_by_year(offline=args.offline)
    if not pick_curves:
        print("  no live pick-value curve available — falling back to the static pick_values.json curve", file=sys.stderr)

    # Same dynasty-rankings fetch again — KTC's playersArray carries `age`
    # right alongside value, so this is also free.
    player_ages, ages_updated_at = valuation.ages_by_name(offline=args.offline)
    if not player_ages:
        print("  no player age data available — player cards will show no age", file=sys.stderr)

    for season in seasons:
        print(f"Building {season}...")
        build_season(season, dynasty_values, valuation_updated_at, redraft_values, pick_curves)

    # cross-season aggregates always span every season on record, even when
    # --season restricted the per-season build loop above (e.g. the trade/
    # draft admin tools rebuild a single season on each submit) — otherwise
    # a one-season build would silently wipe every other season's badges
    build_badges(all_seasons)

    print("Building roster ownership timeline...")
    ownership_data = ownership.build_ownership(all_seasons)
    _write(config.DATA_DIR / "ownership.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        **ownership_data,
    })

    print("Building player ages...")
    _write(config.DATA_DIR / "player_ages.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": ages_updated_at,
        "ages": parse.ages_by_pid(player_ages),
    })

    print("Building trade grades...")
    _write(config.DATA_DIR / "trades.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        **trade_grades.grade_trades(dynasty_values, valuation_updated_at, ownership_data["stints"], pick_curves),
    })

    print("Building pick futures board...")
    latest_league = parse.load_league(max(all_seasons))
    latest_teams = list(latest_league.teams)
    all_pick_ownership = metrics.pick_ownership(0)  # unfiltered: every ledger entry on file
    pick_board = pick_tracking.all_picks_board(
        config.SEASON, latest_teams, DRAFT_ROUNDS, all_pick_ownership,
        horizon_years=PICK_FUTURES_HORIZON_YEARS)
    # Each pick's real market value (round-average of that draft season's KTC
    # curve), computed once here rather than left for every consumer to
    # re-derive — the deployed site's LM Tools (Trade Analyzer, Trade
    # Partners) have no backend to call `trade_analyzer_tool.py`'s
    # equivalent `_pick_value()` at request time, so it has to already be
    # sitting in the static JSON they read. Left unrounded: a team's pick
    # capital sums many of these, and rounding each pick first (rather than
    # the sum) would drift the total off by a few points versus the Python
    # reference implementation, which only ever rounds once, at the end.
    for p in pick_board:
        row = parse.pick_values_for_season(p["season"], pick_curves).get(str(p["round"]))
        p["value"] = sum(row) / len(row) if row else 0.0
    _write(config.DATA_DIR / "pick_futures.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "board": pick_board,
    })

    # Per-player dynasty/redraft value + eligible slots, scoped to whoever's
    # actually rostered in the latest season — the one piece of data the
    # deployed site's LM Tools (Positional Strength, Buy-Low Targets, Trade
    # Analyzer, Trade Partners) genuinely couldn't derive from anything else
    # already shipped: roster.json carries the roster shape, but never a
    # player's market value. Everything else those tools need (rosters,
    # starting_slots, pick values above, this league's own weekly scoring
    # for the buy-low dip check) was already static; this was the one real
    # gap, so it's the one new file rather than four separate ones.
    print("Building player values...")
    latest_rosters = parse.current_roster_players_with_position(latest_league.season)
    dynasty_by_pid = parse.values_by_pid(latest_league.season, dynasty_values)
    redraft_by_pid = parse.values_by_pid(latest_league.season, redraft_values)
    player_values: dict[str, dict] = {}
    for roster in latest_rosters.values():
        for pid, eligible_slots, position in roster:
            if pid in player_values:
                continue
            player_values[str(pid)] = {
                "dynasty": round(dynasty_by_pid.get(pid, 0.0), 0),
                "redraft": round(redraft_by_pid.get(pid, 0.0), 0),
                "position": position,
                "eligible_slots": sorted({parse.SLOT_NAMES.get(s, str(s)) for s in eligible_slots}),
            }
    _write(config.DATA_DIR / "player_values.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "season": latest_league.season,
        "valuation_updated_at": valuation_updated_at,
        "redraft_valuation_updated_at": redraft_updated_at,
        "players": player_values,
    })

    print("Building contend/rebuild spectrum...")
    _write(config.DATA_DIR / "spectrum.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "redraft_valuation_updated_at": redraft_updated_at,
        "teams": spectrum.contend_rebuild_spectrum(
            latest_teams, ownership_data["stints"], pick_board, dynasty_values, redraft_values,
            parse.current_roster_players(latest_league.season), latest_league.starting_slots,
            latest_league.season, pick_curves),
    })

    print("Building all-time head-to-head...")
    _write(config.DATA_DIR / "h2h.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pairs": _all_time_h2h(all_seasons),
    })

    # Always cover every cached season here, never just `seasons` (which is
    # only the current run's scope — a single season when --season was
    # passed, as every admin tool's rebuild subprocess does). A season this
    # run didn't touch still has a real meta.json on disk from whenever it
    # WAS last built, so read the summary back from there rather than
    # relying on this run's in-memory `summaries` — otherwise every
    # single-season admin rebuild (trade/draft/pick/draft-order submits)
    # silently collapsed this file down to just that one season, breaking
    # the season picker and every cross-season page (History, Draft, etc.)
    # that fans out over seasons.json's own list.
    #
    # Unioned with built_seasons() (see its docstring), not all_seasons
    # alone — otherwise a run whose ingest/.cache/ is thin (a cold/evicted
    # CI cache restore) silently shrinks this list down to whatever's
    # cache-fresh THIS run, even though every other season's real JSON is
    # still sitting on disk untouched and correct.
    seasons_for_index = sorted(set(all_seasons) | set(built_seasons()), reverse=True)
    all_summaries = [_season_summary(s) for s in seasons_for_index]
    _write(config.DATA_DIR / "seasons.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "default_season": config.SEASON if any(s["season"] == config.SEASON for s in all_summaries)
        else max(s["season"] for s in all_summaries),
        "seasons": all_summaries,
    })
    print("Build complete.")


if __name__ == "__main__":
    main()
