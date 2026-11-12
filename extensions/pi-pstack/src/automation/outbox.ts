import type { OpsEditAction, OpsRootAction, OutboxAction, ThreadReplyAction, TrackerAction } from './model.ts';
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

/** A message as the operations channel shows it. */
export interface ChannelMessage {
  ts: string;
  text: string;
}

/**
 * The operations channel as the trusted parent sees it: one root status message, and edits of that message. Replies in
 * its thread go through `ThreadDestination` like any other reply. Only the parent adapter holds one.
 */
export interface OperationsDestination {
  /** The root message in `channel` that carries `marker`, from a post that landed before a crash with no acknowledgement. */
  findRoot(channel: string, marker: string): Promise<ChannelMessage | undefined>;
  /** Posts `action.text` as a new root message in `action.channel`, carrying `action.id` as its marker. */
  postRoot(action: OpsRootAction): Promise<{ ts: string }>;
  readMessage(channel: string, ts: string): Promise<ChannelMessage | undefined>;
  /** Sets the text of the message at `ts`, keeping the marker `action.rootId`. */
  edit(action: OpsEditAction, ts: string): Promise<void>;
}

/** Every write stores action.id as a searchable marker in the same destination mutation. */
export interface TrackerDestination {
  searchByMarker(marker: string): Promise<{ id: string }[]>;
  create(action: TrackerAction): Promise<{ id: string }>;
  update(action: TrackerAction): Promise<{ id: string }>;
  comment(action: TrackerAction): Promise<{ id: string }>;
  /** Closes the issue `action.targetId`, which the parent created, and confirms it is closed. */
  compensate?(action: TrackerAction): Promise<{ id: string }>;
}

/** A tracker write handed to a worker, recorded in the entry so a restart adopts that worker instead of starting another. */
export interface TrackerWork {
  runId: string;
  startedAt: string;
}

export type TrackerLanding = { status: 'landed'; id: string; reconciled: boolean; url?: string } | { status: 'working'; work: TrackerWork };

/**
 * One step toward landing a tracker action. It either finishes (marker search before any write, so a second step after a
 * crash finds the first write), hands the write to a worker and says so, or throws, which counts as a failed attempt.
 * `attempt` counts from 1 and names the worker a failed attempt is replaced by.
 */
export interface TrackerLander {
  land(action: TrackerAction, progress: { attempt: number; work?: TrackerWork }): Promise<TrackerLanding>;
}

/** The synchronous tracker: the parent searches by marker and writes in its own process. */
export function directLander(tracker: TrackerDestination): TrackerLander {
  return {
    async land(action) {
      const matches = await tracker.searchByMarker(action.id);
      if (matches.length > 1) throw new Error('ambiguous tracker action marker');
      const landed = matches[0];
      if (landed !== undefined) return { status: 'landed', id: landed.id, reconciled: true };
      const write = action.operation === 'close' ? tracker.compensate : tracker[action.operation];
      if (write === undefined) throw new Error(`the tracker cannot ${action.operation}`);
      return { status: 'landed', id: (await write.call(tracker, action)).id, reconciled: false };
    },
  };
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
  /** Present when an operations channel is configured. Without it, an operations action fails. */
  operations?: OperationsDestination;
  /** A root post never goes here: the source channel gets thread replies only. */
  sourceChannel?: string;
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
export async function flushOutbox(store: AutomationStore, destination: ThreadDestination, tracker?: TrackerLander, options: FlushOptions = {}): Promise<void> {
  const now = options.now ?? (() => new Date());
  // A status root goes first, so an edit queued beside it finds its message in the same pass.
  const entries = outboxEntries(store).sort((left, right) => Number(right.action.kind === 'ops-root') - Number(left.action.kind === 'ops-root'));
  for (const entry of entries) {
    if (entry.state !== 'pending') continue;
    if (options.ignoreBackoff !== true && entry.retryAt !== undefined && entry.retryAt > now().toISOString()) continue;
    const { action } = entry;
    try {
      if (action.kind === 'tracker') {
        if (!tracker) throw new Error('tracker destination unavailable');
        const landing = await tracker.land(action, { attempt: (entry.attempts ?? 0) + 1, ...(entry.work === undefined ? {} : { work: entry.work }) });
        writeAtomic(outboxFile(store, action.id), json(landing.status === 'landed' ? { action, state: 'done', destinationTs: landing.id, reconciled: landing.reconciled, ...(landing.url === undefined ? {} : { url: landing.url }) } : { action, state: 'pending', ...(entry.attempts === undefined ? {} : { attempts: entry.attempts }), work: landing.work }));
        continue;
      }
      if (action.kind === 'ops-root' || action.kind === 'ops-edit') {
        const operations = options.operations;
        if (operations === undefined) throw new Error('no operations channel is configured');
        if (action.channel === options.sourceChannel) throw new Error(`refused: ${action.kind} in the source channel ${action.channel}`);
        if (action.kind === 'ops-root') {
          const landed = await operations.findRoot(action.channel, action.id);
          const ts = landed?.ts ?? (await operations.postRoot(action)).ts;
          writeAtomic(outboxFile(store, action.id), json({ action, state: 'done', destinationTs: ts, reconciled: landed !== undefined }));
          appendLog(store, { ts: now().toISOString(), kind: 'posted', actionId: action.id, destinationTs: ts, reconciled: landed !== undefined });
          continue;
        }
        const root = outboxEntries(store).find((candidate) => candidate.action.id === action.rootId);
        if (root?.state !== 'done') {
          if (root?.state === 'failed') throw new Error(`the operations root ${action.rootId} failed, so there is no message to edit`);
          continue;
        }
        const current = await operations.readMessage(action.channel, root.destinationTs);
        if (current === undefined) throw new Error(`the operations root ${root.destinationTs} is not in ${action.channel}`);
        if (current.text !== action.text) await operations.edit(action, root.destinationTs);
        writeAtomic(outboxFile(store, action.id), json({ action, state: 'done', destinationTs: root.destinationTs, reconciled: current.text === action.text }));
        appendLog(store, { ts: now().toISOString(), kind: 'posted', actionId: action.id, destinationTs: root.destinationTs, reconciled: current.text === action.text });
        continue;
      }
      const before = await destination.readThread(action.channel, action.threadTs);
      const landed = before.find((message) => message.marker === action.id);
      // Preflight: a reply goes only under a parent that is still there. Nothing is posted, and nothing at the root.
      if (landed === undefined && !before.some((message) => message.ts === action.threadTs)) throw new Error(`the thread parent ${action.threadTs} is not in ${action.channel}; nothing was posted`);
      let destinationTs = landed?.ts;
      if (destinationTs === undefined) {
        destinationTs = (await destination.post(action)).ts;
        // Read back: the reply must be a reply in that thread, not only a success the destination reported.
        const seen = (await destination.readThread(action.channel, action.threadTs)).find((message) => message.marker === action.id);
        if (seen === undefined || seen.ts === action.threadTs) throw new Error(`the reply was posted but is not visible under the thread ${action.threadTs}`);
      }
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
