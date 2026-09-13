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

## Scope pivot (2026-09-13): compute OUR OWN live scores, not just live projections

Tommy's own read, after seeing this public feed exists: rather than only
using it as an input signal to a projection MODEL, just use it to
compute this league's real fantasy points ourselves directly — we
already know this league's exact scoring rules, so there's no reason to
keep depending on the private fantasy API's own (slow, cookie-gated,
~15-minute-cadence) `actual` score at all. Both the "what's the real
score right now" number and the eventual "live projection" can be built
on the same free, fast, public feed. Agreed and built out below.

### `ingest/scoring.py` — built and validated (2026-09-13)

Computes this league's real fantasy points from raw per-statId counts,
using the league's actual cached `scoringSettings.scoringItems`
(46 real rules, including D/ST tiers and position-specific overrides).

**Validated against every real player-week ESPN has ever scored for this
league across 2024 and 2025 — 5,312 player-weeks, exact match (within
float rounding) in 100% of cases.** The key discovery that made this
simple: ESPN's raw per-statId stat counts in the PRIVATE feed are
already the exact scoring unit for bucketed categories (e.g. the raw
value at statId 28 is already `floor(rushingYards / 10)`, not the raw
yardage) — so scoring from the private feed's raw stats is purely
linear, `raw_count * points_per_unit` summed, no bucketing math needed
on our end there at all.

### `ingest/live_public_stats.py` — built and validated (2026-09-13)

Translates the PUBLIC feed's `boxscore.players` (named stat groups, not
pre-bucketed like the private feed) into the same statId-space
`scoring.py` expects, for skill positions (passing/rushing/receiving/
fumbles) so far.

- **Empirically confirmed the real yards-per-point divisors** (don't
  have to guess): compared the private feed's own pre-bucketed statId
  (e.g. 28) against its plain yardage stat (e.g. 24) across thousands of
  real 2024-2025 samples. Confirmed exact: passing 1 point per 25 yards,
  rushing and receiving both 1 point per 10 yards.
- **Found and fixed a real bug via validation, not by inspection**:
  Python's `//` floors toward -infinity, so a player with negative
  rushing yards (a QB kneel, a busted scramble) was getting docked an
  extra point it shouldn't have (`-3 // 10 == -1`, when the correct
  bucket is 0). Caught because Matthew Stafford's computed score came
  out 1 point below the real, already-known-correct number — exactly
  the kind of quiet, plausible-looking error this validate-against-
  reality approach exists to catch. Fixed with a proper
  truncate-toward-zero bucket function.
- **End-to-end validated against two real, fully-finished games from
  today** (Rams @ 49ers, Patriots @ Seahawks) — pulled the public feed's
  raw box score for every one of this league's rostered skill players in
  those games (9 players: Puka Nacua, Matthew Stafford, Davante Adams,
  Kyren Williams, Christian McCaffrey, Mike Evans, Rhamondre Stevenson,
  A.J. Brown, Jaxon Smith-Njigba), ran them through
  `live_public_stats.py` → `scoring.py`, and compared against each
  player's real, already-known-correct fantasy score. **9 for 9 exact
  matches.** This is now a proven, working pipeline for offensive skill
  positions — public feed in, our own correctly-scored fantasy points
  out, matching ESPN's own number exactly.
- **Confirmed NOT needed for this league**: forced fumbles (statId 106)
  has zero points in this league's real scoring settings — one of the
  Reddit thread's flagged gaps in this feed turns out not to matter
  here at all.

### `ingest/live_public_dst_kicking.py` — built and validated (2026-09-13)

D/ST turned out simpler than planned once the real team-level stat shape
was actually inspected — no play-by-play scanning needed at all:

- **D/ST is fully derivable from `boxscore.teams` alone.** A team's
  "yards allowed" is just the OPPONENT's own `totalYards` in the same
  game; "points allowed" is the opponent's own score. Sacks/interceptions/
  fumble-recoveries credited to a defense are the OPPONENT's own conceded
  numbers (confirmed real, not inferred: ESPN's own team-stat block lists
  "interceptions" under two entries with the IDENTICAL label
  "Interceptions thrown" — an actual duplicate in their feed, not a
  separate "defensive interceptions" stat, so the opponent's thrown-INT
  count IS the right number to credit). Defensive/special-teams
  touchdowns are given directly per-team (`defensiveTouchdowns`) — didn't
  even need to scan for pick-sixes/fumble-return TDs individually, much
  simpler than the original plan.
