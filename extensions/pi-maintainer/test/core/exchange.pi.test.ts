import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getCurrentTools } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import { maintainerExtension, textOf } from '../support/maintainer.ts';
import { piSessionFixture, promptAndSettle } from '../support/pi-session.ts';

const extension = maintainerExtension();

test('whole-file text completes an SDK edit exchange', async () => {
  const f = await piSessionFixture({ extension, config: 'file: [hello.txt]\nyes-always: true\n' });
  await writeFile(join(f.cwd, 'hello.txt'), 'before\n');
  f.replies.push({ text: 'hello.txt\n```\nafter\n```\n' });
  const session = await f.open();
  await promptAndSettle(session, 'make the edit');
  expect(await readFile(join(f.cwd, 'hello.txt'), 'utf8')).toBe('after\n');
  expect(f.errors).toEqual([]);
  expect(f.requests).toHaveLength(1);
  expect(getCurrentTools(f.requests[0]?.messages ?? [])).toEqual([]);
  expect(f.requests[0]?.messages.map(textOf)).toContain('EDITABLE\nhello.txt\n```\nbefore\n```\n');
  expect(
    session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === 'custom')
      .map((entry) => entry.data),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'operation-intent', operation: 'write', path: join(f.cwd, 'hello.txt') }),
      expect.objectContaining({ kind: 'operation-observed', outcome: 'succeeded' }),
      expect.objectContaining({ kind: 'settled' }),
    ]),
  );
});

test('a malformed reply reaches the next actual request as feedback', async () => {
  const f = await piSessionFixture({ extension });
  f.replies.push({ text: '```\nbad\n```' }, { text: 'repaired' });
  const session = await f.open();
  await promptAndSettle(session, 'make the edit');
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]?.messages.filter((message) => message.role === 'user').map(textOf)).toContain('No filename provided before ``` in file listing');
  expect(f.errors).toEqual([]);
});

test('permission preparation creates an admitted reply target', async () => {
  const f = await piSessionFixture({ extension, config: 'yes-always: true\n' });
  f.replies.push({ text: 'nested/new.txt\n```\ncreated\n```\n' });
  const session = await f.open();
  await promptAndSettle(session, 'create a file');
  expect(await readFile(join(f.cwd, 'nested/new.txt'), 'utf8')).toBe('created\n');
  const intents = session.sessionManager
    .getBranch()
    .filter((entry) => entry.type === 'custom')
    .map((entry) => entry.data);
  expect(intents).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'operation-intent', operation: 'touch' }), expect.objectContaining({ kind: 'operation-intent', operation: 'write' })]));
  expect(f.errors).toEqual([]);
});

test('no UI without explicit consent denies an unselected file', async () => {
  const f = await piSessionFixture({ extension });
  const path = join(f.cwd, 'existing.txt');
  await writeFile(path, 'before');
  f.replies.push({ text: 'existing.txt\n```\nafter\n```\n' });
  const session = await f.open();
  await promptAndSettle(session, 'edit it');
  expect(await readFile(path, 'utf8')).toBe('before');
  expect(f.requests).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test.for(['error', 'aborted', 'length'] as const)('provider $0 text never becomes a partial disk edit', async (stopReason) => {
  const f = await piSessionFixture({ extension, config: 'file: [hello.txt]\n' });
  await writeFile(join(f.cwd, 'hello.txt'), 'before');
  f.replies.push({ text: 'hello.txt\n```\npartial\n```\n', stopReason });
  const session = await f.open();
  await promptAndSettle(session, 'make the edit');
  expect(await readFile(join(f.cwd, 'hello.txt'), 'utf8')).toBe('before');
  expect(f.errors).toEqual([]);
});
