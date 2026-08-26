import type { ReactNode } from "react";
import { usePlayerCard } from "../state/PlayerCardContext";

/** Wraps a player's name (or headshot) to make it open the player card
 * modal on click. D/ST entries use a synthetic negative player_id (not a
 * real ESPN athlete — nothing to fetch), so those render as plain,
 * non-interactive text instead of a dead button. */
export default function PlayerCardTrigger({
  playerId, name, position, proTeam, children,
}: {
  playerId: number | null | undefined;
  name?: string | null;
  position?: string | null;
  proTeam?: string | null;
  children: ReactNode;
}) {
  const { open } = usePlayerCard();
  if (playerId == null || playerId < 0) return <>{children}</>;
  return (
    <button
      type="button"
      className="player-card-trigger"
      onClick={() => open({ playerId, name: name ?? undefined, position, proTeam })}
    >
      {children}
    </button>
  );
}
