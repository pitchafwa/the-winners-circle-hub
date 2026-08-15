import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApp } from "../state/AppContext";
import { loadJson, useJson, useOptionalJson } from "../lib/data";
import { pts, signed } from "../lib/format";
import { useSort, useSorted } from "../lib/useSort";
import EmptyState from "../components/EmptyState";
import { ACCENT, FONT_MONO, INK_MUTED, PAPER_2, RULE } from "../lib/tokens";
import type { Badges, Draft, Meta, Schedule, ScheduleEntry, ScheduleSwap, Standings } from "../types/data";

interface SeasonBundle {
  season: number;
  meta: Meta;
  standings: Standings;
  schedule: Schedule;
}

function useAllSeasons(): { bundles: SeasonBundle[]; loading: boolean; error: string | null } {
  const { seasonsIndex } = useApp();
  const [state, setState] = useState<{ bundles: SeasonBundle[]; loading: boolean; error: string | null }>({
    bundles: [], loading: true, error: null,
  });

  useEffect(() => {
    if (!seasonsIndex) return;
    let alive = true;
    Promise.all(
      seasonsIndex.seasons.map(async (s) => {
        const [meta, standings, schedule] = await Promise.all([
          loadJson<Meta>(`${s.season}/meta.json`),
          loadJson<Standings>(`${s.season}/standings.json`),
          loadJson<Schedule>(`${s.season}/schedule.json`),
        ]);
        return { season: s.season, meta: meta!, standings: standings!, schedule: schedule! };
      }),
    )
      .then((bundles) => alive && setState({ bundles, loading: false, error: null }))
      .catch((e: Error) => alive && setState({ bundles: [], loading: false, error: e.message }));
    return () => { alive = false; };
  }, [seasonsIndex]);

  return state;
}

