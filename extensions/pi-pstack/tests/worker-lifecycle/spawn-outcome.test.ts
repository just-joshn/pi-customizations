// What spawn leaves behind when tmux's answer is lost or the steps after it fail.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { type RunId, TMUX_IDENTITY_FORMAT } from '../../src/run-files.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { type Exec, nodeExec, registerWorkerTools, type SpawnOptions, spawnAssignment } from '../../src/workers.ts';
import { FAKE_PI, killTmuxServer, makeProject, makeRun, type Project, stopProject, TMUX, tmux, until, workerDir, workerTestEnv, writeAssignment } from './harness.ts';

let project: Project;

beforeEach(() => {
  project = makeProject();
  makeRun(project, 'run1');
});

afterEach(() => stopProject(project));

afterAll(killTmuxServer);

const options = (exec: Exec): SpawnOptions => ({ exec, tmuxSocket: TMUX, piCommand: [process.execPath, FAKE_PI], extraEnv: workerTestEnv(project), agentsDir: project.agentsDir, startCheckMs: 1_500 });
const spawn = (workerId: string, exec: Exec) => spawnAssignment(project.dir, 'run1' as RunId, writeAssignment(project, 'run1', workerId, '@@say DONE'), options(exec));
const isNewSession = (args: string[]) => args.includes('new-session');
const claim = (workerId: string, file = '') => join(workerDir(project, 'run1', workerId), 'claim', file);

test('a tmux start whose answer is lost after the session started keeps the claim and finishes the spawn', async () => {
  const timedOut: Exec = async (command, args, execOptions) => {
    if (!isNewSession(args)) return nodeExec(command, args, execOptions);
    await nodeExec(command, args, execOptions);
    return { stdout: '', stderr: 'timed out', code: 1, killed: true };
  };
  const result = await spawn('w1', timedOut);
  expect(result.workerId).toBe('w1');
  expect(existsSync(claim('w1', 'identity.json'))).toBe(true);
  const recorded = JSON.parse(readFileSync(claim('w1', 'tmux.json'), 'utf8'));
  const listed = (await tmux('list-sessions', '-F', `#{session_name} ${TMUX_IDENTITY_FORMAT}`)).split('\n').find((line) => line.startsWith(`${result.tmuxSession} `));
  expect(listed).toBe(`${result.tmuxSession} ${recorded.serverPid} ${recorded.serverStarted} ${recorded.sessionId} ${recorded.created}`);
  await until(
    () => JSON.parse(readFileSync(join(workerDir(project, 'run1', 'w1'), 'state.json'), 'utf8')).settles.length,
    (count) => count === 1,
    10_000,
    'the brief settles',
  );
});

test('a tmux start whose answer is lost before tmux ran releases the claim after the bounded wait', async () => {
  const lost: Exec = async (command, args, execOptions) => (isNewSession(args) ? { stdout: '', stderr: 'timed out', code: 1, killed: true } : nodeExec(command, args, execOptions));
  await expect(spawn('w2', lost)).rejects.toThrow(/did not start/);
  expect(existsSync(claim('w2'))).toBe(false);
  await expect(spawnAssignment(project.dir, 'run1' as RunId, join(workerDir(project, 'run1', 'w2'), 'assignment.json'), options(nodeExec))).resolves.toMatchObject({ workerId: 'w2' });
});

test('a tmux session with the worker name but no host claim keeps the claim as unknown', async () => {
  const assignmentPath = writeAssignment(project, 'run1', 'w3', '@@say DONE');
  const squatted: Exec = async (command, args, execOptions) => {
    if (!isNewSession(args)) return nodeExec(command, args, execOptions);
    const session = args[args.indexOf('-s') + 1] as string;
    await tmux('new-session', '-d', '-s', session, '--', 'sleep', '30');
    return { stdout: '', stderr: 'timed out', code: 1, killed: true };
  };
  await expect(spawnAssignment(project.dir, 'run1' as RunId, assignmentPath, options(squatted))).rejects.toThrow(/unknown/);
  expect(existsSync(claim('w3'))).toBe(true);
  expect(existsSync(claim('w3', 'launch-env.json'))).toBe(false);
});

test('a failure after tmux reported the session removes launch-env.json and keeps the claim', async () => {
  const reported: Exec = async (command, args, execOptions) => (isNewSession(args) ? { stdout: '4242 1700000000 $9 1700000001\n', stderr: '', code: 0, killed: false } : nodeExec(command, args, execOptions));
  mkdirSync(join(project.runRoot('run1'), 'events.jsonl'));
  await expect(spawn('w4', reported)).rejects.toThrow(/EISDIR/);
  expect(existsSync(claim('w4', 'tmux.json'))).toBe(true);
  expect(existsSync(claim('w4', 'launch-env.json'))).toBe(false);
});

test('a reported success without a parsable identity, and no host, releases the claim and launch-env.json', async () => {
  const garbled: Exec = async (command, args, execOptions) => (isNewSession(args) ? { stdout: 'garbled\n', stderr: '', code: 0, killed: false } : nodeExec(command, args, execOptions));
  await expect(spawn('w5', garbled)).rejects.toThrow(/did not start/);
  expect(existsSync(claim('w5'))).toBe(false);
});

test("pstack_worker's description says spawn waits up to the start-check window when the launch outcome is unknown", () => {
  const tools: { name: string; description: string }[] = [];
  const pi = { registerTool: (tool: { name: string; description: string }) => tools.push(tool), on: () => undefined };
  registerWorkerTools(pi as unknown as ExtensionAPI, { tmuxSocket: TMUX, startCheckMs: 1_500 });
  const description = tools.find((tool) => tool.name === 'pstack_worker')?.description;
  expect(description).not.toMatch(/returns at once/);
  expect(description).toMatch(/up to 1\.5 s/);
});
