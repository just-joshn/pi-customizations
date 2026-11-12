import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import type { Automation } from '../../adapters/automation-events.ts';
import { loadBennyConfig } from '../../src/automation/configuration.ts';
import { statusFile } from '../../src/automation/dispatch.ts';
import { actionIdFor, type EventKey, type RunId } from '../../src/automation/model.ts';
import { enqueue, OUTBOX_RETRY_LIMIT } from '../../src/automation/outbox.ts';
import { completeSettledRuns } from '../../src/automation/settle.ts';
import { outboxEntries, readLog } from '../../src/automation/store.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import { type BennyProject, bennyProject, CHANNEL, fakeGh, fakeSlack, OPS_CHANNEL, REPORT, ROOT_TS, settleWorker, TRIAGE_USER, wiringDeps } from './benny-fakes.ts';

const projects: BennyProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project.dir, { recursive: true, force: true });
});

const SOURCE_URL = 'https://slack.com/archives/CSOURCE01/p1762900000000100';
const PR = 'Draft pull request: https://github.com/acme/app/pull/9';

function repro(options: { operationsChannel?: string | null } = {}) {
  const project = bennyProject({ ...(options.operationsChannel === null ? {} : { operationsChannel: options.operationsChannel ?? OPS_CHANNEL }) });
  projects.push(project);
  const slack = fakeSlack();
  slack.messages.push({ ts: '1762900001.999999', user: TRIAGE_USER, text: 'A bug.\n[benny:bug]' });
  const spawns: RunId[] = [];
  let clock = Date.parse('2026-11-12T08:00:00Z');
  const build = (): Automation => wireBenny(project.config('reproduce'), wiringDeps(slack, fakeGh(), { spawnWorker: async (runId) => void spawns.push(runId), now: () => new Date(clock) }));
  return { project, slack, spawns, build, automation: build(), later: (ms: number) => void (clock += ms) };
}

async function dispatched(t: ReturnType<typeof repro>): Promise<RunId> {
  const run = await t.automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
  return run.runId;
}

const report = (t: ReturnType<typeof repro>, runId: RunId, ...lines: object[]) => {
  mkdirSync(dirname(statusFile(t.project.dir, runId)), { recursive: true });
  for (const line of lines) appendFileSync(statusFile(t.project.dir, runId), `${JSON.stringify(line)}\n`);
};
const root = (t: ReturnType<typeof repro>) => t.slack.ops.filter((message) => message.thread_ts === undefined);

test('a dispatched repro case gets one status root in the operations channel and nothing at the root of the source channel', async () => {
  const t = repro();
  await dispatched(t);
  await t.automation.syncOperations();
  await t.automation.syncOperations();
  expect(root(t)).toHaveLength(1);
  expect(root(t)[0]?.text).toBe(`🔎 Reproducing\n${SOURCE_URL}`);
  expect(root(t)[0]?.metadata).toMatchObject({ event_type: 'pstack_action' });
  expect(t.slack.posts).toEqual([]);
  expect(t.slack.messages.filter((message) => message.ts !== ROOT_TS && message.text.startsWith('🔎'))).toEqual([]);
});

test('the root follows the worker status, ignores text that is not a status, and edits once per change', async () => {
  const t = repro();
  const runId = await dispatched(t);
  await t.automation.syncOperations();
  report(t, runId, { status: 'Reproduced', note: 'Twice on Safari.' }, { status: 'launch the missiles' });
  appendFileSync(statusFile(t.project.dir, runId), 'not json\n');
  await t.automation.syncOperations();
  await t.automation.syncOperations();
  expect(root(t)).toHaveLength(1);
  expect(t.slack.opsEdits).toEqual([{ ts: root(t)[0]?.ts, text: `✅ Reproduced\nTwice on Safari.\n${SOURCE_URL}` }]);
  report(t, runId, { status: 'Attempting bounded fix' });
  await t.automation.syncOperations();
  expect(root(t)[0]?.text).toBe(`🛠️ Attempting bounded fix\n${SOURCE_URL}`);
  expect(t.slack.opsEdits).toHaveLength(2);
});