/** Standings-by-week bump chart for the selected season. */
function BumpChart({ schedule, meta }: { schedule: Schedule; meta: Meta }) {
  const { myTeamId, teamName } = useApp();
  const { data, teamIds } = useMemo(() => {
    const decided = schedule.entries.filter(
      (e) => e.winner !== "UNDECIDED" && !e.is_playoff && e.away_id !== null
        && e.matchup_period <= meta.reg_season_weeks
        && !(e.home_score === 0 && e.away_score === 0),
    );
    const weeks = [...new Set(decided.map((e) => e.matchup_period))].sort((a, b) => a - b);
    const ids = meta.teams.map((t) => t.id);
    const wins = new Map(ids.map((id) => [id, 0]));
    const pf = new Map(ids.map((id) => [id, 0]));
    const rows: Record<string, number>[] = [];
    for (const w of weeks) {
      for (const e of decided.filter((x) => x.matchup_period === w)) {
        pf.set(e.home_id, (pf.get(e.home_id) ?? 0) + e.home_score);
        pf.set(e.away_id!, (pf.get(e.away_id!) ?? 0) + e.away_score);
        if (e.winner === "HOME") wins.set(e.home_id, (wins.get(e.home_id) ?? 0) + 1);
        if (e.winner === "AWAY") wins.set(e.away_id!, (wins.get(e.away_id!) ?? 0) + 1);
        if (e.winner === "TIE") {
          wins.set(e.home_id, (wins.get(e.home_id) ?? 0) + 0.5);
          wins.set(e.away_id!, (wins.get(e.away_id!) ?? 0) + 0.5);
        }
      }
      const ranked = [...ids].sort(
        (a, b) => (wins.get(b)! - wins.get(a)!) || (pf.get(b)! - pf.get(a)!),
      );
      const row: Record<string, number> = { week: w };
      ranked.forEach((id, i) => { row[`t${id}`] = i + 1; });
      rows.push(row);
    }
    return { data: rows, teamIds: ids };
  }, [schedule, meta]);

  if (data.length === 0) return <EmptyState>No completed weeks to chart.</EmptyState>;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
        <CartesianGrid stroke={RULE} vertical={false} strokeWidth={0.5} />
        <XAxis dataKey="week" tick={{ fontFamily: FONT_MONO, fontSize: 11, fill: INK_MUTED }}
          tickLine={false} axisLine={{ stroke: RULE }} />
        <YAxis reversed domain={[1, teamIds.length]} tickCount={teamIds.length}
          tick={{ fontFamily: FONT_MONO, fontSize: 11, fill: INK_MUTED }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: PAPER_2, border: `1px solid ${RULE}`, fontFamily: FONT_MONO, fontSize: "0.72rem" }}
          formatter={(v, name) => [`#${v}`, teamName(Number(String(name).slice(1)))]}
          labelFormatter={(w) => `Week ${w}`}
        />
        {teamIds.map((id) => {
          const mine = id === myTeamId;
          return (
            <Line key={id} type="monotone" dataKey={`t${id}`}
              stroke={mine ? ACCENT : INK_MUTED} strokeWidth={mine ? 2.4 : 1}
              strokeOpacity={mine ? 1 : 0.45} dot={false} />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** All-time head-to-head win matrix, aggregated across every season on
 * record — a single season's H2H is mostly noise at 10 teams (a handful of
 * games each), but the full history actually says something. Franchise
 * slot (team_id) is the join key, so this reads correctly across name/owner
 * changes the same way Franchise Careers already does. */
function H2HMatrix({ bundles, meta }: { bundles: SeasonBundle[]; meta: Meta }) {
  const teams = meta.teams;
  const wins = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bundles) {
      for (const e of b.schedule.entries) {
        if (e.winner === "UNDECIDED" || e.away_id === null) continue;
        if (e.winner === "HOME") m.set(`${e.home_id}>${e.away_id}`, (m.get(`${e.home_id}>${e.away_id}`) ?? 0) + 1);
        if (e.winner === "AWAY") m.set(`${e.away_id}>${e.home_id}`, (m.get(`${e.away_id}>${e.home_id}`) ?? 0) + 1);
      }
    }
    return m;
  }, [bundles]);

  return (
    <div className="table-wrap">
      <table className="stat h2h">
        <thead>
          <tr>
            <th scope="col">vs →</th>
            {teams.map((t) => (
              <th key={t.id} scope="col" className="num" title={t.name}>{t.abbrev || t.id}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((row) => (
            <tr key={row.id}>
              <th scope="row" style={{ borderBottom: `1px solid ${RULE}` }}>{row.name}</th>
              {teams.map((col) => {
                if (row.id === col.id) return <td key={col.id} className="num muted">·</td>;
                const w = wins.get(`${row.id}>${col.id}`) ?? 0;
                const l = wins.get(`${col.id}>${row.id}`) ?? 0;
                return (
                  <td key={col.id} className={`num ${w > l ? "pos" : w < l ? "neg" : "muted"}`}>
                    {w}-{l}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordBook({ bundles }: { bundles: SeasonBundle[] }) {
  const { teamName } = useApp();
  const rows = useMemo(() => {
    const games: { e: ScheduleEntry; season: number; team: number; score: number }[] = [];
    for (const b of bundles) {
      for (const e of b.schedule.entries) {
        if (e.winner === "UNDECIDED" || e.away_id === null) continue;
        if (e.home_score === 0 && e.away_score === 0) continue;
        // consolation games in playoff weeks don't count — only alive teams play
        if (e.matchup_period > b.meta.reg_season_weeks && e.playoff_tier !== "WINNERS_BRACKET") continue;
        games.push({ e, season: b.season, team: e.home_id, score: e.home_score });
        games.push({ e, season: b.season, team: e.away_id, score: e.away_score });
      }
    }
    const high = [...games].sort((a, b) => b.score - a.score).slice(0, 5);
    const low = [...games].sort((a, b) => a.score - b.score).slice(0, 5);
    const blowouts = [...games.filter((g) => g.team === g.e.home_id)]
      .map((g) => {
        const homeWon = g.e.home_score >= g.e.away_score;
        return {
          ...g,
          margin: Math.abs(g.e.home_score - g.e.away_score),
          // name the winner, not whoever happened to be home
          team: homeWon ? g.e.home_id : g.e.away_id!,
          winnerScore: homeWon ? g.e.home_score : g.e.away_score,
          loserScore: homeWon ? g.e.away_score : g.e.home_score,
        };
      })
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 5);
    return { high, low, blowouts };
  }, [bundles]);

  const Table = ({ title, list, value }: {
    title: string;
    list: { season: number; e: ScheduleEntry; team?: number }[];
    value: (x: never) => string;
  }) => (
    <div>
      <h3 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>{title}</h3>
      <ul className="feed">
        {list.map((x, i) => (
          <li key={i} className="feed-row">
            <span className="num feed-date muted">{x.season} wk {x.e.matchup_period}</span>
            <span>
              {"team" in x && x.team !== undefined ? <strong>{teamName(x.team)}</strong> : null}{" "}
              <span className="num">{value(x as never)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="record-book">
      <Table title="Highest scores" list={rows.high}
        value={(x: { score: number }) => pts(x.score)} />
      <Table title="Lowest scores" list={rows.low}
        value={(x: { score: number }) => pts(x.score)} />
      <Table title="Biggest blowouts" list={rows.blowouts}
        value={(x: { margin: number; winnerScore: number; loserScore: number }) =>
          `${pts(x.margin)} (${pts(x.winnerScore)}–${pts(x.loserScore)})`} />
    </div>
  );
}

interface CareerRow {
  id: number;
  seasons: number;
  w: number;
  l: number;
  t: number;
  pf: number;
  pct: number;
  titles: number;
  lasts: number;
}

const CAREER_COLS: { key: keyof CareerRow | "name"; label: string; numeric: boolean }[] = [
  { key: "name", label: "Franchise", numeric: false },
  { key: "seasons", label: "Seasons", numeric: true },
  { key: "pct", label: "Record", numeric: true },
  { key: "pf", label: "PF", numeric: true },
  { key: "titles", label: "Titles", numeric: true },
  { key: "lasts", label: "Last places", numeric: true },
];

function CareerTable({ bundles, badges }: { bundles: SeasonBundle[]; badges: Badges | null }) {
  const { teamName } = useApp();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "pct", dir: -1 });

  const rows = useMemo(() => {
    const acc = new Map<number, { seasons: number; w: number; l: number; t: number; pf: number }>();
    for (const b of bundles) {
      if (!b.meta.season_started) continue;
      for (const r of b.standings.rows) {
        const a = acc.get(r.team_id) ?? { seasons: 0, w: 0, l: 0, t: 0, pf: 0 };
        a.seasons += 1;
        a.w += r.wins; a.l += r.losses; a.t += r.ties; a.pf += r.points_for;
        acc.set(r.team_id, a);
      }
    }
    return [...acc.entries()].map(([id, a]): CareerRow => {
      const bl = badges?.teams[String(id)] ?? [];
      return {
        id, ...a,
        pct: (a.w + 0.5 * a.t) / Math.max(a.w + a.l + a.t, 1),
        titles: bl.filter((x) => x.type === "champion").length,
        lasts: bl.filter((x) => x.type === "last_place").length,
      };
    });
  }, [bundles, badges]);

  const sorted = useMemo(() => {
    const val = (r: CareerRow): number | string =>
      sort.key === "name" ? teamName(r.id) : (r[sort.key as keyof CareerRow] as number);
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return 0;
    });
  }, [rows, sort, teamName]);

  const clickSort = (col: (typeof CAREER_COLS)[number]) =>
    setSort((s) =>
      s.key === col.key
        ? { key: s.key, dir: s.dir === 1 ? -1 : 1 }
        : { key: col.key, dir: col.numeric ? -1 : 1 },
    );

  return (
    <div className="table-wrap">
      <table className="stat">
        <thead>
          <tr>
            {CAREER_COLS.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`sortable${c.numeric ? " num" : ""}`}
                aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                onClick={() => clickSort(c)}
              >
                {c.label}
                {sort.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td><strong>{teamName(r.id)}</strong></td>
              <td className="num">{r.seasons}</td>
              <td className="num">
                {r.w}-{r.l}{r.t ? `-${r.t}` : ""}{" "}
                <span className="muted">({(r.pct * 100).toFixed(1)}%)</span>
              </td>
              <td className="num">{pts(r.pf)}</td>
              <td className="num">{r.titles > 0 ? "🏆".repeat(r.titles) : "—"}</td>
              <td className="num">{r.lasts > 0 ? "💀".repeat(r.lasts) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SwapMatrix({ swap, meta }: { swap: ScheduleSwap; meta: Meta }) {
  const teams = meta.teams;
  const abbrev = new Map(teams.map((t) => [t.id, t.abbrev || String(t.id)]));
  const fullName = new Map(teams.map((t) => [t.id, t.name]));
  return (
    <div className="table-wrap">
      <table className="stat h2h">
        <thead>
          <tr>
            <th scope="col" title="row team plays column team's schedule">with ↓'s scores on →'s schedule</th>
            {teams.map((t) => (
              <th key={t.id} scope="col" className="num" title={t.name}>{abbrev.get(t.id)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {swap.rows.map((r) => {
            const own = r.records[String(r.team_id)];
            const ownPct = own ? (own.wins + 0.5 * own.ties) : 0;
            return (
              <tr key={r.team_id}>
                <th scope="row" style={{ borderBottom: `1px solid ${RULE}` }}>{fullName.get(r.team_id)}</th>
                {teams.map((c) => {
                  const rec = r.records[String(c.id)];
                  if (!rec) return <td key={c.id} className="num muted">—</td>;
                  const self = c.id === r.team_id;
                  const better = (rec.wins + 0.5 * rec.ties) - ownPct;
                  return (
                    <td key={c.id}
                      className={`num ${self ? "" : better > 0 ? "pos" : better < 0 ? "neg" : "muted"}`}
                      style={self ? { background: "var(--paper-2)" } : undefined}
                      title={self ? "actual record" : `${signed(better, 1)} wins vs actual`}>
                      {rec.wins}-{rec.losses}{rec.ties ? `-${rec.ties}` : ""}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.5rem", fontStyle: "italic" }}>
        Each cell: the row team's record if they'd inherited the column team's schedule.
        Green = easier ride than the one they got.
      </p>
    </div>
  );
}

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
  return (
    <div>
      <h3 style={{ fontSize: "1.05rem", marginBottom: "0.15rem" }}>{title}</h3>
      <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.6rem" }}>{sub}</p>
      <div className="table-wrap">
        <table className="stat">
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
                  <td><strong>{teamName(g.team_id)}</strong></td>
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
                <span><strong>{p.name}</strong> <span className="muted">{teamName(p.team_id)}</span>{" "}
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
                <span><strong>{p.name}</strong> <span className="muted">{teamName(p.team_id)}</span>{" "}
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
      {showAll && (
        <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
          <table className="stat">
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
                  <td><strong>{p.name}</strong>{p.keeper ? " ⭐" : ""}</td>
                  <td className="muted">{p.position}</td>
                  <td>{teamName(p.team_id)}</td>
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

export default function HistoryPage() {
  const { season, meta } = useApp();
  const all = useAllSeasons();
  const badges = useJson<Badges>("badges.json");
  const swap = useOptionalJson<ScheduleSwap>(season !== null ? `${season}/schedule_swap.json` : null);
  const draft = useOptionalJson<Draft>(season !== null ? `${season}/draft.json` : null);
  const current = all.bundles.find((b) => b.season === season) ?? null;
  const h2hSeasons = all.bundles.filter((b) => b.meta.season_started).map((b) => b.season);

  if (!meta) return null;

  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2>Season timeline</h2>
          <span className="label">{season} standings by week — your team in green</span>
        </div>
        {current ? <BumpChart schedule={current.schedule} meta={current.meta} /> :
          all.loading ? null : <EmptyState>No schedule data.</EmptyState>}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Head-to-head</h2>
          <span className="label">
            {h2hSeasons.length > 0
              ? `all-time, ${Math.min(...h2hSeasons)}–${Math.max(...h2hSeasons)} · row team's wins vs column team`
              : "row team's wins vs column team"}
          </span>
        </div>
        {h2hSeasons.length > 0 ? (
          <H2HMatrix bundles={all.bundles} meta={meta} />
        ) : all.loading ? null : (
          <EmptyState>The grid fills in once games are played.</EmptyState>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Schedule swap</h2>
          <span className="label">{season} · the argument generator</span>
        </div>
        {swap.data ? (
          <SwapMatrix swap={swap.data} meta={meta} />
        ) : (
          !swap.loading && <EmptyState>Needs at least one completed week.</EmptyState>
        )}
      </section>

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

      <section className="section">
        <div className="section-head">
          <h2>Record book</h2>
          <span className="label">all seasons on file ({all.bundles.map((b) => b.season).sort().join(", ")})</span>
        </div>
        {all.error && <div className="error-state">{all.error}</div>}
        {all.bundles.length > 0 && <RecordBook bundles={all.bundles} />}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Franchise careers</h2>
          <span className="label">every season on record, 2012–present</span>
        </div>
        {all.bundles.length > 0 && <CareerTable bundles={all.bundles} badges={badges.data} />}
        {(badges.data?.unassigned.length ?? 0) > 0 && (
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.75rem", fontStyle: "italic" }}>
            Pre-2018 honors held by departed franchises:{" "}
            {badges.data!.unassigned.map((b) => `${b.team_name_then || "unknown"} (${b.season} ${b.type})`).join(" · ")}
          </p>
        )}
      </section>
    </>
  );
}
