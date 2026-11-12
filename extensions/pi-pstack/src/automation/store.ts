import { appendFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ActionId, AutomationEvent, EventKey, OutboxAction, Prerequisite, RunId } from './model.ts';
import type { TrackerWork } from './outbox.ts';

export type LogEntry =
  | { ts: string; kind: 'received'; key: EventKey; event: AutomationEvent }
  | { ts: string; kind: 'blocked'; key: EventKey; missing: Prerequisite[]; problems?: string[] }
  | { ts: string; kind: 'dispatched'; key: EventKey; runId: RunId }
  | { ts: string; kind: 'awaiting-verdict'; key: EventKey }
  /** A case closed for good. `key` is absent when the event never became a case. */
  | { ts: string; kind: 'rejected'; reason: string; key?: EventKey }
  | { ts: string; kind: 'reply-refused'; key: EventKey; reason: string }
  | { ts: string; kind: 'completed'; key: EventKey; runId: RunId }
  | { ts: string; kind: 'posted'; actionId: ActionId; destinationTs: string; reconciled: boolean }
  | { ts: string; kind: 'follow-up-dispatched'; key: EventKey; runId: RunId; round: number; seenTs: string }
  | { ts: string; kind: 'follow-up-completed'; key: EventKey; runId: RunId; round: number }
  | { ts: string; kind: 'follow-up-closed'; key: EventKey; reason: string }
  | { ts: string; kind: 'follow-up-rerun-refused'; key: EventKey; reason: string }
  | { ts: string; kind: 'repro-outcome'; key: EventKey; runId: RunId; status?: string; note?: string; /** The worker verified an existing fix, so no fix of this case's own may follow. */ existingFix?: boolean; /** Why the parent did not accept the worker's reported outcome, when it did not. */ unverified?: string }
  | { ts: string; kind: 'repro-window'; key: EventKey; runId: RunId; seenTs: string }
  | { ts: string; kind: 'repro-turn'; key: EventKey; runId: RunId; turn: number; purpose: 'review' | 'fix' | 'rerun'; generation: number; prompt: string; seenTs?: string }
  | { ts: string; kind: 'repro-turn-completed'; key: EventKey; runId: RunId; turn: number; failure?: string; decision?: string; corrected?: boolean }
  | { ts: string; kind: 'repro-closed'; key: EventKey; runId: RunId; reason: string }
  | { ts: string; kind: 'worker-retired'; key: EventKey; runId: RunId; outcome: string; ok: boolean }
  | { ts: string; kind: 'evidence-staged'; key: EventKey; runId: RunId; /** Files that went with the source reply. */ attached: number; skipped: { requested: string; reason: string }[]; /** Files kept in the store beyond the first Slack message, for the operations thread. */ further?: { name: string; path: string }[] }
  /** Report attachments the worker was not given, each with the reason. */
  | { ts: string; kind: 'attachments-omitted'; key: EventKey; runId: RunId; omitted: { name: string; reason: string }[] }
  /** A repro worker committed, pushed or opened a pull request before the go-ahead. It was stopped, and no fix followed. */
  | { ts: string; kind: 'unprompted-fix'; key: EventKey; runId: RunId; ahead: number; committed: number; pushed: boolean | 'unknown'; /** Pull requests the automation opened and closed. */ pullRequests: string[]; /** Pull requests it did not open, reported and left open. */ leftOpen?: string[] }
  /** A pull request on a run branch was not a draft. The parent made it one. */
  /** The parent opened this pull request itself: the only record that makes a pull request this automation's own. */
  | { ts: string; kind: 'pull-request-opened'; key: EventKey; runId: RunId; actionId: string; number: number; url: string }
  | { ts: string; kind: 'draft-guard'; key: EventKey; runId: RunId; pullRequest: string }
  | { ts: string; kind: 'fix-landing-failed'; key: EventKey; runId: RunId; turn: number; reason: string }
  | { ts: string; kind: 'deadline'; runId: RunId; minutes: number; abort: string }
  | { ts: string; kind: 'compensated'; key: EventKey; issue: string; verified: boolean; reason?: string }
  | { ts: string; kind: 'outbox-failed'; actionId: ActionId; attempts: number; error: string; final: boolean }
  | { ts: string; kind: 'source-error'; reason: string };

