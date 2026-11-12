// A worker's depth in the spawn tree travels in its launch environment, and spawn refuses past three levels.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { loadAssignment, type RunId } from '../../src/run-files.ts';
import { spawnAssignment } from '../../src/workers.ts';
import { FAKE_PI, makeParent, makeProject, makeRun, type Parent, type Project, stopProject, TMUX, until, workerDir, workerTestEnv, writeAssignment } from './harness.ts';

const coordinator = { mcp: 'inherit', env: 'inherit', externalWrite: false, spawn: true };
const NAMES = 'PSTACK_DEPTH PSTACK_SPAWN PSTACK_TMUX_SOCKET';
let project: Project;
let parent: Parent;

beforeEach(() => {
  project = makeProject();
  makeRun(project, 'run1');
  parent = makeParent(project, [], { piCommand: [process.execPath, FAKE_PI], extraEnv: {} });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await parent.stop();
  await stopProject(project);
});

const envOf = async (workerId: string) => {
  const collected = await until(
    async () => (await parent.call('pstack_worker', { action: 'collect', runId: 'run1', workerId })).details,
    (details) => details.settled === true,
    15_000,
    `${workerId} settles`,
  );
  return JSON.parse(collected.finalText);
};

const spawn = (workerId: string, fields: Record<string, unknown> = {}) =>
  spawnAssignment(project.dir, 'run1' as RunId, writeAssignment(project, 'run1', workerId, `@@env-json ${NAMES}`, fields), { tmuxSocket: TMUX, piCommand: [process.execPath, FAKE_PI], extraEnv: workerTestEnv(project), agentsDir: project.agentsDir });

test('a sub-coordinator spawned by the root runs at depth 2 with spawning enabled on the same tmux server', async () => {
  await parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', 'sub', `@@env-json ${NAMES}`, { workspace: { mode: 'worktree', inputCommit: project.commit }, capabilities: coordinator }) });
  expect(await envOf('sub')).toEqual({ PSTACK_DEPTH: '2', PSTACK_SPAWN: '1', PSTACK_TMUX_SOCKET: TMUX });
});

test("a sub-coordinator's worker runs at depth 3 without the spawning flag it would otherwise inherit", async () => {
  vi.stubEnv('PSTACK_DEPTH', '2');
  vi.stubEnv('PSTACK_SPAWN', '1');
  await spawn('leaf');
  expect(await envOf('leaf')).toMatchObject({ PSTACK_DEPTH: '3', PSTACK_SPAWN: null });
});

test('at depth 2 spawn refuses a worker that could spawn, before claiming it', async () => {
  vi.stubEnv('PSTACK_DEPTH', '2');
  await expect(spawn('c3', { workspace: { mode: 'worktree', inputCommit: project.commit }, capabilities: coordinator })).rejects.toThrow(/depth/);
  expect(existsSync(join(workerDir(project, 'run1', 'c3'), 'claim'))).toBe(false);
});

test.for(['3', '4', 'x'])('with PSTACK_DEPTH=%s spawn refuses every worker, before claiming it', async (depth) => {
  vi.stubEnv('PSTACK_DEPTH', depth);
  await expect(spawn('w4')).rejects.toThrow(/PSTACK_DEPTH|depth/);
  expect(existsSync(join(workerDir(project, 'run1', 'w4'), 'claim'))).toBe(false);
});

test('a readonly worker cannot be a sub-coordinator: it could not write its workers’ assignments', () => {
  expect(() => loadAssignment(writeAssignment(project, 'run1', 'ro', 'x', { capabilities: coordinator }))).toThrow(/spawn.*worktree/);
});
