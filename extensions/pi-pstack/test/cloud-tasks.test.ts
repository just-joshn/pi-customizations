import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { startDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { stopCloudWorker } from '../src/cloud-worker.ts';
import { CloudTasks } from '../src/subagents/cloud-tasks.ts';
import type { TaskRecord } from '../src/worker-records.ts';

async function detachedRoot(options: { stopped: boolean }) {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-cloud-tasks-'));
  const handle = await startDetachedRpc({ directory, cwd: directory, agentDir: join(directory, 'agent'), args: ['--no-session', '--no-extensions'] });
  onTestFinished(async () => {
    await handle.close();
    await rm(directory, { recursive: true, force: true });
  });
  if (options.stopped) await stopCloudWorker(handle);
  const record: TaskRecord = {
    id: 'cloud-fixture',
    persona: 'generalPurpose',
    cwd: directory,
    readonly: false,
    sessionFile: join(directory, 'session'),
    outputFile: join(directory, 'output.txt'),
    status: 'running',
    output: '',
    detached: { directory: handle.directory, invocation: 'fixture-invocation', entryCursor: null },
  };
  return { handle, record };
}

function recordingHost(generation: () => number) {
  const commits: TaskRecord[] = [];
  const notices: Array<{ id: string; parentIdle: boolean }> = [];
  const host = {
    generation,
    current: () => undefined,
    commit: (record: TaskRecord) => commits.push(record),
    pendingUsage: () => undefined,
    notify: (record: TaskRecord, parentIdle: boolean) => notices.push({ id: record.id, parentIdle }),
  };
  return { host, commits, notices };
}

test('a background cloud task that exited without a snapshot settles as interrupted, is saved, and wakes the parent', async () => {
  const { record } = await detachedRoot({ stopped: true });
  const { host, commits, notices } = recordingHost(() => 1);
  const worker = new CloudTasks(host).attach(record, 1, () => true);
  const finished = await worker.completion;
  expect(finished).toMatchObject({ id: 'cloud-fixture', status: 'interrupted', output: 'Cloud worker exited without a completion snapshot.' });
  expect(commits).toEqual([finished]);
  expect(notices).toEqual([{ id: 'cloud-fixture', parentIdle: true }]);
  expect(await readFile(record.outputFile, 'utf8')).toBe('Cloud worker exited without a completion snapshot.');
}, 30000);

test('a foreground cloud task is saved without waking the parent', async () => {
  const { record } = await detachedRoot({ stopped: true });
  const { host, commits, notices } = recordingHost(() => 1);
  const finished = await new CloudTasks(host).attach(record, 1, () => true, false).completion;
  expect(commits).toEqual([finished]);
  expect(notices).toEqual([]);
}, 30000);

test('a task whose owner generation ended settles without touching the new generation', async () => {
  const { record } = await detachedRoot({ stopped: true });
  const { host, commits, notices } = recordingHost(() => 2);
  const finished = await new CloudTasks(host).attach(record, 1, () => true).completion;
  expect(finished.status).toBe('interrupted');
  expect(commits).toEqual([]);
  expect(notices).toEqual([]);
}, 30000);

test('attaching a record without a durable handle is refused', () => {
  const { host } = recordingHost(() => 1);
  const record: TaskRecord = { id: 'plain', persona: 'generalPurpose', cwd: '/', readonly: false, sessionFile: '/s', outputFile: '/o', status: 'running', output: '' };
  expect(() => new CloudTasks(host).attach(record, 1, () => true)).toThrow('Cloud task is missing its durable handle.');
});

test('shutdown by a session that does not own the task disconnects without stopping the root', async () => {
  const { record, handle } = await detachedRoot({ stopped: false });
  const { host } = recordingHost(() => 1);
  const tasks = new CloudTasks(host);
  const worker = tasks.attach(record, 1, () => true);
  expect(tasks.has('cloud-fixture')).toBe(true);
  expect(tasks.shutdown(false, () => {})).toEqual([]);
  expect(tasks.has('cloud-fixture')).toBe(false);
  expect(await worker.completion).toMatchObject({ id: 'cloud-fixture', status: 'running' });
  expect(await handle.status()).toBe('ready');
}, 30000);

test('shutdown by the owning session stops the root and hands the settled record to the claim', async () => {
  const { record, handle } = await detachedRoot({ stopped: false });
  const { host } = recordingHost(() => 1);
  const tasks = new CloudTasks(host);
  const worker = tasks.attach(record, 1, () => true);
  const claimed: TaskRecord[] = [];
  await Promise.all(tasks.shutdown(true, (settled) => claimed.push(settled)));
  expect(claimed.map((settled) => settled.status)).toEqual(['interrupted']);
  expect((await worker.completion).status).toBe('interrupted');
  expect(await handle.status()).toBe('exited');
}, 30000);
