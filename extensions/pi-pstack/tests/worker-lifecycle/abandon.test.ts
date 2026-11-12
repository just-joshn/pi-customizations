// A parent that crashed between taking claim/ and starting tmux leaves a claim no host will ever hold.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { killTmuxServer, makeParent, makeProject, makeRun, type Parent, type Project, stopProject, workerDir, writeAssignment } from './harness.ts';

let project: Project;
let parent: Parent;

beforeEach(async () => {
  project = makeProject();
  makeRun(project, 'run1');
  parent = makeParent(project, [], { startCheckMs: 1_000 });
  await parent.start();
});

afterEach(async () => {
  await parent.stop();
  await stopProject(project);
});

afterAll(killTmuxServer);

test('abort of a claim whose host never started marks it abandoned, removes launch-env.json, and keeps the claim', async () => {
  const assignmentPath = writeAssignment(project, 'run1', 'w1', '@@say NEVER');
  const claim = join(workerDir(project, 'run1', 'w1'), 'claim');
  mkdirSync(claim, { mode: 0o700 });
  writeFileSync(join(claim, 'launch-env.json'), '{"SECRET":"left-behind"}', { mode: 0o600 });

  const receipt = await parent.call('pstack_worker', { action: 'abort', runId: 'run1', workerId: 'w1' });
  expect(receipt.details.disposition).toBe('abandoned');
  expect(existsSync(join(claim, 'launch-env.json'))).toBe(false);
  expect(existsSync(claim)).toBe(true);
  const events = readFileSync(join(project.runRoot('run1'), 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(events.filter((event) => event.workerId === 'w1').map((event) => event.kind)).toEqual(['abandoned', 'abort']);
  await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath })).rejects.toThrow(/already claimed/);
});

/** The claim a host leaves when it dies after writing identity.json and before taking launch-env.json. */
function claimedByHost(workerId: string, hostPid: number): string {
  const claim = join(workerDir(project, 'run1', workerId), 'claim');
  mkdirSync(claim, { mode: 0o700 });
  writeFileSync(join(claim, 'launch-env.json'), '{"SECRET":"left-behind"}', { mode: 0o600 });
  writeFileSync(join(claim, 'tmux.json'), JSON.stringify({ serverPid: '1', serverStarted: '1', sessionId: '$999', created: '1' }), { mode: 0o600 });
  writeFileSync(join(claim, 'identity.json'), JSON.stringify({ digest: 'd', instance: 'i', hostPid }), { mode: 0o600 });
  return claim;
}

test.for(['has exited', 'now names another process'] as const)('abort of a host that claimed the worker and died before reading launch-env.json removes the file and keeps the claim (its pid %s)', async (pidState) => {
  writeAssignment(project, 'run1', 'w2', '@@say NEVER');
  const other = pidState === 'has exited' ? undefined : spawn('sleep', ['30'], { stdio: 'ignore' });
  try {
    const claim = claimedByHost('w2', other?.pid ?? (spawnSync('true').pid as number));
    const receipt = await parent.call('pstack_worker', { action: 'abort', runId: 'run1', workerId: 'w2' });
    expect(receipt.details.disposition).toBe('refused');
    expect(existsSync(join(claim, 'launch-env.json'))).toBe(false);
    expect(existsSync(join(claim, 'identity.json'))).toBe(true);
  } finally {
    other?.kill('SIGKILL');
  }
});

test('abort leaves launch-env.json while the process that claimed the worker is still its host', async () => {
  const assignmentPath = writeAssignment(project, 'run1', 'w3', '@@say NEVER');
  const host = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', assignmentPath], { stdio: 'ignore' });
  try {
    const claim = claimedByHost('w3', host.pid as number);
    const receipt = await parent.call('pstack_worker', { action: 'abort', runId: 'run1', workerId: 'w3' });
    expect(receipt.details.disposition).toBe('refused');
    expect(existsSync(join(claim, 'launch-env.json'))).toBe(true);
  } finally {
    host.kill('SIGKILL');
  }
});
