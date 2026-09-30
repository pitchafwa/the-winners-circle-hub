import { useMemo, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { useJson } from "../lib/data";
import { pts } from "../lib/format";
import { useSort, useSorted } from "../lib/useSort";
import EmptyState from "../components/EmptyState";
import ScreenshotButton from "../components/ScreenshotButton";
import TeamLink from "../components/TeamLink";
import type { PickFutures, PickFuturesEntry, PickResolutionStatus } from "../types/data";

const STATUS_LABEL: Record<PickResolutionStatus, string> = {
  unresolved: "Unresolved",
  projected: "Projected",
  resolved: "Resolved",
};

// LM-Tools-only, same gate PlayersPage's FP Rank/Dynasty columns and
// RosterTable's FP projection column already use — a real-money external
// market estimate, not core league content. `value_basis` explains ITS
// OWN confidence (a still-uncertain, in-progress-season projection reads
// very differently from an exact, already-known slot) rather than making
// the viewer guess from `status` alone.
const VALUE_BASIS_LABEL: Record<PickFuturesEntry["value_basis"], string> = {
  exact: "Exact — that season's real final standings are already in",
  projected_distribution: "Projected from that team's real range of plausible finishes this season",
  n2_heuristic: "Rough estimate — blends current roster strength, dynasty strength, and next year's pick capital (much less certain, two years out)",
  round_average: "Round average — nothing more specific to price it against yet",
};

const COLS: { key: string; label: string; numeric: boolean; title?: string }[] = [
  { key: "season", label: "Draft", numeric: true },
  { key: "round", label: "Rd", numeric: true },
  { key: "original", label: "Original owner", numeric: false },
  { key: "owner", label: "Current owner", numeric: false },
  { key: "status", label: "Status", numeric: false },
  { key: "overall_pick", label: "Slot", numeric: true, title: "Overall pick number, once the prior season is final" },
  { key: "player_name", label: "Player", numeric: false, title: "Once that year's draft has actually happened" },
];

const ADMIN_COLS: { key: string; label: string; numeric: boolean; title?: string }[] = [
  { key: "value", label: "Value", numeric: true, title: "KeepTradeCut dynasty market value — see each row for how precisely it's priced" },
];

// Every board load starts with the CURRENT season's picks — already fully
// drafted before this season's Week 1 (real rookie drafts happen at the
// start of the season, not the end) — so they're the one year on this
// board that's already history, not a real future to plan around. Kept
// reachable (Tommy: "it's nice to know who had whose pick though"), just
// not the default view. `years[0]` is always this season, since
// all_picks_board() starts its horizon at config.SEASON.
const FUTURE_ONLY = "future";

export default function PickFuturesPage() {
  const { teamName, meta, adminUnlocked } = useApp();
  const boardTableRef = useRef<HTMLTableElement>(null);
  const futures = useJson<PickFutures>("pick_futures.json");
  const board = futures.data?.board ?? [];
  const cols = adminUnlocked ? [...COLS, ...ADMIN_COLS] : COLS;

  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>(FUTURE_ONLY);

  const years = useMemo(
    () => [...new Set(board.map((p) => p.season))].sort((a, b) => a - b),
    [board],
  );
  const archivedSeason = years[0];

  const filtered = useMemo(() => {
    return board.filter((p) => {
      if (yearFilter === FUTURE_ONLY) {
        if (p.season === archivedSeason) return false;
      } else if (yearFilter !== "all" && String(p.season) !== yearFilter) {
        return false;
      }
      if (teamFilter !== "all" && p.current_owner_id !== Number(teamFilter)) return false;
      return true;
    });
  }, [board, teamFilter, yearFilter, archivedSeason]);

  const sort = useSort<PickFutures["board"][number]>("season", 1, (r, key) => {
    if (key === "original") return teamName(r.original_team_id);
    if (key === "owner") return teamName(r.current_owner_id);
    return r[key as keyof typeof r] as number | string | null;
  });
  const rows = useSorted(filtered, sort);

  return (
    <section className="section">
      <div className="section-head">
        <h2>Pick futures board</h2>
        <span className="label">
          every team's slate of upcoming rookie-draft picks
          <ScreenshotButton targetRef={boardTableRef} filename="pick-futures" />
        </span>
      </div>
      {futures.error && <div className="error-state" style={{ marginBottom: "1rem" }}>{futures.error}</div>}
      {futures.loading ? (
        <p className="muted" style={{ fontStyle: "italic" }}>Loading...</p>
      ) : board.length === 0 ? (
        !futures.error && <EmptyState>No pick data on file yet.</EmptyState>
      ) : (
        <>
          <div style={{ display: "flex", gap: "1.25rem", marginBottom: "0.9rem" }}>
            <label>
              <span className="label">Team&nbsp;</span>
              <select className="control" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                <option value="all">All teams</option>
                {(meta?.teams ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Draft year&nbsp;</span>
              <select className="control" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                <option value={FUTURE_ONLY}>Future picks only</option>
                <option value="all">All years (includes the drafted {archivedSeason} class)</option>
                {years.map((y) => (
                  <option key={y} value={y}>{y}{y === archivedSeason ? " (already drafted)" : ""}</option>
                ))}
              </select>
            </label>
          </div>

          {rows.length === 0 ? (
            <EmptyState>No picks match that filter.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="stat" ref={boardTableRef}>
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th key={c.key} scope="col" className={`sortable${c.numeric ? " num" : ""}`}
                        title={c.title}
                        aria-sort={sort.ariaSort(c.key)}
                        onClick={() => sort.toggle(c.key, c.numeric ? 1 : -1)}>
                        {c.label}{sort.marker(c.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={`${p.season}-${p.round}-${p.original_team_id}`}>
                      <td className="num">{p.season}</td>
                      <td className="num">{p.round}</td>
                      <td className={p.original_team_id !== p.current_owner_id ? "muted" : undefined}>
                        <TeamLink id={p.original_team_id}>{teamName(p.original_team_id)}</TeamLink>
                      </td>
                      <td>
                        <strong><TeamLink id={p.current_owner_id}>{teamName(p.current_owner_id)}</TeamLink></strong>
                        {p.original_team_id !== p.current_owner_id && (
                          <span className="muted" style={{ fontSize: "0.75rem" }}> · traded</span>
                        )}
                      </td>
                      <td className="muted">{STATUS_LABEL[p.status]}</td>
                      <td className="num muted">{p.overall_pick ?? "—"}</td>
                      <td>{p.player_name ?? "—"}</td>
                      {adminUnlocked && (
                        <td className="num" title={VALUE_BASIS_LABEL[p.value_basis]}>
                          {pts(p.value, 0)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
