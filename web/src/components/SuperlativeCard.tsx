import { useApp } from "../state/AppContext";
import { pts, pct } from "../lib/format";
import type { Award, AwardMeta } from "../types/data";

function formatValue(award: Award, meta: AwardMeta | undefined): string {
  if (award.key === "best_coach") return pct(award.value / 100, 1);
  if (award.key === "bust") return pts(award.value);
  void meta;
  return pts(award.value);
}

export default function SuperlativeCard({
  award,
  meta,
  index,
}: {
  award: Award;
  meta: AwardMeta | undefined;
  index: number;
}) {
  const { teamName } = useApp();
  const tone = meta?.tone ?? "neutral";
  return (
    <article
      className="superlative-card"
      data-tone={tone}
      style={{ animationDelay: `${Math.min(index * 70, 700)}ms` }}
    >
      <div className={`award-name ${tone}`}>{meta?.label ?? award.key}</div>
      <div className="award-rule" />
      <div className="award-team">{teamName(award.team_id)}</div>
      <div className="award-value">{formatValue(award, meta)}</div>
      <div className="award-detail">{award.detail}</div>
    </article>
  );
}
