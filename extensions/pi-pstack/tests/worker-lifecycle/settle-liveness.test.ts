// Every way a prompt can end on real Pi leaves collect a result.
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { FIXTURE, killTmuxServer, makeParent, makeProject, makeRun, type Parent, type Project, stopProject, until, wakes, writeAssignment } from './harness.ts';

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
const settledResult = (workerId: string, ms = 20_000) =>
  until(
    () => collect(workerId),
    (result) => result.settled === true,
    ms,
    `${workerId} settles`,
  );

test('a brief that an extension command handles settles as handled and wakes the parent', async () => {
  await spawn('h1', '/pstack-noop');
  expect((await settledResult('h1')).lastSettle).toMatchObject({ phase: 'handled', generation: 1 });
  await until(
    () => wakes(parent).map((wake) => wake?.phase),
    (phases) => phases.includes('handled'),
    5_000,
    'handled wake',
  );
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
