import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import type { ShellNotice } from '../src/background-shell.ts';
import { drainInbox, type InboxItem, postItem } from '../src/inbox.ts';

const inbox = test.extend<{ dir: string }>({
  dir: async ({ signal }, use) => {
    signal.throwIfAborted();
    const root = mkdtempSync(join(tmpdir(), 'pstack-inbox-'));
    try {
      await use(join(root, 'inbox', 'session-1'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
});

const notice = (taskId: string): ShellNotice => ({ kind: 'finished', status: 'aborted', taskId, shellId: taskId, title: `job ${taskId}`, toolCallId: `call-${taskId}` });

inbox('items come back once, in the order they were posted', ({ dir }) => {
  const items: InboxItem[] = [
    { type: 'shell', from: 'agent-a', notice: notice('100') },
    { type: 'adopt', from: 'agent-a', agentId: 'agent-b' },
    { type: 'shell', from: 'agent-b', notice: notice('101') },
  ];
  for (const item of items) postItem(dir, item);
  expect(drainInbox(dir)).toEqual(items);
  expect(drainInbox(dir)).toEqual([]);
});

inbox('a file that is not an inbox item is dropped without blocking the rest', ({ dir }) => {
  postItem(dir, { type: 'adopt', from: 'agent-a', agentId: 'agent-b' });
  writeFileSync(join(dir, '000000000000000-000000-broken.json'), '{"type":');
  writeFileSync(join(dir, '000000000000000-000001-unknown.json'), JSON.stringify({ type: 'other', from: 'x' }));
  expect(drainInbox(dir)).toEqual([{ type: 'adopt', from: 'agent-a', agentId: 'agent-b' }]);
  expect(drainInbox(dir)).toEqual([]);
});

inbox('a folder that does not exist yet reads as empty', ({ dir }) => {
  expect(drainInbox(dir)).toEqual([]);
});
