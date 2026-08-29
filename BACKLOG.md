# League Hub — Backlog

Ideas parked for later. Nothing here gets built until Tommy says which ones
to pull off this list. Roughly grouped; not priority-ordered.

## Points race chart: include real playoff games (2026-08-29)

Tommy's follow-up: "add playoff weeks for the teams that made the
playoffs, again only counting actual material playoff games and not
consolation."

- ESPN's `playoff_tier` on each `ScheduleEntry` distinguishes three
  `is_playoff: true` buckets: `WINNERS_BRACKET` (the real championship
  bracket), `WINNERS_CONSOLATION_LADDER`, and
  `LOSERS_CONSOLATION_LADDER` (5th-10th place games for teams that
  already missed the real playoffs). Confirmed this directly against
  real 2025 data before writing any code. The filter in
  `PointsPaceChart` now admits `!e.is_playoff || e.playoff_tier ===
  "WINNERS_BRACKET"` instead of excluding all playoff weeks outright —
  the previous `matchup_period <= meta.reg_season_weeks` cutoff is gone
  too, since it's now redundant with the tier filter.
- **A team that misses the playoffs (or gets eliminated from
  `WINNERS_BRACKET`) needs its line to stop, not flatline.** Added a
  per-week `playedThisWeek` set built from that week's actual decided
  `WINNERS_BRACKET`/regular-season entries; a team's `row[t{id}]` is
  only written for weeks it actually played. Combined with the
  existing `connectNulls` on each `<Line>`, this renders as a real gap
  in a missed/eliminated team's line rather than repeating its last
  known rolling average indefinitely into playoff weeks it didn't
  play — the code previously would have kept recomputing a "trailing
  average" from stale scores since `weeklyScores` never got a fresh
  push, silently faking data for weeks with no real game.
- Subtitle updated: "3-week rolling average PPG, playoffs included —
  your team in green".
- Verified against real 2025 data end-to-end, not just visually:
  independently recomputed the whole per-team weekly series via a live
  `fetch()` in the browser console (same filter/window logic,
  hand-written separately from the component) and it matched the
  chart's rendered path data exactly, including Tommy's own team's
  values through week 17. Separately confirmed via the rendered SVG
  path endpoints that exactly the 4 teams that missed the real
  `WINNERS_BRACKET` (`[2, 7, 8, 9]` this season) have lines stopping
  at week 14, and the 6 teams that made it (`[1, 3, 4, 5, 6, 10]`)
  extend into weeks 15-17, each stopping at its own real elimination
  point rather than every playoff team's line ending at the same week.
  `npx tsc --noEmit` and production build both clean, no console
  errors.

## Points race chart: cumulative total → 3-week rolling PPG (2026-08-29)

Tommy's feedback on the just-shipped cumulative version: "given the range
of the Y axis (roughly 0-2000) you can't really learn much from it."
Right diagnosis — with 10 lines all climbing toward ~2000, the real
variation between teams was a few pixels of vertical spread. Talked
through three alternatives (trailing rolling average, raw weekly, and
cumulative-vs-league-average pace); Tommy picked a 3-week trailing
average, with the added ask that the first two weeks not be blank —
week 1 shows that week's raw score, week 2 shows the 2-week average,
week 3+ uses a true trailing 3-week window.

- **`HistoryCharts.tsx`**: `CumulativePointsChart` renamed
  `PointsPaceChart` (no longer cumulative, so the old name was actively
  misleading); `PointsTooltip` renamed `PaceTooltip` and now formats to
  one decimal place (`pts(value, 1)`) since PPG figures, unlike whole
  cumulative totals, need it. Computation swapped from a running total
  to `weeklyScores.get(id).slice(-3)` averaged per week — the shrinking-
  window behavior for weeks 1-2 falls out naturally from `slice(-3)` on
  a short array, no special-casing needed. Y-axis domain set to
  `["auto", "auto"]` (recharts default was fine for the 0-2000 cumulative
  scale but needs to actually rescale to the ~60-180 PPG range now).
  `connectNulls` added to the `<Line>`s as a defensive measure in case a
  team is winless-so-far in some future small-sample edge case.
- `LeaguePage.tsx` updated to import/render `PointsPaceChart` and the
  section subtitle changed from "cumulative points scored, week by
  week" to "3-week rolling average PPG".
- Verified the math directly against real 2025 schedule data (not just
  visually): pulled Tommy's own 14-week score list via a live `fetch()`
  in the browser console and hand-computed the same trailing-window
  average client-side — matched the chart's rendered path data exactly
  (week 1 = 127 raw, week 2 = 126 = avg(127,125), week 3 = 125.3 =
  avg(127,125,124), etc.). Confirmed live: Y-axis now reads ~60-180
  instead of 0-2000, my-team line still renders in accent color with a
  real non-flat path, `npx tsc --noEmit` and production build both
  clean, no console errors.

## Points race chart (2026-08-29)

Tommy's request: "add a chart similar to the season timeline and 'regret'
charts that shows cumulative season points scored for each team as a
10-line line graph." New "Points race" section on the League page,
directly below Season Timeline.

- **`CumulativePointsChart`** (`HistoryCharts.tsx`) — reuses `BumpChart`'s
  exact filtering (regular-season, decided-games-only, skips the
  all-zero-score placeholder rows) but accumulates `home_score`/
  `away_score` into a running per-team total instead of computing a
  weekly rank. Same 10-line recharts `LineChart`, same accent-for-
  my-team/muted-for-everyone-else coloring, same `forwardRef` +
  `forceDesktop` prop shape as `BumpChart` so it drops into the existing
  screenshot pipeline with no new capture logic.
- New `PointsTooltip` (local, not exported) — same idea as the existing
  `BumpTooltip` but sorted descending by point value instead of
  ascending by rank, since here bigger is what's good.
- **`LeaguePage.tsx` refactor**: the `useState`/`flushSync`/optional-
  `setTimeout` boilerplate for force-desktop capture had been hand-
  written twice already (Playoff Probability, Season Timeline); factored
  it into a local `useForceDesktopCapture(asyncDelayMs?)` hook before
  adding a third copy for Points Race. All three call sites (`odds`,
  `bump`, `points`) now share one implementation.
