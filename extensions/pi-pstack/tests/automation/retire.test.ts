import { rmSync } from 'node:fs';

import { afterEach, describe, expect, test } from 'vitest';
import type { Automation } from '../../adapters/automation-events.ts';
import type { RunId } from '../../src/automation/model.ts';
import { RETIRE_ATTEMPT_LIMIT } from '../../src/automation/retire.ts';
import { completeSettledRuns } from '../../src/automation/settle.ts';
import { readLog } from '../../src/automation/store.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import { beginTurn, type BennyProject, bennyProject, fakeGh, fakeSlack, OPS_CHANNEL, REPORT, settleWorker, TRIAGE_USER, wiringDeps } from './benny-fakes.ts';

const projects: BennyProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project.dir, { recursive: true, force: true });
});

const TRIAGE_FOLLOW_UP = 10;
const OPS_FOLLOW_UP = 45;
const VERDICT = 'Reproducible export failure.\n[benny:bug]';
const COULD_NOT = JSON.stringify({ text: '', status: 'Could not reproduce', operations: 'Tried twice.' });

function setup(kind: 'triage' | 'reproduce', options: { operationsChannel?: string; abortOutcomes?: string[] } = {}) {
  const project = bennyProject(options.operationsChannel === undefined ? {} : { operationsChannel: options.operationsChannel });
  projects.push(project);
  const slack = fakeSlack();
  if (kind === 'reproduce') slack.messages.push({ ts: '1762900001.999999', user: TRIAGE_USER, text: 'A bug.\n[benny:bug]' });
  const spawns: { runId: RunId; assignmentPath: string }[] = [];
  const aborts: RunId[] = [];
  const steers: RunId[] = [];
  const outcomes = [...(options.abortOutcomes ?? [])];
  let clock = Date.parse('2026-11-12T08:00:00Z');
  const build = (): Automation =>
    wireBenny(
      project.config(kind),
      wiringDeps(slack, fakeGh(), {
        spawnWorker: async (runId, assignmentPath) => void spawns.push({ runId, assignmentPath }),
        now: () => new Date(clock),
        steer: async (_root, runId) => {
          steers.push(runId);
          beginTurn(project.dir, runId);
        },
        abort: async (_root, runId) => {
          aborts.push(runId);
          return outcomes.shift() ?? 'stopped';
        },
      }),
    );
  return { project, slack, spawns, aborts, steers, build, automation: build(), later: (minutes: number) => void (clock += minutes * 60_000) };
}
type Setup = ReturnType<typeof setup>;

async function finished(t: Setup, finalText: string): Promise<RunId> {
  const run = await t.automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
  settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText });
  expect(await completeSettledRuns(t.automation)).toBe(1);
  t.spawns.length = 0;
  return run.runId;
}
const retiredEntries = (t: Setup) => readLog(t.automation.store).filter((entry) => entry.kind === 'worker-retired');

