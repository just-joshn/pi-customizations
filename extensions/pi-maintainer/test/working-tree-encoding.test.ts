import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test, vi } from 'vitest';
import { createWorkingTree } from '../src/edit/working-tree.ts';

test.for(['latin-1', 'latin1', 'iso-8859-1'])('reads Python Latin-1 bytes with %s', async (encoding) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-maintainer-encoding-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'source.txt');
  await writeFile(path, Buffer.from([0x80, 0x81, 0x9f, 0xa3, 0xff]));
  const notices = { output: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const tree = createWorkingTree({ encoding, notices });

  expect(await tree.read(path)).toBe('\u0080\u0081\u009f£ÿ');
  expect(notices.error).not.toHaveBeenCalled();
});

test('normalizes newlines in Latin-1 files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-maintainer-encoding-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'source.txt');
  await writeFile(path, Buffer.from([0x80, 0x0d, 0x0a, 0xa3, 0x0d, 0xff, 0x0a]));
  const tree = createWorkingTree({ encoding: 'latin-1', notices: { output: vi.fn(), warning: vi.fn(), error: vi.fn() } });

  expect(await tree.read(path)).toBe('\u0080\n£\nÿ\n');
});
