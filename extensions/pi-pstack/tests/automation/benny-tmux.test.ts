// A real tmux worker running real Pi with the scripted model: the serve process's completion path end to end, with a
// fake Slack and a fake gh at the two external edges.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, expect, test } from 'vitest';
import { type Automation } from '../../adapters/automation-events.ts';
import { abortInTmux } from '../../src/automation/abort.ts';
import { spawnInTmux, workerDir } from '../../src/automation/dispatch.ts';
import { steerRun } from '../../src/automation/steer.ts';
import type { RunId } from '../../src/automation/model.ts';
import { outboxEntries, readLog } from '../../src/automation/store.ts';
import { loadBennyConfig } from '../../src/automation/configuration.ts';
import { completeSettledRuns } from '../../src/automation/settle.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import { readHostState } from '../../src/run-files.ts';
import { killTmuxServer, makeProject, type Project, PI, stopProject, TEST_PI_ARGS, TMUX, until, workerTestEnv } from '../worker-lifecycle/harness.ts';
import { bennyProject, fakeGh, fakeSlack, OPS_CHANNEL, REPORT, ROOT_TS, TRIAGE_USER, wiringDeps } from './benny-fakes.ts';

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
  expect(slack.posts).toEqual([{ thread_ts: ROOT_TS, text: `${verdict} tracker=https://github.com/acme/app/issues/1` }]);
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

/**
 * A repro case on a real worker. The scripted model answers the directive line of the last message it was sent, and the
 * parent's own turn prompts carry none, so `reply` maps each prompt the parent sends to the directive that stands for the
 * model's answer. The message still goes through the real host, which takes it as the idle worker's next prompt.
 */
async function reproCase(reply: (prompt: string) => string, report: string, followUp?: string) {
  project = makeProject('pstack-benny-repro-');
  const current = project;
  const benny = bennyProject({ root: current.dir, operationsChannel: OPS_CHANNEL });
  const slack = fakeSlack();
  slack.messages.push({ ts: '1762900001.999999', user: TRIAGE_USER, text: 'A bug.\n[benny:bug]' });
  const prompts: string[] = [];
  let clock = Date.parse('2026-11-12T08:00:00Z');
  const spawn = spawnInTmux(current.dir, { tmuxSocket: TMUX, piCommand: [PI], extraPiArgs: TEST_PI_ARGS, extraEnv: workerTestEnv(current), agentsDir: current.agentsDir, resolveModel: () => ({ provider: 'scripted', id: 'echo', thinkingLevel: null }) });
  const automation: Automation = wireBenny(
    benny.config('reproduce'),
    wiringDeps(slack, fakeGh(), {
      inputCommit: () => current.commit,
      now: () => new Date(clock),
      spawnWorker: async (runId, assignmentPath) => {
        writeFileSync(join(assignmentPath, '..', 'brief.md'), `@@say ${runId.startsWith('fu-') && followUp !== undefined ? followUp : report}`);
        await spawn(runId, assignmentPath);
      },
      steer: async (root, runId, text) => {
        prompts.push(text);
        await steerRun(root, runId, reply(text));
      },
      abort: abortInTmux({ tmuxSocket: TMUX }),
    }),
  );
  const run = await automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
  await until(async () => (await completeSettledRuns(automation)) > 0 || automation.pendingRuns().length === 0, Boolean, 60_000, 'the first report to settle and the case to complete');
  return { automation, slack, run, prompts, dir: workerDir(current.dir, run.runId), later: (minutes: number) => void (clock += minutes * 60_000) };
}

const opsStatus = (slack: ReturnType<typeof fakeSlack>) => slack.ops.find((message) => message.thread_ts === undefined)?.text.split('\n')[0];
const REPORTED = JSON.stringify({ text: 'Reproduced twice.', status: 'Reproduced', operations: 'Evidence attached.' });

test('a real repro worker is held through the rejection window and then takes the fix phase as its next turn', async () => {
  const r = await reproCase(() => `@@say ${JSON.stringify({ status: 'Draft pull request opened', operations: 'Draft pull request: https://github.com/acme/app/pull/9' })}`, REPORTED);
  expect(r.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: 'Reproduced twice.' }]);
  expect(opsStatus(r.slack)).toBe('✅ Reproduced');
  const generationBefore = readHostState(r.dir)?.generation;

  await r.automation.advanceRepro();
  expect(r.prompts).toEqual([]);
  r.later(11);
  await until(async () => (await r.automation.advanceRepro(), opsStatus(r.slack)), (status) => status === '🔗 Draft pull request opened', 60_000, 'the fix turn to settle and its status to show');

  expect(r.prompts).toHaveLength(1);
  expect(r.prompts[0]).toContain('Start the fix phase now');
  expect(readHostState(r.dir)?.generation).toBe((generationBefore ?? 0) + 1);
  expect(r.slack.ops.filter((message) => message.thread_ts !== undefined).map((message) => message.text)).toEqual(['Evidence attached.', 'Draft pull request: https://github.com/acme/app/pull/9']);
  expect(readLog(r.automation.store)).toContainEqual(expect.objectContaining({ kind: 'repro-closed', reason: 'the fix phase finished' }));
  const session = readFileSync(join(r.dir, 'session', readdirSync(join(r.dir, 'session'))[0] as string), 'utf8');
  expect(session.match(/"role":"user"/g)).toHaveLength(2);
});

