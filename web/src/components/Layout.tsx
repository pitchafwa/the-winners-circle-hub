import { NavLink, Outlet } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { useJson } from "../lib/data";
import { dateTime } from "../lib/format";
import { PlayerCardProvider } from "../state/PlayerCardContext";
import NavDropdown from "./NavDropdown";
import type { DropdownEntry } from "./NavDropdown";
import type { Meta, Spectrum, TradeGrades } from "../types/data";

const NAV = [
  { to: "/", label: "League", end: true },
  { to: "/team", label: "My Team" },
  { to: "/matchups", label: "Matchups" },
];

// Season Arc (the week-by-week bump chart + schedule swap) moved onto the
// League page itself — it's single-season-scoped like everything on that
// page, unlike the rest of this dropdown, which is genuinely multi-season.
const HISTORY_ITEMS = [
  { to: "/history", label: "Record Book", end: true },
  { to: "/history/h2h", label: "Head-to-Head" },
  { to: "/history/careers", label: "Career Stats" },
];

// Draft Grades/Pick Futures/Trades are all "how teams are building/moving
// assets" — one dropdown instead of splitting Trades out as its own
// top-level item next to two thematically-identical siblings.
const FRONT_OFFICE_ITEMS = [
  { to: "/draft", label: "Draft Grades", end: true },
  { to: "/draft/futures", label: "Pick Futures" },
  { to: "/trades", label: "Trades" },
];

const NAV_TAIL = [
  { to: "/trophies", label: "Superlatives" },
];

// Only shown once adminUnlocked is true (any one password-gated tool
// unlocks all of them, same session-wide flag). The three draft-adjacent
// tools live under their own nested group — opens as a flyout to the
// right of this row instead of stacking a 4th/5th/6th item into one long
// list, per Tommy's ask.
const LM_TOOLS_ITEMS: DropdownEntry[] = [
  { to: "/admin/trades", label: "Trades" },
  {
    label: "Draft Tools",
    children: [
      { to: "/admin/drafts", label: "Draft Entry" },
      { to: "/admin/picks", label: "Pick Reassignment" },
      { to: "/admin/draft-order", label: "Draft Order" },
    ],
  },
  { to: "/admin/trade-analyzer", label: "Trade Analyzer" },
  { to: "/admin/buy-low", label: "Buy-Low Targets" },
  { to: "/admin/positions", label: "Positional Strength" },
  { to: "/admin/trade-partners", label: "Trade Partners" },
  { to: "/admin/weekly-summary", label: "Weekly Summary" },
  { to: "/admin/data", label: "Backup / Restore" },
];

/** WEEK N · LIVE / LATE EDITION once that week's games are all in, or
 * OFFSEASON outside the season — computed from fields already in the
 * data contract, no ingest change needed. */
function mastheadDate(meta: Meta | null): string {
  if (!meta || !meta.season_started) return "Offseason";
  const week = meta.current_matchup_period;
  const done = meta.completed_weeks.includes(week);
  return `Week ${String(week).padStart(2, "0")} · ${done ? "Late Edition" : "Live"}`;
}

export default function Layout() {
  const { seasonsIndex, season, setSeason, meta, metaError, myTeamId, setMyTeamId, adminUnlocked } = useApp();
  const franchiseItems = (meta?.teams ?? []).map((t) => ({
    to: `/franchise/${t.id}`,
    label: t.nickname ?? t.name,
  }));

  // Two independent market-value fetches, each on its own 12h cache: KTC
  // (dynasty, backs draft grades/trade grades/the spectrum's "held assets"
  // side) and, as of 2026-08-28, FantasyPros' consensus rank (redraft,
  // backs the spectrum's "contending" side — see valuation.py's module
  // docstring for why that source changed). Showing the OLDER of the two
  // timestamps next to the ESPN one is a cheap way to notice if either
  // fetch ever starts silently failing: it'll stop advancing while the
  // ESPN timestamp keeps moving normally.
  const trades = useJson<TradeGrades>("trades.json");
  const spectrum = useJson<Spectrum>("spectrum.json");
  const marketValuesUpdatedAt = [trades.data?.valuation_updated_at, spectrum.data?.redraft_valuation_updated_at]
    .filter((d): d is string => d !== null && d !== undefined)
    .sort()[0] ?? null;

  return (
    <PlayerCardProvider>
    <div className="shell">
      <header className="masthead">
        <div className="masthead-top">
          <div className="masthead-name">
            <h1 className="wordmark">{meta?.name ?? "The League Hub"}</h1>
            <span className="masthead-date">{mastheadDate(meta)}</span>
          </div>
          <div className="masthead-controls">
            {meta && (
              <label>
                <span className="label">Team&nbsp;</span>
                <select
                  className="control"
                  value={myTeamId ?? ""}
                  onChange={(e) => setMyTeamId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Pick your team…</option>
                  {meta.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nickname ? `${t.nickname} — ${t.name}` : t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {seasonsIndex && season !== null && (
              <label>
                <span className="label">Season&nbsp;</span>
                <select
                  className="control"
                  value={season}
                  onChange={(e) => setSeason(Number(e.target.value))}
                >
                  {seasonsIndex.seasons.map((s) => (
                    <option key={s.season} value={s.season}>
                      {s.season}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
        <nav className="mainnav" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => (isActive ? "navlink active" : "navlink")}
            >
              {n.label}
            </NavLink>
          ))}
          <NavDropdown label="History" items={HISTORY_ITEMS} />
          <NavDropdown label="Front Office" items={FRONT_OFFICE_ITEMS} />
          {franchiseItems.length > 0 && <NavDropdown label="Franchises" items={franchiseItems} />}
          {NAV_TAIL.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => (isActive ? "navlink active" : "navlink")}
            >
              {n.label}
            </NavLink>
          ))}
          {adminUnlocked && <NavDropdown label="LM Tools" items={LM_TOOLS_ITEMS} />}
        </nav>
      </header>

      <main>
        {metaError ? (
          <div className="error-state" role="alert">
            Failed to load league data: {metaError}. Run the ingest (`make refresh`) and reload.
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      <footer className="footer muted">
        {meta && (
          <span>
            Data pulled from ESPN {dateTime(meta.fetched_at)} · built {dateTime(meta.generated_at)}
            {marketValuesUpdatedAt && <> · market values (KTC dynasty / FantasyPros redraft) as of {dateTime(marketValuesUpdatedAt)}</>}
          </span>
        )}
        {" · "}
        <NavLink to="/admin" className="muted" style={{ fontSize: "0.7rem" }}>LM Tools</NavLink>
      </footer>
    </div>
    </PlayerCardProvider>
  );
}
