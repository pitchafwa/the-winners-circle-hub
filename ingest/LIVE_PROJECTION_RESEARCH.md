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

### Still not built — the real remaining gap is D/ST + kicking

- **D/ST (team-level defense scoring)**: this league scores D/ST as ONE
  team unit (position id 16), never individual defenders — so what's
  needed is team-level points-allowed and yards-allowed, not per-
  defender stats. Confirmed derivable from this same public feed's
  `boxscore.teams` (team-level game totals, e.g. `totalYards`) — a
  team's defense's "yards allowed" is simply the OPPONENT team's own
  `totalYards` in the same game, and "points allowed" is the opponent's
  live score. Sacks/INTs/fumble-recoveries for D/ST scoring purposes are
  the OPPONENT's own "sacksYardsLost"/interceptions-thrown/fumbles-lost
  numbers (a defense's sack is the other team's QB being sacked) — not
  yet wired up, but the data needed is confirmed present, just needs the
  cross-team lookup logic written.
- **Kicking distance tiers**: this feed's `kicking` stat group only
  gives a combined "made/attempted" count, no per-kick distance — but
  this league's real scoring IS tiered by distance (FG80 items nonzero
  at multiple distance brackets). Needs each made field goal's real
  distance parsed out of the drive `plays[].text` strings (e.g.
  "E.McPherson 43 Yd Field Goal") — not yet built.
- **2-point conversions**: confirmed still missing from this feed's
  structured stats entirely (matches what the Reddit thread flagged) —
  this league DOES score these (2 points each, passing/rushing/
  receiving all nonzero in real scoring settings) — needs the same
  drive `plays[].text` parsing approach as kicking distance.

## Next steps (pick up here)

- [ ] Build the D/ST team-defense scoring piece (points/yards-allowed +
      opponent-derived sacks/INTs/fumble-recoveries), per the plan above
      — the data is confirmed present, this is just wiring.
- [ ] Build the `drives[].plays[].text` parser for made-field-goal
      distance (kicking tiers) and 2-point conversions — both needed for
      this league's real scoring, neither in the structured stat groups.
- [ ] Once skill positions + D/ST + kicking are all covered: validate a
      FULL real team's live score (every starter, one real team, one
      real week) against the known-correct final, the same
      validate-against-reality approach used above.
- [ ] Decide how self-computed live scores reconcile with ESPN's own
      official number once available (Tommy's call, already made,
      2026-09-13): treat our own number as the fast "right now" score,
      then quietly replace it with ESPN's official number once a game is
      actually over — nobody should ever see a wrong FINAL score, only a
      provisional live one.
- [ ] THEN: revisit the original "live projection" model (opportunity-
      share + shrinkage, backtested via nflverse's free historical
      play-by-play, `play_by_play_{year}.csv.gz` — confirmed downloadable
      2026-09-13) — now that we can compute the "actual" half of that
      question ourselves, live, this becomes the next real layer on top.
