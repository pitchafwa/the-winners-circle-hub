import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import PlayerCardModal from "../components/PlayerCardModal";

export interface PlayerCardTarget {
  playerId: number;
  name?: string;
  position?: string | null;
  proTeam?: string | null;
}

interface PlayerCardContextValue {
  open: (target: PlayerCardTarget) => void;
}

const PlayerCardContext = createContext<PlayerCardContextValue | null>(null);

export function usePlayerCard(): PlayerCardContextValue {
  const ctx = useContext(PlayerCardContext);
  if (!ctx) throw new Error("usePlayerCard must be used within a PlayerCardProvider");
  return ctx;
}

/** Mounted once (Layout.tsx, wraps every route) so any component — League's
 * Recent Activity, My Team's roster table, a Matchups lineup row — can
 * open a card without prop-drilling a callback down through every layer.
 * The modal itself only ever exists when a card is open, rendered here as
 * the provider's own extra child. */
export function PlayerCardProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<PlayerCardTarget | null>(null);
  const open = useCallback((t: PlayerCardTarget) => setTarget(t), []);
  const close = useCallback(() => setTarget(null), []);
  return (
    <PlayerCardContext.Provider value={{ open }}>
      {children}
      {target && <PlayerCardModal target={target} onClose={close} />}
    </PlayerCardContext.Provider>
  );
}
