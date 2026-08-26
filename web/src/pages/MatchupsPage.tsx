import { useState } from "react";
import { useApp } from "../state/AppContext";
import { useJson, useOptionalJson } from "../lib/data";
import { MISSING, pct, pts } from "../lib/format";
import EmptyState from "../components/EmptyState";
import PlayerHeadshot from "../components/PlayerHeadshot";
import WeeklyMatchupProjections from "../components/WeeklyMatchupProjections";
import type { TeamInfo } from "../components/WeeklyMatchupProjections";
import { displayOrderIndices } from "../lib/lineupOrder";
import type {
  Award, AwardMeta, H2H, LineupPlayer, Matchup, MatchupSide,
  Recaps, Sim, Standings, Superlatives, WeekMatchups,
} from "../types/data";

/** Lines up a team's started lineup against the league's real slot order
 * (e.g. QB, RB, RB, RB/WR, WR, WR, TE, D/ST, K, FLEX) by each player's own
 * real `.slot`, rather than raw array position. A manager who leaves a
 * slot unfilled that week (confirmed real — happens most weeks somewhere
 * in this league's history) makes that team's started-player count fall
 * short of a fully-staffed opponent's; zipping two such lists by index
 * shifts everything after the gap out of alignment, which is what was
 * making some rows' position label not match the player shown there. */
function alignBySlot(lineup: LineupPlayer[], slotOrder: string[]): (LineupPlayer | undefined)[] {
  const bySlot = new Map<string, LineupPlayer[]>();
  for (const p of lineup) {
    if (!p.started) continue;
    const list = bySlot.get(p.slot) ?? [];
    list.push(p);
    bySlot.set(p.slot, list);
  }
  return slotOrder.map((slot) => bySlot.get(slot)?.shift());
}

function PlayerRow({ p }: { p: LineupPlayer | undefined }) {
  if (!p) return <div className="mu-player" />;
  // Same reasoning as the projected card's LineupRow: only show the
  // position tag when it differs from the slot (flex slots, or the bench
  // list where "slot" isn't a real position at all) — a redundant "QB"
  // next to a QB-slot player just invited comparison against the slot
  // column and read as a mismatch even though it wasn't one.
  const showPosition = p.position !== p.slot;
  return (
    <div className="mu-player">
      <span className="mu-name-group">
        <PlayerHeadshot playerId={p.player_id} size={18} />
        <span className="mu-name">
          {p.name}
          {showPosition && <span className="muted mu-pos"> {p.position}</span>}
        </span>
      </span>
      <span className="num mu-pts">
        {pts(p.actual)}
        <span className="muted mu-proj">{p.projected !== null ? ` /${pts(p.projected)}` : ""}</span>
      </span>
    </div>
  );
}

function SideMeta({ side }: { side: MatchupSide }) {
  return (
    <div className="muted mu-meta">
      coach {side.coach_rating !== null ? pct(side.coach_rating) : MISSING} · left{" "}
      {pts(side.bench_points_lost)} benched
      {side.home_bonus > 0 && <> · +{pts(side.home_bonus)} home</>}
      {side.adjustment !== 0 && <> · {side.adjustment > 0 ? "+" : ""}{pts(side.adjustment)} adj</>}
    </div>
  );
}

function Ribbons({ awards, awardsMeta }: { awards: Award[]; awardsMeta: Record<string, AwardMeta> }) {
  if (awards.length === 0) return null;
  return (
    <div className="mu-ribbons">
      {awards.map((a) => {
        const meta = awardsMeta[a.key];
        return (
          <span key={a.key} className="badge-chip mu-ribbon" data-tone={meta?.tone ?? "neutral"} title={a.detail}>
            {meta?.label ?? a.key}
          </span>
        );
      })}
    </div>
  );
}

