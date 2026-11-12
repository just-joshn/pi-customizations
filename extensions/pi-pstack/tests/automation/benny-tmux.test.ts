// A real tmux worker running real Pi with the scripted model: the serve process's completion path end to end, with a
// fake Slack and a fake gh at the two external edges.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, expect, test } from 'vitest';
import { type Automation } from '../../adapters/automation-events.ts';
import { spawnInTmux, workerDir } from '../../src/automation/dispatch.ts';
import type { RunId } from '../../src/automation/model.ts';
import { outboxEntries } from '../../src/automation/store.ts';
import { loadBennyConfig } from '../../src/automation/configuration.ts';
import { completeSettledRuns } from '../../src/automation/settle.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import { readHostState } from '../../src/run-files.ts';
import { killTmuxServer, makeProject, type Project, PI, stopProject, TEST_PI_ARGS, TMUX, until, workerTestEnv } from '../worker-lifecycle/harness.ts';
import { bennyProject, fakeGh, fakeSlack, REPORT, ROOT_TS, wiringDeps } from './benny-fakes.ts';

let project: Project | undefined;
afterEach(async () => {
  if (project !== undefined) await stopProject(project);
  project = undefined;
});
afterAll(killTmuxServer);

test('a real worker settles, its result completes the case, and the issue and the reply land once', async () => {
  project = makeProject('pstack-benny-');
  const benny = bennyProject({ root: project.dir });
  const slack = fakeSlack();
  const gh = fakeGh();
  const verdict = 'Reproducible export failure.\n[benny:bug]';
  const result = JSON.stringify({ text: verdict, tracker: { operation: 'create', title: 'Export fails on Safari', body: 'Expected a download.' } });
  const current = project;
  const spawn = spawnInTmux(current.dir, { tmuxSocket: TMUX, piCommand: [PI], extraPiArgs: TEST_PI_ARGS, extraEnv: workerTestEnv(current), agentsDir: current.agentsDir, resolveModel: () => ({ provider: 'scripted', id: 'echo', thinkingLevel: null }) });
  const automation: Automation = wireBenny(benny.config('triage'), wiringDeps(slack, gh, {
    // The scripted model replies with the directive in the brief, so the worker's final message is the result above.
    spawnWorker: async (runId, assignmentPath) => {
      writeFileSync(join(assignmentPath, '..', 'brief.md'), `@@say ${result}`);
      await spawn(runId, assignmentPath);
    },
  }));

  const run = await automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
  await until(
    async () => (await completeSettledRuns(automation)) > 0 || automation.pendingRuns().length === 0,
    Boolean,
    45_000,
    'the worker to settle and the case to complete',
  );

  expect(gh.issues.map((issue) => issue.title)).toEqual(['Export fails on Safari']);
  expect(slack.posts).toEqual([{ thread_ts: ROOT_TS, text: verdict }]);
  expect(automation.pendingRuns()).toEqual([]);
  const restarted = wireBenny(loadBennyConfig(current.dir, 'triage'), wiringDeps(slack, gh));
  await restarted.reconcile();
  expect(await completeSettledRuns(restarted)).toBe(0);
  expect(slack.posts).toHaveLength(1);
  expect(gh.issues).toHaveLength(1);
});

test('a tracker that is not GitHub is written by a real worker that reads the project adapter skill, and the reply lands after it', async () => {
  project = makeProject('pstack-benny-linear-');
  const benny = bennyProject({ root: project.dir, adapterSkill: 'linear-adapter' });
  const slack = fakeSlack();
  const gh = fakeGh();
  const verdict = 'Reproducible export failure.\n[benny:bug]';
  const caseResult = JSON.stringify({ text: verdict, tracker: { operation: 'create', title: 'Export fails on Safari', body: 'Expected a download.' } });
  const skillPath = join(project.dir, '.pi/skills/linear-adapter/SKILL.md');
  const trackerScript = JSON.stringify([{ tool: 'read', args: { path: skillPath } }, { text: '{"outcome":"created","id":"LIN-42"}' }]);
  const current = project;
  const spawn = spawnInTmux(current.dir, { tmuxSocket: TMUX, piCommand: [PI], extraPiArgs: TEST_PI_ARGS, extraEnv: workerTestEnv(current), agentsDir: current.agentsDir, resolveModel: () => ({ provider: 'scripted', id: 'echo', thinkingLevel: null }) });
  const spawned: string[] = [];
  const automation: Automation = wireBenny(
    benny.config('triage'),
    wiringDeps(slack, gh, {
      spawnWorker: async (runId, assignmentPath) => {
        spawned.push(runId);
        writeFileSync(join(assignmentPath, '..', 'brief.md'), runId.startsWith('trk-') ? `@@script ${trackerScript}` : `@@say ${caseResult}`);
        await spawn(runId, assignmentPath);
      },
    }),
  );

  const run = await automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
  await until(async () => (await completeSettledRuns(automation)) > 0 || automation.pendingRuns().length === 0, Boolean, 90_000, 'the case worker and the tracker worker to settle and the case to complete');

  expect(spawned).toHaveLength(2);
  expect(spawned[1]?.startsWith('trk-')).toBe(true);
  expect(outboxEntries(automation.store)).toContainEqual(expect.objectContaining({ state: 'done', destinationTs: 'LIN-42' }));
  expect(slack.posts).toEqual([{ thread_ts: ROOT_TS, text: verdict }]);
  expect(gh.calls).toHaveLength(0);
  const session = readFileSync(join(workerDir(current.dir, spawned[1] as RunId), 'session', readdirSync(join(workerDir(current.dir, spawned[1] as RunId), 'session'))[0] as string), 'utf8');
  expect(session).toContain('"name":"read"');
  expect(session).toContain('Use the Linear MCP tools');
});

test('a real worker still running when triage_total_minutes passes is aborted through the host, and the failure reply posts', async () => {
  project = makeProject('pstack-benny-deadline-');
  const benny = bennyProject({ root: project.dir });
  const slack = fakeSlack();
  const gh = fakeGh();
  const current = project;
  const spawn = spawnInTmux(current.dir, { tmuxSocket: TMUX, piCommand: [PI], extraPiArgs: TEST_PI_ARGS, extraEnv: workerTestEnv(current), agentsDir: current.agentsDir, resolveModel: () => ({ provider: 'scripted', id: 'echo', thinkingLevel: null }) });
  const config = { ...benny.config('triage'), budgets: { totalMinutes: 0.05, followUpMinutes: 10 } };
  const automation: Automation = wireBenny(config, wiringDeps(slack, gh, {
    spawnWorker: async (runId, assignmentPath) => {
      writeFileSync(join(assignmentPath, '..', 'brief.md'), '@@sleep 600000 never');
      await spawn(runId, assignmentPath);
    },
  }));

  const run = await automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
  const dir = workerDir(current.dir, run.runId);
  await until(() => readHostState(dir)?.phase, (phase) => phase === 'running', 45_000, 'the worker to start its long turn');
  await until(async () => (await completeSettledRuns(automation)) > 0, Boolean, 45_000, 'the deadline to abort the worker and complete the case');

  expect(slack.posts).toHaveLength(1);
  expect(slack.posts[0]?.text).toMatch(/exceeded its 0\.05-minute budget\. No ticket was created\.\n\[benny:other\]$/);
  expect(gh.issues).toHaveLength(0);
  await until(() => readHostState(dir)?.phase, (phase) => phase === 'stopped' || phase === 'exited', 30_000, 'the host to stop');
  expect(automation.pendingRuns()).toEqual([]);
}, 120_000);
