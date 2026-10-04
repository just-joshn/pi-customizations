import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { afterEach, expect, test, vi } from 'vitest';
import type { RemoteExecutor } from '../src/remote-executors.ts';
import { remoteWorkerArguments, resolveRemotePlacement, startRemoteWorker } from '../src/remote-worker.ts';
import * as transport from '../src/remote-worker-transport.ts';
import type { TaskRecord } from '../src/worker-records.ts';
import type { prepareWorkerSession } from '../src/worker-support.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

type Prepared = Awaited<ReturnType<typeof prepareWorkerSession>>;
const executor: RemoteExecutor = {
  id: 'fixture',
  transport: 'lima',
  target: 'fixture',
  packageRoot: '/guest/package',
  repository: '/guest/repository',
  localRepository: '/local/repository',
  agentDir: '/guest/agent',
  machineId: 'guest-machine',
  isolation: 'vm',
  extensions: ['/guest/provider.ts'],
};
const prepared = {
  cwd: '/local/repository',
  selected: { model: { provider: 'fixture', id: 'model' }, thinkingLevel: 'off' },
  loader: { getSkills: () => ({ skills: [{ filePath: join(process.cwd(), 'host/skills/loop/SKILL.md') }, { filePath: '/private/skill.md' }] }), getPrompts: () => ({ prompts: [] }), getAppendSystemPrompt: () => ['Operator instructions'] },
  readonly: false,
  settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }),
} as unknown as Prepared;
const receipt = {
  directory: '/guest/rpc',
  cwd: '/guest/worktree',
  sha: 'a'.repeat(40),
  executorId: 'fixture',
  machineId: 'guest-machine',
  hostname: 'guest',
  isolation: 'vm',
  virtualization: 'apple',
  bootId: 'boot',
  sessionFile: '/guest/session',
  sessionId: 'session',
  model: { provider: 'fixture', id: 'model' },
  thinkingLevel: 'off',
};

