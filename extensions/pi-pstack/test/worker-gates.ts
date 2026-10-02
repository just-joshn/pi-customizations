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

type StreamLog = { requests: string[]; watchers: { marker: string; resolve: () => void }[] };

function streamLog(dir: string): StreamLog {
  const holder = globalThis as { __pstackStreamLogs?: Map<string, StreamLog> };
  holder.__pstackStreamLogs ??= new Map();
  const existing = holder.__pstackStreamLogs.get(dir);
  if (existing) return existing;
  const created: StreamLog = { requests: [], watchers: [] };
  holder.__pstackStreamLogs.set(dir, created);
  return created;
}

/** Called by the fixture model when it starts a response in the agent directory, so tests and nested models can wait on a session actually running. */
export function announceStreamStart(dir: string, request: string): void {
  const log = streamLog(dir);
  log.requests.push(request);
  const ready = log.watchers.filter((watcher) => request.includes(watcher.marker));
  log.watchers = log.watchers.filter((watcher) => !request.includes(watcher.marker));
  for (const watcher of ready) watcher.resolve();
}

/** Resolves once a fixture model response containing the marker has started in the agent directory, including one that started earlier. */
export function streamStarted(dir: string, marker: string): Promise<void> {
  const log = streamLog(dir);
  if (log.requests.some((request) => request.includes(marker))) return Promise.resolve();
  return new Promise((resolve) => {
    log.watchers.push({ marker, resolve });
  });
}
