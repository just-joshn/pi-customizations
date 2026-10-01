import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { openCloudWorker, readCloudOutcome } from '../src/cloud-worker.ts';
import { WorkerRuntime } from '../src/worker-runtime.ts';
import { fixture } from './session-fixture.ts';

vi.mock(import('../src/cloud-worker.ts'), async (original) => ({ ...(await original()), openCloudWorker: vi.fn(), readCloudOutcome: vi.fn() }));
vi.mock(import('../scripts/detached-rpc-client.mjs'), async (original) => ({ ...(await original()), openDetachedRpc: vi.fn() }));

test('a rejected first cloud prompt closes its mocked allocation and records failure', async () => {
  let runtime: WorkerRuntime | undefined;
  let context: ExtensionContext | undefined;
  const close = vi.fn(async () => {});
  const send = vi.fn(async () => ({ type: 'response' as const, command: 'prompt' as const, success: false as const, error: 'Fixture prompt rejected' }));
  const handle = { directory: '/unused', send, close, status: vi.fn(), activity: vi.fn(), snapshot: vi.fn(), info: vi.fn() };
  vi.mocked(readCloudOutcome).mockResolvedValue(undefined);
  const { openDetachedRpc } = await import('../scripts/detached-rpc-client.mjs');
  vi.mocked(openDetachedRpc).mockReturnValue(handle);
  let taskId = '';
  vi.mocked(openCloudWorker).mockImplementation(async ({ id }) => {
    taskId = id;
    return {
      handle,
      record: {
        id,
        persona: 'generalPurpose',
        cwd: '/unused',
        readonly: false,
        sessionFile: '/unused/session',
        outputFile: '/unused/output',
        status: 'running',
        output: '',
        modelReference: 'fixture',
        detached: { directory: '/unused', invocation: 'fixture', entryCursor: null },
      },
    };
  });
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
  const { session } = await f.open();
  try {
    if (!runtime || !context) throw new Error('Main fixture lifecycle did not start');
    await expect(runtime.start('fixture-call', { prompt: 'Not executed', environment: 'cloud' }, undefined, context)).rejects.toThrow('Fixture prompt rejected');
    expect(close).toHaveBeenCalledOnce();
    expect((await runtime.output(taskId, false, undefined)).details).toMatchObject({ status: 'failed', output: 'Error: Fixture prompt rejected' });
    expect(f.requests).toEqual([]);
  } finally {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    await f.close();
  }
});
