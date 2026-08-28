import { useMemo, useRef } from "react";
import { useApp } from "../state/AppContext";
import { useJson } from "../lib/data";
import { signed } from "../lib/format";
import { useSort, useSorted } from "../lib/useSort";
import EmptyState from "../components/EmptyState";
import ScreenshotButton from "../components/ScreenshotButton";
import SuperlativeCard from "../components/SuperlativeCard";
import TeamLink from "../components/TeamLink";
import type { Superlatives } from "../types/data";

interface TallyRow {
  id: number;
  counts: Map<string, number>;
  points: number;
  total: number;
}

const AWARD_ORDER = [
  "highest_score", "best_coach", "blowout", "projection_buster", "waiver_hero",
  "nail_biter", "luckiest", "unluckiest", "bust", "worst_benching", "lowest_score",
];

const SHORT_LABEL: Record<string, string> = {
  highest_score: "High",
  best_coach: "Coach",
  blowout: "Blowout",
  projection_buster: "Buster",
  waiver_hero: "Hero",
  nail_biter: "Nail-biter",
  luckiest: "Lucky",
  unluckiest: "Unlucky",
  bust: "Bust",
  worst_benching: "Benched",
  lowest_score: "Low",
};

export default function TrophyCasePage() {
  const { season, meta, teamName } = useApp();
  const tallyTableRef = useRef<HTMLTableElement>(null);
  const certificatesGridRef = useRef<HTMLDivElement>(null);
  const superlatives = useJson<Superlatives>(season !== null ? `${season}/superlatives.json` : null);

  const tally: TallyRow[] | null = useMemo(() => {
    const s = superlatives.data;
    if (!s) return null;
    const byTeam = new Map<number, { counts: Map<string, number>; points: number; total: number }>();
    for (const a of s.awards) {
      const t = byTeam.get(a.team_id) ?? { counts: new Map(), points: 0, total: 0 };
      t.counts.set(a.key, (t.counts.get(a.key) ?? 0) + 1);
      t.points += s.awards_meta[a.key]?.points ?? 0;
      t.total += 1;
      byTeam.set(a.team_id, t);
    }
    return [...byTeam.entries()]
      .map(([id, t]) => ({ id, ...t }))
      .sort((a, b) => b.points - a.points || b.total - a.total);
  }, [superlatives.data]);

  const { teamName: tn } = useApp();
  const sortHook = useSort<TallyRow>("points", -1, (r, key) => {
    if (key === "team") return tn(r.id);
    if (key === "points") return r.points;
    return r.counts.get(key) ?? 0;
  });
  const sortedTally = useSorted(tally ?? [], sortHook);

  if (!meta) return null;

  const keys = superlatives.data
    ? AWARD_ORDER.filter((k) => superlatives.data!.awards_meta[k])
    : [];
  const champion = tally && tally.length > 0 && meta.season_started ? tally[0] : null;
  const latest = superlatives.data?.awards.filter((a) => a.week === (meta.completed_weeks.at(-1) ?? -1)) ?? [];

  return (
    <>
      {champion && (
        <section className="hero">
          <p className="label">{meta.season} Superlative Champion{meta.season_over ? "" : " (so far)"}</p>
          <h2 className="hero-headline" style={{ color: "var(--gold)" }}>
            {teamName(champion.id)}
          </h2>
          <p className="hero-sub muted">
            {champion.total} weekly awards · <span className="num">{signed(champion.points, 0)}</span>{" "}
            trophy points. Awards are worth points — gold ones a lot, embarrassing ones less than zero.
          </p>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>The tally</h2>
          <span className="label">
            every weekly award, all season
            <ScreenshotButton targetRef={tallyTableRef} filename="trophy-tally" />
          </span>
        </div>
        {superlatives.error && <div className="error-state">{superlatives.error}</div>}
        {!meta.season_started && (
          <EmptyState>Superlatives open with week 1. Every week hands out {keys.length || 11} awards.</EmptyState>
        )}
        {tally && meta.season_started && superlatives.data && (
          <div className="table-wrap">
            <table className="stat" ref={tallyTableRef}>
              <thead>
                <tr>
                  <th scope="col" className="sortable" aria-sort={sortHook.ariaSort("team")}
                    onClick={() => sortHook.toggle("team", 1)}>
                    Team{sortHook.marker("team")}
                  </th>
                  {keys.map((k) => (
                    <th key={k} scope="col" className="num sortable"
                      title={`${superlatives.data!.awards_meta[k].label} — ${superlatives.data!.awards_meta[k].description}`}
                      aria-sort={sortHook.ariaSort(k)} onClick={() => sortHook.toggle(k)}>
                      {SHORT_LABEL[k] ?? superlatives.data!.awards_meta[k].label}{sortHook.marker(k)}
                    </th>
                  ))}
                  <th scope="col" className="num sortable" aria-sort={sortHook.ariaSort("points")}
                    onClick={() => sortHook.toggle("points")}>
                    Points{sortHook.marker("points")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedTally.map((t) => (
                  <tr key={t.id}>
                    <td><TeamLink id={t.id}><strong>{teamName(t.id)}</strong></TeamLink></td>
                    {keys.map((k) => {
                      const n = t.counts.get(k) ?? 0;
                      return (
                        <td key={k} className={`num ${n === 0 ? "muted" : ""}`}>
                          {n === 0 ? "·" : n}
                        </td>
                      );
                    })}
                    <td className={`num ${t.points > 0 ? "pos" : t.points < 0 ? "neg" : ""}`}>
                      <strong>{signed(t.points, 0)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {latest.length > 0 && superlatives.data && (
        <section className="section">
          <div className="section-head">
            <h2>Latest certificates</h2>
            <span className="label">
              week {meta.completed_weeks.at(-1)}
              <ScreenshotButton targetRef={certificatesGridRef} filename={`certificates-week${meta.completed_weeks.at(-1)}`} />
            </span>
          </div>
          <div className="card-grid" ref={certificatesGridRef}>
            {latest.map((a, i) => (
              <SuperlativeCard key={a.key} award={a} meta={superlatives.data!.awards_meta[a.key]} index={i} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
