/** A single replaceable value. Holds mutable state in a closure, so owners never assign to their own fields. */
export interface Cell<T> {
  readonly read: () => T;
  readonly write: (next: T) => void;
}

export function cell<T>(initial: T): Cell<T> {
  let value = initial;
  return {
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
}
