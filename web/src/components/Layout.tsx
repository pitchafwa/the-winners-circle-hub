import { NavLink, Outlet } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { dateTime } from "../lib/format";

const NAV = [
  { to: "/", label: "League", end: true },
  { to: "/team", label: "My Team" },
  { to: "/matchups", label: "Matchups" },
  { to: "/history", label: "History" },
  { to: "/trophies", label: "Trophy Case" },
];

export default function Layout() {
  const { seasonsIndex, season, setSeason, meta, metaError, myTeamId, setMyTeamId } = useApp();

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead-top">
          <h1 className="wordmark">{meta?.name ?? "The League Hub"}</h1>
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
        <NavLink to="/admin/weekly-summary" className="muted" style={{ fontSize: "0.7rem" }}>weekly summary</NavLink>
      </footer>
    </div>
  );
}