- Verified live against real 2025 season data (2026 is preseason, no
  completed weeks): all 10 lines render, tooltip logic mirrors the
  already-shipped `BumpTooltip` pattern exactly. Confirmed via canvas
  pixel sampling of a real capture — corner pixel matches the frame's
  `#FAF3E1` background exactly (not transparent), multiple rows through
  the image show real non-background content (chart lines, gridlines),
  and ~218 dark-ink pixels confirm the title text rasterized. Captured
  image was 1396×734 at pixelRatio 2 (698×367 CSS px) — consistent with
  the 650px forced-desktop chart width plus frame padding. No console
  errors.
- Same caveat as `BumpChart`'s existing entry above: the accent line
  (`#0FA894`, "your team") did not rasterize through this capture in
  the test environment — 0 accent-colored pixels found in the pixel
  scan, matching the exact pre-existing, already-documented browser/
  color-specific SVG rasterization limitation, not a new bug. Every
  other line and the title rasterized correctly.

## Trade analyzer + buy-low targets (2026-08-27) — built, Tommy-only

Two new LM Tools, password-gated like the rest, local-dev-only (need the
admin-api dev middleware) — see `ingest/trade_analyzer_tool.py`'s
docstring and the code review above for the full design.

- **Trade Analyzer** (`/admin/trade-analyzer`) — pick two teams, check
  players/picks off each roster to give up, get a before/after comparison:
  contending value, dynasty roster value, future pick capital, rebuilding
  value, and a per-position starter-tier/depth split, for both teams. Pure
  what-if — nothing written to disk.
- **Buy-Low Targets** (`/admin/buy-low`) — every other team's player with
  real dynasty value above a floor whose last-3-games PPG has dropped hard
  below their own season average.
- Found and fixed a real, previously-latent bug at the shared source
  (`parse.py:recent_player_performance()`) while building this: a player
  genuinely inactive/IR one week can still show `played:True` with a real
  all-zero stat line, which was silently dragging down every consumer of
  that function's "recent form" data (roster_card.py's on_fire/on_ice/
  recent_avg_diff, not just the new buy-low tool) — same fix already
  applied to the player card's PPG calc, now shared.
- Also found and fixed, during live verification, a real duplicate-pick
  bug (not just a console warning): a team can legitimately hold two picks
  of the same season/round (its own natural pick plus one acquired via
  trade — confirmed live, team 10 holds five different 2027 2nds), and the
  original `${season}-${round}` selection key collapsed them into one
  checkbox.

## Home-screen icon for "Add to Home Screen" (2026-08-29)

Tommy's iPhone "Add to Home Screen" (Chrome) was auto-generating a plain
letter-on-grey tile instead of a real icon — iOS reads `apple-touch-icon`
specifically for this, separate from the favicon and ignoring
manifest.json entirely.

- Generated `apple-touch-icon.png` (180×180), `icon-192.png`, and
  `icon-512.png` — navy `#12213D` background (matches the masthead
  exactly) with the same 🏈 emoji the existing favicon already uses, so
  the home-screen icon and the browser tab read as the same app. Real
  emoji glyph, not a generated letter tile: rendered via Pillow using
  Windows' own Segoe UI Emoji color font (`embedded_color=True`), run in
  an ephemeral `uv run --with pillow` environment rather than adding
  Pillow to the project's own venv for a one-off asset generation task.
- `index.html` gained `apple-touch-icon`, `apple-mobile-web-app-capable`
  (launches without Safari's URL bar/chrome, closer to a real installed
  app), `apple-mobile-web-app-title` (name under the icon — "League Hub"
  instead of the full page title), and — for Android/Chrome parity, which
  reads these instead — a `manifest.json` + `theme-color`.
- All new asset references use RELATIVE paths (`apple-touch-icon.png`,
  not `/apple-touch-icon.png`) rather than root-absolute — confirmed via
  a real `GITHUB_PAGES=1` build that Vite only rewrites recognized
  script/link[stylesheet] tags with the `/the-winners-circle-hub/` base
  prefix, not arbitrary `<link>` hrefs, so a root-absolute path would
  have 404'd on the actual deployed site while working fine locally.
  Relative paths resolve correctly under either base with no rewriting
  needed at all.
- Verified live: both build modes (plain and `GITHUB_PAGES=1`) checked
  directly by inspecting build output; confirmed the icon file itself
  actually loads and decodes (tab title showed real "180×180" dimensions,
  not a broken-image state) and all new `<meta>`/`<link>` tags resolve to
  correct absolute URLs in the live DOM, no console errors.

## Screenshot capture: force-desktop for the two bar/chart blocks (2026-08-29)

Tommy's follow-up after seeing real captures: Season Timeline looked
good, but Playoff Probability's mobile-wrapped layout (name+pct on one
line, bar squeezed onto its own line below) reads worse in a static
screenshot than it does live — wants both to capture the roomier
desktop layout instead, same idea as the matchup cards.

- **Playoff Probability** (`PlayoffProbabilityTracks.tsx`): new
  `forceDesktop` prop adds a `.playoff-tracks-force-desktop` class,
  overriding the `@media (max-width: 640px)` mobile wrap back to a
  single-row desktop layout (`!important`, since a plain media query is
  keyed off the real viewport — still mobile-width during capture — not
  something a class can conditionally opt out of) plus a fixed 600px
  container width. The width matters as much as the un-wrapping: with
  no width of its own, `.playoff-track`'s flex:1 auto bar has zero
  intrinsic content size, so even single-line it would've collapsed
  toward 0 in an unconstrained shrink-to-fit capture frame — the same
  "squeezed bar" problem the original mobile fix existed to solve in
  the first place, just relocated.
