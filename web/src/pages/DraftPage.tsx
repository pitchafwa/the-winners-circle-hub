import { useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { useOptionalJson } from "../lib/data";
import { pts, signed } from "../lib/format";
import { useSort, useSorted } from "../lib/useSort";
import EmptyState from "../components/EmptyState";
import PlayerHeadshot from "../components/PlayerHeadshot";
import ScreenshotButton from "../components/ScreenshotButton";
import TeamLink from "../components/TeamLink";
import type { Draft } from "../types/data";

const BOARD_COLS: { key: string; label: string; numeric: boolean; title?: string }[] = [
  { key: "overall", label: "Pick", numeric: true },
  { key: "name", label: "Player", numeric: false },
  { key: "position", label: "Pos", numeric: false },
  { key: "team", label: "Team", numeric: false },
  { key: "value", label: "Value", numeric: true, title: "Current dynasty trade value (0-9999)" },
  { key: "expected_value", label: "Slot par", numeric: true, title: "Smoothed expected value for that draft slot" },
  { key: "value_diff", label: "Value diff", numeric: true, title: "What efficiency grades are based on" },
  { key: "points", label: "Fantasy pts", numeric: true, title: "Informational only — not used for grading" },
];

function GradeTable({
  title, sub, rows, valueLabel, valueOf,
}: {
  title: string;
  sub: string;
  rows: { team_id: number; grade: string }[];
  valueLabel: string;
  valueOf: (r: { team_id: number; grade: string }) => { text: string; tone: "pos" | "neg" | "" };
}) {
  const { teamName } = useApp();
  const tableRef = useRef<HTMLTableElement>(null);
  return (
    <div>
      <h3 style={{ fontSize: "1.05rem", marginBottom: "0.15rem" }}>
        {title}
        <ScreenshotButton targetRef={tableRef} filename={title.toLowerCase().replace(/\s+/g, "-")} />
      </h3>
      <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.6rem" }}>{sub}</p>
      <div className="table-wrap">
        <table className="stat" ref={tableRef}>
          <thead>
            <tr>
              <th scope="col">Grade</th>
              <th scope="col">Team</th>
              <th scope="col" className="num">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const v = valueOf(g);
              return (
                <tr key={g.team_id}>
                  <td className="mono" style={{ fontSize: "1.1rem", fontWeight: 600, textAlign: "left" }}>
                    {g.grade}
                  </td>
                  <td><TeamLink id={g.team_id}><strong>{teamName(g.team_id)}</strong></TeamLink></td>
                  <td className={`num ${v.tone}`}>{v.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DraftCard({ draft }: { draft: Draft }) {
  const { teamName } = useApp();
  const [showAll, setShowAll] = useState(false);
  const boardTableRef = useRef<HTMLTableElement>(null);
  const graded = draft.picks.filter((p) => p.value_diff !== null);
  const steals = [...graded].sort((a, b) => b.value_diff! - a.value_diff!).slice(0, 5);
  const busts = [...graded].sort((a, b) => a.value_diff! - b.value_diff!).slice(0, 5);
  const boardSort = useSort<Draft["picks"][number]>("overall", 1, (r, key) =>
    key === "team" ? teamName(r.team_id) : (r[key as keyof typeof r] as number | string | null),
  );
  const boardRows = useSorted(draft.picks, boardSort);

  if (!draft.valuation_available) {
    return (
      <EmptyState>
        Dynasty valuations weren't reachable for this build (network issue,
        no cache yet) — draft grades will appear once they're available.
      </EmptyState>
    );
  }

  return (
    <div>
      <div className="two-col" style={{ gap: "1.5rem" }}>
        <GradeTable
          title="Haul grade" sub="Share of the whole class's current dynasty value — who ended up with the best team, regardless of cost."
          rows={draft.haul_grades} valueLabel="Share"
          valueOf={(g) => {
            const h = g as (typeof draft.haul_grades)[number];
            return { text: h.share_pct !== null ? `${h.share_pct}%` : "—", tone: "" };
          }}
        />
        <GradeTable
          title="Efficiency grade" sub="Value found relative to draft slot — who got the best bargains, independent of volume spent."
          rows={draft.efficiency_grades} valueLabel="Value vs slot"
          valueOf={(g) => {
            const e = g as (typeof draft.efficiency_grades)[number];
            return { text: signed(e.total_diff, 0), tone: e.total_diff >= 0 ? "pos" : "neg" };
          }}
        />
      </div>

      <div className="record-book" style={{ marginTop: "1.75rem" }}>
        <div>
          <h3 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>Steals</h3>
          <ul className="feed">
            {steals.map((p) => (
              <li key={p.player_id} className="feed-row">
                <span className="num feed-date muted">pk {p.overall}</span>
                {p.player_id !== null && <PlayerHeadshot playerId={p.player_id} position={p.position} className="leaderboard-headshot" />}
                <span><strong>{p.name}</strong> <span className="muted"><TeamLink id={p.team_id}>{teamName(p.team_id)}</TeamLink></span>{" "}
                  <span className="num pos">{signed(p.value_diff, 0)}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>Busts</h3>
          <ul className="feed">
            {busts.map((p) => (
              <li key={p.player_id} className="feed-row">
                <span className="num feed-date muted">pk {p.overall}</span>
                {p.player_id !== null && <PlayerHeadshot playerId={p.player_id} position={p.position} className="leaderboard-headshot" />}
                <span><strong>{p.name}</strong> <span className="muted"><TeamLink id={p.team_id}>{teamName(p.team_id)}</TeamLink></span>{" "}
                  <span className="num neg">{signed(p.value_diff, 0)}</span></span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <button className="label" style={{ marginTop: "1rem", color: "var(--accent)" }}
        onClick={() => setShowAll((s) => !s)}>
        {showAll ? "hide full draft board ↑" : "show full draft board ↓"}
      </button>
      {showAll && <ScreenshotButton targetRef={boardTableRef} filename="draft-board" />}
      {showAll && (
        <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
          <table className="stat" ref={boardTableRef}>
            <thead>
              <tr>
                {BOARD_COLS.map((c) => (
                  <th key={c.key} scope="col" className={`sortable${c.numeric ? " num" : ""}`}
                    title={c.title}
                    aria-sort={boardSort.ariaSort(c.key)}
                    onClick={() => boardSort.toggle(c.key, c.key === "overall" ? 1 : c.numeric ? -1 : 1)}>
                    {c.label}{boardSort.marker(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {boardRows.map((p) => (
                <tr key={`${p.overall}-${p.player_id ?? p.name}`}>
                  <td className="num">{p.overall}</td>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      {p.player_id !== null && <PlayerHeadshot playerId={p.player_id} position={p.position} />}
                      <strong>{p.name}</strong>{p.keeper ? " ⭐" : ""}
                    </span>
                  </td>
                  <td className="muted">{p.position}</td>
                  <td><TeamLink id={p.team_id}>{teamName(p.team_id)}</TeamLink></td>
                  <td className="num">{p.value === null ? "—" : pts(p.value)}</td>
                  <td className="num muted">{p.expected_value === null ? "—" : pts(p.expected_value)}</td>
                  <td className={p.value_diff === null ? "num muted" : `num ${p.value_diff >= 0 ? "pos" : "neg"}`}>
                    {p.value_diff === null ? "—" : signed(p.value_diff, 0)}
                  </td>
                  <td className="num muted">{p.points === null ? "—" : pts(p.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DraftPage() {
  const { season, meta } = useApp();
  const draft = useOptionalJson<Draft>(season !== null ? `${season}/draft.json` : null);

  if (!meta) return null;

  return (
    <section className="section">
      <div className="section-head">
        <h2>Draft report card</h2>
        <span className="label">{season} · value returned vs draft slot</span>
      </div>
      {draft.data ? (
        <DraftCard draft={draft.data} />
      ) : (
        !draft.loading && (
          <EmptyState>
            {meta.season_started
              ? "No draft data on file for this season."
              : "Report cards get graded after the season starts putting up numbers."}
          </EmptyState>
        )
      )}
    </section>
  );
}
