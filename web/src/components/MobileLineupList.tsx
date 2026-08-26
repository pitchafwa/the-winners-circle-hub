import { useLayoutEffect, useRef, useState } from "react";
import { pts } from "../lib/format";
import PlayerHeadshot from "./PlayerHeadshot";

// LineupPlayer and WeekLineupPlayer (the two real per-player shapes this
// renders) both satisfy this structurally — no need to import either type
// here, just the fields actually used.
export interface StackablePlayer {
  player_id: number | null;
  name: string | null;
  position: string | null;
  pro_team: string | null;
  slot: string;
  actual: number | null;
  projected: number | null;
  played: boolean;
  on_fire: boolean;
  on_ice: boolean;
}

// "Christian Watson" -> "C. Watson". D/ST entries ("49ers D/ST") aren't a
// person's name — abbreviating the first word would mangle the team name,
// so callers only invoke this for real players.
function abbreviateName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function StackedRow({ p }: { p: StackablePlayer | undefined }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [abbreviate, setAbbreviate] = useState(false);
  const name = p?.name ?? "";
  const icon = p?.on_fire ? "🔥" : p?.on_ice ? "🧊" : "";
  const canAbbreviate = p != null && p.position !== "D/ST";

  // A name only needs abbreviating when the FULL name (plus icon) would
  // overflow the row's available width — not every long name does, and
  // re-measuring against whatever's currently displayed would oscillate
  // (abbreviate -> now it fits -> un-abbreviate -> overflows again). So
  // this always measures the full, un-abbreviated name via an offscreen
  // probe, against the wrap's own width — which flexbox holds constant
  // regardless of its content, since it's the row's only flex:1 item.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || !canAbbreviate) return;
    const check = () => {
      const available = el.clientWidth;
      if (available === 0) return;
      const probe = document.createElement("span");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.whiteSpace = "nowrap";
      probe.style.left = "-9999px";
      probe.style.font = getComputedStyle(el).font;
      probe.textContent = icon ? `${name} ${icon}` : name;
      document.body.appendChild(probe);
      const needed = probe.getBoundingClientRect().width;
      document.body.removeChild(probe);
      setAbbreviate(needed > available);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [name, icon, canAbbreviate]);

  if (!p) return null;
  const displayName = abbreviate && canAbbreviate ? abbreviateName(name) : name;

  return (
    <div className="c-row">
      <span className="c-badge">{p.slot}</span>
      {p.player_id === null ? (
        <span className="c-name-wrap"><span className="c-name muted">Empty</span></span>
      ) : (
        <>
          <PlayerHeadshot playerId={p.player_id} position={p.position} proTeam={p.pro_team} className="leaderboard-headshot" />
          <span className="c-name-wrap" ref={wrapRef}>
            <span className="c-name">{displayName}</span>
            {p.on_fire && <span className="on-fire-flame" title="On fire — well ahead of projection">🔥</span>}
            {p.on_ice && <span className="on-fire-flame" title="Ice cold — well behind projection">🧊</span>}
          </span>
          <span className="c-stat">
            {p.played ? pts(p.actual) : <span className="muted">—</span>}
            <span className="muted"> /{pts(p.projected)}</span>
          </span>
        </>
      )}
    </div>
  );
}

/** Option C — Tommy's pick for mobile: a full-width stacked list per team
 * (away, then home) instead of the desktop's 3-column side-by-side grid.
 * Position renders as the same small badge desktop's middle slot column
 * uses (.c-badge), just inline before the name instead of in its own
 * column — there's no room on a phone for 3 columns to stay legible, and
 * giving every row the full card width means a name almost never needs
 * to wrap, unlike the side-by-side layout this replaces on mobile.
 * Desktop is entirely unaffected — see the .mu-grid / .mobile-lineup
 * toggle in global.css, this component only ever renders (visibly) below
 * 640px. */
export default function MobileLineupList({
  awayName, awayPlayers, homeName, homePlayers,
}: {
  awayName: string;
  awayPlayers: (StackablePlayer | undefined)[];
  homeName: string;
  homePlayers: (StackablePlayer | undefined)[];
}) {
  return (
    <div className="mobile-lineup">
      <div className="team-block">
        <div className="team-block-head">{awayName}</div>
        {awayPlayers.map((p, i) => <StackedRow key={p?.player_id ?? `empty-${i}`} p={p} />)}
      </div>
      <div className="team-block">
        <div className="team-block-head">{homeName}</div>
        {homePlayers.map((p, i) => <StackedRow key={p?.player_id ?? `empty-${i}`} p={p} />)}
      </div>
    </div>
  );
}
