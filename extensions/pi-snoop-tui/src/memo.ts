import { cell } from './cell.ts';

/** A function that remembers its last call. `reset` forgets it, so the next call computes again. */
export interface Memo<A extends readonly unknown[], R> {
  readonly get: (...args: A) => R;
  readonly reset: () => void;
}

function sameArgs(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

/** Reuses the last result while every argument is unchanged. Pass `same` when some argument needs a structural comparison. */
export function memoLast<A extends readonly unknown[], R>(compute: (...args: A) => R, same: (a: A, b: A) => boolean = sameArgs): Memo<A, R> {
  const last = cell<{ readonly args: A; readonly value: R } | undefined>(undefined);
  return {
    get(...args) {
      const hit = last.read();
      if (hit && same(hit.args, args)) return hit.value;
      const value = compute(...args);
      last.write({ args, value });
      return value;
    },
    reset() {
      last.write(undefined);
    },
  };
}
