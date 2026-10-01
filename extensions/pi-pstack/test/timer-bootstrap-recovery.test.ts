import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test, vi } from 'vitest';

vi.mock(import('../scripts/detached-rpc-client.mjs'), async (original) => ({
  ...(await original()),
  startDetachedRpc: vi.fn(async () => { throw new Error('A second writer was attempted.'); }),
}));

import { openTimerRoot } from '../scripts/timer-root.mjs';

async function interruptedBootstrap(status: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-timer-bootstrap-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const rpcDirectory = join(directory, 'rpc-original');
  await mkdir(rpcDirectory);
  if (status) await writeFile(join(rpcDirectory, 'status.json'), JSON.stringify(status));
  return directory;
}

test.for([
  { name: 'a live starting supervisor', status: { kind: 'starting', pid: process.pid } },
  { name: 'a supervisor whose initial receipt is missing', status: undefined },
  { name: 'a dead supervisor with a surviving child', status: { kind: 'ready', pid: 2147483647, childPid: process.pid } },
  { name: 'an inconclusive bootstrap failure', status: { kind: 'failed', pid: 2147483647, error: 'Interrupted startup' } },
])('recovery refuses another writer after $name without a root receipt', async ({ status }) => {
  const directory = await interruptedBootstrap(status);
  await expect(openTimerRoot(directory, { cwd: directory, agentDir: directory, args: [] })).rejects.toThrow('reconciliation');
  expect((await readdir(directory)).filter((name) => name.startsWith('rpc-'))).toEqual(['rpc-original']);
});

test('recovery checks incomplete bootstraps even when a separate root receipt exists', async () => {
  const directory = await interruptedBootstrap({ kind: 'starting', pid: process.pid });
  await writeFile(join(directory, 'root.json'), JSON.stringify({ rpcDirectory: join(directory, 'rpc-saved'), sessionFile: join(directory, 'session', 'root.jsonl') }));
  await expect(openTimerRoot(directory, { cwd: directory, agentDir: directory, args: [] })).rejects.toThrow('reconciliation');
});

test('a conclusive bootstrap exit allows a replacement writer', async () => {
  const directory = await interruptedBootstrap({ kind: 'exited', pid: 2147483647, code: 0 });
  await expect(openTimerRoot(directory, { cwd: directory, agentDir: directory, args: [] })).rejects.toThrow('A second writer was attempted.');
});
