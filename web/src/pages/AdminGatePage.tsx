import { Link } from "react-router-dom";
import PasswordGate from "../components/PasswordGate";

const TOOLS = [
  { to: "/admin/trades", label: "Trades", desc: "Submit and manage trades" },
  { to: "/admin/drafts", label: "Draft Entry", desc: "Enter a season's rookie draft" },
  { to: "/admin/picks", label: "Pick Reassignment", desc: "Fix who holds a future pick, no trade record" },
  { to: "/admin/draft-order", label: "Draft Order", desc: "Override next year's projected draft order" },
  { to: "/admin/trade-analyzer", label: "Trade Analyzer", desc: "What-if a trade against contending/rebuilding value and positional strength" },
  { to: "/admin/buy-low", label: "Buy-Low Targets", desc: "Strong dynasty value, recent production down hard" },
  { to: "/admin/weekly-summary", label: "Weekly Summary", desc: "Generate the weekly recap" },
  { to: "/admin/data", label: "Backup / Restore", desc: "Export or restore hand-entered data" },
];

export default function AdminGatePage() {
  return (
    <PasswordGate>
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2>LM Tools</h2>
          <span className="label">unlocked</span>
        </div>
        <p className="muted" style={{ marginBottom: "1rem" }}>
          Use the "LM Tools" menu in the header from anywhere on the site, or jump straight to a tool below.
        </p>
        <div className="card-grid">
          {TOOLS.map((t) => (
            <Link key={t.to} to={t.to} className="trade-card"
              style={{ display: "block", color: "inherit", textDecoration: "none" }}>
              <div className="trade-teams">{t.label}</div>
              <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>{t.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </PasswordGate>
  );
}
