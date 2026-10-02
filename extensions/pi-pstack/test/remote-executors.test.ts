import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { configuredExecutor, parseExecutor, remoteArguments } from '../src/remote-executors.ts';

const executor = {
  id: 'build-machine',
  transport: 'lima',
  target: 'pi-pstack-parity',
  packageRoot: '/home/pstack/package/extensions/pi-pstack',
  repository: '/home/pstack/repo',
  localRepository: '/tmp/repo',
  agentDir: '/home/pstack/agent',
  machineId: 'ca97ec6598b84717a0cfa133848df979',
  isolation: 'vm',
};

test('remote commands target an explicit machine without a shell or host environment', () => {
  const selected = parseExecutor(executor);
  expect(remoteArguments(selected)).toEqual({
    executable: 'limactl',
    args: ['shell', '--workdir=/tmp', 'pi-pstack-parity', 'env', '-i', 'HOME=/home/pstack/agent', 'PATH=/usr/local/bin:/usr/bin:/bin', 'node', '/home/pstack/package/extensions/pi-pstack/scripts/remote-rpc.mjs'],
  });
});

test.for([null, {}, { ...executor, target: '-oProxyCommand=unsafe' }, { ...executor, packageRoot: 'relative' }, { ...executor, isolation: 'worktree' }, { ...executor, machineId: '' }])(
  'invalid placements fail before execution %#',
  (input) => {
    expect(() => parseExecutor(input)).toThrow('Invalid remote executor');
  },
);

test('SSH execution requires a pinned known-hosts file and strict host verification', () => {
  expect(() => parseExecutor({ ...executor, transport: 'ssh' })).toThrow('SSH executor requires knownHosts');
  const selected = parseExecutor({ ...executor, transport: 'ssh', target: 'pstack@buildbox', knownHosts: '/tmp/pstack-known-hosts' });
  const command = remoteArguments(selected);
  expect(command.executable).toBe('ssh');
  expect(command.args.slice(0, 8)).toEqual([
    '-oForwardAgent=no',
    '-oClearAllForwardings=yes',
    '-oPermitLocalCommand=no',
    '-oBatchMode=yes',
    '-oStrictHostKeyChecking=yes',
    '-oUserKnownHostsFile=/tmp/pstack-known-hosts',
    '--',
    'pstack@buildbox',
  ]);
  expect(command.args[8]).toBe("'env' '-i' 'HOME=/home/pstack/agent' 'PATH=/usr/local/bin:/usr/bin:/bin' 'node' '/home/pstack/package/extensions/pi-pstack/scripts/remote-rpc.mjs'");
});

test('container transport cannot satisfy independent VM placement', () => {
  expect(() => parseExecutor({ ...executor, transport: 'orb' })).toThrow('Invalid remote executor');
});

test('repository aliases resolve to the same configured executor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-executor-alias-'));
  const alias = `${root}-alias`;
  try {
    await symlink(root, alias);
    const path = join(root, 'executors.json');
    await writeFile(path, JSON.stringify([{ ...executor, localRepository: alias }]));
    vi.stubEnv('PI_PSTACK_EXECUTORS', path);
    expect((await configuredExecutor(root)).id).toBe(executor.id);
  } finally {
    vi.unstubAllEnvs();
    await Promise.all([rm(root, { recursive: true, force: true }), rm(alias, { force: true })]);
  }
});

test('two executor labels cannot turn the same machine into independent lanes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-executor-machine-'));
  try {
    const path = join(root, 'executors.json');
    await writeFile(
      path,
      JSON.stringify([
        { ...executor, localRepository: root },
        { ...executor, id: 'other-label', agentDir: '/home/pstack/other', localRepository: root },
      ]),
    );
    vi.stubEnv('PI_PSTACK_EXECUTORS', path);
    await expect(configuredExecutor(root, executor.id)).rejects.toThrow('Duplicate remote machine identity');
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
