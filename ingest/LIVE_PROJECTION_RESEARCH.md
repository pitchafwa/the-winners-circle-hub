# Live in-game player projection — research notes (started 2026-09-13)

## The ask

Tommy wants League Hub to compute its own live, in-game "rest of game"
fantasy projection for a player, rather than relying on ESPN's frozen
pregame number (confirmed this session: ESPN's own `projected` field
never moves once a game starts — see BACKLOG.md's "Resolved" entry from
today). ESPN's iPhone app apparently does show a live-recalculating
number, but it comes from an app-only backend we can't reach (confirmed
this session too — the website's own network calls and the public
fantasy API both stay frozen at 13 for Drake London while the phone
reportedly showed 9.7 for the same player mid-game).

Tommy's own framing of the hard part, verbatim: fantasy points don't
accrue smoothly — "a player who starts the game with a 20 yard catch in
the first 10 seconds of the game isn't on pace for like 300 points." Any
naive "points-so-far ÷ time-elapsed × full game" pace model breaks
immediately on that case. This needs a real, defensible model, backtested
against real games, not a guess.

## Why naive approaches fail

- **Pace extrapolation** (points/minute × 60): explodes on any single
  early big play, and conversely reads a player as dead the moment they
  have a quiet first quarter, even if they're about to get a normal
  second-half workload. This is exactly the case Tommy named.
- **Freeze at pregame projection until the game's "likely over"** (what
  this app does today): safe, never embarrassing, but also never
  actually "live" — ignores real in-game signal that matters (blowout
  game script pulling a starter early, an injury mid-game, a workload
  shift because another player at the same position got hurt).

## Proposed approach: project remaining OPPORTUNITY, not remaining points, with shrinkage

Two separate problems, solved separately:

1. **How much more will this player's team even do, and how much of it
   goes to this player?** Not a points question — an *opportunity*
   question (targets, carries, red-zone looks). This is driven by real,
   observable game-state signals: time remaining, current score
   differential (trailing teams pass more / abandon the run; teams up
   big run more and rest starters late), and the pace of the game so far
   (plays run vs. league-average per-minute rate). A player's *share* of
   their team's remaining opportunities is itself mostly their pregame
   expected share, nudged by what's actually been observed so far this
   game.

2. **How efficient will they be per opportunity?** Also mostly their
   season per-touch rate, nudged by today's per-touch performance.

The nudge in both cases needs **shrinkage toward the pregame baseline**,
weighted by real sample size (number of targets/carries observed so far
this game), not by clock time. This is the direct fix for the "20-yard
catch in the first 10 seconds" case: one data point should move the
estimate almost nothing; the pull toward the live/observed rate should
only grow once there's an actual meaningful sample of plays for that
player this game (e.g. an empirical-Bayes / Beta-Binomial-style shrinkage
keyed to target/carry count, not minutes elapsed).

Final live projection = real points already scored + (expected remaining
opportunity share × remaining team plays × shrunk per-touch efficiency).

## Backtesting plan — real data, not vibes

Confirmed today: **nflverse's public play-by-play data is free, requires
no login, and has exactly what's needed** —
`https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{year}.csv.gz`
(also parquet). Each row is one real NFL play with `game_seconds_remaining`,
score differential, down/distance, and player attribution (receiver,
rusher, passer IDs) plus the play's real yardage/TD outcome. This lets us
replay any real historical game play-by-play and know EXACTLY what a
model would have projected at any checkpoint (25%/50%/75% through the
game) versus what actually ended up happening — real backtestable ground
truth, not a guess.

