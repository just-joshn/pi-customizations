import type { OutboxAction } from './model.ts';
import { type AutomationStore, appendLog, createExclusive, json, outboxEntries, outboxFile, writeAtomic } from './store.ts';

/** A message in a destination thread. `marker` is the action id the poster attached, when the message carries one. */
export interface ThreadMessage {
  ts: string;
  marker?: string;
}

/** The destination as the trusted parent sees it. Only the parent adapter holds one; workers never do. */
export interface ThreadDestination {
  readThread(channel: string, threadTs: string): Promise<ThreadMessage[]>;
  /** Posts `action.text` as a reply in `action.threadTs`, carrying `action.id` as its marker. */
  post(action: OutboxAction): Promise<{ ts: string }>;
}

/** Queues an action once. A second enqueue of the same id keeps the first, so one purpose yields one external action. */
export function enqueue(store: AutomationStore, action: OutboxAction): boolean {
  return createExclusive(outboxFile(store, action.id), json({ action, state: 'pending' }));
}

/**
 * Performs every pending action. Before each post it reads the destination thread for the action's marker: a post that
 * landed before a crash, with no acknowledgement written, is acknowledged instead of repeated.
 */
export async function flushOutbox(store: AutomationStore, destination: ThreadDestination): Promise<void> {
  for (const entry of outboxEntries(store)) {
    if (entry.state === 'done') continue;
    const { action } = entry;
    const landed = (await destination.readThread(action.channel, action.threadTs)).find((message) => message.marker === action.id);
    const destinationTs = landed?.ts ?? (await destination.post(action)).ts;
    const reconciled = landed !== undefined;
    writeAtomic(outboxFile(store, action.id), json({ action, state: 'done', destinationTs, reconciled }));
    appendLog(store, { ts: new Date().toISOString(), kind: 'posted', actionId: action.id, destinationTs, reconciled });
  }
}