async function repository(onTestFinished: (cleanup: () => Promise<void>) => void) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'remote-placement-')));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'pkg'));
  const git = (...args: string[]) => execFileSync('git', ['-C', directory, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', ...args], { encoding: 'utf8' }).trim();
  git('init', '-qb', 'main');
  await writeFile(join(directory, 'pkg/source'), 'committed');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  const configured = { ...executor, localRepository: directory };
  const config = join(directory, 'executors.json');
  await writeFile(config, JSON.stringify([configured]));
  vi.stubEnv('PI_PSTACK_EXECUTORS', config);
  return { directory, git, configured };
}

test('placement uses committed HEAD and preserves the requested repository subdirectory', async ({ onTestFinished }) => {
  const { directory, git, configured } = await repository(onTestFinished);
  await writeFile(join(directory, 'pkg/dirty'), 'uncommitted');
  expect(await resolveRemotePlacement(join(directory, 'pkg'), { prompt: 'work' })).toEqual({ executor: configured, sha: git('rev-parse', 'HEAD'), subdirectory: 'pkg' });
  expect(await resolveRemotePlacement(directory, { prompt: 'work', cloud_base_branch: 'main' })).toMatchObject({ sha: git('rev-parse', 'HEAD'), subdirectory: '.' });
  await expect(resolveRemotePlacement(directory, { prompt: 'work', cloud_base_branch: 'absent' })).rejects.toThrow('does not resolve');
});

test('resume preserves machine and checkout identity and refuses legacy local allocations', async ({ onTestFinished }) => {
  const { directory, git, configured } = await repository(onTestFinished);
  const prior = { detached: { remote: { executor: configured, sha: git('rev-parse', 'HEAD') } } } as TaskRecord;
  expect(await resolveRemotePlacement(directory, { prompt: 'again' }, prior)).toMatchObject({ executor: configured });
  await expect(resolveRemotePlacement(directory, { prompt: 'again', remote_executor: 'different' }, prior)).rejects.toThrow('preserve the remote executor');
  await expect(resolveRemotePlacement(directory, { prompt: 'again' }, { detached: {} } as TaskRecord)).rejects.toThrow('legacy local');
  await writeFile(join(directory, 'new'), 'new');
  git('add', '.');
  git('commit', '-qm', 'new');
  await expect(resolveRemotePlacement(directory, { prompt: 'again', cloud_base_branch: 'main' }, prior)).rejects.toThrow('preserve the remote checkout SHA');
});

test('remote argv names guest resources and guest providers without local provider paths', () => {
  const args = remoteWorkerArguments({ ...prepared, readonly: true }, executor);
  expect(args).toContain('/guest/provider.ts');
  expect(args).toContain('/guest/package/src/index.ts');
  expect(args).toContain('/guest/package/host/skills/loop/SKILL.md');
  expect(args).not.toContain('/private/skill.md');
  expect(args).toContain('read,grep,find,ls');
  expect(args).not.toContain(process.cwd());
});

test.for([false, true])('remote launch inherits parent project trust (%s)', (trusted) => {
  const args = remoteWorkerArguments({ ...prepared, settingsManager: SettingsManager.inMemory({}, { projectTrusted: trusted }) }, executor);
  expect(args.filter((arg) => arg === '--approve' || arg === '--no-approve')).toEqual([trusted ? '--approve' : '--no-approve']);
});

test('declined remote trust leaves executable project resources unloaded', async ({ onTestFinished }) => {
  const directory = await mkdtemp(join(tmpdir(), 'remote-trust-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.pi/extensions'), { recursive: true });
  await writeFile(join(directory, '.pi/extensions/probe.ts'), 'throw new Error("project extension executed");');
  const args = remoteWorkerArguments({ ...prepared, settingsManager: SettingsManager.inMemory({}, { projectTrusted: false }) }, executor);
  const loader = new DefaultResourceLoader({ cwd: directory, agentDir: join(directory, 'agent'), settingsManager: SettingsManager.inMemory() });
  expect(args).toContain('--no-approve');
  await loader.reload({ resolveProjectTrust: async () => args.includes('--approve') });
  expect(loader.getExtensions().extensions).toHaveLength(0);
  expect(loader.getExtensions().errors).toHaveLength(0);
});

test('remote startup validates placement and retains observed isolation evidence', async () => {
  vi.spyOn(transport, 'remoteCall').mockResolvedValue(receipt);
  const result = await startRemoteWorker('task', prepared, { executor, sha: receipt.sha, subdirectory: '.' });
  expect(result.remote).toMatchObject({ machineId: 'guest-machine', virtualization: 'apple', bootId: 'boot', sha: receipt.sha, localCwd: prepared.cwd });
  expect(result.response.sessionFile).toBe('/guest/session');
  expect(transport.remoteCall).toHaveBeenCalledWith(executor, expect.objectContaining({ operation: 'start', sha: receipt.sha, systemPrompt: 'Operator instructions' }));
});

test('mismatched placement is closed and never returned as a worker', async () => {
  const close = vi.fn(async () => {});
  vi.spyOn(transport, 'openRemoteRpc').mockReturnValue({ close } as unknown as ReturnType<typeof transport.openRemoteRpc>);
  vi.spyOn(transport, 'remoteCall').mockResolvedValue({ ...receipt, machineId: 'wrong' });
  await expect(startRemoteWorker('task', prepared, { executor, sha: receipt.sha, subdirectory: '.' })).rejects.toThrow('placement did not match');
  expect(close).toHaveBeenCalledOnce();
});

test('model mismatch and invalid remote receipts fail explicitly', async () => {
  const close = vi.fn(async () => {});
  vi.spyOn(transport, 'openRemoteRpc').mockReturnValue({ close } as unknown as ReturnType<typeof transport.openRemoteRpc>);
  const call = vi.spyOn(transport, 'remoteCall').mockResolvedValue({ ...receipt, thinkingLevel: 'high' });
  await expect(startRemoteWorker('task', prepared, { executor, sha: receipt.sha, subdirectory: '.' })).rejects.toThrow('requested model');
  expect(close).toHaveBeenCalledOnce();
  call.mockResolvedValue(null);
  await expect(startRemoteWorker('task', prepared, { executor, sha: receipt.sha, subdirectory: '.' })).rejects.toThrow('Invalid remote worker placement');
});
