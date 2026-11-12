import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, expect, test } from 'vitest';
import type { Automation } from '../../adapters/automation-events.ts';
import { abortInTmux, type AbortOutcome } from '../../src/automation/abort.ts';
import { workerDir } from '../../src/automation/dispatch.ts';
import type { RunId } from '../../src/automation/model.ts';
import { collectRun, completeSettledRuns } from '../../src/automation/settle.ts';
import { readLog } from '../../src/automation/store.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import type { HostState } from '../../src/run-files.ts';
import { killTmuxServer, TMUX } from '../worker-lifecycle/harness.ts';
import { type BennyProject, bennyProject, fakeGh, fakeSlack, REPORT, ROOT_TS, wiringDeps } from './benny-fakes.ts';

const projects: BennyProject[] = [];
afterAll(killTmuxServer);
afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project.dir, { recursive: true, force: true });
});

const MINUTES = 30;
const START = Date.parse('2026-11-12T08:00:00Z');

function triage() {
  const project = bennyProject();
  projects.push(project);
  const slack = fakeSlack();
  const aborts: RunId[] = [];
  let clock = START;
  const config = { ...project.config('triage'), budgets: { totalMinutes: MINUTES, followUpMinutes: 10 } };
  const automation: Automation = wireBenny(config, wiringDeps(slack, fakeGh(), { spawnWorker: async () => undefined, now: () => new Date(clock) }));
  const abort = async (_root: string, runId: RunId): Promise<AbortOutcome> => {
    aborts.push(runId);
    return 'stopped';
  };
  return { project, slack, automation, aborts, abort, later: (minutes: number) => void (clock += minutes * 60_000) };
}

/** What a host that is alive but has no settle covering its work looks like, as `inspect` reports it. */
const liveHost = (runId: RunId, phase: 'idle' | 'running', generation: number): HostState => ({
  schemaVersion: 1,
  runId,
  workerId: 'owner' as HostState['workerId'],
  kind: 'pi',
  digest: 'x',
  instance: 'i1',
  hostPid: process.pid,
  childPid: null,
  tmuxSession: 's',
  socketPath: '/nonexistent',
  phase,
  reason: null,
  model: null,
  sessionFile: null,
  briefSent: true,
  generation,
  settles: [],
  exit: null,
  updatedAt: new Date(START).toISOString(),
});

async function dispatched(t: ReturnType<typeof triage>): Promise<RunId> {
  const run = await t.automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error('not dispatched');
  return run.runId;
}

test.for<[string, 'idle' | 'running', number]>([
  ['a live idle host that never took its work', 'idle', 0],
  ['a live running host', 'running', 1],
])('%s past triage_total_minutes is aborted and the case completes with the failure reply', async ([, phase, generation]) => {
  const t = triage();
  const runId = await dispatched(t);
  const inspect = async () => liveHost(runId, phase, generation);
  const collect = (id: RunId) => collectRun(t.project.dir, id, inspect);

  expect(await completeSettledRuns(t.automation, { collect, abort: t.abort })).toBe(0);
  t.later(MINUTES - 1);
  expect(await completeSettledRuns(t.automation, { collect, abort: t.abort })).toBe(0);
  expect(t.aborts).toEqual([]);
  expect(t.slack.posts).toEqual([]);

  t.later(2);
  expect(await completeSettledRuns(t.automation, { collect, abort: t.abort })).toBe(1);
  expect(t.aborts).toEqual([runId]);
  expect(t.slack.posts).toHaveLength(1);
  expect(t.slack.posts[0]).toMatchObject({ thread_ts: ROOT_TS });
  expect(t.slack.posts[0]?.text).toMatch(/could not finish this report: the worker exceeded its 30-minute budget\. No ticket was created\.\n\[benny:other\]$/);
  expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'deadline', runId, minutes: MINUTES, abort: 'stopped' }));
  expect(t.automation.pendingRuns()).toEqual([]);
  expect(await completeSettledRuns(t.automation, { collect, abort: t.abort })).toBe(0);
  expect(t.slack.posts).toHaveLength(1);
});

test('a claim with no state.json past the deadline completes with the failure reply, even when no host can be reached to abort', async () => {
  const t = triage();
  const runId = await dispatched(t);
  mkdirSync(join(workerDir(t.project.dir, runId), 'claim'), { recursive: true });
  writeFileSync(join(workerDir(t.project.dir, runId), 'claim', 'identity.json'), '{}');
  const unreachable = async (): Promise<AbortOutcome> => 'refused: no tmux session';
  expect(await completeSettledRuns(t.automation, { abort: unreachable })).toBe(0);
  t.later(MINUTES + 1);
  expect(await completeSettledRuns(t.automation, { abort: unreachable })).toBe(1);
  expect(t.slack.posts[0]?.text).toContain('exceeded its 30-minute budget');
  expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'deadline', abort: 'refused: no tmux session' }));
});

test('a worker that settles after the deadline but before the next poll keeps its result', async () => {
  const t = triage();
  const runId = await dispatched(t);
  t.later(MINUTES + 5);
  const collect = async () => ({ settled: true as const, failure: null, finalText: 'Not a defect.\n[benny:other]' });
  expect(await completeSettledRuns(t.automation, { collect, abort: t.abort })).toBe(1);
  expect(t.aborts).toEqual([]);
  expect(t.slack.posts[0]?.text).toBe('Not a defect.\n[benny:other]');
  expect(runId).toBeDefined();
});

test('an abort that throws still completes the case', async () => {
  const t = triage();
  await dispatched(t);
  t.later(MINUTES + 1);
  const broken = async (): Promise<AbortOutcome> => Promise.reject(new Error('socket exploded'));
  expect(await completeSettledRuns(t.automation, { abort: broken })).toBe(1);
  expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'deadline', abort: expect.stringContaining('socket exploded') }));
});

test('a claim no host ever took is abandoned through the runtime abort when its deadline passes, and the case still completes', async () => {
  const t = triage();
  const runId = await dispatched(t);
  const worker = workerDir(t.project.dir, runId);
  mkdirSync(join(worker, 'claim'), { recursive: true });
  writeFileSync(join(worker, 'claim', 'launch-env.json'), '{"SECRET":"left-behind"}', { mode: 0o600 });
  const abort = abortInTmux({ tmuxSocket: TMUX, startCheckMs: 300 });
  t.later(MINUTES + 1);
  expect(await completeSettledRuns(t.automation, { abort })).toBe(1);
  expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'deadline', runId, abort: 'abandoned' }));
  expect(existsSync(join(worker, 'claim', 'launch-env.json'))).toBe(false);
  expect(existsSync(join(worker, 'claim'))).toBe(true);
  const events = readFileSync(join(t.project.dir, '.pi/pstack/runs', runId, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { kind: string });
  expect(events.map((event) => event.kind)).toEqual(['abandoned', 'abort']);
  expect(t.slack.posts[0]?.text).toContain('exceeded its 30-minute budget');
});
