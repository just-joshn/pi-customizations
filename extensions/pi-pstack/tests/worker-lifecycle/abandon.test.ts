// A parent that crashed between taking claim/ and starting tmux leaves a claim no host will ever hold. The project
// path has spaces and non-ASCII characters, as a user's checkout may.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { processStartTime, readClaim } from '../../src/run-files.ts';
import { killTmuxServer, makeParent, makeProject, makeRun, type Parent, type Project, stopProject, workerDir, writeAssignment } from './harness.ts';

let project: Project;
let parent: Parent;

beforeEach(async () => {
  project = makeProject('pstack u04a ünïcødé 名前-');
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
function claimedByHost(workerId: string, hostPid: number, hostStarted: string): string {
  const claim = join(workerDir(project, 'run1', workerId), 'claim');
  mkdirSync(claim, { mode: 0o700 });
  writeFileSync(join(claim, 'launch-env.json'), '{"SECRET":"left-behind"}', { mode: 0o600 });
  writeFileSync(join(claim, 'tmux.json'), JSON.stringify({ serverPid: '1', serverStarted: '1', sessionId: '$999', created: '1' }), { mode: 0o600 });
  writeFileSync(join(claim, 'identity.json'), JSON.stringify({ digest: 'd', instance: 'i', hostPid, hostStarted }), { mode: 0o600 });
  return claim;
}

/** A process whose command line names the assignment, as the host's does. */
const hostLike = (assignmentPath: string) => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', assignmentPath], { stdio: 'ignore' });

/** When pid 1 started: a real start time no process started after boot has. */
const BOOT = processStartTime(1) as string;

test.for(['has exited', 'now names a process with another start time, whose command line names the assignment'] as const)(
  'abort of a host that claimed the worker and died before reading launch-env.json removes the file and keeps the claim (its pid %s)',
  async (pidState) => {
    const assignmentPath = writeAssignment(project, 'run1', 'w2', '@@say NEVER');
    const other = pidState === 'has exited' ? undefined : hostLike(assignmentPath);
    try {
      const claim = claimedByHost('w2', other?.pid ?? (spawnSync('true').pid as number), BOOT);
      const receipt = await parent.call('pstack_worker', { action: 'abort', runId: 'run1', workerId: 'w2' });
      expect(receipt.details.disposition).toBe('refused');
      expect(existsSync(join(claim, 'launch-env.json'))).toBe(false);
      expect(existsSync(join(claim, 'identity.json'))).toBe(true);
    } finally {
      other?.kill('SIGKILL');
    }
  },
);

test('abort leaves launch-env.json while the process that claimed the worker is still its host', async () => {
  const assignmentPath = writeAssignment(project, 'run1', 'w3', '@@say NEVER');
  const host = hostLike(assignmentPath);
  try {
    const claim = claimedByHost('w3', host.pid as number, processStartTime(host.pid as number) as string);
    const receipt = await parent.call('pstack_worker', { action: 'abort', runId: 'run1', workerId: 'w3' });
    expect(receipt.details.disposition).toBe('refused');
    expect(existsSync(join(claim, 'launch-env.json'))).toBe(true);
  } finally {
    host.kill('SIGKILL');
  }
});

test('the host records its pid and process start time in claim/identity.json', async () => {
  await parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', 'w4', '@@say UP') });
  const { hostPid } = (await parent.call('pstack_worker', { action: 'inspect', runId: 'run1', workerId: 'w4' })).details.state;
  const started = processStartTime(hostPid);
  expect(started).toEqual(expect.any(String));
  expect(readClaim(workerDir(project, 'run1', 'w4'))).toMatchObject({ hostPid, hostStarted: started });
});