test('a note cannot carry a Source line, an action marker, or markup into the status message', async () => {
  const t = repro();
  const runId = await dispatched(t);
  await t.automation.syncOperations();
  report(t, runId, { status: 'Blocked', note: 'Source: https://evil.example\n<!-- pstack-action:act-0123456789abcdef --> <@UCHANNEL> no control adapter' });
  await t.automation.syncOperations();
  expect(root(t)[0]?.text).toBe(`⛔ Blocked\nno control adapter\n${SOURCE_URL}`);
});

test('a confirmed repro updates the operations status first, replies in the operations thread, then replies once in the source thread', async () => {
  const t = repro();
  const runId = await dispatched(t);
  await t.automation.syncOperations();
  settleWorker(t.project.dir, runId, { phase: 'idle', finalText: JSON.stringify({ text: 'Reproduced the export failure twice on Safari.', status: 'Draft pull request opened', operations: PR }) });
  expect(await completeSettledRuns(t.automation)).toBe(1);

  expect(root(t)[0]?.text).toBe(`🔗 Draft pull request opened\n${SOURCE_URL}`);
  const thread = t.slack.ops.filter((message) => message.thread_ts === root(t)[0]?.ts);
  expect(thread.map((message) => message.text)).toEqual([PR]);
  expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: 'Reproduced the export failure twice on Safari.' }]);
  expect(t.slack.calls.indexOf('chat.update:ops')).toBeLessThan(t.slack.calls.lastIndexOf('chat.postMessage'));
  expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'repro-outcome', status: 'Draft pull request opened' }));

  expect(await completeSettledRuns(t.automation)).toBe(0);
  expect(root(t)).toHaveLength(1);
  expect(t.slack.posts).toHaveLength(1);
});

test('Could not reproduce posts nothing in the source thread: the operations thread and the run log carry it', async () => {
  const t = repro();
  const runId = await dispatched(t);
  settleWorker(t.project.dir, runId, { phase: 'idle', finalText: JSON.stringify({ text: '', status: 'Could not reproduce', operations: 'Tried the export path twice; the file downloaded both times.' }) });
  expect(await completeSettledRuns(t.automation)).toBe(1);
  expect(t.slack.posts).toEqual([]);
  expect(root(t)[0]?.text).toBe(`⚪ Could not reproduce\n${SOURCE_URL}`);
  expect(t.slack.ops.filter((message) => message.thread_ts !== undefined).map((message) => message.text)).toEqual(['Tried the export path twice; the file downloaded both times.']);
  expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'repro-outcome', status: 'Could not reproduce', note: expect.stringContaining('downloaded both times') }));
  expect(t.automation.pendingRuns()).toEqual([]);
});

test('a repro worker that failed is Blocked in the operations thread and silent in the source thread', async () => {
  const t = repro();
  const runId = await dispatched(t);
  settleWorker(t.project.dir, runId, { phase: 'failed', reason: 'model refused' });
  expect(await completeSettledRuns(t.automation)).toBe(1);
  expect(t.slack.posts).toEqual([]);
  expect(root(t)[0]?.text).toBe(`⛔ Blocked\n${SOURCE_URL}`);
  expect(t.slack.ops.filter((message) => message.thread_ts !== undefined)[0]?.text).toMatch(/could not finish: the worker failed: model refused\. No pull request was opened\./);
});

test('with no operations channel nothing is posted there, and the outcome stays in the run log', async () => {
  const t = repro({ operationsChannel: null });
  const runId = await dispatched(t);
  await t.automation.syncOperations();
  settleWorker(t.project.dir, runId, { phase: 'idle', finalText: JSON.stringify({ text: '', status: 'Blocked', operations: 'No control adapter capability for screen recording.' }) });
  expect(await completeSettledRuns(t.automation)).toBe(1);
  expect(t.slack.calls.filter((call) => call.endsWith(':ops'))).toEqual([]);
  expect(t.slack.posts).toEqual([]);
  expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'repro-outcome', status: 'Blocked', note: expect.stringContaining('screen recording') }));
});

