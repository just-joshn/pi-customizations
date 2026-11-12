// A skill outside poteto-mode names a run id and spawns, as Cursor's skills call Task: the run is created for the caller.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { FAKE_PI, killTmuxServer, makeParent, makeProject, makeRun, type Parent, type Project, stopProject, writeAssignment } from './harness.ts';

let project: Project;
let parent: Parent;

beforeEach(async () => {
  project = makeProject();
  parent = makeParent(project, [], { piCommand: [process.execPath, FAKE_PI], extraPiArgs: [] });
  await parent.start();
});

afterEach(async () => {
  await parent.stop();
  await stopProject(project);
});

afterAll(killTmuxServer);

const runJson = (runId: string) => JSON.parse(readFileSync(join(project.runRoot(runId), 'run.json'), 'utf8'));
const spawn = (runId: string, workerId: string, brief = '@@say DONE', extra: Record<string, unknown> = {}) => parent.call('pstack_worker', { action: 'spawn', runId, assignmentPath: writeAssignment(project, runId, workerId, brief), ...extra });

test('spawning into a run id nobody created makes the run for the calling session', async () => {
  const result = await spawn('how-1', 'explainer', 'Explain the retry logic.\n\nMore detail.');
  expect(result.details.workerId).toBe('explainer');
  expect(runJson('how-1')).toMatchObject({ schemaVersion: 1, runId: 'how-1', title: 'Explain the retry logic.', playbook: null, parentSessionFile: project.sessionFile, inputCommit: project.commit });
  expect((await parent.call('pstack_worker', { action: 'inspect', runId: 'how-1', workerId: 'explainer' })).details.available).toBe(true);
});

test('the playbook argument names the skill that started the run', async () => {
  await spawn('why-1', 'w1', '@@say DONE', { playbook: 'why' });
  expect(runJson('why-1').playbook).toBe('why');
});

test('concurrent first spawns of one run id converge on a single run', async () => {
  await Promise.all([spawn('arena-1', 'a'), spawn('arena-1', 'b'), spawn('arena-1', 'c')]);
  expect(runJson('arena-1').parentSessionFile).toBe(project.sessionFile);
  expect(readdirSync(project.runRoot('arena-1')).filter((name) => name.startsWith('run.json'))).toEqual(['run.json']);
  expect(readdirSync(join(project.runRoot('arena-1'), 'workers')).sort()).toEqual(['a', 'b', 'c']);
});

test('a second spawn into the run keeps the run the first one made', async () => {
  await spawn('swarm-1', 'a', '@@say DONE', { playbook: 'swarm' });
  const before = readFileSync(join(project.runRoot('swarm-1'), 'run.json'), 'utf8');
  await spawn('swarm-1', 'b', 'Different title');
  expect(readFileSync(join(project.runRoot('swarm-1'), 'run.json'), 'utf8')).toBe(before);
});

test('a run another session owns stays refused', async () => {
  makeRun(project, 'theirs', '/elsewhere.jsonl');
  await expect(spawn('theirs', 'w1')).rejects.toThrow(/belongs to session \/elsewhere\.jsonl/);
  expect(runJson('theirs').parentSessionFile).toBe('/elsewhere.jsonl');
});

test('an automation run with no parent session stays refused', async () => {
  makeRun(project, 'auto', null);
  await expect(spawn('auto', 'w1')).rejects.toThrow(/belongs to session \(none\)/);
});

test('an invalid run id creates nothing', async () => {
  await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'Bad_Id', assignmentPath: '/x' })).rejects.toThrow(/Invalid runId/);
});

test('inspect of a run nobody created still reports the missing run', async () => {
  await expect(parent.call('pstack_worker', { action: 'inspect', runId: 'nope', workerId: 'w' })).rejects.toThrow(/has no run\.json/);
});
