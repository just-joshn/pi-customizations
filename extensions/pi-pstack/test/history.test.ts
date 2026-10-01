import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { workspaceHistory } from '../src/history.ts';

vi.mock(import('node:fs/promises'), async (original) => ({ ...(await original()) }));

test('authorizes ownership before body reads and preserves names and activity ordering', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'pstack-history-'));
  const foreign = join(root, 'foreign.jsonl');
  const header = `${JSON.stringify({ type: 'session', id: 'foreign', cwd: join(root, 'other') })}\n`;
  try {
    await fs.writeFile(foreign, `${header}{"type":"message","message":{"role":"user","content":"foreign synthetic body"}}\n`);
    await fs.writeFile(join(root, 'old.jsonl'), `${JSON.stringify({ type: 'session', id: 'old', cwd: root, timestamp: '2026-01-01T00:00:00Z' })}\n{"type":"session_info","name":" Old name "}\n`);
    await fs.writeFile(join(root, 'new.jsonl'), `${JSON.stringify({ type: 'session', id: 'new', cwd: root, timestamp: '2026-02-01T00:00:00Z' })}\n{"type":"session_info","name":"Cleared"}\n{"type":"session_info","name":" "}\n`);
    const original = fs.open;
    let reads: ReturnType<typeof vi.spyOn> | undefined;
    let streams: ReturnType<typeof vi.spyOn> | undefined;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await original(...args);
      if (args[0] === foreign) {
        reads = vi.spyOn(handle, 'read');
        streams = vi.spyOn(handle, 'createReadStream');
      }
      return handle;
    });
    expect(await workspaceHistory(root, root)).toEqual([
      { id: 'new', path: join(root, 'new.jsonl'), name: undefined },
      { id: 'old', path: join(root, 'old.jsonl'), name: 'Old name' },
    ]);
    expect(streams).toHaveBeenCalledTimes(0);
    expect(reads).toHaveBeenCalledTimes(Buffer.byteLength(header));
    expect(reads?.mock.calls.every((args: readonly unknown[]) => args[2] === 1 && Number(args[3]) < Buffer.byteLength(header))).toBe(true);
  } finally {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('cancellation after allocation closes the session handle', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'pstack-history-abort-'));
  const controller = new AbortController();
  const original = fs.open;
  let checkClosed: () => void = () => {
    throw new Error('file was not allocated');
  };
  try {
    await fs.writeFile(join(root, 'session.jsonl'), JSON.stringify({ type: 'session', id: 'own', cwd: root }));
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await original(...args);
      const close = vi.spyOn(handle, 'close');
      checkClosed = () => {
        expect(close).toHaveBeenCalledTimes(1);
      };
      controller.abort(new Error('cancelled after allocation'));
      return handle;
    });
    await expect(workspaceHistory(root, root, controller.signal)).rejects.toThrow('cancelled after allocation');
    checkClosed();
  } finally {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('unreadable discovery is best effort but cancellation propagates', async () => {
  expect(await workspaceHistory('/unavailable-workspace', '/unavailable-history')).toEqual([]);
  const controller = new AbortController();
  controller.abort(new Error('cancelled history'));
  await expect(workspaceHistory('/unavailable-workspace', '/unavailable-history', controller.signal)).rejects.toThrow('cancelled history');
});
