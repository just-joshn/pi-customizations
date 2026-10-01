import { afterEach, expect, mock, test } from 'bun:test';
import * as real from 'node:fs/promises';
import { join } from 'node:path';

import { cleanDirectories, makeDirectory } from './orch-fixtures.ts';

const original = { ...real };
let blockInbox = false;
mock.module('node:fs/promises', () => ({
  ...original,
  mkdir: async (path: string, ...rest: unknown[]) => {
    if (blockInbox && String(path).endsWith('/inbox')) throw new Error('mkdir blocked');
    return (original.mkdir as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
  },
}));

afterEach(async () => {
  blockInbox = false;
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
    blockInbox = true;
    await expect(store.inbox.drain()).rejects.toThrow('mkdir blocked');
    blockInbox = false;
    expect((await store.inbox.peek()).map((row) => row.agent).toSorted()).toEqual(['a', 'b']);
    expect((await original.readdir(directory)).filter((name) => name.startsWith('.inbox-drain'))).toEqual([]);
    expect(await original.readdir(join(directory, 'inbox'))).toHaveLength(2);
  } finally {
    await store.close();
  }
});
