import { useMemo, useState } from "react";

export type SortDir = 1 | -1;

/** Shared column-sort state for rankings tables. Null values always sink. */
export function useSort<Row>(
  defaultKey: string,
  defaultDir: SortDir,
  value: (row: Row, key: string) => number | string | null | undefined,
) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({
    key: defaultKey,
    dir: defaultDir,
  });

  const toggle = (key: string, firstDir: SortDir = -1) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: firstDir },
    );

  const arrange = (rows: Row[]): Row[] =>
    [...rows].sort((a, b) => {
      const va = value(a, sort.key);
      const vb = value(b, sort.key);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return 0;
    });

  const ariaSort = (key: string): "ascending" | "descending" | undefined =>
    sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined;

  const marker = (key: string): string =>
    sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "";

  return { sort, toggle, arrange, ariaSort, marker };
}

/** Memoized arrange for convenience. */
export function useSorted<Row>(
  rows: Row[],
  hook: ReturnType<typeof useSort<Row>>,
): Row[] {
  const { arrange, sort } = hook;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => arrange(rows), [rows, sort.key, sort.dir]);
}
