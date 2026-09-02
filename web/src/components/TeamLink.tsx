import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** Wraps any rendered team name in a link to that team's CURRENT-season
 * page (`/team/:id` — same page "My Team" shows for the globally-selected
 * team, just for an arbitrary team without changing that selection),
 * matching the Franchises nav menu's own pivot (2026-09-01) — easy click-
 * through to a team's real current-season roster/results from anywhere in
 * the app, not its historical cross-season page. That historical page is
 * still one click away from there ("View full franchise history →" on
 * MyTeamPage.tsx), so nothing is lost, just relocated behind an extra
 * click for the (rarer) cross-season use case. Defaults to the "team-
 * link" class (inherits the surrounding text's own color/weight,
 * underlines only on hover) so dropping this into a dense stat table
 * doesn't turn every row teal — pass a different className for a context
 * that wants the louder default link color. */
export default function TeamLink({
  id, className = "team-link", children,
}: {
  id: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to={`/team/${id}`} className={className}>
      {children}
    </Link>
  );
}