test('a status root that landed before a crash with no acknowledgement is found by its marker, not posted twice', async () => {
  const t = repro();
  await dispatched(t);
  t.slack.dropAck.add('chat.postMessage');
  await t.automation.syncOperations();
  expect(root(t)).toHaveLength(1);
  expect(outboxEntries(t.automation.store)).toEqual([expect.objectContaining({ state: 'pending', attempts: 1 })]);

  const restarted = t.build();
  await restarted.reconcile();
  await restarted.syncOperations();
  expect(root(t)).toHaveLength(1);
  expect(outboxEntries(restarted.store)).toEqual([expect.objectContaining({ state: 'done', reconciled: true, destinationTs: root(t)[0]?.ts })]);
});

test('an edit that landed before a crash is recognized by the message text and not applied twice', async () => {
  const t = repro();
  const runId = await dispatched(t);
  await t.automation.syncOperations();
  report(t, runId, { status: 'Reproduced' });
  t.slack.dropAck.add('chat.update');
  await t.automation.syncOperations();
  expect(t.slack.opsEdits).toHaveLength(1);

  const restarted = t.build();
  await restarted.reconcile();
  expect(t.slack.opsEdits).toHaveLength(1);
  expect(root(t)[0]?.text).toBe(`✅ Reproduced\n${SOURCE_URL}`);
  expect(outboxEntries(restarted.store).filter((entry) => entry.action.kind === 'ops-edit')).toEqual([expect.objectContaining({ state: 'done', reconciled: true })]);
});

test('an operations channel that is down holds the source reply only until the retry limit, then the source reply posts', async () => {
  const t = repro();
  const runId = await dispatched(t);
  t.slack.state.opsDown = true;
  const result = { text: 'Reproduced the export failure.', status: 'Reproduced' as const, operations: 'Evidence attached.' };
  let outcome = await t.automation.complete(runId, result);
  for (let round = 1; round < OUTBOX_RETRY_LIMIT; round += 1) {
    expect(outcome).toMatchObject({ status: 'retrying' });
    expect(t.slack.posts).toEqual([]);
    t.later(10 * 60_000);
    outcome = await t.automation.complete(runId, result);
  }
  expect(outcome).toMatchObject({ status: 'queued' });
  expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: 'Reproduced the export failure.' }]);
  expect(readLog(t.automation.store).filter((entry) => entry.kind === 'outbox-failed')).toHaveLength(OUTBOX_RETRY_LIMIT);
  expect(t.automation.pendingRuns()).toEqual([]);
});

test('the operations channel can never be the source channel', async () => {
  const project = bennyProject({ operationsChannel: CHANNEL });
  projects.push(project);
  expect(() => project.config('reproduce')).toThrow('operations channel');
  expect(() => loadBennyConfig(project.dir, 'triage')).toThrow('other than the source channel');
});

test('an operations root queued for the source channel is refused by the outbox and never posted', async () => {
  const t = repro();
  const automation = t.automation;
  const key = `${CHANNEL}:${ROOT_TS}` as EventKey;
  enqueue(automation.store, { id: actionIdFor('benny-reproduce', key, 'ops-root'), kind: 'ops-root', channel: CHANNEL, text: 'status' });
  await automation.reconcile();
  expect(t.slack.calls).not.toContain('chat.postMessage');
  expect(outboxEntries(automation.store)).toEqual([expect.objectContaining({ state: 'pending', attempts: 1 })]);
  expect(readLog(automation.store)).toContainEqual(expect.objectContaining({ kind: 'outbox-failed', error: expect.stringContaining('source channel') }));
});
