import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { expect, test } from 'vitest';
import { BRANDING } from '../../src/branding.ts';
import { restore } from '../../src/core/branch.ts';
import { installMaintainer } from '../../src/core/install.ts';
import { editFeature } from '../../src/edit/feature.ts';
import { maintainerExtension, textOf } from '../support/maintainer.ts';
import { piSessionFixture, promptAndSettle, scriptedModel } from '../support/pi-session.ts';

const extension = maintainerExtension();
const malformed = { text: '```\nmissing filename\n```\n' };

test('exactly three reflections reach provider requests', async () => {
  const f = await piSessionFixture({ extension });
  f.replies.push(malformed, malformed, malformed, malformed);
  const session = await f.open();
  await promptAndSettle(session, 'repair it');
  expect(f.requests).toHaveLength(4);
  expect(f.requests.slice(1).map((request) => request.messages.filter((message) => message.role === 'user' && textOf(message).includes('No filename provided')).length)).toEqual([1, 2, 3]);
  expect(restore(session.sessionManager.getBranch()).snapshot?.lifecycle).toEqual({ kind: 'idle' });
  expect(f.errors).toEqual([]);
});

test('a new canonical user resets an exhausted reflection budget', async () => {
  const f = await piSessionFixture({ extension });
  f.replies.push(...Array.from({ length: 8 }, () => malformed));
  const session = await f.open();
  await promptAndSettle(session, 'first');
  const firstUser = restore(session.sessionManager.getBranch()).snapshot?.lastUserEntry;
  await promptAndSettle(session, 'second');
  const lastUser = session.sessionManager
    .getBranch()
    .filter((entry) => entry.type === 'message' && entry.message.role === 'user')
    .at(-1);
  expect(f.requests).toHaveLength(8);
  expect(restore(session.sessionManager.getBranch()).snapshot?.lastUserEntry).toBe(lastUser?.id);
  expect(lastUser?.id).not.toBe(firstUser);
  expect(f.errors).toEqual([]);
});

test('a suppressed continuation becomes interrupted at final reconciliation', async () => {
  const f = await piSessionFixture({
    extension,
    after: [
      (pi) => {
        pi.on('turn_end', (event) => ({ entries: event.entries, continue: false }));
      },
    ],
  });
  f.replies.push(malformed);
  const session = await f.open();
  await promptAndSettle(session, 'repair it');
  expect(f.requests).toHaveLength(1);
  expect(restore(session.sessionManager.getBranch()).snapshot?.lifecycle).toMatchObject({ kind: 'interrupted', reflectionsSent: 1, reason: 'Expected reflection did not receive a response' });
  expect(f.errors).toEqual([]);
});

test('canonical user binding precedes the actual provider call', async () => {
  const f = await piSessionFixture({ extension });
  const session = await f.open();
  f.replies.push({
    text: '',
    wait: async () => {
      const branch = session.sessionManager.getBranch();
      const user = branch.findLast((entry) => entry.type === 'message' && entry.message.role === 'user');
      expect(restore(branch).snapshot).toMatchObject({ lastUserEntry: user?.id, lifecycle: { kind: 'active', reflectionsSent: 0 } });
    },
  });
  await promptAndSettle(session, 'bind me');
  expect(f.requests).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test('an undeclared provider tool call stops without tool execution', async () => {
  let executions = 0;
  const f = await piSessionFixture({
    extension,
    before: [
      (pi) =>
        pi.registerTool({
          name: 'danger',
          label: 'Danger',
          description: 'Must not execute',
          exposure: 'deferred',
          parameters: Type.Object({}),
          execute: async () => {
            executions += 1;
            return { content: [{ type: 'text', text: 'bad' }], details: {} };
          },
        }),
    ],
  });
  f.replies.push({ text: '', stopReason: 'toolUse', tool: { name: 'danger', id: 'stray', arguments: {} } });
  const session = await f.open();
  await promptAndSettle(session, 'try a tool');
  expect(executions).toBe(0);
  expect(f.requests).toHaveLength(1);
  const result = session.sessionManager.getBranch().find((entry) => entry.type === 'message' && entry.message.role === 'toolResult');
  expect(result?.type === 'message' && result.message.role === 'toolResult' ? textOf(result.message) : '').toContain('not found');
  expect(f.errors).toEqual([]);
});

test('provider cancellation leaves the disk file unchanged', async () => {
  const f = await piSessionFixture({ extension, config: 'file: [hello.txt]\n' });
  await writeFile(join(f.cwd, 'hello.txt'), 'before');
  let entered = () => {};
  const streaming = new Promise<void>((done) => {
    entered = done;
  });
  f.replies.push({
    text: 'hello.txt\n```\npartial\n```\n',
    wait: async (signal) => {
      entered();
      if (!signal || signal.aborted) return;
      await new Promise<void>((done) => signal.addEventListener('abort', () => done(), { once: true }));
    },
  });
  const session = await f.open();
  let settled = false;
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'agent_settled') settled = true;
  });
  const running = session.prompt('edit it');
  await streaming;
  await session.abort();
  await running;
  unsubscribe();
  expect(settled).toBe(true);
  expect(await readFile(join(f.cwd, 'hello.txt'), 'utf8')).toBe('before');
  expect(restore(session.sessionManager.getBranch()).snapshot?.lifecycle).toMatchObject({ kind: 'interrupted' });
  expect(f.errors).toEqual([]);
});