function MatchupCard({
  m,
  awardsByTeam,
  awardsMeta,
}: {
  m: Matchup;
  awardsByTeam: Map<number, Award[]>;
  awardsMeta: Record<string, AwardMeta>;
}) {
  const { teamName, meta } = useApp();
  if (!m.away) {
    return (
      <article className="mu-card">
        <div className="mu-head">
          <strong>{teamName(m.home.team_id)}</strong>
          <span className="muted">bye</span>
        </div>
      </article>
    );
  }
  const homeWon = m.winner === "HOME";
  const awayWon = m.winner === "AWAY";
  const realSlotOrder = meta?.starting_slots ?? [];
  // Reordered for display only — meta.starting_slots itself (the real
  // ESPN order) is untouched; this permutation just changes what order
  // the grid below renders rows in.
  const slotOrder = displayOrderIndices(realSlotOrder).map((i) => realSlotOrder[i]);
  const homeAligned = alignBySlot(m.home.lineup, slotOrder);
  const awayAligned = alignBySlot(m.away.lineup, slotOrder);

  return (
    <article className="mu-card">
      {m.is_playoff && <div className="label" style={{ marginBottom: "0.4rem" }}>
        {m.playoff_tier === "WINNERS_BRACKET" ? "playoffs" : "consolation"}</div>}
      <div className="mu-head">
        <div className={`mu-team ${awayWon ? "winner" : ""}`}>
          <strong>{teamName(m.away.team_id)}</strong>
          <span className="num mu-total">{pts(m.away.total)}</span>
          <Ribbons awards={awardsByTeam.get(m.away.team_id) ?? []} awardsMeta={awardsMeta} />
        </div>
        <span className="muted mu-at">at</span>
        <div className={`mu-team ${homeWon ? "winner" : ""}`}>
          <strong>{teamName(m.home.team_id)}</strong>
          <span className="num mu-total">{pts(m.home.total)}</span>
          <Ribbons awards={awardsByTeam.get(m.home.team_id) ?? []} awardsMeta={awardsMeta} />
        </div>
      </div>
      <div className="mu-grid">
        <div className="mu-col">
          {slotOrder.map((_slot, i) => (
            <PlayerRow key={i} p={awayAligned[i]} />
          ))}
        </div>
        <div className="mu-slots">
          {slotOrder.map((slot, i) => (
            <div key={i} className="label mu-slot">{slot}</div>
          ))}
        </div>
        <div className="mu-col right">
          {slotOrder.map((_slot, i) => (
            <PlayerRow key={i} p={homeAligned[i]} />
          ))}
        </div>
      </div>
      <div className="mu-footer">
        <SideMeta side={m.away} />
        <SideMeta side={m.home} />
      </div>
      <details className="mu-bench">
        <summary className="label">benches</summary>
        <div className="mu-grid">
          <div className="mu-col">
            {m.away.lineup.filter((p) => !p.started).map((p) => <PlayerRow key={p.player_id} p={p} />)}
          </div>
          <div className="mu-slots" />
          <div className="mu-col right">
            {m.home.lineup.filter((p) => !p.started).map((p) => <PlayerRow key={p.player_id} p={p} />)}
          </div>
        </div>
      </details>
    </article>
  );
}

export default function MatchupsPage() {
  const { season, meta } = useApp();
  const weeks = meta?.completed_weeks ?? [];
  const [chosen, setChosen] = useState<number | null>(null);
  const week = chosen ?? weeks.at(-1) ?? null;
  const data = useJson<WeekMatchups>(
    season !== null && week !== null ? `${season}/matchups/week-${week}.json` : null,
  );
  const recaps = useOptionalJson<Recaps>(season !== null ? `${season}/recaps.json` : null);
  const sim = useOptionalJson<Sim>(season !== null ? `${season}/sim.json` : null);
  const standings = useOptionalJson<Standings>(season !== null ? `${season}/standings.json` : null);
  const superlatives = useOptionalJson<Superlatives>(season !== null ? `${season}/superlatives.json` : null);
  const h2h = useOptionalJson<H2H>("h2h.json");

  if (!meta) return null;

  const recap = week !== null ? recaps.data?.recaps[String(week)] : undefined;
  const teamInfo = new Map<number, TeamInfo>(
    (standings.data?.rows ?? []).map((r) => [r.team_id, { record: r.record, streak: r.streak }]),
  );
  const awardsByTeam = new Map<number, Award[]>();
  for (const a of superlatives.data?.awards ?? []) {
    if (a.week !== week) continue;
    const list = awardsByTeam.get(a.team_id) ?? [];
    list.push(a);
    awardsByTeam.set(a.team_id, list);
  }

  return (
    <>
      {sim.data && sim.data.this_week_matchups?.length > 0 && (
        <section className="section" aria-labelledby="weekly-h">
          <div className="section-head">
            <h2 id="weekly-h">This Week's Games</h2>
            <span className="label">projected score · win probability · playoff stakes</span>
          </div>
          <WeeklyMatchupProjections
            matchups={sim.data.this_week_matchups}
            teamInfo={teamInfo}
            h2hPairs={h2h.data?.pairs ?? []}
          />
        </section>
      )}

      <section className="section" style={sim.data?.this_week_matchups?.length ? { marginTop: "2.5rem" } : undefined}>
        <div className="section-head">
          <h2>Matchups</h2>
          {weeks.length > 0 && (
            <label>
              <span className="label">Week&nbsp;</span>
              <select className="control" value={week ?? ""} onChange={(e) => setChosen(Number(e.target.value))}>
                {weeks.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {weeks.length === 0 && <EmptyState>Matchups appear once games are played. Scores land here every Sunday.</EmptyState>}
        {data.error && <div className="error-state">{data.error}</div>}
        {data.data && (
          <>
            {recap && <p className="recap" style={{ marginBottom: "0.5rem" }}>{recap}</p>}
            <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "1rem" }}>
              Player lines show actual /projected points.
            </p>
            <div className="mu-list">
              {data.data.matchups.map((m, i) => (
                <MatchupCard
                  key={i}
                  m={m}
                  awardsByTeam={awardsByTeam}
                  awardsMeta={superlatives.data?.awards_meta ?? {}}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
