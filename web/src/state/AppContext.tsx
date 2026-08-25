import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useJson } from "../lib/data";
import type { Meta, SeasonsIndex, TeamRef } from "../types/data";

const SEASON_KEY = "league-hub:v1:season";
const MY_TEAM_KEY = "league-hub:v1:my-team";

interface AppState {
  seasonsIndex: SeasonsIndex | null;
  season: number | null;
  setSeason: (s: number) => void;
  meta: Meta | null;
  metaError: string | null;
  loading: boolean;
  teamsById: Map<number, TeamRef>;
  teamName: (id: number | null | undefined) => string;
  /** Franchise identity (team_id) survives renames — this always resolves to
   * the CURRENT roster info, regardless of which season is selected. Use
   * this (not teamsById/teamName) anywhere multiple seasons are shown
   * together, so an old game or stat line is labeled with the name people
   * know the franchise by today, not whatever it was called back then. */
  currentTeamsById: Map<number, TeamRef>;
  currentTeamName: (id: number | null | undefined) => string;
  myTeamId: number | null;
  setMyTeamId: (id: number | null) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const seasonsLoad = useJson<SeasonsIndex>("seasons.json");
  const seasonsIndex = seasonsLoad.data;

  const [seasonChoice, setSeasonChoice] = useState<number | null>(() => {
    const stored = localStorage.getItem(SEASON_KEY);
    return stored ? Number(stored) : null;
  });
  const [myTeamId, setMyTeamState] = useState<number | null>(() => {
    const stored = localStorage.getItem(MY_TEAM_KEY);
    return stored ? Number(stored) : null;
  });

  const season = useMemo(() => {
    if (!seasonsIndex) return null;
    const valid = seasonsIndex.seasons.map((s) => s.season);
    if (seasonChoice !== null && valid.includes(seasonChoice)) return seasonChoice;
    return seasonsIndex.default_season;
  }, [seasonsIndex, seasonChoice]);

  const metaLoad = useJson<Meta>(season !== null ? `${season}/meta.json` : null);
  const currentSeason = seasonsIndex?.default_season ?? null;
  const currentMetaLoad = useJson<Meta>(currentSeason !== null ? `${currentSeason}/meta.json` : null);

  const setSeason = (s: number) => {
    localStorage.setItem(SEASON_KEY, String(s));
    setSeasonChoice(s);
  };

  const setMyTeamId = (id: number | null) => {
    if (id === null) localStorage.removeItem(MY_TEAM_KEY);
    else localStorage.setItem(MY_TEAM_KEY, String(id));
    setMyTeamState(id);
  };

  const teamsById = useMemo(() => {
    const m = new Map<number, TeamRef>();
    metaLoad.data?.teams.forEach((t) => m.set(t.id, t));
    return m;
  }, [metaLoad.data]);

  const currentTeamsById = useMemo(() => {
    const m = new Map<number, TeamRef>();
    currentMetaLoad.data?.teams.forEach((t) => m.set(t.id, t));
    return m;
  }, [currentMetaLoad.data]);

  const value: AppState = {
    seasonsIndex,
    season,
    setSeason,
    meta: metaLoad.data,
    metaError: seasonsLoad.error ?? metaLoad.error,
    loading: seasonsLoad.loading || metaLoad.loading,
    teamsById,
    teamName: (id) => (id === null || id === undefined ? "—" : teamsById.get(id)?.name ?? `Team ${id}`),
    currentTeamsById,
    currentTeamName: (id) =>
      id === null || id === undefined ? "—" : currentTeamsById.get(id)?.name ?? `Team ${id}`,
    myTeamId,
    setMyTeamId,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}