- **Season Timeline** (`BumpChart`): new `forceDesktop` prop widens its
  wrapping div to 650px. Unlike the playoff bars (pure CSS, settles
  instantly), recharts' `ResponsiveContainer` only re-renders its SVG
  at the new width after its own `ResizeObserver` actually fires — a
  real async step. `ScreenshotButton`'s `prepareCapture` hook now
  accepts returning a `Promise`, and this one does: flips the width via
  `flushSync`, then waits a short fixed 150ms (not
  `requestAnimationFrame` — confirmed elsewhere in this feature that
  rAF never fires in a backgrounded/non-compositing tab) before the
  capture proceeds, giving the resize+re-render time to actually
  finish.
- Both driven from `LeaguePage.tsx` (owns the `forceDesktop` state +
  flushSync setters, same pattern as `MatchupCard`), not
  self-contained, since the `ScreenshotButton` for each lives in the
  section-head, separate from the block it's capturing.
- Verified live: Season Timeline capture now 698×367 CSS px (650px
  chart + padding) with real title/gridline/line colors present;
  Playoff Probability now 648×399 CSS px (600px forced width + padding,
  visibly shorter than the old all-wrapped capture since rows are
  single-line again) with real title/bar colors present, and confirmed
  the live page cleanly reverts to its normal mobile layout
  (class stripped, width back to 335px) after the capture completes.

## Screenshot capture: title + padding frame (2026-08-28)

Tommy's feedback after the charts pass: tables and matchup cards looked
great, but captures of things without their own visible border/header
(Playoff Probability, Season Timeline) looked "cut off right when the
content ends," with no title. Fixed once, at the source
(`ScreenshotButton.tsx`), rather than reworking every page's own markup.

- `capture()` now builds a small offscreen frame — a heading (the
  block's title, defaulting to a title-cased version of `filename` when
  no explicit `title` prop is given) plus real padding — around a CLONE
  of the target, and captures that instead of the bare target. Explicit
  nicer titles added at the two dynamic per-item sites where the
  filename slug would've looked awkward (`MatchupCard`, `TradeCard` in
  `ActivityFeed.tsx`); every other call site rides the auto-derived
  default.
- Found and fixed two real bugs building this, both confirmed live
  before and after:
  1. Positioning the offscreen frame with `left:-9999px` (the obvious
     first approach) silently produced a fully TRANSPARENT capture —
     html-to-image's coordinate math breaks on negative positions,
     shifting the rendered content entirely outside the exported SVG's
     viewBox. Fixed by nesting the frame (`top:0;left:0`, no negative
     coordinates anywhere) inside a zero-size `overflow:hidden` stage
     instead — invisible to the user the same way, without the negative
     offset.
  2. Reparenting the clone broke recharts' `ResponsiveContainer`
     specifically: its `width:100%` resolves against whatever it's
     actually mounted in, and the synthetic frame has no real width of
     its own — the Season Timeline capture came out squashed to ~246px
     instead of its real ~335px. Fixed by walking the original/clone
     trees in parallel and freezing any percentage-width element to the
     ORIGINAL element's real measured pixel width before capture. (Also
     had to fix the fix: the first attempt checked
     `getComputedStyle(original).width.endsWith("%")`, which is always
     false — computed style always resolves to a pixel value, even for a
     percentage source rule. Had to check the element's own inline
     `style.width` instead, which does preserve the specified
     `"100%"`.)
- Verified live across all three capture patterns: Standings table,
  Season Timeline chart (real title/gridline/line colors all present at
  the correct positions via pixel sampling, correct ~383×367 CSS px
  frame size), and a matchup card (title + full card content both
  present, force-desktop layout unaffected) — all with an opaque
  background frame (no transparency regression) and no console errors.

## Screenshot rollout: charts (2026-08-28)

Second pass, covering the two blocks deferred from the first rollout:

