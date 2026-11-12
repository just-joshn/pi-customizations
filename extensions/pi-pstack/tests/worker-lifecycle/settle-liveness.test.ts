// Every way a prompt can end on real Pi leaves collect a result.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { FIXTURE, killTmuxServer, makeParent, makeProject, makeRun, type Parent, type Project, stopProject, tmux, transcript, until, wakes, workerDir, writeAssignment } from './harness.ts';

const NOOP = join(PACKAGE_ROOT, 'tests/worker-lifecycle/noop-command.ts');
let project: Project;
let parent: Parent;

beforeEach(async () => {
  project = makeProject();
  makeRun(project, 'run1');
  parent = makeParent(project, [], {
    extraPiArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-mcp', '--no-approve', '--extension', FIXTURE, '--extension', NOOP],
  });
  await parent.start();
});

afterEach(async () => {
  await parent.stop();
  await stopProject(project);
});

afterAll(killTmuxServer);

const spawn = (workerId: string, brief: string) => parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', workerId, brief) });
const steer = (workerId: string, message: string) => parent.call('pstack_worker', { action: 'steer', runId: 'run1', workerId, message });
const collect = async (workerId: string) => (await parent.call('pstack_worker', { action: 'collect', runId: 'run1', workerId })).details;
const settings = (value: unknown) => writeFileSync(join(project.agentDir, 'settings.json'), JSON.stringify(value));
const settledResult = (workerId: string, ms = 20_000) =>
  until(
    () => collect(workerId),
    (result) => result.settled === true,
    ms,
    `${workerId} settles`,
  );

test('a brief that an extension command handles settles as handled and wakes the parent', async () => {
  await spawn('h1', '/pstack-noop');
  // Settling is watched with inspect: a collect that found it settled would mark the settle collected, and a collected settle sends no wake.
  await until(
    async () => (await parent.call('pstack_worker', { action: 'inspect', runId: 'run1', workerId: 'h1' })).details.state?.settles ?? [],
    (settles) => settles.length === 1,
    20_000,
    'h1 settles',
  );
  await until(
    () => wakes(parent).map((wake) => wake?.phase),
    (phases) => phases.includes('handled'),
    5_000,
    'handled wake',
  );
  expect((await collect('h1')).lastSettle).toMatchObject({ phase: 'handled', generation: 1 });
});

test('a steer that an extension command handles on an idle worker settles that steer', async () => {
  await spawn('h2', '@@say FIRST');
  await settledResult('h2');
  await steer('h2', '/pstack-noop');
  const result = await until(
    () => collect('h2'),
    (current) => current.settled === true && current.lastSettle.generation === 2,
    20_000,
    'the handled steer settles',
  );
  expect(result.lastSettle.phase).toBe('handled');
});

test('a cancel during a run with a queued steer settles as aborted and drops the steer', async () => {
  await spawn('c1', '@@sleep 3000 SLOW');
  const { tmuxSession } = await until(
    async () => (await parent.call('pstack_worker', { action: 'inspect', runId: 'run1', workerId: 'c1' })).details.state,
    (state) => state.phase === 'running',
    10_000,
    'running',
  );
  await steer('c1', '@@say QUEUED');
  await tmux('send-keys', '-t', tmuxSession, 'cancel', 'Enter');
  expect((await settledResult('c1')).lastSettle).toMatchObject({ phase: 'aborted', generation: 2 });
  expect(transcript(project, 'run1', 'c1')).not.toContain('assistant:QUEUED');
});

test('an error stop after auto-retry settles as failed', async () => {
  settings({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 50 } });
  await spawn('e1', '@@fail overloaded');
  expect((await settledResult('e1')).lastSettle).toMatchObject({ phase: 'failed', reason: expect.stringContaining('overloaded'), generation: 1 });
  expect(readFileSync(join(workerDir(project, 'run1', 'e1'), 'state.json'), 'utf8')).toContain('"phase": "idle"');
});

test('a turn that compacts before it runs settles with its reply', async () => {
  settings({ compaction: { enabled: true, reserveTokens: 127_990, keepRecentTokens: 1 } });
  await spawn('k1', '@@say ONE');
  await settledResult('k1');
  await steer('k1', '@@say TWO');
  const result = await until(
    () => collect('k1'),
    (current) => current.settled === true && current.lastSettle.generation === 2,
    20_000,
    'the compacting turn settles',
  );
  expect(result.finalText).toBe('TWO');
  const sessionDir = join(workerDir(project, 'run1', 'k1'), 'session');
  const session = readdirSync(sessionDir).find((file) => file.endsWith('.jsonl')) as string;
  expect(readFileSync(join(sessionDir, session), 'utf8')).toContain('"type":"compaction"');
});