- **Validated exact against the one real answer available**: LAR's D/ST
  (Rams, today's finished game) computed to 1.0 points — matching the
  already-known-correct value exactly.
- **This league's real points-allowed/yards-allowed tier ladders have
  genuine gaps**, confirmed by dumping every one of the league's 46 real
  scoring rules directly rather than assuming a standard template: no
  rule exists at all for 18-27 points allowed, or for 300-349 yards
  allowed. Those ranges correctly score 0 now, matching what's actually
  configured — almost got this wrong by assuming a continuous ladder.

- **Kicker: built and validated against 2 real kickers, both exact
  matches** (Harrison Mevis 1.0, Jason Myers 7.0). Made-field-goal
  distance turned out NOT to need play-text parsing after all — each
  field-goal `scoringPlays` entry carries a clean `statYardage` field...
  except when it doesn't: found this missing/null on a second real game
  checked during validation (Patriots @ Seahawks) despite the exact same
  distance being present in that play's `text` ("Jason Myers 30 Yd Field
  Goal") — so `made_field_goal_distance()` tries the structured field
  first and falls back to parsing text, since real data proved neither
  alone was reliable.
- Confirmed **statId 198 = the 50-59 yard field goal tier** — a real gap
  in espn_api's own community-maintained stat map (jumps straight from
  40-49 to 60+) — inferred from this league's own tier progression
  (<40=3pts, 40-49=4pts, 198=5pts, 60+=6pts) and confirmed consistent
  once a real 50-yard make (Andy Borregales, NE) scored exactly 5+1=6.

### Still not built — no real example seen yet to validate against

- **2-point conversions**: confirmed still missing from this feed's
  structured stats entirely (matches what the Reddit thread flagged) —
  this league DOES score these (2 points each, passing/rushing/
  receiving all nonzero in real settings). No 2-point conversion has
  happened in any game checked so far this week, so there's nothing real
  to validate a parser against yet — would need `drives[].plays[].text`
  parsing once one occurs.
- **Blocked kicks and safeties** (statId 97, 98): not present as a direct
  team-level stat in this feed, and neither occurred in any live game
  checked while building this. Same situation as 2-point conversions —
  flagged rather than guessed at, pick up once a real example exists.

## Next steps (pick up here)

- [x] ~~Build the D/ST team-defense scoring piece~~ — done, validated.
- [x] ~~Build kicker scoring~~ — done, validated.
- [ ] Build the `drives[].plays[].text` parser for 2-point conversions
      and blocked-kicks/safeties, once a real example of each occurs in a
      live game to validate the parser against — don't ship unvalidated
      text-parsing for rare events.
- [x] ~~Validate a FULL real team's live score~~ — done via the full
      integration test below, not just one team: ran the real
      `simulate.run()` with a live override applied against all of this
      week's rostered players and confirmed 12 known-correct real scores
      (across every position type) came out exact through the actual
      production code path.
- [x] ~~Wire this into the actual live build pipeline~~ — done.
      `ingest/live_score.py` orchestrates the whole week into one
      {player_id: points} dict; `parse.optimal_week_projection()` takes
      an optional `live_score_override` param, applied only while a
      player's game is genuinely still in progress (once a game's over,
      ESPN's own official number wins — the reconciliation behavior
      Tommy already decided, 2026-09-13); threaded through
      `simulate.run()` and called from `build.py`, gated on the live
      current week and skipped entirely in `--offline` mode (caught and
      fixed a real bug during testing where the live fetch was firing
      even with `--offline` before this gate existed), wrapped
      defensively so a hiccup in this external feed falls back to the
      private feed's own slower numbers rather than breaking the build.
- [ ] THEN: revisit the original "live projection" model (opportunity-
      share + shrinkage, backtested via nflverse's free historical
      play-by-play, `play_by_play_{year}.csv.gz` — confirmed downloadable
      2026-09-13) — now that we can compute the "actual" half of that
      question ourselves, live, this becomes the next real layer on top.

## Scope note: `roster_card.py` NOT yet switched over (2026-09-13)

`this_week_matchups`/`sim.json` (the Matchups page, My Team's live
score) now use the self-computed live score — but each player card's own
`week_actual`/`week_projection` fields (`roster_card.py`) still read
straight from the private feed's own `statSourceId` stat lines,
untouched by this session's work. Deliberate scoping call, not an
oversight: Tommy's ask and this session's testing were both about the
Matchups page specifically. Worth doing the same swap there later for
consistency (a player's card and the matchup card showing two different
"current" numbers mid-game would be a real, confusing bug once someone
notices) — flagged here so it isn't forgotten, not started yet.

## Refresh cadence — what this new feed does and doesn't unlock (2026-09-13)

Tommy asked whether this new source lets the site update more often on
game days. Two separate things:

- **The live-score computation itself has no rate limit or login tied to
  it** — unlike the private fantasy API (cookie-gated, and this whole
  app already rate-limits itself to be polite to it), ESPN's public
  boxscore feed could be polled much more often than every ~15 minutes
  with no new constraint on OUR side.
- **The actual bottleneck was never really the data source — it's the
  GitHub Actions schedule** (`refresh.yml`'s generated cron windows,
  `generate_refresh_schedule.py`). Polling more often means more
  workflow runs, which costs more CI minutes and pushes more commits.
  That's a real, separate decision (how often, what it costs) that
  deserves an explicit yes rather than a silent change to shared CI
  config — not made as a side effect of this work.
