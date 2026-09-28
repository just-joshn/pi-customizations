export type PendingWork = Map<string, () => void>;

function registry(): PendingWork {
  const holder = globalThis as { __pstackPendingWork?: PendingWork };
  holder.__pstackPendingWork ??= new Map();
  return holder.__pstackPendingWork;
}

/** Records work that must never run once the drain aborted it. */
export function registerPendingWork(name: string, run: () => void): void {
  registry().set(name, run);
}

/** Removes pending work when its abort path cancels it. */
export function clearPendingWork(name: string): void {
  registry().delete(name);
}

/** Runs whatever is still pending and reports it, so a leak surfaces as a failed assertion. */
export function releasePendingWork(): string[] {
  const pending = registry();
  const names = [...pending.keys()];
  for (const run of pending.values()) run();
  pending.clear();
  return names;
}
