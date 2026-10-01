import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { startDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { filesystemLaunch } from '../scripts/filesystem-launch.mjs';

test('unrestricted transport launch remains unchanged', async () => {
  expect(await filesystemLaunch('node', ['fixture'], '/unused')).toEqual({ executable: 'node', args: ['fixture'] });
});

test.skipIf(process.platform === 'darwin')('unsupported hosts reject requested restrictions without an unsandboxed fallback', async () => {
  await expect(filesystemLaunch('node', [], '/unused', { denied: ['/store'], allowed: [] })).rejects.toThrow('Unsandboxed fallback is not permitted');
});

test.skipIf(process.platform !== 'darwin')('ancestor exceptions cannot remove a coordinator-store restriction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-isolation-invalid-'));
  try {
    const store = join(root, 'store');
    await mkdir(store);
    await expect(filesystemLaunch('node', [], root, { denied: [store], allowed: [root] })).rejects.toThrow('cannot also be an allowed');
    await expect(filesystemLaunch('node', [], root, { denied: [store], allowed: [store] })).rejects.toThrow('cannot also be an allowed');
    await expect(filesystemLaunch('node', [], root, { denied: [], allowed: [] })).rejects.toThrow('Invalid filesystem restriction');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'darwin')(
  'detached transport blocks coordinator stores and permits task-owned state',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'pstack-isolation-'));
    const store = join(root, 'store');
    const own = join(store, 'task-one');
    await mkdir(own, { recursive: true });
    await writeFile(join(store, 'private.txt'), 'parent fixture');
    await writeFile(join(own, 'own.txt'), 'owned fixture');
    try {
      const handle = await startDetachedRpc({ directory: own, cwd: root, agentDir: join(root, 'agent'), args: ['--no-session', '--no-extensions'], filesystem: { denied: [store], allowed: [own] } });
      try {
        const parent = await handle.send({ type: 'bash', command: `head -c 1 '${join(store, 'private.txt')}' >/dev/null 2>&1 && printf readable || printf blocked` });
        const owned = await handle.send({ type: 'bash', command: `head -c 1 '${join(own, 'own.txt')}' >/dev/null 2>&1 && printf readable || printf blocked` });
        expect(parent).toMatchObject({ success: true, data: { output: 'blocked' } });
        expect(owned).toMatchObject({ success: true, data: { output: 'readable' } });
      } finally {
        await handle.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
