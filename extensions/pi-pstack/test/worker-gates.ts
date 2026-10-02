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

type StreamWatcher = { marker: string; resolve: () => void };

function watchers(): Set<StreamWatcher> {
  const holder = globalThis as { __pstackStreamWatchers?: Set<StreamWatcher> };
  holder.__pstackStreamWatchers ??= new Set();
  return holder.__pstackStreamWatchers;
}

/** Called by the fixture model when it starts a response, so tests can wait on a child actually running. */
export function announceStreamStart(request: string): void {
  for (const watcher of [...watchers()]) {
    if (!request.includes(watcher.marker)) continue;
    watchers().delete(watcher);
    watcher.resolve();
  }
}

/** Resolves when a fixture model response starts for a request containing the marker. Register it before launching the work. */
export function streamStarted(marker: string): Promise<void> {
  return new Promise((resolve) => {
    watchers().add({ marker, resolve });
  });
}
