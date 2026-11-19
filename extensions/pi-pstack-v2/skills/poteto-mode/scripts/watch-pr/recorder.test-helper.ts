export interface Recorder<T> {
  add(value: T): void;
  readonly items: readonly T[];
}

export function createRecorder<T>(): Recorder<T> {
  let items: readonly T[] = [];
  return {
    add(value) {
      items = [...items, value];
    },
    get items() {
      return items;
    },
  };
}