test('a real repro worker told a person claimed the fix decides to stop, is aborted through its host, and never gets the fix phase', async () => {
  const r = await reproCase(() => `@@say ${JSON.stringify({ decision: 'stop', corrected: false, operations: 'A person claimed the fix.' })}`, REPORTED);
  r.slack.messages.push({ ts: '1762900050.000000', user: 'U2', text: 'I am already fixing this.' });
  await until(async () => (await r.automation.advanceRepro(), readLog(r.automation.store).some((entry) => entry.kind === 'repro-closed')), Boolean, 60_000, 'the review turn to settle and the case to close');
  expect(r.prompts).toHaveLength(1);
  expect(r.prompts[0]).toContain('I am already fixing this.');
  expect(r.slack.ops.filter((message) => message.thread_ts !== undefined).map((message) => message.text)).toContain('A person claimed the fix.');
  await until(() => readHostState(r.dir)?.phase, (phase) => phase === 'stopped' || phase === 'exited', 30_000, 'the host to stop');
  r.later(30);
  await r.automation.advanceRepro();
  expect(r.prompts).toHaveLength(1);
  expect(opsStatus(r.slack)).toBe('✅ Reproduced');
}, 150_000);

test('a real follow-up worker answers a question in the operations thread and asks for the one rerun, which the real repro worker takes as its next turn', async () => {
  const follow = JSON.stringify({ text: 'Rerunning with the admin account.', rerun: { correction: 'Log in as admin and try again.' } });
  const rerun = JSON.stringify({ status: 'Reproduced', text: 'Reproduced with the admin account.', operations: 'With admin the export fails.' });
  const r = await reproCase(() => `@@say ${rerun}`, JSON.stringify({ text: '', status: 'Could not reproduce', operations: 'Tried twice.' }), follow);
  const rootTs = r.slack.ops.find((message) => message.thread_ts === undefined)?.ts ?? '';
  r.slack.ops.push({ ts: '1762900200.000000', user: 'U2', text: 'Wrong account, retry as admin.', thread_ts: rootTs });

  await until(async () => (await r.automation.advanceFollowUps(), r.prompts.length), (count) => count === 1, 60_000, 'the follow-up worker to settle and the rerun to be sent');
  expect(r.prompts[0]).toContain('rerun the repro once');
  expect(r.prompts[0]).toContain('Log in as admin and try again.');
  await until(async () => (await r.automation.advanceRepro(), opsStatus(r.slack)), (status) => status === '✅ Reproduced', 60_000, 'the rerun turn to settle and its status to show');

  const replies = r.slack.ops.filter((message) => message.thread_ts !== undefined && message.user === TRIAGE_USER).map((message) => message.text);
  expect(replies).toEqual(['Tried twice.', 'Rerunning with the admin account.', 'With admin the export fails.']);
  expect(r.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: 'Reproduced with the admin account.' }]);
  expect(r.prompts).toHaveLength(1);
}, 180_000);

test('a real triage worker idles after its verdict and is shut down through its host once the follow-up window ends, once across a restart', async () => {
  project = makeProject('pstack-benny-retire-');
  const current = project;
  const benny = bennyProject({ root: current.dir });
  const slack = fakeSlack();
  const gh = fakeGh();
  let clock = Date.now();
  const spawn = spawnInTmux(current.dir, { tmuxSocket: TMUX, piCommand: [PI], extraPiArgs: TEST_PI_ARGS, extraEnv: workerTestEnv(current), agentsDir: current.agentsDir, resolveModel: () => ({ provider: 'scripted', id: 'echo', thinkingLevel: null }) });
  const build = (): Automation =>
    wireBenny(benny.config('triage'), wiringDeps(slack, gh, {
      now: () => new Date(clock),
      abort: abortInTmux({ tmuxSocket: TMUX }),
      spawnWorker: async (runId, assignmentPath) => {
        writeFileSync(join(assignmentPath, '..', 'brief.md'), `@@say ${JSON.stringify({ text: 'A bug.\n[benny:bug]' })}`);
        await spawn(runId, assignmentPath);
      },
    }));
  const automation = build();
  const run = await automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
  await until(async () => (await completeSettledRuns(automation)) > 0 || automation.pendingRuns().length === 0, Boolean, 45_000, 'the worker to settle and the case to complete');
  const dir = workerDir(current.dir, run.runId);
  expect(readHostState(dir)?.phase).toBe('idle');

  await automation.retireWorkers();
  expect(readHostState(dir)?.phase).toBe('idle');
  clock += 11 * 60_000;
  await automation.retireWorkers();
  await until(() => readHostState(dir)?.phase, (phase) => phase === 'stopped' || phase === 'exited', 30_000, 'the retired host to stop');

  const restarted = build();
  await restarted.reconcile();
  await restarted.retireWorkers();
  expect(readLog(automation.store).filter((entry) => entry.kind === 'worker-retired')).toEqual([expect.objectContaining({ runId: run.runId, ok: true })]);
}, 120_000);
