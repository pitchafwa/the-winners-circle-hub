# League Hub — Backlog

Ideas parked for later. Nothing here gets built until Tommy says which ones
to pull off this list. Roughly grouped; not priority-ordered.

## Built (2026-08-15)

All of the below shipped in one batch: roster-ownership timeline (new
`ingest/ownership.py`, `web/public/data/ownership.json`) plus the three
tenure stats built on it, trade grades (`ingest/trade_grades.py`,
`trades.json`), pick futures board (`pick_tracking.all_picks_board()`,
`pick_futures.json`), contend/rebuild spectrum (`ingest/spectrum.py`,
`spectrum.json`), a per-team Franchise page + index, and the nav reorg
(hand-rolled `NavDropdown` — no UI-primitive dependency existed to reuse —
for "History ▾" and "Draft ▾"). Not yet committed/pushed/deployed — waiting
on Tommy to review and batch with his own trade entries.

Not yet done: linking team names elsewhere in the app (standings, career
table, matchups) through to `/franchise/:teamId` — the Franchise pages
exist and are reachable via the Franchises index, just not cross-linked
from every mention of a team yet.

## Re-added (2026-08-24)

- **Data backup/restore** (`/admin/data`) — was parked 2026-08-16 pending a
  simpler design, but Tommy asked to add it back exactly as originally
  built, no simplification. Re-wired the route (`App.tsx`) and footer nav
  link (`Layout.tsx`); the page/API code itself (`ingest/data_tool.py`,
  `web/src/pages/DataAdminPage.tsx`, `web/src/lib/dataAdminApi.ts`,
  `web/src/types/dataAdmin.ts`) was never deleted, so nothing needed
  rebuilding. Verified live: export hits the real backend and returns a
  correct bundle (real trades, pick ownership, etc.).

## Declined

- Draft class survival rate
- "On this day" callouts
- League Constitution page
- "Closest to the belt / closest to the cellar" recap blurb

## Kept on backlog (not approved yet)

- Dynasty Power Rankings variant
- League-wide positional trends over time (multi-week chart on top of the
  existing single-snapshot heatmap) — parked, Tommy's not sold it's needed.

## League dashboard ideas (2026-08-24)

- **Waiver wire activity leaderboard** — this league doesn't use FAAB, but
  waiver activity is heavy; Tommy wants to see who's gotten the most points
  from waiver pickups and which individual adds were the best value. This
  is almost entirely free once picked up: `ownership.json`'s stints already
  track `acquired_via` ("waiver"/"fa") and `points_started` per stint —
  the exact same computation that already powers the Franchise page's
  "roster legends" (career value leader etc.), just filtered to a
  different `acquired_via` value instead of "trade"/"draft". Overlaps with
  the "recent transactions impact tracker" idea below — could ship as one
  feature (an all-time leaderboard + a "recent" filtered view) rather than
  two.

## From Tommy (2026-08-15) — dynasty tenure stats

This is a 17-keeper dynasty league, so plenty of players have been on the
same roster for years. Wants ways to surface that:

- **Career value leader** — which player(s) have given a team the most
  value over their whole tenure on that roster (not just this season).
- **Biggest headache** — most points under projection, tallied across every
  season a player's been rostered (a career-long version of the existing
  single-week `bust` superlative).
- **Favorite stashes** — players who've been rostered the longest with the
  fewest actual starts (kept purely for speculative future value).

All three need the same underlying thing, which doesn't exist yet: a
continuous per-player "who owned this player, and was he started or
benched, in every week going back to when they joined the roster" timeline.
The raw ingredients are already in the data (manual drafts, manual trades,
ESPN waiver/FA activity) — nobody's stitched them into one ownership
timeline yet. Worth building that once as a shared primitive rather than
solving it three separate times; several of the ideas below need the exact
same thing.

## Recommended: extensions of things already built

- **Trade grades** — the draft report card already grades every rookie pick
  against a real dynasty market value (`pick_values.json`) and every
  player's current value (`valuation.py`). The exact same machinery could
  grade every trade in `manual_trades.json`, retroactively and on an
  ongoing basis: who won which trade, biggest league blowout, a team's
  career trade record. This is the most natural next build — no new data
  source needed, just a new lens on data that's already flowing.
- **Dynasty Power Rankings** — the current Power Rankings are single-season
  (all-play, points-for, trend, roster). A dynasty variant blending in
  current roster dynasty value + held draft-pick capital would answer a
  different, very dynasty-specific question: who's actually building the
  best long-term team, not just who's winning this year.
- **Pick futures board** — `pick_ownership` (resolved/projected/unresolved
  traded future picks) already exists in the data but isn't its own page —
  it's easy to lose track of who owns what pick 2 years out. A dedicated
  board (or a expanded History section) showing every traded future pick
  league-wide at a glance would be a handy trade-planning reference.

## Recommended: new, dynasty-flavored

- **Draft class survival rate** — of everyone taken in a given year's
  rookie draft, how many are still on a roster N years later (vs. cut,
  traded away and cut elsewhere, etc.) — a fun companion to the draft
  report card, and free once the ownership timeline above exists.
- **Contend/rebuild spectrum** — a one-glance read on where each team sits
  between "all-in now" and "stockpiling for later," from average roster
  age + held future pick capital. Good Trophy-Case-style content.
- **"On this day" callouts** — e.g. "3 years ago today, [Team] drafted
  [Player]." Playful, low-effort, and the draft-date data to power it
  already exists.
- **A real "Franchise" page per team** — My Team is season-scoped and
  History is league-wide; there's no single place for one team's *entire*
  story — every trade it's ever made, every draft pick, full roster
  tenure. Dynasty leagues are fundamentally about franchises persisting
  across years more than any one season, so this might be the highest-
  leverage structural addition on this list.
- **League Constitution page** — not data-driven, just a static reference
  page for the actual rules (keeper count, playoff format, trade deadline,
  tiebreakers) — cheap to build, kills the recurring "wait what's the rule
  again" group-chat question.

## Structural note

If more than one or two of the "career tenure" ideas get greenlit, build
the roster-ownership timeline as its own ingest-side primitive first
(likely a new `ownership_history` computed structure, probably keyed by
team_id/player_id/week), then layer the individual stats on top — cheaper
than solving the same underlying problem three separate times.
