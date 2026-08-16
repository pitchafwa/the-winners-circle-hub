import { NavLink, Outlet } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { dateTime } from "../lib/format";
import NavDropdown from "./NavDropdown";
import type { Meta } from "../types/data";

const NAV = [
  { to: "/", label: "League", end: true },
  { to: "/team", label: "My Team" },
  { to: "/matchups", label: "Matchups" },
];

const HISTORY_ITEMS = [
  { to: "/history", label: "Standings", end: true },
  { to: "/history/records", label: "Record Book" },
  { to: "/history/h2h", label: "Head-to-Head" },
  { to: "/history/careers", label: "Career Stats" },
];

const DRAFT_ITEMS = [
  { to: "/draft", label: "Draft Grades", end: true },
  { to: "/draft/futures", label: "Pick Futures" },
];

const NAV_AFTER_DRAFT = [
  { to: "/franchises", label: "Franchises" },
  { to: "/trophies", label: "Trophy Case" },
  { to: "/trades", label: "Trades" },
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
  const { seasonsIndex, season, setSeason, meta, metaError, myTeamId, setMyTeamId } = useApp();

  return (
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
          <NavDropdown label="Draft" items={DRAFT_ITEMS} />
          {NAV_AFTER_DRAFT.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => (isActive ? "navlink active" : "navlink")}
            >
              {n.label}
            </NavLink>
          ))}
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
          </span>
        )}
        {" · "}
        <NavLink to="/admin/trades" className="muted" style={{ fontSize: "0.7rem" }}>trades</NavLink>
        {" · "}
        <NavLink to="/admin/drafts" className="muted" style={{ fontSize: "0.7rem" }}>drafts</NavLink>
        {" · "}
        <NavLink to="/admin/picks" className="muted" style={{ fontSize: "0.7rem" }}>picks</NavLink>
        {" · "}
        <NavLink to="/admin/draft-order" className="muted" style={{ fontSize: "0.7rem" }}>draft order</NavLink>
        {" · "}
        <NavLink to="/admin/data" className="muted" style={{ fontSize: "0.7rem" }}>backup &amp; restore</NavLink>
        {" · "}
        <NavLink to="/admin/weekly-summary" className="muted" style={{ fontSize: "0.7rem" }}>weekly summary</NavLink>
      </footer>
    </div>
  );
}