describe('triage', () => {
  test('the idle worker is shut down once the follow-up window ends, and not before', async () => {
    const t = setup('triage');
    const runId = await finished(t, JSON.stringify({ text: VERDICT }));
    await t.automation.retireWorkers();
    t.later(TRIAGE_FOLLOW_UP - 1);
    await t.automation.retireWorkers();
    expect(t.aborts).toEqual([]);

    t.later(2);
    await t.automation.retireWorkers();
    expect(t.aborts).toEqual([runId]);
    expect(retiredEntries(t)).toEqual([expect.objectContaining({ runId, outcome: 'stopped', ok: true })]);
  });

  test('a repeated pass and a restart shut it down once', async () => {
    const t = setup('triage');
    const runId = await finished(t, JSON.stringify({ text: VERDICT }));
    t.later(TRIAGE_FOLLOW_UP + 1);
    await t.automation.retireWorkers();
    await t.automation.retireWorkers();
    const restarted = t.build();
    await restarted.reconcile();
    await restarted.retireWorkers();
    expect(t.aborts).toEqual([runId]);
    expect(retiredEntries(t)).toHaveLength(1);
  });

  test('a follow-up worker still answering keeps the case worker until the window closes', async () => {
    const t = setup('triage');
    const runId = await finished(t, JSON.stringify({ text: VERDICT }));
    t.slack.messages.push({ ts: '1762900050.000000', user: 'U2', text: 'Does this happen on Chrome too?' });
    await t.automation.advanceFollowUps();
    expect(t.spawns).toHaveLength(1);
    t.later(TRIAGE_FOLLOW_UP + 1);
    await t.automation.retireWorkers();
    expect(t.aborts).toEqual([]);

    await t.automation.advanceFollowUps();
    expect(t.aborts).toEqual([t.spawns[0]?.runId]);
    await t.automation.retireWorkers();
    expect(t.aborts).toEqual([t.spawns[0]?.runId, runId]);
  });

  test('a shutdown the host refuses is tried again on the next pass, up to the attempt limit, and a success ends it', async () => {
    const t = setup('triage', { abortOutcomes: ['refused: no host claimed the worker', 'refused: no host claimed the worker'] });
    const runId = await finished(t, JSON.stringify({ text: VERDICT }));
    t.later(TRIAGE_FOLLOW_UP + 1);
    for (let pass = 0; pass < 5; pass += 1) await t.automation.retireWorkers();
    expect(t.aborts).toEqual([runId, runId, runId]);
    expect(retiredEntries(t).map((entry) => entry.ok)).toEqual([false, false, true]);
  });

  test('a host that keeps refusing is left after the attempt limit instead of being retried forever', async () => {
    const t = setup('triage', { abortOutcomes: Array.from({ length: 20 }, () => 'refused: no host claimed the worker') });
    await finished(t, JSON.stringify({ text: VERDICT }));
    t.later(TRIAGE_FOLLOW_UP + 1);
    for (let pass = 0; pass < RETIRE_ATTEMPT_LIMIT + 3; pass += 1) await t.automation.retireWorkers();
    expect(t.aborts).toHaveLength(RETIRE_ATTEMPT_LIMIT);
  });
});

describe('repro', () => {
  test('the idle worker is shut down once the operations follow-up window ends', async () => {
    const t = setup('reproduce', { operationsChannel: OPS_CHANNEL });
    const runId = await finished(t, COULD_NOT);
    t.later(OPS_FOLLOW_UP - 1);
    await t.automation.retireWorkers();
    expect(t.aborts).toEqual([]);
    t.later(2);
    await t.automation.retireWorkers();
    await t.automation.retireWorkers();
    expect(t.aborts).toEqual([runId]);
  });

  test('a rerun turn still in flight keeps the worker past the window, and it is shut down after the turn settles', async () => {
    const t = setup('reproduce', { operationsChannel: OPS_CHANNEL });
    const runId = await finished(t, COULD_NOT);
    const rootTs = t.slack.ops.find((message) => message.thread_ts === undefined)?.ts ?? '';
    t.slack.ops.push({ ts: '1762900200.000000', user: 'U2', text: 'Wrong account, retry as admin.', thread_ts: rootTs });
    await t.automation.advanceFollowUps();
    settleWorker(t.project.dir, t.spawns[0]?.runId as RunId, { phase: 'idle', finalText: JSON.stringify({ text: 'Rerunning.', rerun: { correction: 'Use admin.' } }) });
    await t.automation.advanceFollowUps();
    expect(t.steers).toEqual([runId]);

    t.later(OPS_FOLLOW_UP + 1);
    await t.automation.retireWorkers();
    expect(t.aborts.filter((id) => id === runId)).toEqual([]);

    settleWorker(t.project.dir, runId, { phase: 'idle', finalText: JSON.stringify({ status: 'Could not reproduce', operations: 'Still fine with admin.' }) });
    await t.automation.advanceRepro();
    await t.automation.advanceRepro();
    await t.automation.retireWorkers();
    expect(t.aborts.filter((id) => id === runId)).toEqual([runId]);
  });

  test('without an operations channel there is no window, so the worker is shut down as soon as its lifecycle is over', async () => {
    const t = setup('reproduce');
    const runId = await finished(t, COULD_NOT);
    await t.automation.retireWorkers();
    expect(t.aborts).toEqual([runId]);
  });

  test('a case still inside its rejection window keeps its worker', async () => {
    const t = setup('reproduce');
    await finished(t, JSON.stringify({ text: 'Reproduced twice.', status: 'Reproduced', operations: 'Evidence.' }));
    t.later(5);
    await t.automation.retireWorkers();
    expect(t.aborts).toEqual([]);
  });
});
