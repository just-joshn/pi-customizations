import './leak-preload.ts';
import * as real from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';
import { cleanDirectories, makeDirectory } from './orch-fixtures.ts';

const fault = vi.hoisted(() => ({ blockInbox: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  const mkdir = vi.fn(original.mkdir);
  mkdir.mockImplementation((...args) => {
    if (fault.blockInbox && String(args[0]).endsWith('/inbox')) throw new Error('mkdir blocked');
    return original.mkdir(...args);
  });
  return { ...original, mkdir };
});

afterEach(async () => {
  fault.blockInbox = false;
  await cleanDirectories();
});

test('an inbox drain whose inbox directory cannot be recreated puts the pointers back', async () => {
  const { openStore } = await import('../../skills/poteto-mode/scripts/orch/store.ts');
  const directory = await makeDirectory();
  const store = openStore(directory);
  try {
    await store.init();
    await store.inbox.push({ agent: 'a', unit: 'u1', status: 'done' });
    await store.inbox.push({ agent: 'b', unit: 'u2', status: 'done' });
    fault.blockInbox = true;
    await expect(store.inbox.drain()).rejects.toThrow('mkdir blocked');
    fault.blockInbox = false;
    expect((await store.inbox.peek()).map((row) => row.agent).toSorted()).toEqual(['a', 'b']);
    expect((await real.readdir(directory)).filter((name) => name.startsWith('.inbox-drain'))).toEqual([]);
    expect(await real.readdir(join(directory, 'inbox'))).toHaveLength(2);
  } finally {
    await store.close();
  }
});
