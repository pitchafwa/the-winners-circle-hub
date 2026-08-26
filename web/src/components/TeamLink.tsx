import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** Wraps any rendered team name in a link to that franchise's page.
 * Defaults to the "team-link" class (inherits the surrounding text's own
 * color/weight, underlines only on hover) so dropping this into a dense
 * stat table doesn't turn every row teal — pass a different className for
 * a context that wants the louder default link color. */
export default function TeamLink({
  id, className = "team-link", children,
}: {
  id: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to={`/franchise/${id}`} className={className}>
      {children}
    </Link>
  );
}
