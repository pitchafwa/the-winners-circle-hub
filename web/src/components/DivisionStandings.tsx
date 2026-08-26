import { useApp } from "../state/AppContext";
import { pct, pts, MISSING } from "../lib/format";
import TeamLink from "./TeamLink";
import type { SimTeam, StandingsRow } from "../types/data";

const PLAYOFF_SPOTS_PER_DIVISION = 3;

function seasonStarted(rows: StandingsRow[]): boolean {
  return rows.some((r) => r.wins + r.losses + r.ties > 0);
}

export default function DivisionStandings({
  name,
  rows,
  simByTeam,
}: {
  name: string;
  rows: StandingsRow[];
  simByTeam: Map<number, SimTeam>;
}) {
  const { teamName } = useApp();
  const started = seasonStarted(rows);
  // Once real games exist, the real (tiebreak-aware) division rank drives
  // order. Before that, division_rank is arbitrary noise (nothing to break
  // a tie with yet) — sort by playoff odds instead, the only real signal
  // that exists preseason.
  const sorted = started
    ? [...rows].sort((a, b) => (a.division_rank ?? 99) - (b.division_rank ?? 99))
    : [...rows].sort(
        (a, b) => (simByTeam.get(b.team_id)?.playoff_pct ?? 0) - (simByTeam.get(a.team_id)?.playoff_pct ?? 0),
      );

  return (
    <div>
      <p className="label" style={{ marginBottom: "0.5rem" }}>{name}</p>
      <div className="table-wrap">
        <table className="stat division-race-table">
          <thead>
            <tr>
              <th className="num" scope="col">#</th>
              <th scope="col">Team</th>
              <th className="num" scope="col">W-L</th>
              <th className="num" scope="col">Strk</th>
              <th className="num" scope="col">Div</th>
              <th className="num" scope="col">GB</th>
              <th className="num" scope="col">Playoff</th>
              <th className="num" scope="col">Title</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const sim = simByTeam.get(r.team_id);
              const inPlayoffs = i < PLAYOFF_SPOTS_PER_DIVISION;
              const cls = [
                inPlayoffs ? "in" : null,
                // Thicker rule under the last playoff-position row instead
                // of a separate "playoff cutline" label row.
                i === PLAYOFF_SPOTS_PER_DIVISION - 1 ? "cutline" : null,
              ].filter(Boolean).join(" ") || undefined;
              return (
                <tr key={r.team_id} className={cls}>
                  <td className="num">{i + 1}</td>
                  <td><TeamLink id={r.team_id}><strong>{teamName(r.team_id)}</strong></TeamLink></td>
                  <td className="num">{r.record}</td>
                  <td className="num">{started ? (r.streak || MISSING) : MISSING}</td>
                  <td className="num">{r.division_record}</td>
                  <td className="num">{started ? pts(r.games_back) : "0"}</td>
                  <td className="num">{sim ? pct(sim.playoff_pct, 0) : MISSING}</td>
                  <td className="num">
                    <span className="division-title-cell">
                      <span aria-hidden="true">🏆</span>
                      <span className="num">{sim ? pct(sim.title_pct, 1) : MISSING}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
