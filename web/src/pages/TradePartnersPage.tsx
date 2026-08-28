import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../state/AppContext";
import PasswordGate from "../components/PasswordGate";
import EmptyState from "../components/EmptyState";
import TeamLink from "../components/TeamLink";
import { fetchTradePartners } from "../lib/tradeAnalyzerApi";
import type { TradePartner, TradePartnerMatch } from "../lib/tradeAnalyzerApi";

function matchLabel(m: TradePartnerMatch): string {
  return m.direction === "they_help_you"
    ? `They can fill your ${m.position}`
    : `You can fill their ${m.position}`;
}

function PartnerCard({ partner, rank }: { partner: TradePartner; rank: number }) {
  const { teamName } = useApp();
  return (
    <div className="stat-block" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", padding: "0.9rem 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
        <span className="label" style={{ fontSize: "0.7rem" }}>#{rank}</span>
        <h3 style={{ margin: 0, flex: 1 }}>
          <TeamLink id={partner.team_id}>{teamName(partner.team_id)}</TeamLink>
        </h3>
        <span className="num muted" title="Mutual positional fit — higher means each side is strong exactly where the other is thin">
          fit {partner.fit_score.toFixed(2)}
        </span>
      </div>
      {partner.matches.length === 0 ? (
        <p className="muted" style={{ fontStyle: "italic", margin: 0, fontSize: "0.85rem" }}>
          No clear positional overlap right now.
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {partner.matches.slice(0, 4).map((m) => (
            <li key={`${m.position}-${m.direction}`}
              className={m.direction === "they_help_you" ? "pos" : "muted"}
              style={{
                fontSize: "0.75rem", padding: "0.15rem 0.5rem", borderRadius: "999px",
                border: "1px solid var(--rule)",
              }}>
              {matchLabel(m)}
            </li>
          ))}
        </ul>
      )}
      <Link to="/admin/trade-analyzer" className="muted" style={{ fontSize: "0.75rem" }}>
        Open in Trade Analyzer →
      </Link>
    </div>
  );
}

export default function TradePartnersPage() {
  const { seasonsIndex, meta, myTeamId, setMyTeamId } = useApp();
  const season = seasonsIndex?.default_season ?? null;
  const [state, setState] = useState<{ partners: TradePartner[] | null; loading: boolean; error: string | null }>({
    partners: null, loading: false, error: null,
  });

  useEffect(() => {
    if (season === null || myTeamId === null) {
      setState({ partners: null, loading: false, error: null });
      return;
    }
    let alive = true;
    setState({ partners: null, loading: true, error: null });
    fetchTradePartners({ season, myTeamId })
      .then((res) => { if (alive) setState({ partners: res.partners, loading: false, error: null }); })
      .catch((err: Error) => { if (alive) setState({ partners: null, loading: false, error: err.message }); });
    return () => { alive = false; };
  }, [season, myTeamId]);

  return (
    <PasswordGate>
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2>Trade partners</h2>
          <span className="label">every team ranked by how much their positional surplus overlaps your need, and yours theirs</span>
        </div>

        <label style={{ display: "block", marginBottom: "1rem" }}>
          <span className="label">Your team&nbsp;</span>
          <select className="control" value={myTeamId ?? ""}
            onChange={(e) => setMyTeamId(e.target.value ? Number(e.target.value) : null)}>
            <option value="" disabled>Pick your team…</option>
            {(meta?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>

        {myTeamId === null && <EmptyState>Pick your team above to see ranked trade partners.</EmptyState>}
        {state.loading && <p className="muted" style={{ fontStyle: "italic" }}>Loading...</p>}
        {state.error && <div className="error-state">{state.error}</div>}
        {state.partners && state.partners.length === 0 && (
          <EmptyState>No other teams on file right now.</EmptyState>
        )}
        {state.partners && state.partners.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.75rem" }}>
            {state.partners.map((p, i) => <PartnerCard key={p.team_id} partner={p} rank={i + 1} />)}
          </div>
        )}
      </section>
    </PasswordGate>
  );
}