test('chat file membership persists across runtime replacement', async () => {
  const f = await piSessionFixture({ extension, config: 'yes-always: true\n' });
  f.replies.push({ text: 'created.txt\n```\ncreated\n```\n' });
  const session = await f.open();
  await promptAndSettle(session, 'create it');
  await session.reload();
  f.replies.push({ text: '' });
  await promptAndSettle(session, 'after reload');
  expect(f.requests.at(-1)?.messages.some((message) => textOf(message).includes('created\n```'))).toBe(true);
  const path = session.sessionManager.getSessionFile();
  if (!path) throw new Error('persistent fixture has no session file');
  session.dispose();
  const reopened = await f.open(SessionManager.open(path));
  f.replies.push({ text: '' });
  await promptAndSettle(reopened, 'after reopen');
  expect(restore(reopened.sessionManager.getBranch()).snapshot?.files.editable).toEqual([join(f.cwd, 'created.txt')]);
  expect(f.requests.at(-1)?.messages.some((message) => textOf(message).includes('created\n```'))).toBe(true);
  expect(f.errors).toEqual([]);
});

test('navigateTree restores the selected branch without undoing disk writes', async () => {
  const f = await piSessionFixture({ extension, config: 'yes-always: true\n' });
  const session = await f.open();
  f.replies.push({ text: 'a.txt\n```\na\n```\n' });
  await promptAndSettle(session, 'create a');
  const branchA = session.sessionManager.getLeafId();
  f.replies.push({ text: 'b.txt\n```\nb\n```\n' });
  await promptAndSettle(session, 'create b');
  if (!branchA) throw new Error('fixture has no branch leaf');
  expect((await session.navigateTree(branchA, { summarize: false })).cancelled).toBe(false);
  f.replies.push({ text: '' });
  await promptAndSettle(session, 'selected a');
  expect(restore(session.sessionManager.getBranch()).snapshot?.files.editable).toEqual([join(f.cwd, 'a.txt')]);
  expect(f.requests.at(-1)?.messages.some((message) => textOf(message).includes('\nb.txt\n```'))).toBe(false);
  expect(await readFile(join(f.cwd, 'b.txt'), 'utf8')).toBe('b\n');
  expect(f.errors).toEqual([]);
});

test('a pending destructive intent blocks new requests after reload', async () => {
  const f = await piSessionFixture({ extension });
  const session = await f.open();
  session.sessionManager.appendCustomEntry(BRANDING.stateEntry, { schema: 1, kind: 'operation-intent', reply: 'crashed-reply', ordinal: 0, operation: 'write', path: join(f.cwd, 'uncertain.txt') });
  await session.reload();
  await promptAndSettle(session, 'do not replay');
  expect(f.requests).toHaveLength(0);
  expect(restore(session.sessionManager.getBranch()).pendingOperations).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test('tool_call blocks an intentionally reactivated capability', async () => {
  let executions = 0;
  const f = await piSessionFixture({
    extension,
    before: [
      (pi) => {
        pi.registerTool({
          name: 'danger',
          label: 'Danger',
          description: 'Must not execute',
          parameters: Type.Object({}),
          execute: async () => {
            executions += 1;
            return { content: [{ type: 'text', text: 'bad' }], details: {} };
          },
        });
      },
    ],
    after: [
      (pi) => {
        pi.on('before_agent_start', () => pi.setActiveTools(['danger']));
      },
    ],
  });
  f.replies.push({ text: '', stopReason: 'toolUse', tool: { name: 'danger', id: 'stray', arguments: {} } });
  const session = await f.open();
  await session.setModel(scriptedModel);
  await promptAndSettle(session, 'try a tool');
  expect(executions).toBe(0);
  expect(f.requests).toHaveLength(1);
  const result = session.sessionManager.getBranch().find((entry) => entry.type === 'message' && entry.message.role === 'toolResult');
  expect(result?.type === 'message' && result.message.role === 'toolResult' ? textOf(result.message) : '').toContain('reply-text edits');
  expect(f.errors).toEqual([]);
});

test('a missing prompt source stops before a provider request', async () => {
  const f = await piSessionFixture({ extension: (pi) => installMaintainer(pi, [editFeature], { home: () => '/nonexistent', processEnvironment: () => ({}) }) });
  const session = await f.open();
  await promptAndSettle(session, 'do not send an unformatted request');
  expect(restore(session.sessionManager.getBranch()).snapshot?.lifecycle).toMatchObject({ kind: 'interrupted' });
  expect(f.requests).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

test('a prompt-source failure aborts without falling back to raw context', async () => {
  const f = await piSessionFixture({
    extension: maintainerExtension({
      promptSource: {
        get: () => {
          throw new Error('formatter failed');
        },
      },
    }),
  });
  const session = await f.open();
  await promptAndSettle(session, 'do not send raw context');
  expect(restore(session.sessionManager.getBranch()).snapshot?.lifecycle).toMatchObject({ kind: 'interrupted', reason: 'formatter failed' });
  expect(f.requests).toHaveLength(0);
  expect(f.errors).toEqual([]);
});
