/** A reassignable slot, so state lives in a closure and every change builds a new value. */
export interface Cell<T> {
  readonly read: () => T;
  readonly write: (next: T) => void;
}

export function createCell<T>(initial: T): Cell<T> {
  let value = initial;
  return {
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
}

export const patchCell = <T extends object>(cell: Cell<T>, changes: Partial<T>): void => cell.write({ ...cell.read(), ...changes });

/** A copy of `map` with `key` moved to the end, so Map order stays recency order. */
export const withEntry = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): Map<K, V> => new Map<K, V>([...map].filter(([existing]) => existing !== key).concat([[key, value]]));

export const withoutKeys = <K, V>(map: ReadonlyMap<K, V>, keys: readonly K[]): Map<K, V> => new Map<K, V>([...map].filter(([existing]) => !keys.includes(existing)));
