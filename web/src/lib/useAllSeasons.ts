import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { loadJson } from "./data";
import type { Meta, Schedule, Standings } from "../types/data";

export interface SeasonBundle {
  season: number;
  meta: Meta;
  standings: Standings;
  schedule: Schedule;
}

/** Fans out to every season's meta/standings/schedule at once — the shared
 * fetch behind every cross-season page (History's sub-pages, Draft, Franchise). */
export function useAllSeasons(): { bundles: SeasonBundle[]; loading: boolean; error: string | null } {
  const { seasonsIndex } = useApp();
  const [state, setState] = useState<{ bundles: SeasonBundle[]; loading: boolean; error: string | null }>({
    bundles: [], loading: true, error: null,
  });

  useEffect(() => {
    if (!seasonsIndex) return;
    let alive = true;
    Promise.all(
      seasonsIndex.seasons.map(async (s) => {
        const [meta, standings, schedule] = await Promise.all([
          loadJson<Meta>(`${s.season}/meta.json`),
          loadJson<Standings>(`${s.season}/standings.json`),
          loadJson<Schedule>(`${s.season}/schedule.json`),
        ]);
        return { season: s.season, meta: meta!, standings: standings!, schedule: schedule! };
      }),
    )
      .then((bundles) => alive && setState({ bundles, loading: false, error: null }))
      .catch((e: Error) => alive && setState({ bundles: [], loading: false, error: e.message }));
    return () => { alive = false; };
  }, [seasonsIndex]);

  return state;
}
