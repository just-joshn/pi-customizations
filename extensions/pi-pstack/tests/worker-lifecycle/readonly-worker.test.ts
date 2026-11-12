// A readonly worker reads the project through bash_readonly, the OS-sandboxed shell, and records evidence; it writes nothing.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { killTmuxServer, makeParent, makeProject, makeRun, type Parent, type Project, stopProject, TEST_PI_ARGS, until, writeAssignment } from './harness.ts';

const WORKER_SIDE = join(PACKAGE_ROOT, 'tests/worker-lifecycle/worker-side-extension.ts');
let project: Project;
let parent: Parent;

beforeEach(async () => {
  project = makeProject();
  makeRun(project, 'run1');
  parent = makeParent(project, [], { extraPiArgs: [...TEST_PI_ARGS, '--extension', WORKER_SIDE] });
  await parent.start();
});

afterEach(async () => {
  await parent.stop();
  await stopProject(project);
});

afterAll(killTmuxServer);

const finalText = (generation: number) =>
  until(
    async () => (await parent.call('pstack_worker', { action: 'collect', runId: 'run1', workerId: 'ro' })).details,
    (result) => result.settled === true && result.lastSettle.generation === generation,
    30_000,
    `generation ${generation} settles`,
  ).then((result) => result.finalText as string);

test.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')('a readonly worker has bash_readonly and pstack_evidence, reads git history with it, and cannot write through it', async () => {
  await parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', 'ro', '@@tools-list') });
  expect((await finalText(1)).split(',').sort()).toEqual(['bash_readonly', 'find', 'grep', 'ls', 'pstack_evidence', 'read']);

  const script = [{ tool: 'bash_readonly', args: { command: 'git log -1 --format=%H' } }, { tool: 'bash_readonly', args: { command: 'touch escaped.txt; echo "touch exit $?"' } }];
  await parent.call('pstack_worker', { action: 'steer', runId: 'run1', workerId: 'ro', message: `@@script ${JSON.stringify(script)}` });
  const results = await finalText(2);
  expect(results).toContain(project.commit);
  expect(results).toMatch(/touch exit [1-9]/);
  expect(existsSync(join(project.dir, 'escaped.txt'))).toBe(false);
});

test('collect hands the parent a readonly worker\'s final reply as its report, not a missing report.md', async () => {
  await parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', 'ro', '@@say FINDINGS: the cart rounds late') });
  const settled = await until(
    async () => parent.call('pstack_worker', { action: 'collect', runId: 'run1', workerId: 'ro' }),
    (result) => result.details.settled === true,
    30_000,
    'readonly worker settles',
  );
  expect(settled.details.report).toContain('FINDINGS: the cart rounds late');
  const shown = settled.text;
  expect(shown).toContain('FINDINGS: the cart rounds late');
  expect(shown).not.toContain('(missing)');
});
