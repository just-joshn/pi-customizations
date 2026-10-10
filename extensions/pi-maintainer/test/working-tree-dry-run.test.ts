import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test, vi } from 'vitest';
import { createWorkingTree } from '../src/edit/working-tree.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pi-maintainer-dry-run-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const tree = createWorkingTree({ dryRun: true, notices: { output: vi.fn(), warning: vi.fn(), error: vi.fn() } });
  return { root, tree };
}

test('dry-run writes preserve existing file bytes', async () => {
  const { root, tree } = await fixture();
  const path = join(root, 'source.txt');
  await writeFile(path, Buffer.from([0xff, 0x0d, 0x0a]));

  await tree.write(path, 'replacement');

  expect(await readFile(path)).toEqual(Buffer.from([0xff, 0x0d, 0x0a]));
});

test('dry-run writes leave missing files absent', async () => {
  const { root, tree } = await fixture();
  const path = join(root, 'new.txt');

  await tree.write(path, 'replacement');

  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readdir(root)).toHaveLength(0);
});

test('dry-run touch leaves missing directories absent', async () => {
  const { root, tree } = await fixture();

  expect(await tree.touch(join(root, 'nested', 'new.txt'))).toBe(true);

  expect(await readdir(root)).toHaveLength(0);
});

test('dry-run touch preserves existing file timestamps', async () => {
  const { root, tree } = await fixture();
  const path = join(root, 'source.txt');
  await writeFile(path, 'original');
  const before = await stat(path);

  expect(await tree.touch(path)).toBe(true);

  const after = await stat(path);
  expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(after.ctimeMs).toBe(before.ctimeMs);
});

test('dry-run removal preserves a source file', async () => {
  const { root, tree } = await fixture();
  const path = join(root, 'source.txt');
  await writeFile(path, 'original');

  await tree.remove(path);

  expect(await readFile(path, 'utf8')).toBe('original');
});

test('dry-run removal preserves directories', async () => {
  const { root, tree } = await fixture();
  const path = join(root, 'nested');
  await mkdir(path);

  await tree.remove(path);

  expect((await stat(path)).isDirectory()).toBe(true);
});

test('dry-run operations still read existing file contents', async () => {
  const { root, tree } = await fixture();
  const path = join(root, 'source.txt');
  await writeFile(path, 'original\r\n');

  expect(await tree.read(path)).toBe('original\n');
});
