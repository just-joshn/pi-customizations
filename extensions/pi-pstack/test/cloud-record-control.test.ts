import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { startDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { cloudControl, readCloudOutcome, stopCloudWorker } from '../src/cloud-worker.ts';
import type { TaskRecord } from '../src/worker-records.ts';
import { fixture, packageRoot, prompt, toolResults } from './session-fixture.ts';

const savedRecord = (directory: string, runtime: string, invocation: string): TaskRecord => ({
  id: 'fixture',
  persona: 'generalPurpose',
  cwd: directory,
  readonly: false,
  sessionFile: join(directory, 'session'),
  outputFile: join(directory, 'output'),
  status: 'running',
  output: '',
  detached: { directory: runtime, invocation, entryCursor: null },
});

test('cloud record control reads a finished main-session snapshot without launching Task', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-cloud-record-'));
  const handle = await startDetachedRpc({ directory, cwd: directory, agentDir: join(directory, 'agent'), headless: true, closeAfterSettle: true, args: ['--no-session', '--no-extensions', '-e', packageRoot] });
  try {
    const invocation = randomUUID();
    const record = savedRecord(directory, handle.directory, invocation);
    expect(await readCloudOutcome(record)).toBeUndefined();
    await expect(handle.send({ type: 'get_state' }, '../unsafe')).rejects.toThrow('Invalid detached RPC request ID');
    const response = await handle.send({ type: 'prompt', message: '/pstack' }, invocation);
    expect(response.id).toBe(invocation);
    await expect.poll(() => handle.status(), { timeout: 5000 }).toBe('exited');
    expect(await readCloudOutcome(record)).toEqual({ status: 'settled', output: '', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    await expect(readCloudOutcome(savedRecord(directory, handle.directory, 'wrong'))).rejects.toThrow('invocation does not match');
  } finally {
    await handle.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test('disconnect leaves the main process alive and explicit stop shuts it down', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-cloud-disconnect-'));
  const handle = await startDetachedRpc({ directory, cwd: directory, agentDir: join(directory, 'agent'), args: ['--no-session', '--no-extensions'] });
  try {
    const control = cloudControl(handle);
    control.disconnect();
    expect(control.signal.aborted).toBe(true);
    expect(await handle.status()).toBe('ready');
    expect((await handle.send({ type: 'get_state' })).success).toBe(true);
    await stopCloudWorker(handle);
    expect(await handle.status()).toBe('exited');
    expect(await readCloudOutcome(savedRecord(directory, handle.directory, 'unused'))).toMatchObject({ status: 'interrupted', output: 'Cloud worker exited without a completion snapshot.' });
  } finally {
    await handle.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test('parent restoration reconnects saved cloud control and shutdown detaches it without Task execution', async () => {
  const f = await fixture();
  const handle = await startDetachedRpc({ directory: f.root, cwd: f.cwd, agentDir: join(f.root, 'rpc-agent'), args: ['--no-session', '--no-extensions'] });
  try {
    const record = savedRecord(f.cwd, handle.directory, randomUUID());
    const manager = SessionManager.create(f.cwd, join(f.root, 'sessions'));
    manager.appendCustomEntry('pstack-task', record);
    const { session } = await f.open(manager);
    f.calls.push({ type: 'toolCall', id: 'read-restored-cloud', name: 'TaskOutput', arguments: { task_id: record.id, block: false } });
    await prompt(session, 'Read the restored control record.');
    expect(toolResults(session, 'TaskOutput')[0]?.isError).toBe(false);
    expect(JSON.stringify(toolResults(session, 'TaskOutput')[0]?.content)).toContain('running');
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    expect(await handle.status()).toBe('ready');
    expect((await handle.send({ type: 'get_state' })).success).toBe(true);
    expect(
      f.requests
        .flatMap((request) => request.messages)
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => message.content)
        .filter((block) => block.type === 'toolCall')
        .map((block) => block.name),
    ).not.toContain('Task');
  } finally {
    await handle.close();
    await f.close();
  }
}, 30000);

test('the internal owner finalization path shuts down a scripted main session without Task calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-owner-finalize-'));
  const handle = await startDetachedRpc({
    directory,
    cwd: directory,
    agentDir: join(directory, 'agent'),
    headless: true,
    closeAfterSettle: true,
    ownerId: 'main-fixture',
    args: ['--no-session', '--no-extensions', '-e', packageRoot, '-e', join(packageRoot, 'test/journey-provider.ts'), '--provider', 'journey-test', '--model', 'recorder'],
  });
  try {
    const commands = await handle.send({ type: 'get_commands' });
    expect(JSON.stringify(commands)).toContain('pstack-worker-finalize');
    const invocation = randomUUID();
    await handle.send({ type: 'prompt', message: 'JOURNEY:getgoal' }, invocation);
    await expect.poll(() => handle.status(), { timeout: 5000 }).toBe('exited');
    const outcome = await readCloudOutcome(savedRecord(directory, handle.directory, invocation));
    expect(outcome?.status).toBe('settled');
    expect(outcome?.usage.totalTokens).toBe(0);
    const snapshot = await handle.snapshot();
    expect(JSON.stringify(snapshot?.entries)).toContain('GetGoal');
    expect(JSON.stringify(snapshot?.entries)).not.toContain('"toolName":"Task"');
  } finally {
    await handle.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test('a stale supervisor PID is failed without overwriting the actor-owned status', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-cloud-stale-'));
  try {
    const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    expect(exited.status).toBe(0);
    await writeFile(join(directory, 'status.json'), JSON.stringify({ kind: 'ready', pid: exited.pid, childPid: exited.pid }));
    expect(await readCloudOutcome(savedRecord(directory, directory, 'unused'))).toMatchObject({ status: 'failed', output: 'Detached RPC supervisor exited without a final status.' });
    expect(JSON.parse(await readFile(join(directory, 'status.json'), 'utf8'))).toEqual({ kind: 'ready', pid: exited.pid, childPid: exited.pid });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
