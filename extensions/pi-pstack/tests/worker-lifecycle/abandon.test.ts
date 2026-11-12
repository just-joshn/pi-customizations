// A parent that crashed between taking claim/ and starting tmux leaves a claim no host will ever hold.
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
