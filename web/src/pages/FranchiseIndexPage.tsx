import { Link } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { useJson } from "../lib/data";
import type { Badges } from "../types/data";

export default function FranchiseIndexPage() {
  const { meta } = useApp();
  const badges = useJson<Badges>("badges.json");

  if (!meta) return null;

  return (
    <section className="section">
      <div className="section-head">
        <h2>Franchises</h2>
        <span className="label">every team's full history, one page each</span>
      </div>
      <div className="card-grid">
        {meta.teams.map((t) => {
          const titles = (badges.data?.teams[String(t.id)] ?? []).filter((b) => b.type === "champion").length;
          return (
            <Link key={t.id} to={`/franchise/${t.id}`} className="trade-card" style={{ display: "block" }}>
              <div className="label">{t.nickname ?? t.owner}</div>
              <div className="trade-teams">{t.name}</div>
              {titles > 0 && <div className="muted">{"🏆".repeat(titles)}</div>}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
