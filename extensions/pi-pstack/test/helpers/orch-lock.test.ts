import './leak-preload.ts';
import { execFile, spawnSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, onTestFinished, test, vi } from 'vitest';
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

const deadPid = (): string => String(spawnSync('true').pid);

afterEach(async () => {
  for (const store of handles.splice(0)) await store.close();
  await cleanDirectories();
  vi.restoreAllMocks();
});

describe('orch lock holders', () => {
  test('a holder pid that raises EPERM counts as a live holder', async () => {
    const kill = process.kill.bind(process);
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === 1 && signal === 0) throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
      return kill(pid, signal);
    });
    const { directory, store } = await initialized({ lockWaitMs: 0 });
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
    const { directory, store } = await initialized({ lockWaitMs: 0 });
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
  test('the held error names the force recovery for a reused pid, and force takes the lock', async () => {
    const stolen: string[] = [];
    const { directory, store } = await initialized({ lockWaitMs: 0 });
    await writeFile(lockOf(directory), `${liveForeignPid}\n`);
    await expect(store.units.add({ id: 'u', track: 't' })).rejects.toThrow('rerun with --force');
    const forced = openStore(directory, { force: true, onLockStolen: (holder) => stolen.push(holder) });
    handles.push(forced);
    await forced.units.add({ id: 'u', track: 't' });
    expect(stolen).toEqual([liveForeignPid]);
    expect((await readFile(lockOf(directory), 'utf8')).trim()).toBe(String(process.pid));
  });

  test('a writer waits for a live holder that releases and then proceeds', async () => {
    const { directory, store } = await initialized({ lockWaitMs: 3000 });
    await writeFile(lockOf(directory), `${liveForeignPid}\n`);
    const started = Date.now();
    const release = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        void rm(lockOf(directory), { force: true }).then(() => resolve(), reject);
      }, 200);
      onTestFinished(() => clearTimeout(timer));
    });
    await store.units.add({ id: 'u', track: 't' });
    await release;
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    expect((await store.units.get('u')).id).toBe('u');
  });

  test('a writer gives up after the bounded wait with the held error', async () => {
    const { directory, store } = await initialized({ lockWaitMs: 150 });
    await writeFile(lockOf(directory), `${liveForeignPid}\n`);
    const started = Date.now();
    await expect(store.units.add({ id: 'u', track: 't' })).rejects.toThrow(`store lock held by pid ${liveForeignPid}`);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(2000);
  });
});

const racer = (store: string, id: string) => `import { openStore } from ${JSON.stringify(storeModule)};
const store = openStore(${JSON.stringify(store)}, { lockWaitMs: 150 });
try { await store.units.add({ id: ${JSON.stringify(id)}, track: 't' }); process.stdout.write('won\\n'); await Bun.sleep(700); }
catch (error) { process.stdout.write('lost ' + error.message + '\\n'); }
finally { await store.close(); }
`;

async function runScript(path: string): Promise<string> {
  const { stdout } = await promisify(execFile)('bun', [path], { timeout: 15_000 });
  return stdout.trim();
}

test('two processes racing a dead-holder lock leave exactly one winner and the loser names the winner', async () => {
  const { directory } = await initialized();
  const scripts = await Promise.all(
    ['a', 'b'].map(async (id) => {
      const path = join(directory, `racer-${id}.ts`);
      await writeFile(path, racer(directory, id));
      return path;
    }),
  );
  expect.hasAssertions();
  for (let round = 0; round < 6; round += 1) {
    await writeFile(lockOf(directory), `${deadPid()}\n`);
    const results = await Promise.allSettled(scripts.map(runScript));
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const outputs = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    expect(outputs.filter((line) => line === 'won')).toHaveLength(1);
    expect(outputs.find((line) => line !== 'won')).toMatch(/^lost store lock held by pid \d+/);
    await rm(lockOf(directory), { force: true });
    await rm(join(directory, 'units.tsv'), { force: true });
    await writeFile(join(directory, 'units.tsv'), 'id\ttrack\tstate\tbranch\tpr\tsha\tbrief\n');
  }
}, 60_000);

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
  expect.hasAssertions();
  const done = runScript(writer);
  let finished = false;
  void done.then(
    () => (finished = true),
    () => (finished = true),
  );
  let reads = 0;
  let last = 0;
  try {
    while (!finished) {
      const rows = await store.units.list();
      expect(rows.length).toBeGreaterThanOrEqual(last);
      last = rows.length;
      reads += 1;
    }
  } finally {
    await done;
  }
  expect(reads).toBeGreaterThan(1);
  expect((await store.units.list()).length).toBe(150);
}, 60_000);