- **Playoff Probability** (`PlayoffProbabilityTracks.tsx`) — plain CSS
  progress bars, not an SVG chart (a mislabel in the original "defer as a
  chart" call — corrected here). Same `forwardRef` + `ScreenshotButton`
  recipe as every table. Verified live: real floor/risk/upside bar
  colors (`--accent-2`/`--negative`/`--positive`) all present in the
  capture via pixel sampling, no console errors.
- **Season Timeline** (`BumpChart` in `HistoryCharts.tsx`) — the real
  recharts SVG chart. Wrapped in a plain `<div ref={ref}>` around
  `ResponsiveContainer` (recharts doesn't cleanly forward a ref to
  anything useful itself) and captured the same way as everything else.
  Verified live with real season data: gridlines (`--rule`) and 9 of 10
  teams' lines (`--ink-muted`) all present with exact color matches via
  pixel sampling — genuinely legible, working capture.
  - **One verified, narrow limitation**: the "your team" highlighted
    line (`--accent`, #0FA894) specifically does not rasterize through
    the `<img>` + canvas pipeline in this session's test browser, while
    every other line/gridline/color renders correctly. Root-caused
    thoroughly, not just observed: reproduced with `html-to-image`
    bypassed entirely (raw `XMLSerializer` on the live SVG), reproduced
    regardless of the line's z-order (moved to front, no change), and
    reproduced when the SAME color was applied to a DIFFERENT, otherwise
    fully-working path (still failed identically) — meaning it's
    specific to that exact color value going through this browser's
    SVG-image rasterizer, not a bug in the capture code, not a z-order/
    occlusion issue, and not a CSS-override issue (confirmed no
    stylesheet rules on the SVG, computed style matches the attribute
    exactly). Most likely an artifact of this session's specific
    automated-browser/GPU compositing environment rather than something
    that reproduces on a real phone — shipped as-is; if Tommy sees the
    same missing highlight on his actual iPhone, worth a follow-up
    (probably switching the "mine" line's differentiation to something
    less color-dependent, e.g. a marker or heavier dash, since
    strokeWidth alone already differs 2.4 vs 1).

## Screenshot rollout: every table/card block, league-wide (2026-08-28)

Full rollout of the "save as image" button (`ScreenshotButton.tsx`) beyond
the Standings/Matchups test run, to every block Tommy greenlit:

- **League tab**: Division Race (both divisions, self-contained buttons
  next to each division's own label), Contend/Rebuild table, Positional
  strength heatmap, Week N Superlatives card grid.
- **My Team**: current roster table.
- **Draft report card**: Haul grade + Efficiency grade tables (each
  self-contained next to its own `<h3>`), full draft board table.
- **Trades**: the team net-value ledger table.
- **Pick futures board**: the full picks table.
- **Trophy Case**: the season tally table, latest-certificates card grid.
- **Franchise pages**: head-to-head table, draft history table.
- **History**: Record Book's by-franchise leaders table, all-time
  Head-to-Head matrix, Franchise Careers table.
- **LM Tools**: Positional Strength, Buy-Low Targets, and Trade
  Analyzer's per-team position-table results (self-contained per
  `TeamResultCard`) all got buttons; Trade Partners' card grid got one
  button for the whole grid.
- **Recent Activity**: each of the top-3 trade cards gets its own corner
  button (`TradeCard`, new small component factored out of
  `ActivityFeed.tsx` so each card can hold its own ref) — same
  `.card-shot` corner-overlay pattern the matchup cards use, generalized
  from `.mu-card-shot` (renamed) since it's no longer matchup-specific.

Mechanically, this was almost entirely `forwardRef` plumbing: any
sortable table component now forwards its `<table>` ref so the owning
page can render `<ScreenshotButton>` inline next to that block's own
subheader/label — same recipe proven on Standings, applied to every
`<table className="stat">` in the app except the ones deliberately
deferred (see below). Card-grid blocks (auto-reflow `display:grid`, no
overflow-clipping like a table) just get a ref on their own container —
no special handling needed, since — unlike matchup cards — they aren't
flex-shrunk into a different, much-taller mobile layout; they just
reflow columns, which is a legitimate thing to capture as-is.

**Explicitly deferred** (per Tommy, wants them but as a separate pass):
Season Timeline bump chart and Schedule Swap matrix (recharts SVG /
gradient-heavy — real risk of broken captures, worth its own testing
pass) and Playoff Probability's progress bars.

**Explicitly excluded** (per Tommy): Recent Activity's non-trade feed
list (unbounded length), and all admin data-entry forms (Trade/Draft/
Pick admin pages — input forms, not shareable content).

Verified live at a 375px mobile viewport across a representative spread
(League tab's Contend/Rebuild table, a Recent Activity trade card,
History's Franchise Leaders table, LM Tools' Positional Strength table)
— every capture produced a correctly-sized full-content image, no
console errors, and the button is confirmed CSS-hidden again above
640px.

## Screenshot button: icon-only placement + matchup cards (2026-08-28)

Follow-up to the Standings test run, now generalized: renamed
`TableScreenshotButton.tsx` → `ScreenshotButton.tsx` (it's no longer
table-specific) and reworked it into a small icon-only camera button
(no text label) that sits inline next to a block's own subheader/label,
instead of a separate full-width bar above the content.

- **Standings**: `StandingsTable` converted to `forwardRef` so
  `LeaguePage.tsx` can hold the `<table>` ref itself and render
  `<ScreenshotButton>` directly inside the section-head, right next to
  "click a column to sort" — the placement Tommy asked for.
- **Matchup cards**: each card gets its own small camera icon in its
  top-right corner (no shared header row to sit next to, since each
  card in the list is its own capture target). Per Tommy's ask, the
  capture always renders the roomier DESKTOP side-by-side layout
  (`.mu-grid`), never the vertically-long mobile stacked list
  (`.mobile-lineup`), regardless of the real device viewport — both
  layouts already exist in the DOM at all times (this app's established
  CSS-only responsive pattern, one hidden via `@media` at a time), so
  capture just needs to temporarily flip which one is showing.
  - New `.mu-card-force-desktop` CSS class does three things while
    applied: shows `.mu-grid`, hides `.mobile-lineup`, and forces the
    card to a fixed 600px width (`.mu-card`'s width is normally
    flex-shrunk to fit the real viewport, not just visually clipped
    like a scrollable table — un-hiding the grid alone would still
    render it squeezed into a narrow mobile-width box).
  - `ScreenshotButton` gained optional `prepareCapture`/`cleanupCapture`
    hooks so a caller can toggle this kind of override right before/
    after capture — kept generic rather than matchup-specific, for
    reuse anywhere else a similar "always capture the desktop version"
    need comes up.
  - Drives the toggle through real React state + `flushSync` (not a raw
    `classList.add` on the DOM node) — a direct DOM mutation is
    invisible to React's reconciler, so a re-render for any unrelated
    reason during the capture's async gap would silently wipe it;
    `flushSync` commits synchronously so there's no gap for that race.
- Also new: `.mu-card-force-desktop .mu-card-shot { display: none }` —
  the camera icon hides itself during its own capture so it doesn't
  show up inside the screenshot.
- Verified live for both: Standings capture still works correctly at
  the new placement; a real 2025 matchup card's screenshot rendered at
  1200×1158px (600×579 CSS px desktop grid, 2x pixel ratio) versus its
  live mobile rendering of 335×1158px (same numeric height by
  coincidence — 579×2 — but a completely different, far more compact
  layout, confirmed via canvas pixel sampling that real varied content
  fills the desktop capture, and that the card cleanly reverts to its
  normal mobile size afterward).

## Mobile "save table as image" — test run on Standings (2026-08-28)

Tommy wanted a mobile-only button to screenshot a table's FULL contents
(including columns currently scrolled off-screen) so he can send it to
the group chat, without having to scroll-and-stitch multiple screenshots
by hand. Test run on the Standings table only, per his ask — roll out to
other tables once he's happy with it.

- **The trick**: `html-to-image` renders straight from the DOM tree, so
  it reads a target element's own natural width, not the viewport's
  clipped visible area. A `<table>` inside `.table-wrap`'s
  `overflow-x: auto` ancestor still lays out at its own full content
  width — only the ANCESTOR clips/scrolls it — so pointing the capture
  at the `<table>` itself (never at `.table-wrap`) gets the whole thing
  in one shot, no scrolling or stitching. New `TableScreenshotButton.tsx`,
  wired into `StandingsTable.tsx`; CSS-hidden above 640px (desktop
  already shows the whole table).
- Tries the Web Share API first (`navigator.share` with files) where
  supported — opens the native share sheet directly, pick a group chat
  or Save to Photos in one tap. Falls back to an in-page image preview
  (long-press to save/share) everywhere else.
- Found and fixed two real bugs during testing, not just environment
  quirks:
  1. The originally-planned `window.open()` fallback got silently
     popup-blocked — calling it after an `await` loses the browser's
     "this came from a real tap" flag on most mobile browsers. Replaced
     with the in-page preview overlay above, which needs no popup at all.
  2. html-to-image's own `toBlob()`/`toPng()` resolve the loaded capture
     inside a `requestAnimationFrame` callback, which only fires while
     the tab is actively compositing — normally invisible, but a real
     way to hang forever if the tab loses visibility mid-capture (OS
     share sheet stealing focus, backgrounding, etc). Rewrote the final
     step to use the library's `toSvg()` (DOM→SVG serialization, the
     part that actually needs the library) and then manually load+draw
     to a canvas — same output, one fewer way to get stuck. Also passed
     `skipFonts: true`: by default the library re-fetches every
     `@font-face` on the ENTIRE page (all ~30 of this app's IBM Plex Mono
     weight/subset files) to inline as base64, which is slow for no
     benefit here — the table only needs its own text legible, not exact
     kerning.
  - Verified the fix caught a real hang, not a false alarm: confirmed
    `requestAnimationFrame` genuinely never fires in a backgrounded/
    non-compositing tab (a real, if edge-case, browser condition) before
    rewriting around it.
- Verified live: captured image is 1712×904px against a 375px mobile
  viewport (pixel-ratio-2'd, so ~856px logical — over double the visible
  width), confirmed via canvas pixel sampling that real table content
  (not blank space) renders across the full width, no console errors.

## Redraft value source switched: KTC → FantasyPros ECR (2026-08-28)

Tommy didn't buy the redraft/contending-value rankings KTC's own
`fantasy-rankings` page was producing — specifically, Antonio's team
(Fresh Prince of Bel-Air) reading as top-2 in the league. Swapped the
"how good is this roster RIGHT NOW" side of the model to a second,
independently-sourced opinion instead of tuning the same one further:

- `valuation.fantasypros_redraft_values_by_name()` (new) fetches
  FantasyPros' PPR draft cheat sheet
  (fantasypros.com/nfl/rankings/ppr-cheatsheets.php), which embeds its
  full 517-player consensus-rank (ECR) list as inline JS the same way
  KTC's pages do (`var ecrData = {...}`, no JS execution needed to
  scrape). `redraft_values_by_name()` (the original KTC version) stays
  in the file, unused, in case this ever needs revisiting.
