import { useApp } from "../state/AppContext";
import { pts, pct, signed } from "../lib/format";
import TeamLink from "./TeamLink";
import type { Award, AwardMeta } from "../types/data";

function formatValue(award: Award, meta: AwardMeta | undefined): string {
  if (award.key === "best_coach") return pct(award.value / 100, 1);
  if (award.key === "bust") return pts(award.value);
  // Win-probability-added, not points — a single week's swing is usually
  // well under 0.1, so the default 1 decimal would round almost every
  // real value to "0.0" or "0.1" and lose the number entirely. 3
  // decimals matches the MVP Race chart's own tooltip (same underlying
  // stat, same reason).
  if (award.key === "mvp" || award.key === "lvp") return signed(award.value, 3);
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
      <div className="award-team"><TeamLink id={award.team_id}>{teamName(award.team_id)}</TeamLink></div>
      <div className="award-value">{formatValue(award, meta)}</div>
      <div className="award-detail">{award.detail}</div>
    </article>
  );
}
