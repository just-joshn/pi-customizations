import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import * as executors from '../src/remote-executors.ts';
import { openRemoteRpc, remoteCall } from '../src/remote-worker-transport.ts';

const executor: executors.RemoteExecutor = {
  id: 'fixture',
  transport: 'lima',
  target: 'fixture',
  packageRoot: '/guest/package',
  repository: '/guest/repository',
  localRepository: '/local/repository',
  agentDir: '/guest/agent',
  machineId: 'guest-machine',
  isolation: 'vm',
};

function transport(mode = 'normal') {
  vi.spyOn(executors, 'remoteArguments').mockReturnValue({ executable: process.execPath, args: [join(process.cwd(), 'test/remote-transport-fixture.mjs'), mode] });
}

test('remote requests travel over stdin without forwarding model credentials', async () => {
  transport('environment');
  vi.stubEnv('PI_REMOTE_TEST_SECRET', 'fixture-sensitive-value');
  const request = { operation: 'info' as const, taskId: '00000000-0000-0000-0000-000000000000' };
  expect(await remoteCall(executor, request)).toEqual({ request: { ...request, executor } });
});

test('remote handles retain directory and invocation identity through lifecycle operations', async () => {
  transport();
  const handle = openRemoteRpc(executor, '00000000-0000-0000-0000-000000000000', '/guest/agent/task/rpc-one');
  expect(handle.directory).toBe('/guest/agent/task/rpc-one');
  expect(await handle.status()).toBe('ready');
  expect(await handle.activity()).toEqual({ kind: 'running', invocation: 'test-invocation' });
  expect(await handle.snapshot()).toBeUndefined();
  expect(await handle.send({ type: 'prompt', message: 'work' }, 'stable-invocation')).toMatchObject({ success: true, data: { invocation: 'stable-invocation' } });
  await handle.close();
});

test('invalid transport responses fail explicitly', async () => {
  transport('invalid');
  await expect(remoteCall(executor, { operation: 'info', taskId: '00000000-0000-0000-0000-000000000000' })).rejects.toThrow('Invalid remote');
});

test('remote domain errors retain their cause', async () => {
  transport('error');
  await expect(remoteCall(executor, { operation: 'info', taskId: '00000000-0000-0000-0000-000000000000' })).rejects.toThrow('Remote machine identity differs');
});