- Player rank gets remapped onto roughly the same 0-9999 value scale
  KTC's own redraft numbers used — piecewise-linear interpolation
  against 12 anchor points sampled straight off KTC's real redraft
  curve (rank 1 → 9999 down to rank 375 → 0) — specifically so
  `spectrum.py`'s dollar-level Contending/Balanced/Rebuilding thresholds
  and everything else built assuming that scale keep working unmodified.
  Only WHO ranks where changes, not the numeric range values live in.
  `_Source` generalized with a `parser` callback so this and the two KTC
  fetches share the same fetch/cache/offline-fallback machinery.
- **Verified the actual complaint is fixed**: recomputed both old (KTC)
  and new (FantasyPros) team rankings side by side — Antonio's team goes
  from #1 under KTC to #7 under FantasyPros, no longer top-2, confirmed
  live on the League tab's Contend/Rebuild table (Balanced, 58698, down
  from 63360 and a #1 finish).
- Every consumer downstream (Trade Analyzer/Trade Partners' client-side
  port, the League tab's spectrum table) needed no code changes — they
  all read whatever's in `player_values.json`'s `redraft` field, which
  is source-agnostic by design.
- Footer/docstring wording updated everywhere it said "KTC" for the
  redraft half specifically (`Layout.tsx`'s footer, `spectrum.py`,
  `DATA.md`) — now reads "KTC dynasty / FantasyPros redraft".

## Positional Strength: drop D/ST-K, add heat coloring (2026-08-28) — built, Tommy-only

- Dropped the D/ST and K columns — both carry no meaningful dynasty
  value in this league (`VALUATION_EXCLUDED_SLOTS`), so every team read
  ~0 for both; pure width with no signal. The League tab's own
  positional table (`PositionHeatmap.tsx`, real weekly scoring rather
  than dynasty value) keeps them, since actual points scored there very
  much isn't zero.
- Added conditional formatting: each cell tints green (stronger) or red
  (weaker) by how far that team's starter-tier value sits from the
  league's own average AT THAT POSITION — scaled per column, not one
  scale across all four, since raw dynasty value ranges differ hugely by
  position (RB starter tiers run ~3x a TE's); a shared scale would've
  made TE always read pale regardless of real relative strength. Same
  rgba/alpha formula as the League tab's existing heatmap so the two
  read the same way despite different underlying stats.

## Trade Partners + LM Tools now work on the deployed site (2026-08-28) — built, Tommy-only

Tommy asked why Positional Strength/Trade Analyzer/etc only worked on
`pnpm dev` and not the real deployed site — the honest answer was that
they called a local Python backend (a Vite dev-middleware bridge,
`web/vite-plugins/admin-api.ts`, spawning `trade_analyzer_tool.py`) that
simply doesn't exist once deployed (GitHub Pages is 100% static, no
server at all). Four of the five LM Tools were read-only (no writes to
disk), so all four moved to a pure client-side port:

- **Trade Partners** (`/admin/trade-partners`) — new LM Tool: every other
  team ranked by mutual positional fit — how much their positional
  surplus overlaps this team's need, and vice versa. Value = starter tier
  + depth per position (reusing Positional Strength's rating); need/
  surplus expressed as a fraction of the league average so positions with
  very different value scales (RB pool vs. TE pool) compare fairly. Fit
  score sums (my need × their surplus) + (their need × my surplus) over
  every position.
- **Positional Strength, Buy-Low Targets, Trade Analyzer, and the new
  Trade Partners all ported to TypeScript** (`web/src/lib/teamValue.ts`,
  `buyLow.ts`, `leaguePerformance.ts`), reading two static files instead
  of calling a backend: `player_values.json` (new — every rostered
  player's dynasty/redraft value + real ESPN eligible slots, the one
  piece of data nothing else already shipped) and `pick_futures.json`'s
  new `value` field (each pick's real market value, computed once at
  build time). Both regenerate on the normal scheduled refresh, same as
  every other page's data.
- The one non-trivial piece — Trade Analyzer's "best possible starting
  lineup" (contending value) — needed porting the same bipartite-matching
  logic `metrics.redraft_lineup_value()` uses server-side
  (`scipy.optimize.linear_sum_assignment`). Ported as a greedy-with-
  augmenting-paths algorithm (`teamValue.ts`'s `redraftLineupValue()`) —
  provably exact for this case (a player's value is the same regardless
  of which of their eligible slots they fill), not an approximation.
  Verified live: ran the identical trade through both implementations,
  every number matched exactly, including a real ~3-point rounding
  discrepancy found and fixed in `pick_futures.json`'s `value` field
  (was rounding each pick before summing; now sums first, matching
  Python's round-once-at-the-end behavior).
- `trade_analyzer_tool.py` kept in the repo as the reference
  implementation the TS port was matched against (still runnable via
  CLI), but nothing in `admin-api.ts` routes to it anymore.
- Verified on the actual static production build (`vite build` + a plain
  static file server, no dev server, no Python) — all four tools render
  correctly with zero console errors, proving they'll work the same way
  on the real deployed GitHub Pages site.

## Trade analyzer follow-ups + positional strength tool (2026-08-27) — built, Tommy-only

- **Pick picker now names the real original team** on every pick, not just
  acquired ones (`(Tyus's pick)`, `(Marquel's pick)`, etc.) — previously
  showed the literal placeholder text "original owner" as link text, a real
  display bug.
- **Positional Strength** (`/admin/positions`) — new LM Tool, quick-glance
  table of every team's per-position starter-tier/depth dynasty value at
  once (same `_position_ratings()` computation the Trade Analyzer already
  does for two teams, run for all ten), sortable by any position column.
  New `league_positions` subcommand on `trade_analyzer_tool.py`.
- Found and fixed a real Rules-of-Hooks bug while building this: the
  table's rendering function called `useApp()`/`useSorted()` but was
  invoked as a plain conditional function call inside the page's render
  body rather than as its own JSX component — React saw a different hook
  count between the loading and loaded render, crashing with "Rendered
  more hooks than during the previous render." Fixed by making it a real
  component (`RatingsTable`) rendered via JSX.
- **Trade Partners** (`/admin/trade-partners`) — every other team ranked
  by mutual positional fit: per position, value = starter + depth (from
  the same rating used by Positional Strength); a team's need at a
  position is how far below the league average it sits, surplus how far
  above, both as a fraction of that average so positions with very
  different value scales compare fairly. Fit score between two teams =
  Σ over positions of (my need × their surplus) + (their need × my
  surplus) — ranks teams by "where I'm thin and they're deep, and vice
  versa," instead of guessing who might want to talk trade. New
  `trade_partners` subcommand on `trade_analyzer_tool.py`; card-per-team
  layout with readable "They can fill your X" / "You can fill their X"
  chips and a jump link into the Trade Analyzer.

## Full-app page review (2026-08-26)

Requested: a page-by-page pass with small/medium/large ideas across the
whole site, using everything learned building it so far. Nothing here is
built — greenlight individually.

### Cross-cutting (small, applies to most pages)

- **Team names aren't linked to their Franchise page almost anywhere** —
  confirmed by reading the actual components: `StandingsTable.tsx` (the
  league-wide standings, the single most-viewed table in the app),
  `CareerTable`/`FranchiseLeaders`/`H2HMatrix`/`RecordBook` in
  `HistoryCharts.tsx`, `TradesPage.tsx`, `DraftPage.tsx`,
  `PickFuturesPage.tsx`, and `FranchisePage.tsx`'s own trade-history section
  (doesn't even link the OTHER team in a trade it's displaying) all render
  team names as bare text, not `<Link to={/franchise/:id}>`. This was
  flagged as "not yet done" back when the Franchise pages were first built
  and never got picked up. Single highest-value small fix on this list —
  one component-level change (wrap team-name renders in a `Link`) fans out
  correctly everywhere since they all already resolve team_id → name.
- **There's no `/franchises` index page** — despite being described as
  built in earlier project notes, `App.tsx` only has `franchise/:teamId`;
  the only entry point is the "Franchises ▾" nav dropdown listing all 10
  teams by name. A real index page (grid of team cards — record, titles,
  current posture) is listed separately below as a medium item, but even
  just confirming this gap is worth a look.

### League page

- Small: streak isn't shown on the league-wide Standings table (only on
  the divisional Division Race tables) — cheap to add, data already exists
  on `StandingsRow`.
- Medium: **waiver wire activity leaderboard** — this league has heavy
  waiver activity and no FAAB; `ownership.json` stints already carry
  `acquired_via` and `points_started`, so filtering to `"waiver"/"fa"`
  (instead of `"trade"/"draft"`, same as the Franchise page's "roster
  legends") gets most of the way there almost for free. Could ship as one
  feature with a "recent" time-windowed view (see below) rather than two.
- Medium: **recent transactions impact tracker** — same mechanism,
  windowed to the last 2-3 weeks instead of all-time: "here's how your
  recent free-agent moves are panning out." Near-zero new computation once
  the leaderboard above exists.
- Large: **dynasty Power Rankings variant** — parked, not declined. Plain
  Power Rankings (all-play/PF/trend/roster) got folded into Division Race
  and deleted from display since it was redundant with standings — but a
  genuinely *dynasty*-flavored ranking (blending current redraft roster
  strength with held pick capital) would answer a different question than
  the Contend/Rebuild spectrum does: not "which direction is this team
  headed" but "who's actually built the best long-term team right now."

### Matchups page

- Small: **elimination-game flag** — badge a card when
  `playoff_pct_if_lose_next` drops below some real threshold for either
  team. Field already exists on `SimTeam`.
- Small: **upset-alert flag** — badge when the projected underdog still
  has a real (>35%) win chance. Same data already computed for the WP bar.
- Small: visually distinguish the single biggest game of the week (already
  sorted first by `playoff_impact_score`) with its own ribbon/border
  instead of just position in the list.
- Small: "jump to my game" anchor link at the top of a full week's card
  list — the `mine` team's card is already accent-bordered, just no way to
  scroll straight to it.

### My Team page

- Small: add a one-line tooltip/subtitle on the "Left on bench" stat
  clarifying it's the sum of weekly (optimal − actual) shortfalls, not
  Optimal PF minus PF — came up directly in conversation; those two read
  as the same idea but aren't (Optimal PF − PF mixes in home-field bonus
  and skips bench-blind weeks). Cheap to prevent the same question landing
  again.
- Medium: a compact "this week's opponent" preview card — H2H record,
  streak, win probability — reusing the same data `WeeklyMatchupProjections`
  already renders on the Matchups page, just surfaced here too so My Team
  doesn't require a tab switch to see the upcoming game at a glance.
- Medium/Large: **player pop-up cards** — already spiked and de-risked
  (see "Kept on backlog" below): a public ESPN endpoint (no league auth
  needed) returns season game log, news, and real analyst blurbs
  (Rotowire) for any player, fetchable directly from the browser on click.
  Roster table is the natural first place to wire it in. The real lift is
  the modal/card component and picking which fields to show, not the data
  — this is probably the single most ESPN-app-like feature left on the
  list.

### Franchise page

- Small: color/label each trade-history line as "acquired"/"sent" relative
  to the franchise being viewed, instead of a flat list of `player → team`
  arrows the reader has to parse direction from.
- Small: explicit "Championships: N · Playoff appearances: N" stat block —
  the badge shelf shows championship chips visually, but there's no
  countable number next to Seasons/Record/PF in the hero stats.
- Medium: **head-to-head vs. every other franchise** — `h2h.json` already
  has every pair's all-time record; a small table on this page filtered to
  the one team ("this franchise's record against everyone it's ever
  played") is a natural rivalry-flavored addition, near-zero new backend.
- Medium: a small career PF-by-season or record-by-season sparkline in the
  hero stats — reuses the app's existing small-chart pattern (My Team's
  ScoringChart/BenchChart), gives the career numbers some shape instead of
  three flat totals.
- Large: **a real `/franchises` index page** — grid of all 10 franchise
  cards (record, titles, current contend/rebuild posture, badge count),
  each linking into its own `/franchise/:teamId`. See the cross-cutting
  note above — this was apparently scoped originally but never actually
  built; the nav dropdown is the only current entry point.

### Trophy Case page

- Small: this page still has the same headline+paragraph `.hero` block
  Tommy just had removed from the League page for being distracting — same
  visual pattern, worth deciding whether it gets the same treatment or
  whether the Superlative Champion callout earns its keep here (it's a
  genuine "who's winning the season" signal the League page's version
  wasn't).
- Small: link team names in the tally table to their Franchise page.
- Medium: an **all-time tally** (across every season, not just the current
  one) alongside the current-season table — "most Highest-Score awards
  ever," career trophy leaders — reuses the same award data via
  `useAllSeasons()`.

### Trades page

- Small: the team-ledger table renders as `table.stat` but isn't wired
  into the app's usual `useSort` pattern — every other stat table in the
  app sorts on click, this one doesn't.
- Small: filter the trade-card list by team.
- Small: link every team name (ledger + trade cards) to its Franchise page.
- Medium: a "biggest trade" or "most lopsided trade all-time" callout,
  pulled straight from data already computed (`net` per trade).

### Draft page

- Small: link team names to Franchise pages.
- Medium: a global, all-time "Draft Hall of Fame" view — best value pick
  ever, biggest bust ever, across every class — the per-team version of
  this already exists on each Franchise page, but there's no cross-season,
  cross-team leaderboard.

### Pick Futures page

- Small: per-team summary strip above the table ("Team X holds 2 firsts,
  1 second over the next 3 classes") — cheap aggregation over data already
  on the board.
- Small: filter by team or by draft year.
- Small: link team names to Franchise pages.

### History pages (Records / H2H / Careers)

- Small: link every team name across all three sub-pages to Franchise
  pages (`CareerTable`'s Franchise column is the most obvious miss).
- Medium: **streak-based records** — Record Book currently only tracks
  Highest/Lowest scores and Biggest blowouts (checked `RecordBook` in
  `HistoryCharts.tsx` directly). No longest win streak, no longest active
  title drought, no longest playoff-miss streak — all computable from data
  already on file (`StandingsRow.streak` per season, badge history).

## Parked (2026-08-26)

Tommy's call, explicitly not building these for now:

- **Recent transactions impact tracker** (League page section above) — the
  Recent Activity feed already exists and already shows who added/dropped/
  traded whom; this was specifically the extra "how's it panning out"
  layer (points started since pickup, vs. projection) on top of it. Parked
  as-is, not built.
- **Waiver wire activity leaderboard** (see "League dashboard ideas" below)
  — same status, parked.
- **Record Book streak-based records** (History pages section above) —
  longest win streak / title drought / playoff-miss streak. Parked, not
  built.

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

- **Player pop-up cards** (click a player's name anywhere → a modal/card with
  season game log, recent news, and analyst evaluations, like ESPN's own
  app) — Tommy asked for a lift estimate + research spike (2026-08-27).
  Findings:
  - **Very feasible, moderate lift, no backend needed.** A single public
    ESPN endpoint —
    `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{playerId}/overview`
    (their general sports site API, NOT the private fantasy league API this
    app already calls, so no `ESPN_S2`/`SWID` cookie needed) — returns
    everything this feature wants in one response: `statistics`,
    `gameLog` (real per-game stat lines for the season — covers "season
    game log" outright, no need to extend `recent_player_performance`),
    `news` (real headlines, several are video-clip items with thumbnails
    and a link out to espn.com, not always plain text), `rotowire`
    (**this is the real find** — genuine analyst prose, e.g. a real
    2026-08-21 blurb on Nico Collins' target share outlook, with a
    `published` date — exactly the "recent evaluations" Tommy described),
    and `nextGame`/`fantasy` sections.
  - **CORS is wide open** (`access-control-allow-origin: *`, confirmed via
    a live request with an `Origin` header) — the frontend can fetch this
    directly from the browser on click, same direct-fetch pattern the
    trade/weekly-summary tools already use for the Anthropic API. No proxy,
    no new backend, no admin-api.ts route.
  - **Real lift**: per-player on-demand fetch (not bulk-cached at build
    time — fetching this for every rostered player during `build.py` would
    be slow and mostly wasted, since most players' cards never get opened)
    triggered on click, a loading state, and a modal/popover component to
    render it — stats table, a short news list, the Rotowire blurb.
    Genuinely a multi-hour feature, not a quick add, but no open technical
    risk left — the spike's whole point was confirming the data exists and
    is reachable, and it clearly is.
  - Not yet scoped: exactly which fields to show (the full response has a
    lot more than a card needs), where "click a player's name" should be
    wired up first (roster table is the obvious start; trades/drafts/
    activity feed could follow), and whether `PlayerHeadshot.tsx` (built
    2026-08-27 for the roster table) gets reused inside the card too
    (yes, trivially — it's already a standalone component).

### Built (2026-08-26)

Tommy greenlit the spike above, scoped to League/My Team/Matchups only —
explicitly NOT Franchise pages or Record Book.

- New `lib/playerCard.ts` (fetch + types), `state/PlayerCardContext.tsx`
  (a `PlayerCardProvider`/`usePlayerCard()` context so any component can
  open a card without prop-drilling a callback down through every layer —
  mounted once in `Layout.tsx`, wrapping every route), `components/
  PlayerCardTrigger.tsx` (wraps a player's name, opens the card on click;
  a D/ST's synthetic negative player_id renders as plain non-interactive
  text — nothing to fetch, real ESPN athlete ids are always positive), and
  `components/PlayerCardModal.tsx` (the card itself: fantasy rank/owned%
  stat row, next game, latest Rotowire report or ESPN news as fallback,
  season outlook paragraph, awards, recent games and season stats tables —
  each table renders its own section label or nothing at all, rather than
  the parent pre-checking "is there data" separately, after a real bug
  where a stale duplicate of that check let an empty "Recent games" header
  through for a rookie whose gameLog events didn't fully match the shared
  per-game metadata dict).
- Wired into: League's Recent Activity feed (trade players, waiver/FA/drop
  events), My Team's roster table + season projection-report table +
  schedule's top-scorers column, and every Matchups lineup row (completed-
  week desktop grid, the mobile stacked list shared by both matchup card
  types, the pre-game projection cards, and a completed week's award
  headline cards). Verified NOT present on Franchise or Record Book pages,
  per Tommy's scoping.
- One real thing learned live: `gameLog` always reflects the CURRENT real
  NFL season/week (it's a live ESPN endpoint, not scoped to whatever past
  fantasy season the app happens to be displaying) — during the 2026
  preseason this means "Recent games" is empty for literally everyone,
  correctly hidden rather than showing an empty table.
- Verified live end-to-end: real fetch/render for a League activity
  player, a My Team roster player (with position/team subtitle), and a
  completed 2025 Matchups player (real "Season stats" row); Escape key,
  clicking the overlay, and the close button all close it; D/ST rows have
  no trigger; zero triggers found on Franchise or Record Book pages; no
  horizontal overflow at 375px width. `tsc --noEmit` and `pnpm build` both
  clean, no console errors.

### Refined (2026-08-27)

- **Replaced ESPN's position/draft rank/ownership% stat block** with the
  player's real PPG, position rank in PPG, and age — all sourced from our
  own data instead of ESPN's generic-scoring stats. PPG/rank come from a
  new full-season scan (`lib/playerGameLog.ts:fetchPlayerSeasonData`) of
  the same `matchups/week-N.json` files the game log itself reads — while
  scanning for the target player it tallies every other player at the
  same position too, so a season-wide points-per-game rank falls out for
  free. Age comes from a genuinely new backend output, **`player_ages.json`**
  (`valuation.ages_by_name()` + `parse.ages_by_pid()`) — KTC's dynasty-
  rankings `playersArray` carries a real `age` field right alongside
  `oneQBValues.value`, confirmed live (e.g. `24.4`), so this piggybacks on
  the exact same already-scheduled 12h KTC fetch, zero extra requests.
  KTC itself can't be fetched client-side (no CORS headers, confirmed —
  unlike the ESPN endpoint the rest of the card uses), which is why this
  needed a real backend addition instead of another live browser fetch.
- **Injury status investigated, disregarded** — checked both this app's
  own weekly box scores (no per-week injury field ever recorded) and the
  ESPN overview endpoint's full raw response (only generic "team injuries
  page" links, no per-game designation) — genuinely not available from
  either source on file, so this was dropped per the explicit fallback
  instruction rather than faked.
- **Game log**: now week 1 first (was most-recent-first), always shows
  all 17 weeks even with no data ("Data not available", not just a
  missing row), and includes which franchise held the player that week
  (linked to its Franchise page). Moved to the bottom of the card, below
  the ESPN content — season selector moved up next to the new PPG/rank/
  age block and now drives BOTH sections together (one shared season,
  not two that could drift out of sync).
- Verified live: real PPG/rank/age for an active 2025 player (e.g. a real
  WR1 season correctly ranked #1 of ~78 at the position); switching the
  season selector to a year before a player's career updates BOTH the
  stat block (PPG/rank show "—", age stays — it's not season-scoped) AND
  the game log (all 17 weeks "Data not available") together; real
  franchise names/links render per week; no horizontal overflow at 375px
  (the 5-column game log table scrolls in its own `.table-wrap`, not the
  page). `tsc --noEmit` and `pnpm build` clean, no console errors. Ingest
  rebuild (`--offline`) confirmed timestamp-only diff across every
  existing file plus the one new `player_ages.json`.

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
