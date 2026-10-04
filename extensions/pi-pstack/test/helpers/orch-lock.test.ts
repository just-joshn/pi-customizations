import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type OpenStoreOptions, openStore, type Store } from '../../skills/poteto-mode/scripts/orch/store.ts';
import { cleanDirectories, makeDirectory } from './orch-fixtures.ts';

const storeModule = new URL('../../skills/poteto-mode/scripts/orch/store.ts', import.meta.url).pathname;
const handles: Store[] = [];
const lockOf = (directory: string) => join(directory, '.orch.lock');
const liveForeignPid = String(process.ppid);

async function initialized(options?: OpenStoreOptions): Promise<{ directory: string; store: Store }> {
  const directory = await makeDirectory();
  const store = openStore(directory, options);
  handles.push(store);
  await store.init();
  await store.close();
  const reopened = openStore(directory, options);
  handles.push(reopened);
  return { directory, store: reopened };
}

afterEach(async () => {
  for (const store of handles.splice(0)) await store.close();
  await cleanDirectories();
});

describe('orch lock holders', () => {
  test.skipIf(process.getuid?.() === 0)('a holder pid that raises EPERM counts as a live holder', async () => {
    const { directory, store } = await initialized();
    await writeFile(lockOf(directory), '1\n');
    await expect(store.units.add({ id: 'u', track: 't' })).rejects.toThrow('store lock held by pid 1');
  });

  test('a lock that a foreign holder wrote survives our close', async () => {
    const { directory, store } = await initialized();
    await store.units.add({ id: 'u', track: 't' });
    await writeFile(lockOf(directory), '424242\n');
    await store.close();
    expect((await readFile(lockOf(directory), 'utf8')).trim()).toBe('424242');
  });

  test('a close with a pending lock request releases the lock it acquires', async () => {
    const { directory, store } = await initialized();
    const pending = store.units.add({ id: 'u', track: 't' }).catch(() => 'rejected');
    await store.close();
    await pending;
    await expect(readFile(lockOf(directory), 'utf8')).rejects.toThrow('ENOENT');
  });

  test('every read works while another holder owns the lock, and writes are refused', async () => {
    const { directory, store } = await initialized();
    await writeFile(lockOf(directory), `${liveForeignPid}\n`);
    expect(await store.units.list()).toEqual([]);
    expect(await store.units.counts()).toEqual({});
    expect(await store.ledger.summary()).toEqual({});
    expect(await store.inbox.count()).toBe(0);
    expect(await store.gates.list()).toEqual([]);
    expect(await store.standing.show()).toEqual([]);
    expect((await store.frontier.show()).generation).toBe(0);
    await expect(store.units.add({ id: 'u', track: 't' })).rejects.toThrow(`store lock held by pid ${liveForeignPid}`);
  });
});

describe('orch lock recovery', () => {
  test('force takes the lock and reports the previous live holder', async () => {
    const stolen: string[] = [];
    const { directory, store } = await initialized();
    await writeFile(lockOf(directory), `${liveForeignPid}\n`);
    await expect(store.units.add({ id: 'u', track: 't' })).rejects.toThrow(`store lock held by pid ${liveForeignPid}`);
    const forced = openStore(directory, { force: true, onLockStolen: (holder) => stolen.push(holder) });
    handles.push(forced);
    await forced.units.add({ id: 'u', track: 't' });
    expect(stolen).toEqual([liveForeignPid]);
    expect((await readFile(lockOf(directory), 'utf8')).trim()).toBe(String(process.pid));
  });

  test('a dead holder is replaced on the next write', async () => {
    const { directory, store } = await initialized();
    const deadPid = spawnSync('true').pid;
    await writeFile(lockOf(directory), `${deadPid}\n`);
    await store.units.add({ id: 'u', track: 't' });
    expect((await readFile(lockOf(directory), 'utf8')).trim()).toBe(String(process.pid));
  });
});

function runScript(path: string): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(process.execPath, [path]);
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('close', () => resolve(out.trim()));
  });
}

test('a reader never observes a half-written units file while another process rewrites it', async () => {
  const { directory, store } = await initialized();
  const writer = join(directory, 'writer.ts');
  await writeFile(
    writer,
    `import { openStore } from ${JSON.stringify(storeModule)};
const store = openStore(${JSON.stringify(directory)});
for (let n = 0; n < 150; n += 1) await store.units.add({ id: 'u' + n, track: 'tt'.repeat(40) });
await store.close();
`,
  );
  const done = runScript(writer);
  let finished = false;
  void done.then(() => (finished = true));
  let reads = 0;
  let last = 0;
  while (!finished) {
    const rows = await store.units.list();
    expect(rows.length).toBeGreaterThanOrEqual(last);
    last = rows.length;
    reads += 1;
  }
  await done;
  expect(reads).toBeGreaterThan(1);
  expect((await store.units.list()).length).toBe(150);
}, 60_000);
