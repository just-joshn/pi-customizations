import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getCurrentTools } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import { restore } from '../../src/core/branch.ts';
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

test('an admitted read-only target keeps Aider two-set semantics', async () => {
  const f = await piSessionFixture({ extension, config: 'read: [reference.txt]\nyes-always: true\n' });
  const path = join(f.cwd, 'reference.txt');
  await writeFile(path, 'before\n');
  f.replies.push({ text: 'reference.txt\n```\nafter\n```\n' }, { text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'admit the edit');
  await promptAndSettle(session, 'read it again');
  expect(restore(session.sessionManager.getBranch()).snapshot?.files).toEqual({ editable: [path], readOnly: [path] });
  expect(f.requests[1]?.messages.map(textOf)).toContain('READ ONLY\nreference.txt\n```\nafter\n```\n');
  expect(f.requests[1]?.messages.map(textOf)).toContain('EDITABLE\nreference.txt\n```\nafter\n```\n');
  expect(await readFile(path, 'utf8')).toBe('after\n');
  expect(f.errors).toEqual([]);
});

test('symlink parent traversal edits the admitted physical target', async () => {
  const f = await piSessionFixture({ extension, config: 'yes-always: true\n' });
  const child = join(f.root, 'outside', 'child');
  await mkdir(child, { recursive: true });
  await symlink(child, join(f.cwd, 'link'));
  await writeFile(join(f.root, 'outside', 'target.txt'), 'before\n');
  await writeFile(join(f.cwd, 'target.txt'), 'not the target\n');
  f.replies.push({ text: 'link/../target.txt\n```\nafter\n```\n' });
  const session = await f.open();
  await promptAndSettle(session, 'edit the target');
  expect(await readFile(join(f.root, 'outside', 'target.txt'), 'utf8')).toBe('after\n');
  expect(await readFile(join(f.cwd, 'target.txt'), 'utf8')).toBe('not the target\n');
  expect(f.errors).toEqual([]);
});

test('a symlink loop cannot redirect an edit to a lexical parent', async () => {
  const f = await piSessionFixture({ extension, config: 'yes-always: true\n' });
  await symlink('loop', join(f.cwd, 'loop'));
  await writeFile(join(f.cwd, 'target.txt'), 'protected\n');
  f.replies.push({ text: 'loop/../target.txt\n```\nafter\n```\n' }, { text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'reject the loop');
  expect(await readFile(join(f.cwd, 'target.txt'), 'utf8')).toBe('protected\n');
  expect(f.requests).toHaveLength(2);
  expect(f.errors).toEqual([]);
});

test('a later filesystem failure preserves evidence of an earlier write', async () => {
  const f = await piSessionFixture({ extension, config: 'file: [good.txt]\nyes-always: true\n' });
  await writeFile(join(f.cwd, 'good.txt'), 'before\n');
  await mkdir(join(f.cwd, 'bad.txt'));
  f.replies.push({ text: 'good.txt\n```\nafter\n```\nbad.txt\n```\nsecond\n```\n' }, { text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'two edits');
  expect(await readFile(join(f.cwd, 'good.txt'), 'utf8')).toBe('after\n');
  const records = session.sessionManager
    .getBranch()
    .filter((entry) => entry.type === 'custom')
    .map((entry) => entry.data);
  expect(records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'operation-intent', ordinal: 0, path: join(f.cwd, 'good.txt') }),
      expect.objectContaining({ kind: 'operation-observed', ordinal: 0, outcome: 'succeeded' }),
      expect.objectContaining({ kind: 'operation-intent', ordinal: 1, path: join(f.cwd, 'bad.txt') }),
      expect.objectContaining({ kind: 'operation-observed', ordinal: 1, outcome: 'failed' }),
    ]),
  );
  expect(f.requests).toHaveLength(2);
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