nflverse also publishes an ID crosswalk file (nflverse `ff_playerids` /
`player_ids` — maps their GSIS ids to ESPN's player ids), needed to join
this to our own player_id space.

**Backtest design**:
- Pull several full seasons of real play-by-play (2023-2025 are all
  available at that URL — enough games for a real sample).
- Replay each game; at each checkpoint, compute what (a) our new model,
  (b) naive pace-extrapolation, and (c) "frozen at pregame" would have
  projected for every skill player's REST of that game.
- Compare each against the real rest-of-game outcome (mean absolute
  error, and specifically check the early-big-play distortion case
  Tommy named — does the naive model blow up on it, does ours not).
- Only ship a formula that demonstrably beats the current "freeze"
  baseline on real held-out games — otherwise the freeze approach is
  still defensible and simpler.

## Scope reality check

This is a real, multi-step feature, not a quick add:
1. New ingest step: download + cache relevant nflverse play-by-play
   (historical, for backtesting) and figure out how to get equivalent
   real-time play-by-play for the CURRENT live week (nflverse's live/
   near-real-time feed, or another source — this needs checking; the
   historical release files are not live).
2. Build the crosswalk from nflverse GSIS ids to the ESPN player ids
   this app already uses everywhere.
3. Prototype the opportunity-share + shrinkage model above.
4. Build the backtest harness described above against real historical
   games; iterate on the model using real error numbers, not guesses.
5. Only once backtested and defensible: wire the live version into
   `simulate.py`'s `this_week_matchups`, replacing/supplementing
   `optimal_week_projection`'s current `max(actual, projected)` /
   "trust actual once likely-over" logic.

## Live data source found (2026-09-13) — solves the "current week" gap above

Tommy found a real Reddit thread (r/fantasyfootballcoding) of other
developers solving this exact problem. One dead end, one real find:

- **Tank01/NFL's own API**: needs credentials, not pursued.
- **The real find**: ESPN publishes a completely separate, PUBLIC,
  no-login API for its regular (non-fantasy) sports site —
  `site.web.api.espn.com` — distinct from the private
  `fantasy.espn.com` league API this app already uses (which needs the
  `ESPN_S2`/`SWID` cookies). Confirmed live, right now, mid-Sunday:
  - `GET .../apis/site/v2/sports/football/nfl/scoreboard` → today's
    games with real ESPN event ids and live status.
  - `GET .../apis/site/v2/sports/football/nfl/summary?event={id}` → the
    full live game payload for one game: `drives` (every drive this
    game, each with its own `plays[]` — real down/distance/clock/score
    state per play, exactly the game-script signal the model needs),
    `winprobability` (ESPN's own live win-probability, one entry per
    play — a ready-made "how is this game trending" signal, for free),
    and `boxscore.players` — **real-time cumulative per-player stat
    lines** (passing/rushing/receiving/fumbles/etc.), refreshed as the
    game happens.
  - **Confirmed the player-id space matches exactly**: Baker Mayfield's
    id in this public endpoint's `boxscore.players` (`3052587`) is
    byte-for-byte the same id our own `sim.json` already uses for him.
    **No id crosswalk needed at all** — this eliminates an entire step
    from the plan below. Makes sense in hindsight: ESPN uses one athlete
    id space across its whole product line, fantasy included.
  - This also directly answers the "how do we get CURRENT-WEEK live
    play-by-play" gap flagged below as unconfirmed — this endpoint IS
    that source, and it's free/public/no rate-limit-key-required (same
    politeness/backoff handling `fetch.py` already has for the private
    API should still be applied here to be a good citizen, but no
    special access is needed).

**Real caveats from that same thread** (another dev, `johnny-papercut`,
already built something similar against this exact endpoint and hit
real problems worth planning around, not re-discovering the hard way):
  - Stats are sometimes just wrong, mostly on IDP tackles/passes
    defended — likely low-impact for this league (standard offensive
    scoring, no IDP).
  - **Missing from this feed entirely: forced fumbles, and 2-point
    conversions for passer/receiver/rusher** — have to be parsed out of
    the drive `plays[].text` strings by hand (e.g. "...2-point
    conversion..." pattern matching), not available as a clean stat.
  - **Fumble recovery attribution is broken** — recovery counts are
    "weird," and a player can get credited a recovery even when it was
    their OWN team that fumbled (would incorrectly award IDP points;
    lower-stakes for a non-IDP league, but still worth a sanity check
    against `boxscore.players`' fumbles group before trusting it).
  - Given this league's real scoring settings only use forced fumbles /
    fumble recoveries for defense/IDP-adjacent categories (need to
    re-check `league.scoring_settings` to confirm exact impact), these
    gaps may matter less here than they did for that Reddit poster's
    general-purpose multi-league tool — but don't assume, verify against
    this league's real settings before shipping.

## Next steps (pick up here)

- [ ] Confirm this league's real scoring settings don't lean heavily on
      the stat categories this feed gets wrong/misses (forced fumbles,
      2-point conversions, fumble recovery attribution) — check
      `league.scoring_settings` (already fetched, see `parse.py`).
- [ ] Poll this endpoint for one full live game start-to-finish (a
      Thursday or early Sunday window) at the same ~cadence we'd run in
      production, and diff `boxscore.players` snapshots over time to
      confirm per-player stat deltas make sense and land in a reasonable
      timeframe after real plays happen (i.e. how "live" is it really).
  - [ ] Decide whether to still pull nflverse's free historical
      play_by_play (`play_by_play_{year}.csv.gz`, confirmed downloadable
      2026-09-13) for BACKTESTING specifically — it's a different,
      already-labeled, easier-to-bulk-process dataset for replaying past
      seasons than re-deriving the same thing from ESPN's live endpoint
      after the fact. The two sources can coexist: ESPN's public API for
      live production data, nflverse for offline backtesting against
      real historical games.
- [ ] Build the backtest harness against 2-3 historical seasons (via
      nflverse) to validate the opportunity-share + shrinkage model
      proposed above against real games before shipping any formula.
- [ ] Prototype and tune the shrinkage model against real backtest error.
- [ ] Write a small parser for the drive `plays[].text` strings to catch
      2-point conversions and forced fumbles (the two real gaps in the
      structured stat data), if this league's scoring settings need them.
