import type { OutboxAction, ThreadReplyAction, TrackerAction } from './model.ts';
import { type AutomationStore, appendLog, createExclusive, json, outboxEntries, outboxFile, writeAtomic } from './store.ts';

/** A message in a destination thread. `marker` is the action id the poster attached, when the message carries one. */
export interface ThreadMessage {
  ts: string;
  marker?: string;
  user?: string;
  text?: string;
}

/** The destination as the trusted parent sees it. Only the parent adapter holds one; workers never do. */
export interface ThreadDestination {
  readThread(channel: string, threadTs: string): Promise<ThreadMessage[]>;
  /** Posts `action.text` as a reply in `action.threadTs`, carrying `action.id` as its marker. */
  post(action: ThreadReplyAction): Promise<{ ts: string }>;
}

/** Every write stores action.id as a searchable marker in the same destination mutation. */
export interface TrackerDestination {
  searchByMarker(marker: string): Promise<{ id: string }[]>;
  create(action: TrackerAction): Promise<{ id: string }>;
  update(action: TrackerAction): Promise<{ id: string }>;
  comment(action: TrackerAction): Promise<{ id: string }>;
}

/** Queues an action once. A second enqueue of the same id keeps the first, so one purpose yields one external action. */
export function enqueue(store: AutomationStore, action: OutboxAction): boolean {
  return createExclusive(outboxFile(store, action.id), json({ action, state: 'pending' }));
}

/** Attempts an action gets before it is `failed` for good. The wait doubles from 5 s to at most 60 s between attempts. */
export const OUTBOX_RETRY_LIMIT = 5;
const backoffMs = (attempts: number) => Math.min(60_000, 5_000 * 2 ** (attempts - 1));

export interface FlushOptions {
  now?: () => Date;
  /** A restart has no reason to wait out a backoff the previous process set. */
  ignoreBackoff?: boolean;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Performs every pending action, each in isolation: an action that throws is logged and retried later, and the rest of
 * the outbox still runs. Before each post it reads the destination thread for the action's marker: a post that landed
 * before a crash, with no acknowledgement written, is acknowledged instead of repeated. An action that fails
 * `OUTBOX_RETRY_LIMIT` times becomes `failed`, which its owner reads as the cue to take the failure path.
 */
export async function flushOutbox(store: AutomationStore, destination: ThreadDestination, tracker?: TrackerDestination, options: FlushOptions = {}): Promise<void> {
  const now = options.now ?? (() => new Date());
  for (const entry of outboxEntries(store)) {
    if (entry.state !== 'pending') continue;
    if (options.ignoreBackoff !== true && entry.retryAt !== undefined && entry.retryAt > now().toISOString()) continue;
    const { action } = entry;
    try {
      if (action.kind === 'tracker') {
        if (!tracker) throw new Error('tracker destination unavailable');
        const matches = await tracker.searchByMarker(action.id);
        if (matches.length > 1) throw new Error('ambiguous tracker action marker');
        const landed = matches[0];
        const written = landed ?? (await tracker[action.operation](action));
        writeAtomic(outboxFile(store, action.id), json({ action, state: 'done', destinationTs: written.id, reconciled: landed !== undefined }));
        continue;
      }
      const landed = (await destination.readThread(action.channel, action.threadTs)).find((message) => message.marker === action.id);
      const destinationTs = landed?.ts ?? (await destination.post(action)).ts;
      const reconciled = landed !== undefined;
      writeAtomic(outboxFile(store, action.id), json({ action, state: 'done', destinationTs, reconciled }));
      appendLog(store, { ts: now().toISOString(), kind: 'posted', actionId: action.id, destinationTs, reconciled });
    } catch (error) {
      const attempts = (entry.attempts ?? 0) + 1;
      const reason = messageOf(error);
      const final = attempts >= OUTBOX_RETRY_LIMIT;
      writeAtomic(outboxFile(store, action.id), json(final ? { action, state: 'failed', attempts, reason } : { action, state: 'pending', attempts, retryAt: new Date(now().getTime() + backoffMs(attempts)).toISOString() }));
      appendLog(store, { ts: now().toISOString(), kind: 'outbox-failed', actionId: action.id, attempts, error: reason, final });
    }
  }
}
