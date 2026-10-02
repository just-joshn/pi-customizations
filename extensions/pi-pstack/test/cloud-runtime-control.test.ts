import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ExtensionContext, SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test } from 'vitest';
import { startDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { WorkerRuntime } from '../src/worker-runtime.ts';
import { fixture } from './session-fixture.ts';

async function restoredCloudTask() {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-cloud-runtime-'));
  const handle = await startDetachedRpc({ directory, cwd: directory, agentDir: join(directory, 'agent'), args: ['--no-session', '--no-extensions'] });
  onTestFinished(async () => {
    await handle.close();
    await rm(directory, { recursive: true, force: true });
  });
  let runtime: WorkerRuntime | undefined;
  let context: ExtensionContext | undefined;
  const f = await fixture({
    extensionDisabled: true,
    extensionFactories: [
      (pi) => {
        runtime = new WorkerRuntime(pi);
        runtime.registerLifecycle();
        pi.on('session_start', (_event, ctx) => {
          context = ctx;
        });
      },
    ],
  });
  const manager = SessionManager.create(f.cwd, join(f.root, 'sessions'));
  manager.appendCustomEntry('pstack-task', {
    id: 'saved-cloud',
    persona: 'generalPurpose',
    cwd: directory,
    readonly: false,
    sessionFile: join(directory, 'session'),
    outputFile: join(directory, 'output.txt'),
    status: 'running',
    output: '',
    detached: { directory: handle.directory, invocation: 'saved-invocation', entryCursor: null },
  });
  const { session } = await f.open(manager);
  onTestFinished(async () => {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    await f.close();
  });
  if (!runtime || !context) throw new Error('Main fixture lifecycle did not start');
  return { runtime, context, handle };
}

test('TaskMessage queues steering on a restored cloud task through its detached root', async () => {
  const { runtime } = await restoredCloudTask();
  const queued = await runtime.message('saved-cloud', 'please narrow the scope', 'steer');
  expect(queued.content).toEqual([{ type: 'text', text: 'Message queued for saved-cloud' }]);
}, 30000);

test('TaskStop on a restored cloud task stops its root and reports the interrupted record', async () => {
  const { runtime, handle } = await restoredCloudTask();
  const stopped = await runtime.stop('saved-cloud');
  expect(stopped.details).toMatchObject({ task_id: 'saved-cloud', status: 'interrupted', message: 'Stopped task saved-cloud' });
  expect(await handle.status()).toBe('exited');
}, 30000);

test('TaskOutput with block waits for a restored cloud task to finish after it is stopped elsewhere', async () => {
  const { runtime, handle } = await restoredCloudTask();
  const waiting = runtime.output('saved-cloud', true, undefined);
  await handle.send({ type: 'abort' });
  await handle.close();
  const settled = await waiting;
  expect(settled.details).toMatchObject({ id: 'saved-cloud', status: 'interrupted' });
}, 30000);

test('a blocking TaskOutput that is cancelled leaves the cloud task running', async () => {
  const { runtime } = await restoredCloudTask();
  const controller = new AbortController();
  const waiting = runtime.output('saved-cloud', true, controller.signal);
  controller.abort();
  await expect(waiting).rejects.toThrow('Wait cancelled.');
  expect((await runtime.output('saved-cloud', false, undefined)).details).toMatchObject({ status: 'running' });
}, 30000);

test('attaching a task that is not remote is refused', async () => {
  const { runtime, context } = await restoredCloudTask();
  const record = { id: 'local-only', persona: 'generalPurpose', cwd: '/', readonly: false, sessionFile: '/s', outputFile: '/o', status: 'running' as const, output: '' };
  await expect(runtime.attach(record, context)).rejects.toThrow('Only a remote task can be attached from repository discovery.');
});
