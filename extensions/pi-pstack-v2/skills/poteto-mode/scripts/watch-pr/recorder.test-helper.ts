export interface Recorder<T> {
  record(value: T): void;
  readonly items: readonly T[];
}

export function createRecorder<T>(): Recorder<T> {
  let items: readonly T[] = [];
  return {
    record(value) {
      items = [...items, value];
    },
    get items() {
      return items;
    },
  };
}
