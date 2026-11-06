// Background work started anywhere in a subagent tree belongs to the main chat, as Cursor builds every subagent's
// executor with the top-level chat as its wakeup owner: a subagent never hears about its own background shells, and its
// background subagents outlive it. Subagents run as their own Pi processes here, so they report that work through a
// mailbox folder the main chat reads: one JSON file per item, written by rename and consumed in name order.
import { randomBytes } from 'node:crypto';
import { type FSWatcher, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { ShellNotice } from './background-shell.ts';
import { workspaceStateDir } from './paths.ts';

export type InboxItem =
  /** A descendant's background shell finished, or was aborted when its agent ended. */
  | { type: 'shell'; from: string; notice: ShellNotice }
  /** A descendant started a background subagent as a detached run; the main chat follows it and hears its result. */
  | { type: 'adopt'; from: string; agentId: string };

const POLL_MS = 500;
let sequence = 0;

export function inboxDir(workspaceState: string, rootSessionId: string): string {
  return join(workspaceState, 'inbox', rootSessionId);
}

export function postItem(dir: string, item: InboxItem): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `${Date.now().toString().padStart(15, '0')}-${(sequence++).toString().padStart(6, '0')}-${randomBytes(4).toString('hex')}`;
  const temporary = join(dir, `.${name}.tmp`);
  writeFileSync(temporary, JSON.stringify(item), { mode: 0o600 });
  renameSync(temporary, join(dir, `${name}.json`));
}

function parseItem(text: string): InboxItem | undefined {
  const value = JSON.parse(text) as Partial<InboxItem> & { notice?: Partial<ShellNotice> };
  if (typeof value.from !== 'string') return undefined;
  if (value.type === 'adopt' && typeof value.agentId === 'string') return { type: 'adopt', from: value.from, agentId: value.agentId };
  if (value.type === 'shell' && typeof value.notice?.taskId === 'string' && typeof value.notice.title === 'string') return { type: 'shell', from: value.from, notice: value.notice as ShellNotice };
  return undefined;
}

/**
 * Removes and returns every complete item, oldest first. It runs from timers, so a file it cannot read now (a missing
 * folder, too many open files) stays for the next poll instead of throwing. A file that does not parse is dropped.
 */
export function drainInbox(dir: string): InboxItem[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const items: InboxItem[] = [];
  for (const name of names.sort()) {
    const path = join(dir, name);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
      rmSync(path, { force: true });
    } catch {
      continue;
    }
    try {
      const item = parseItem(text);
      if (item !== undefined) items.push(item);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return items;
}

export function clearInbox(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export interface RootInboxHandlers {
  shell: (notice: ShellNotice) => void;
  adopt: (agentId: string) => void;
  /** Resolves once a subagent this chat follows has ended and its own notification is out. */
  settledOf: (agentId: string) => Promise<void> | undefined;
}

/**
 * The main chat's side. Items addressed to an earlier process of this session are dropped at session start, as
 * Cursor's in-memory queue dies with the CLI. A job notice from a subagent this chat still follows waits for that
 * subagent's own result, the order Cursor shows: the subagent's result, then its jobs. Each settle drains the folder
 * first, so a one-shot run sees every item before it decides to exit; register this before the Task and shell handlers.
 */
export function registerRootInbox(pi: ExtensionAPI, handlers: RootInboxHandlers): void {
  let dir: string | undefined;
  let stop: (() => void) | undefined;
  const route = (items: InboxItem[]) => {
    for (const item of items) {
      switch (item.type) {
        case 'adopt':
          handlers.adopt(item.agentId);
          break;
        case 'shell': {
          const settled = handlers.settledOf(item.from);
          if (settled === undefined) handlers.shell(item.notice);
          else void settled.then(() => handlers.shell(item.notice));
          break;
        }
        default: {
          const unhandled: never = item;
          throw new Error(`Unhandled inbox item ${JSON.stringify(unhandled)}`);
        }
      }
    }
  };
  pi.on('session_start', (_event, ctx) => {
    stop?.();
    dir = inboxDir(workspaceStateDir(ctx.cwd), ctx.sessionManager.getSessionId());
    clearInbox(dir);
    stop = watchInbox(dir, route);
  });
  pi.on('agent_before_settle', () => {
    if (dir !== undefined) route(drainInbox(dir));
    return undefined;
  });
  pi.on('session_shutdown', () => {
    stop?.();
    stop = undefined;
    dir = undefined;
  });
}

/** Calls `onItems` with each batch as it arrives: a folder watch for speed, a poll in case the watch misses one. */
export function watchInbox(dir: string, onItems: (items: InboxItem[]) => void): () => void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const check = () => {
    const items = drainInbox(dir);
    if (items.length > 0) onItems(items);
  };
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(dir, check);
    watcher.on('error', () => watcher?.close());
  } catch {
    watcher = undefined;
  }
  const timer = setInterval(check, POLL_MS);
  timer.unref();
  check();
  return () => {
    clearInterval(timer);
    watcher?.close();
  };
}
