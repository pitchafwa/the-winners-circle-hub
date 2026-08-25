/** Display order for a matchup card's lineup grid. The real ESPN slot
 * order (QB, RB, RB, RB/WR, WR, WR, TE, D/ST, K, FLEX) puts one flex-type
 * slot ahead of the pure WR slots and the other at the very end — Tommy
 * wants both flex slots grouped right after the WRs instead. This is
 * purely a rendering permutation: the real slot order everywhere else
 * (the optimal-lineup computation, `meta.starting_slots` itself, roster-
 * strength calcs, any other consumer) is untouched — only a lineup grid
 * that's actually rendering rows on screen uses this. */
const SLOT_DISPLAY_PRIORITY: Record<string, number> = {
  QB: 0, RB: 1, WR: 2, "RB/WR": 3, FLEX: 4, TE: 5, "D/ST": 6, K: 7,
};

function priority(slot: string): number {
  return SLOT_DISPLAY_PRIORITY[slot] ?? 99;
}

/** Returns the original indices of `slots`, reordered for display. A
 * stable sort (guaranteed by the JS spec) so same-named slots — the two
 * RB slots, the two WR slots — keep their original relative order. */
export function displayOrderIndices(slots: string[]): number[] {
  return slots
    .map((slot, i) => ({ slot, i }))
    .sort((a, b) => priority(a.slot) - priority(b.slot))
    .map((x) => x.i);
}
