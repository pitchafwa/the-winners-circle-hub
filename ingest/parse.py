"""Parse raw cached ESPN JSON into plain structures for the metrics layer.

Reads only from .cache/ — no network. This keeps fetch (network) and metrics
(math) fully decoupled: the build can rerun offline from cache.

Slot IDs (ESPN lineupSlotId / eligibleSlots):
    0 QB, 2 RB, 3 RB/WR, 4 WR, 6 TE, 7 OP, 16 D/ST, 17 K,
    20 Bench, 21 IR, 23 FLEX (RB/WR/TE)
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import config

SLOT_NAMES = {
    0: "QB", 1: "TQB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE",
    7: "OP", 8: "DT", 9: "DE", 10: "LB", 11: "DL", 12: "CB", 13: "S",
    14: "DB", 15: "DP", 16: "D/ST", 17: "K", 18: "P", 19: "HC",
    20: "BE", 21: "IR", 22: "", 23: "FLEX", 24: "ER", 25: "Rookie",
}
BENCH_SLOT = 20
IR_SLOT = 21
NON_STARTING = {BENCH_SLOT, IR_SLOT}

POSITION_NAMES = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST"}


@dataclass
class PlayerWeek:
    player_id: int
    name: str
    position: str            # primary position (QB/RB/WR/TE/K/D/ST)
    slot_id: int             # where they were actually slotted this week
    eligible_slots: frozenset[int]
    actual: float            # 0.0 if they did not play — real, not fabricated
    played: bool             # False = no actual stat line existed (bye/DNP)
    projected: float | None  # None if ESPN had no projection
    pro_team_id: int = 0     # NFL team id — used to find this player's game day

    @property
    def started(self) -> bool:
        return self.slot_id not in NON_STARTING

    @property
    def slot_name(self) -> str:
        return SLOT_NAMES.get(self.slot_id, str(self.slot_id))


@dataclass
class TeamWeek:
    team_id: int
    week: int
    total: float             # official score: lineup + home bonus + adjustment
    lineup: list[PlayerWeek]
    is_home: bool = False
    home_bonus: float = 0.0  # league home-field bonus applied this week
    adjustment: float = 0.0  # manual commissioner adjustment

    @property
    def lineup_points(self) -> float:
        """What the starters actually produced — the basis for coach ratings."""
        return round(self.total - self.home_bonus - self.adjustment, 2)

    def starters(self) -> list[PlayerWeek]:
        return [p for p in self.lineup if p.started]

    def bench(self) -> list[PlayerWeek]:
        return [p for p in self.lineup if p.slot_id == BENCH_SLOT]


@dataclass
class MatchupWeek:
    week: int
    matchup_period: int
    home: TeamWeek
    away: TeamWeek | None    # None = bye
    is_playoff: bool
    playoff_tier: str        # NONE / WINNERS_BRACKET / LOSERS_CONSOLATION_LADDER / ...
    winner: str              # HOME / AWAY / TIE / UNDECIDED


@dataclass
class ActivityEvent:
    date: int                # ms epoch
    week: int                # scoring period the transaction executed in
    action: str              # FA_ADDED / WAIVER_ADDED / DROPPED / TRADED
    team_id: int
    player_id: int
    bid: int = 0             # FAAB/waiver bid where applicable
    to_team_id: int | None = None   # trades only: receiving team


@dataclass
class TeamInfo:
    team_id: int
    name: str
    abbrev: str
    logo: str
    owner: str
    division_id: int
    # Official ESPN record data (source of truth for standings)
    wins: int = 0
    losses: int = 0
    ties: int = 0
    points_for: float = 0.0
    points_against: float = 0.0
    division_wins: int = 0
    division_losses: int = 0
    division_ties: int = 0
    streak_type: str = ""
    streak_length: int = 0
    playoff_seed: int = 0
    final_rank: int = 0       # 0 until the season is over


@dataclass
class ScheduleEntry:
    """One matchup from the full-season schedule, played or not."""
    matchup_period: int
    home_id: int
    away_id: int | None       # None = bye
    winner: str               # HOME / AWAY / TIE / UNDECIDED
    home_score: float
    away_score: float
    is_playoff: bool
    playoff_tier: str


@dataclass
class LeagueData:
    season: int
    name: str
    team_count: int
    reg_season_weeks: int
    playoff_team_count: int
    playoff_seeding_rule: str
    home_team_bonus: float
    playoff_home_team_bonus: float
    starting_slots: list[int]          # slot ids with multiplicity, e.g. [0,2,2,3,4,4,6,16,17,23]
    teams: dict[int, TeamInfo]
    weeks: dict[int, list[MatchupWeek]]           # completed weeks only
    divisions: dict[int, str] = field(default_factory=dict)
    full_schedule: list[ScheduleEntry] = field(default_factory=list)  # every matchup period
    activity: list[ActivityEvent] = field(default_factory=list)   # newest first
    adds: dict[tuple[int, int], list[int]] = field(default_factory=dict)
    # adds[(team_id, player_id)] = [dates ms] of FA/waiver pickups by that team
    week_end_dates: dict[int, int] = field(default_factory=dict)  # week -> last game start (ms)
    # league status
    current_matchup_period: int = 0
    scoring_period_id: int = 0
    first_scoring_period: int = 1
    final_scoring_period: int = 17
    previous_seasons: list[int] = field(default_factory=list)
    fetched_at: str = ""

    @property
    def season_over(self) -> bool:
        # Archived leagueHistory snapshots freeze scoring_period_id at the
        # last period that existed rather than ticking past it like a live
        # league does, so scoring_period_id == final_scoring_period forever
        # for any past season — the > comparison below never fires for them.
        # Any season before the one currently being tracked is unambiguously
        # over regardless, so short-circuit on that first.
        if self.season < config.SEASON:
            return True
        return self.scoring_period_id > self.final_scoring_period

    def completed_weeks(self) -> list[int]:
        return sorted(self.weeks.keys())

    def regular_weeks(self) -> list[int]:
        return [w for w in self.completed_weeks() if w <= self.reg_season_weeks]

    def team_week(self, team_id: int, week: int) -> TeamWeek | None:
        for m in self.weeks.get(week, []):
            if m.home.team_id == team_id:
                return m.home
            if m.away is not None and m.away.team_id == team_id:
                return m.away
        return None


def _season_dir(season: int) -> Path:
    return config.CACHE_DIR / str(season)


def pro_game_dates(season: int, week: int) -> dict[int, int]:
    """NFL team id -> that team's game kickoff (ms epoch) for one scoring
    period, from the cached pro schedule. Only ever cached for the season
    fetched live via connect() (fetch_season() -> fetch_pro_schedule_raw),
    never for leagueHistory seasons — so this is empty for any season built
    entirely from fetch_history_raw. Fine: it's only used to explain a week
    that just happened, never for stats on a season long over."""
    path = _season_dir(season) / "proschedule.json"
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        pro_teams = json.load(f)["data"]["settings"]["proTeams"]
    dates: dict[int, int] = {}
    for pt in pro_teams:
        games = pt.get("proGamesByScoringPeriod", {}).get(str(week))
        if games:
            dates[pt["id"]] = games[0]["date"]
    return dates


def owner_aliases() -> dict[int, list[str]]:
    """team_id -> real names/nicknames league members use instead of team names."""
    path = config.ROOT / "ingest" / "owner_aliases.json"
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        raw = json.load(f).get("aliases", {})
    return {int(k): v for k, v in raw.items()}


def pick_values_for_season(season: int) -> dict[str, list[float]]:
    """Standardized draft-pick value curve for one draft season — round (as
    a string key) -> list of 12 values, index 0 = pick 1. See
    ingest/pick_values.json for the full story on why this is a fixed
    external snapshot (KeepTradeCut's real rookie-pick trade market) rather
    than anything derived from this league's own data.

    Genuinely year-specific where KTC's real futures market supports it;
    falls back to the nearest year on file otherwise (clamped, not
    extrapolated) — every draft this league actually has predates the
    earliest year on file, so in practice this always clamps low today, but
    the clamp works both directions as more years get added over time."""
    path = config.ROOT / "ingest" / "pick_values.json"
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        by_year = json.load(f).get("values", {})
    if not by_year:
        return {}
    years = sorted(int(y) for y in by_year)
    clamped = min(max(season, years[0]), years[-1])
    nearest = min(years, key=lambda y: abs(y - clamped))
    return by_year[str(nearest)]


def global_player_names() -> dict[int, str]:
    """id -> name from the cached NFL-wide player list."""
    path = config.CACHE_DIR / "players.json"
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return {int(k): v for k, v in json.load(f).get("names", {}).items() if v}


def _normalize_name(name: str) -> str:
    n = name.lower().strip()
    for junk in (".", "'", "’", ","):
        n = n.replace(junk, "")
    for suffix in (" jr", " sr", " iii", " ii", " iv", " v"):
        n = n.removesuffix(suffix)
    return " ".join(n.split())


def team_key_index(teams: dict[int, "TeamInfo"]) -> dict[str, int]:
    """normalized team name/abbrev/id/real-name-nickname -> team_id. Shared by
    every manual-entry importer so 'the team is unresolved' means the same
    thing everywhere."""
    by_key: dict[str, int] = {}
    for t in teams.values():
        by_key[_normalize_name(t.name)] = t.team_id
        if t.abbrev:
            by_key[_normalize_name(t.abbrev)] = t.team_id
        by_key[str(t.team_id)] = t.team_id
    for tid, nicknames in owner_aliases().items():
        for nick in nicknames:
            by_key[_normalize_name(nick)] = tid
    return by_key


def player_key_index(names: dict[int, str]) -> dict[str, int]:
    """normalized player name -> player_id."""
    return {_normalize_name(n): pid for pid, n in names.items()}


def load_manual_draft(season: int, teams: dict[int, "TeamInfo"],
                      names: dict[int, str]) -> tuple[list[dict], list[str]]:
    """Hand-entered rookie draft from ingest/manual_draft/{season}.csv or .json.

    This dynasty league drafts offline (text message), so ESPN's mDraftDetail
    is really the keeper import and useless for grading. CSV columns:
    round,pick,team,player — team by name, abbrev, or id; player by name.
    Returns (picks, problems). Unmatched names are reported, never guessed.
    """
    base = config.ROOT / "ingest" / "manual_draft"
    problems: list[str] = []
    rows: list[dict] = []

    json_path = base / f"{season}.json"
    csv_path = base / f"{season}.csv"
    if json_path.exists():
        with open(json_path, encoding="utf-8") as f:
            rows = json.load(f).get("picks", [])
    elif csv_path.exists():
        import csv

        with open(csv_path, encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                rows.append({k.lower().strip(): (v or "").strip() for k, v in r.items()})
    else:
        return [], []

    by_team_key = team_key_index(teams)
    by_player_name = player_key_index(names)

    picks: list[dict] = []
    for i, r in enumerate(rows, start=1):
        team_raw = str(r.get("team", "")).strip()
        player_raw = str(r.get("player", "")).strip()
        team_id = by_team_key.get(_normalize_name(team_raw))
        if team_id is None:
            problems.append(f"pick {i}: unknown team '{team_raw}'")
            continue
        player_id = by_player_name.get(_normalize_name(player_raw))
        if player_id is None:
            problems.append(f"pick {i}: unmatched player '{player_raw}'")
        picks.append({
            "overall": int(r.get("overall") or i),
            "round": int(r.get("round") or 0),
            "round_pick": int(r.get("pick") or 0),
            "team_id": team_id,
            "player_id": player_id,          # None = unmatched, surfaced in UI
            "player_name_raw": player_raw,
            "keeper": False,
            "bid": 0,
        })
    picks.sort(key=lambda x: (x["round"], x["round_pick"], x["overall"]))
    for i, p in enumerate(picks, start=1):
        if not p["overall"]:
            p["overall"] = i
    return picks, problems


def roster_player_names(season: int | None = None) -> dict[int, str]:
    """player_id -> name from the current rosters in league.json — the only
    name source before any games are played (preseason adds/drops/trades)."""
    season = season or config.SEASON
    raw = _load(season, "league")
    names: dict[int, str] = {}
    if not raw:
        return names
    for t in raw.get("teams", []):
        for e in t.get("roster", {}).get("entries", []):
            player = (e.get("playerPoolEntry") or {}).get("player") or {}
            if "id" in player and "fullName" in player:
                names[player["id"]] = player["fullName"]
    return names


def _load(season: int, name: str):
    path = _season_dir(season) / f"{name}.json"
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)["data"]


def _parse_player(entry: dict, week: int) -> PlayerWeek | None:
    ppe = entry.get("playerPoolEntry")
    if not ppe:
        return None
    player = ppe["player"]

    actual, played, projected = 0.0, False, None
    for stat in player.get("stats", []):
        if stat.get("scoringPeriodId") != week or stat.get("statSplitTypeId") != 1:
            continue
        if stat.get("statSourceId") == 0:
            actual = round(stat.get("appliedTotal", 0.0), 2)
            played = True
        elif stat.get("statSourceId") == 1:
            projected = round(stat.get("appliedTotal", 0.0), 2)

    return PlayerWeek(
        player_id=player["id"],
        name=player.get("fullName", f"Player {player['id']}"),
        position=POSITION_NAMES.get(player.get("defaultPositionId", 0), "?"),
        slot_id=entry.get("lineupSlotId", BENCH_SLOT),
        eligible_slots=frozenset(player.get("eligibleSlots", [])),
        actual=actual,
        played=played,
        projected=projected,
        pro_team_id=player.get("proTeamId", 0),
    )


def _parse_side(side: dict, week: int, is_home: bool, home_bonus: float) -> TeamWeek:
    entries = side.get("rosterForCurrentScoringPeriod", {}).get("entries", [])
    lineup = [p for e in entries if (p := _parse_player(e, week)) is not None]
    return TeamWeek(
        team_id=side["teamId"],
        week=week,
        total=round(side.get("totalPoints", 0.0), 2),
        lineup=lineup,
        is_home=is_home,
        home_bonus=home_bonus if is_home else 0.0,
        adjustment=round(side.get("adjustment", 0.0), 2),
    )


def load_league(season: int | None = None) -> LeagueData:
    season = season or config.SEASON
    raw = _load(season, "league")
    if raw is None:
        raise FileNotFoundError(f"No cached league.json for {season} — run fetch first")

    settings = raw["settings"]
    slot_counts = settings["rosterSettings"]["lineupSlotCounts"]
    starting_slots = []
    for slot_id_str, count in sorted(slot_counts.items(), key=lambda kv: int(kv[0])):
        slot_id = int(slot_id_str)
        if slot_id in NON_STARTING or count <= 0:
            continue
        starting_slots.extend([slot_id] * count)

    members = {m["id"]: m.get("displayName", "?") for m in raw.get("members", [])}
    teams = {}
    for t in raw["teams"]:
        owners = [members.get(o, "?") for o in t.get("owners", [])]
        rec = t.get("record", {}).get("overall", {})
        div_rec = t.get("record", {}).get("division", {})
        teams[t["id"]] = TeamInfo(
            team_id=t["id"],
            name=t.get("name") or f"{t.get('location', '')} {t.get('nickname', '')}".strip(),
            abbrev=t.get("abbrev", ""),
            logo=t.get("logo", ""),
            owner=", ".join(owners),
            division_id=t.get("divisionId", 0),
            wins=rec.get("wins", 0),
            losses=rec.get("losses", 0),
            ties=rec.get("ties", 0),
            points_for=round(rec.get("pointsFor", 0.0), 2),
            points_against=round(rec.get("pointsAgainst", 0.0), 2),
            division_wins=div_rec.get("wins", 0),
            division_losses=div_rec.get("losses", 0),
            division_ties=div_rec.get("ties", 0),
            streak_type=rec.get("streakType", ""),
            streak_length=rec.get("streakLength", 0),
            playoff_seed=t.get("playoffSeed", 0),
            final_rank=t.get("rankCalculatedFinal", 0),
        )

    schedule_settings = settings["scheduleSettings"]
    scoring_settings = settings.get("scoringSettings", {})
    league = LeagueData(
        season=season,
        name=settings["name"],
        team_count=settings["size"],
        reg_season_weeks=schedule_settings["matchupPeriodCount"],
        playoff_team_count=schedule_settings["playoffTeamCount"],
        playoff_seeding_rule=schedule_settings["playoffSeedingRule"],
        home_team_bonus=scoring_settings.get("homeTeamBonus", 0) or 0,
        playoff_home_team_bonus=scoring_settings.get("playoffHomeTeamBonus", 0) or 0,
        starting_slots=starting_slots,
        teams=teams,
        weeks={},
    )
    league.divisions = {d.get("id", 0): d.get("name", "") for d in schedule_settings.get("divisions", [])}

    status = raw.get("status", {})
    league.current_matchup_period = status.get("currentMatchupPeriod", 0)
    league.scoring_period_id = raw.get("scoringPeriodId", 0)
    league.first_scoring_period = status.get("firstScoringPeriod", 1)
    league.final_scoring_period = status.get("finalScoringPeriod", 17)
    league.previous_seasons = [y for y in status.get("previousSeasons", []) if y < season]

    with open(_season_dir(season) / "league.json", encoding="utf-8") as f:
        league.fetched_at = json.load(f).get("fetched_at", "")

    # Full-season schedule, played or not (upcoming matchups, H2H history)
    for m in raw.get("schedule", []):
        home = m.get("home", {})
        away = m.get("away")
        if not home:
            continue
        if m.get("matchupPeriodId", 0) > config.FINAL_COUNTED_WEEK:
            continue
        tier = m.get("playoffTierType", "NONE")
        league.full_schedule.append(ScheduleEntry(
            matchup_period=m.get("matchupPeriodId", 0),
            home_id=home.get("teamId"),
            away_id=away.get("teamId") if away else None,
            winner=m.get("winner", "UNDECIDED"),
            home_score=round(home.get("totalPoints", 0.0), 2),
            away_score=round(away.get("totalPoints", 0.0), 2) if away else 0.0,
            is_playoff=tier != "NONE",
            playoff_tier=tier,
        ))

    # Completed weeks — whatever box-score caches exist, capped at the last
    # week this league counts (week 17 is dead to us)
    for path in sorted(_season_dir(season).glob("boxscores-week*.json")):
        week = int(path.stem.replace("boxscores-week", ""))
        if week > config.FINAL_COUNTED_WEEK:
            continue
        box = _load(season, f"boxscores-week{week}")
        matchups = []
        for m in box.get("schedule", []):
            if m.get("winner") == "UNDECIDED":
                continue
            if "home" not in m:
                continue
            tier = m.get("playoffTierType", "NONE")
            bonus = league.playoff_home_team_bonus if tier != "NONE" else league.home_team_bonus
            home = _parse_side(m["home"], week, is_home=True, home_bonus=bonus)
            away = _parse_side(m["away"], week, is_home=False, home_bonus=0.0) if "away" in m else None
            matchups.append(MatchupWeek(
                week=week,
                matchup_period=m.get("matchupPeriodId", week),
                home=home,
                away=away,
                is_playoff=tier != "NONE",
                playoff_tier=tier,
                winner=m.get("winner", "UNDECIDED"),
            ))
        if matchups:
            league.weeks[week] = matchups

    # Transaction history (for Waiver Hero and the activity feed)
    for path in sorted(_season_dir(season).glob("transactions-week*.json")):
        week = int(path.stem.replace("transactions-week", ""))
        raw_tx = _load(season, f"transactions-week{week}")
        for tx in raw_tx.get("transactions", []):
            if tx.get("status") != "EXECUTED":
                continue
            date = tx.get("processDate") or tx.get("proposedDate") or 0
            tx_type = tx.get("type")
            for item in tx.get("items", []):
                item_type = item.get("type")
                if item_type == "ADD" and tx_type in ("FREEAGENT", "WAIVER"):
                    action = "WAIVER_ADDED" if tx_type == "WAIVER" else "FA_ADDED"
                    ev = ActivityEvent(date=date, week=week, action=action,
                                       team_id=item.get("toTeamId") or tx.get("teamId"),
                                       player_id=item["playerId"],
                                       bid=tx.get("bidAmount", 0) if tx_type == "WAIVER" else 0)
                    league.activity.append(ev)
                    league.adds.setdefault((ev.team_id, ev.player_id), []).append(date)
                elif item_type == "DROP":
                    league.activity.append(ActivityEvent(
                        date=date, week=week, action="DROPPED",
                        team_id=item.get("fromTeamId") or tx.get("teamId"),
                        player_id=item["playerId"]))
                elif tx_type == "TRADE_ACCEPT":
                    league.activity.append(ActivityEvent(
                        date=date, week=week, action="TRADED",
                        team_id=item.get("fromTeamId") or tx.get("teamId"),
                        player_id=item["playerId"],
                        to_team_id=item.get("toTeamId")))
    league.activity.sort(key=lambda e: -e.date)

    # The league-view schedule omits playoffTierType — patch tiers in from the
    # box-score data so consolation games are identifiable everywhere
    tier_by_matchup: dict[tuple[int, int | None, int | None], tuple[str, bool]] = {}
    for week, matchups in league.weeks.items():
        for m in matchups:
            key = (m.matchup_period, m.home.team_id, m.away.team_id if m.away else None)
            tier_by_matchup[key] = (m.playoff_tier, m.is_playoff)
    for s in league.full_schedule:
        hit = tier_by_matchup.get((s.matchup_period, s.home_id, s.away_id))
        if hit:
            s.playoff_tier, s.is_playoff = hit

    # Week-end dates from the pro schedule (last game start per scoring period)
    pro = _load(season, "proschedule")
    if pro:
        for team in pro.get("settings", {}).get("proTeams", []):
            for period, games in team.get("proGamesByScoringPeriod", {}).items():
                for g in games:
                    w = int(period)
                    league.week_end_dates[w] = max(league.week_end_dates.get(w, 0), g.get("date", 0))

    return league