export type OutboxEntry =
  | { action: OutboxAction; state: 'pending'; attempts?: number; retryAt?: string; work?: TrackerWork }
  | { action: OutboxAction; state: 'done'; destinationTs: string; reconciled: boolean; /** The report's permalink was already linked to the issue, so nothing was written. */ alreadyLinked?: true; /** The tracker's own link to the issue, when it gave one. */ url?: string }
  | { action: OutboxAction; state: 'failed'; attempts: number; reason: string };

/** `<project>/.pi/pstack/automation/<name>/`: one directory per automation, written by one source at a time. */
export interface AutomationStore {
  dir: string;
  log: string;
  cursor: string;
  outbox: string;
  lock: string;
}

export function automationStore(projectRoot: string, name: string): AutomationStore {
  const dir = join(projectRoot, '.pi', 'pstack', 'automation', name);
  return { dir, log: join(dir, 'events.jsonl'), cursor: join(dir, 'cursor.json'), outbox: join(dir, 'outbox'), lock: join(dir, 'source.lock') };
}

const temporary = (path: string) => `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;

export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = temporary(path);
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}

/** Creates a fully written file only when none exists: the link fails with EEXIST instead of replacing. */
export function createExclusive(path: string, text: string): boolean {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = temporary(path);
  writeFileSync(tmp, text, { mode: 0o600 });
  try {
    linkSync(tmp, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally {
    unlinkSync(tmp);
  }
}

export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function appendLog(store: AutomationStore, entry: LogEntry): void {
  mkdirSync(store.dir, { recursive: true, mode: 0o700 });
  appendFileSync(store.log, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

/** Every complete entry. A line torn by a crash mid-append is skipped; the operation that wrote it reruns idempotently. */
export function readLog(store: AutomationStore): LogEntry[] {
  if (!existsSync(store.log)) return [];
  const entries: LogEntry[] = [];
  for (const line of readFileSync(store.log, 'utf8').split('\n')) {
    if (line === '') continue;
    try {
      entries.push(JSON.parse(line) as LogEntry);
    } catch {}
  }
  return entries;
}

export function readCursor(store: AutomationStore): string | undefined {
  return readJson<{ ts: string }>(store.cursor)?.ts;
}

export function writeCursor(store: AutomationStore, ts: string): void {
  writeAtomic(store.cursor, json({ ts }));
}

export const outboxFile = (store: AutomationStore, id: ActionId) => join(store.outbox, `${id}.json`);

export function outboxEntries(store: AutomationStore): OutboxEntry[] {
  if (!existsSync(store.outbox)) return [];
  return readdirSync(store.outbox)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => readJson<OutboxEntry>(join(store.outbox, file)))
    .filter((entry): entry is OutboxEntry => entry !== undefined);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** One event source per automation: a second receiver or poller, in this or another process, is refused. */
export function acquireSourceLock(store: AutomationStore, source: string): () => void {
  const body = json({ pid: process.pid, source });
  if (!createExclusive(store.lock, body)) {
    const holder = readJson<{ pid: number; source: string }>(store.lock);
    if (holder !== undefined && alive(holder.pid)) throw new Error(`automation already has an active ${holder.source} source (pid ${holder.pid})`);
    unlinkSync(store.lock);
    if (!createExclusive(store.lock, body)) throw new Error('automation source lock was taken concurrently');
  }
  return () => {
    if (readJson<{ pid: number }>(store.lock)?.pid === process.pid) unlinkSync(store.lock);
  };
}
