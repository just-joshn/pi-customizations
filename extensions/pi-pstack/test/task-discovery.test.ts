import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { discoverTasks, publishTask, selectTask } from '../src/task-discovery.ts';
import type { TaskRecord } from '../src/worker-records.ts';

async function fixture(onTestFinished: (cleanup: () => Promise<void>) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'task-discovery-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  vi.stubEnv('PI_CODING_AGENT_DIR', join(directory, 'agent'));
  const repository = join(directory, 'repository');
  execFileSync('git', ['init', '-qb', 'feature', repository]);
  return { directory, repository };
}

const record = (id: string): TaskRecord => ({
  id,
  persona: 'generalPurpose',
  cwd: '/guest/worktree',
  readonly: false,
  sessionFile: '/guest/session',
  outputFile: '/local/output',
  status: 'running',
  output: '',
  detached: {
    directory: '/guest/rpc',
    invocation: 'invocation',
    entryCursor: null,
    remote: {
      executor: { id: 'vm', transport: 'lima', target: 'vm', isolation: 'vm', machineId: 'machine', packageRoot: '/guest/package', repository: '/guest/repository', localRepository: '/local/repository', agentDir: '/guest/agent' },
      machineId: 'machine',
      hostname: 'vm',
      virtualization: 'apple',
      bootId: 'boot',
      sha: 'a'.repeat(40),
      localCwd: '/local/repository',
    },
  },
});

test('remote launch discovery is scoped to the repository and retains branch placement', async ({ onTestFinished }) => {
  const { directory, repository } = await fixture(onTestFinished);
  expect(await discoverTasks(repository)).toEqual([]);
  await publishTask(record('task-one'), repository);
  expect(await discoverTasks(repository)).toMatchObject([{ branch: 'feature', record: { id: 'task-one' } }]);
  const other = join(directory, 'other');
  execFileSync('git', ['init', '-q', other]);
  expect(await discoverTasks(other)).toEqual([]);
  expect(await discoverTasks(repository, 'absent')).toEqual([]);
});

test('explicit attachment selectors reject missing and ambiguous branch matches', async ({ onTestFinished }) => {
  const { repository } = await fixture(onTestFinished);
  await publishTask(record('task-one'), repository, 'review');
  expect((await selectTask(repository, { task_id: 'task-one' })).record.id).toBe('task-one');
  expect((await selectTask(repository, { branch: 'review' })).record.id).toBe('task-one');
  await publishTask(record('task-two'), repository, 'review');
  await expect(selectTask(repository, { branch: 'review' })).rejects.toThrow('exactly one');
  await expect(selectTask(repository, {})).rejects.toThrow('exactly one selector');
  await expect(selectTask(repository, { task_id: 'task-one', branch: 'review' })).rejects.toThrow('exactly one selector');
  await expect(selectTask(repository, { task_id: 'absent' })).rejects.toThrow('exactly one');
});

test('resume replaces only its launch receipt and invalid records fail closed', async ({ onTestFinished }) => {
  const { repository } = await fixture(onTestFinished);
  const initial = record('task-one');
  const path = await publishTask(initial, repository);
  await publishTask({ ...initial, sessionFile: '/guest/same-session', detached: { ...initial.detached!, invocation: 'next' } }, repository);
  expect((await selectTask(repository, { task_id: initial.id })).record.detached?.invocation).toBe('next');
  expect(JSON.parse(await readFile(path, 'utf8')).record.sessionFile).toBe('/guest/same-session');
  await expect(publishTask({ ...initial, id: '../escape' }, repository)).rejects.toThrow('Invalid');
});
