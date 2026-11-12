// A case worker settles and then idles: its host stays up so the parent can send it its next turn. Nothing after the
// last turn needs it, so the parent shuts it down once the case's lifecycle is over, which is after the follow-up window
// (a follow-up may still ask the repro worker for its one rerun). The decision is derived from the event log and the
// clock alone, and the shutdown is logged with its outcome, so a restart retires a worker once and never twice.
import type { AbortRun } from './abort.ts';
import type { AutomationConfig } from '../../adapters/automation-events.ts';
import type { EventKey, RunId } from './model.ts';
import { type AutomationStore, appendLog, type LogEntry, readLog } from './store.ts';

/** A shutdown the host refused or failed is tried again on the next pass, this many times in all. */
export const RETIRE_ATTEMPT_LIMIT = 5;

export interface RetireHost {
  config: AutomationConfig;
  store: AutomationStore;
  now: () => Date;
  abort: AbortRun;
  /** When the case's follow-up window starts, or undefined while its lifecycle is not over. */
  anchor: (key: EventKey, completedTs: string) => string | undefined;
  /** Runs with a repro turn still to settle. */
  inFlight: () => RunId[];
  /** Runs before a worker is shut down. A failure holds the shutdown, and counts as an attempt like a refused one. */
  beforeRetire?: (runId: RunId) => Promise<void>;
}

interface Case {
  key: EventKey;
  runId: RunId;
  completedTs: string;
  closed: boolean;
  roundInFlight: boolean;
  attempts: number;
  retired: boolean;
}

function cases(log: LogEntry[]): Case[] {
  const found = new Map<EventKey, Case>();
  for (const entry of log) {
    if (entry.kind === 'completed' && !found.has(entry.key)) found.set(entry.key, { key: entry.key, runId: entry.runId, completedTs: entry.ts, closed: false, roundInFlight: false, attempts: 0, retired: false });
  }
  const open = new Map<RunId, EventKey>();
  for (const entry of log) {
    const found_ = 'key' in entry ? found.get(entry.key) : undefined;
    if (found_ === undefined) continue;
    if (entry.kind === 'follow-up-closed') found_.closed = true;
    if (entry.kind === 'follow-up-dispatched') open.set(entry.runId, entry.key);
    if (entry.kind === 'follow-up-completed') open.delete(entry.runId);
    if (entry.kind === 'worker-retired') {
      found_.attempts += 1;
      if (entry.ok) found_.retired = true;
    }
  }
  for (const key of open.values()) {
    const unfinished = found.get(key);
    if (unfinished !== undefined) unfinished.roundInFlight = !unfinished.closed;
  }
  return [...found.values()];
}

export function createRetirement(host: RetireHost): { advance(): Promise<void> } {
  const { config, store } = host;
  const minutes = config.budgets?.followUpMinutes;
  /** Repro without an operations channel has no thread to watch, so no window. */
  const windowless = minutes === undefined || (config.kind === 'reproduce' && config.operations === undefined);

  return {
    async advance() {
      for (const item of cases(readLog(store))) {
        if (item.retired || item.attempts >= RETIRE_ATTEMPT_LIMIT) continue;
        if (host.inFlight().includes(item.runId) || item.roundInFlight) continue;
        const start = host.anchor(item.key, item.completedTs);
        if (start === undefined) continue;
        const over = item.closed || windowless || host.now().getTime() > Date.parse(start) + (minutes ?? 0) * 60_000;
        if (!over) continue;
        try {
          await host.beforeRetire?.(item.runId);
        } catch (error) {
          appendLog(store, { ts: host.now().toISOString(), kind: 'worker-retired', key: item.key, runId: item.runId, outcome: `refused: the last look at the worker's pull requests failed: ${error instanceof Error ? error.message : String(error)}`, ok: false });
          continue;
        }
        const outcome = await host.abort(config.projectRoot, item.runId).catch((error: unknown) => `refused: ${error instanceof Error ? error.message : String(error)}`);
        appendLog(store, { ts: host.now().toISOString(), kind: 'worker-retired', key: item.key, runId: item.runId, outcome, ok: !outcome.startsWith('refused') });
      }
    },
  };
}
