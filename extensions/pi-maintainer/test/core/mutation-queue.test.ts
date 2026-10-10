import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test } from 'vitest';
import { createWorkingTree } from '../../src/edit/working-tree.ts';

async function files() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'maintainer-queue-')));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'text.txt');
  await writeFile(path, '0');
  return { path, root, tree: createWorkingTree({ notices: { output: () => {}, warning: () => {}, error: () => {} } }) };
}

test('a transaction serializes complete competing read-modify-writes', async () => {
  const { path, tree } = await files();
  const increment = () =>
    tree.mutate([path], async (locked) => {
      const value = await locked.read(path);
      await locked.write(path, String(Number(value) + 1));
    });
  await Promise.all([increment(), increment(), increment()]);
  expect(await readFile(path, 'utf8')).toBe('3');
});

test('aliases acquire one effective file lock', async () => {
  const { path, root, tree } = await files();
  const alias = join(root, 'alias.txt');
  await symlink(path, alias);
  await tree.mutate([alias, path, alias], (locked) => locked.write(alias, 'changed'));
  expect(await readFile(path, 'utf8')).toBe('changed');
});

test('undeclared mutation targets are rejected before writing', async () => {
  const { path, root, tree } = await files();
  await expect(tree.mutate([path], (locked) => locked.write(join(root, 'other.txt'), 'bad'))).rejects.toThrow('Mutation target was not locked');
  expect(await tree.exists(join(root, 'other.txt'))).toBe(false);
});

test('nested transactions fail rather than reacquire a held lock', async () => {
  const { path, tree } = await files();
  await expect(tree.mutate([path], (locked) => locked.mutate([path], async () => {}))).rejects.toThrow('cannot be reentered');
  await tree.write(path, 'released');
  expect(await readFile(path, 'utf8')).toBe('released');
});

test('an aborted queued transaction never enters its callback', async () => {
  const { path, tree } = await files();
  const abort = new AbortController();
  let release = () => {};
  let acquired = () => {};
  const entered = new Promise<void>((done) => {
    acquired = done;
  });
  const hold = withFileMutationQueue(path, async () => {
    acquired();
    await new Promise<void>((done) => {
      release = done;
    });
  });
  await entered;
  const queued = tree.mutate([path], (locked) => locked.write(path, 'bad'), abort.signal);
  abort.abort(new Error('cancelled'));
  release();
  await hold;
  await expect(queued).rejects.toThrow('cancelled');
  expect(await readFile(path, 'utf8')).toBe('0');
});
