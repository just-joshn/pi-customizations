const SLASH = '/';

/** Sum like Python 3.12's sum(): Neumaier-compensated, so totals match the original digit for digit. */
export function pySum(values: readonly number[]): number {
  const state = values.reduce(
    (acc, value) => {
      const next = acc.sum + value;
      const carry = Math.abs(acc.sum) >= Math.abs(value) ? acc.sum - next + value : value - next + acc.sum;
      return { sum: next, carry: acc.carry + carry };
    },
    { sum: 0, carry: 0 },
  );
  return state.carry !== 0 && Number.isFinite(state.carry) ? state.sum + state.carry : state.sum;
}

export interface Total<T> {
  readonly item: T;
  readonly total: number;
}

function* totalsOfSorted<T>(sorted: readonly { readonly item: T; readonly key: string; readonly ms: number; readonly order: number }[]): Generator<Total<T> & { readonly order: number }> {
  let current: (Total<T> & { readonly key: string; readonly order: number }) | undefined;
  for (const entry of sorted) {
    if (current !== undefined && current.key === entry.key) {
      current = { ...current, total: current.total + entry.ms };
      continue;
    }
    if (current !== undefined) yield current;
    current = { item: entry.item, key: entry.key, total: entry.ms, order: entry.order };
  }
  if (current !== undefined) yield current;
}

const compareKeys = (a: string, b: string): number => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

/** Sums `ms` per key, adding in input order, and lists the groups in order of first appearance. */
export function sumBy<T>(items: readonly T[], keyOf: (item: T) => string, msOf: (item: T) => number): Total<T>[] {
  const keyed = items.map((item, order) => ({ item, key: keyOf(item), ms: msOf(item), order }));
  const sorted = keyed.toSorted((a, b) => compareKeys(a.key, b.key));
  return [...totalsOfSorted(sorted)].toSorted((a, b) => a.order - b.order).map(({ item, total }) => ({ item, total }));
}

/** The last path segment, like Python's Path(text).name. */
export function basename(text: string): string {
  return (
    text
      .split(SLASH)
      .filter((part) => part !== '')
      .at(-1) ?? ''
  );
}
