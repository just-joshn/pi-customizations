import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import type { Automation } from '../../adapters/automation-events.ts';
import { OUTBOX_RETRY_LIMIT } from '../../src/automation/outbox.ts';
import type { RunId } from '../../src/automation/model.ts';
import { completeSettledRuns } from '../../src/automation/settle.ts';
import { outboxEntries, readLog } from '../../src/automation/store.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import { type BennyProject, bennyProject, fakeGh, fakeSlack, REPORT, ROOT_TS, settleWorker, trackerAgentDir, wiringDeps } from './benny-fakes.ts';

const projects: BennyProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project.dir, { recursive: true, force: true });
});

const VERDICT = 'Reproducible export failure.\n[benny:bug]';
const CREATE = { text: VERDICT, tracker: { operation: 'create', title: 'Export button does nothing on Safari', body: 'Expected a download.\nSource: https://slack.com/archives/COTHER/p1' } };

function linear(options: { adapterSkill?: string | null; env?: Record<string, string> } = {}) {
  const project = bennyProject({ adapterSkill: options.adapterSkill === undefined ? 'linear-adapter' : options.adapterSkill });
  projects.push(project);
  const slack = fakeSlack();
  const gh = fakeGh();
  const spawns: { runId: RunId; assignmentPath: string }[] = [];
  let clock = Date.parse('2026-11-12T08:00:00Z');
  const build = (): Automation => wireBenny(project.config('triage'), wiringDeps(slack, gh, { spawnWorker: async (runId, assignmentPath) => void spawns.push({ runId, assignmentPath }), now: () => new Date(clock), ...(options.env === undefined ? {} : { env: options.env }) }));
  return { project, slack, gh, spawns, build, automation: build(), later: (ms: number) => void (clock += ms) };
}

async function dispatched(t: ReturnType<typeof linear>): Promise<RunId> {
  const run = await t.automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
  settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: JSON.stringify(CREATE) });
  return run.runId;
}

const trackerEntry = (t: ReturnType<typeof linear>) => outboxEntries(t.automation.store).find((entry) => entry.action.kind === 'tracker');
const read = (path: string) => readFileSync(path, 'utf8');

test('a tracker other than GitHub is written by a dedicated worker that loads the project adapter skill, and the reply waits for it', async () => {
  const t = linear();
  const caseRun = await dispatched(t);
  expect(await completeSettledRuns(t.automation)).toBe(0);

  expect(t.spawns).toHaveLength(2);
  const worker = t.spawns[1];
  expect(worker?.runId).not.toBe(caseRun);
  const assignment = JSON.parse(read(worker?.assignmentPath ?? ''));
  expect(assignment).toMatchObject({ kind: 'pi', capabilities: { mcp: 'inherit', env: 'minimal', externalWrite: true }, workspace: { mode: 'readonly', path: t.project.dir } });
  const run = JSON.parse(read(join(dirname(dirname(dirname(worker?.assignmentPath ?? ''))), 'run.json')));
  expect(run.parentSessionFile).toBeNull();

  const brief = read(join(dirname(worker?.assignmentPath ?? ''), 'brief.md'));
  const marker = /<!-- pstack-action:(act-[0-9a-f]{16}) -->/.exec(brief)?.[1];
  expect(marker).toBeDefined();
  expect(brief).toContain(join(t.project.dir, '.pi/skills/linear-adapter/SKILL.md'));
  expect(brief).toContain('team-placeholder');
  expect(brief).toContain('intake-status-placeholder');
  expect(brief.indexOf('Search first')).toBeGreaterThan(-1);
  expect(brief.indexOf('Search first')).toBeLessThan(brief.indexOf('Only if both searches find nothing'));
  expect(brief).toMatch(/"outcome"/);
  expect(brief).toContain('"labels"');
  expect(brief.match(/^<\/untrusted_action>$/gm)).toHaveLength(1);

  expect(trackerEntry(t)).toMatchObject({ state: 'pending', work: { runId: worker?.runId } });
  expect(t.slack.posts).toHaveLength(0);
  expect(t.automation.pendingRuns()).toEqual([caseRun]);

  expect(await completeSettledRuns(t.automation)).toBe(0);
  expect(t.spawns).toHaveLength(2);

  settleWorker(t.project.dir, worker?.runId as RunId, { phase: 'idle', finalText: '```json\n{"outcome":"created","id":"LIN-42","url":"https://linear.app/x/issue/LIN-42"}\n```' });
  expect(await completeSettledRuns(t.automation)).toBe(1);
  expect(trackerEntry(t)).toMatchObject({ state: 'done', destinationTs: 'LIN-42', reconciled: false });
  expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: `${VERDICT} tracker=https://linear.app/x/issue/LIN-42` }]);
  expect(t.gh.calls).toHaveLength(0);
});

test('a worker-written Source line cannot reach the adapter brief as the source of the action', async () => {
  const t = linear();
  await dispatched(t);
  await completeSettledRuns(t.automation);
  const brief = read(join(dirname(t.spawns[1]?.assignmentPath ?? ''), 'brief.md'));
  expect(brief).toContain('"sourceUrl": "https://slack.com/archives/CSOURCE01/p1762900000000100"');
  expect(brief).not.toContain('COTHER');
});

test('a restart while the tracker worker runs adopts it and never spawns a second writer', async () => {
  const t = linear();
  await dispatched(t);
  await completeSettledRuns(t.automation);
  const first = t.spawns[1]?.runId as RunId;

  const restarted = t.build();
  await restarted.reconcile();
  expect(await completeSettledRuns(restarted)).toBe(0);
  expect(t.spawns).toHaveLength(2);
  expect(trackerEntry(t)).toMatchObject({ state: 'pending', work: { runId: first } });

  settleWorker(t.project.dir, first, { phase: 'idle', finalText: '{"outcome":"found","id":"LIN-7"}' });
  expect(await completeSettledRuns(restarted)).toBe(1);
  expect(trackerEntry(t)).toMatchObject({ state: 'done', destinationTs: 'LIN-7', reconciled: true });
  expect(t.slack.posts).toHaveLength(1);
});

test('a worker that fails is replaced by a fresh worker, which searches by the same marker first; after the retry limit the failure reply posts', async () => {
  const t = linear();
  await dispatched(t);
  const markerOf = (index: number) => /pstack-action:(act-[0-9a-f]{16})/.exec(read(join(dirname(t.spawns[index]?.assignmentPath ?? ''), 'brief.md')))?.[1];
  await completeSettledRuns(t.automation);
  for (let attempt = 1; attempt <= OUTBOX_RETRY_LIMIT; attempt += 1) {
    expect(t.spawns).toHaveLength(attempt + 1);
    settleWorker(t.project.dir, t.spawns[attempt]?.runId as RunId, { phase: 'failed', reason: 'the MCP server timed out' });
    await completeSettledRuns(t.automation);
    t.later(10 * 60_000);
    await completeSettledRuns(t.automation);
    if (attempt < OUTBOX_RETRY_LIMIT) expect(t.slack.posts).toHaveLength(0);
  }
  const runs = new Set(t.spawns.map((spawn) => spawn.runId));
  expect(runs.size).toBe(OUTBOX_RETRY_LIMIT + 1);
  expect(new Set(t.spawns.slice(1).map((_, index) => markerOf(index + 1))).size).toBe(1);
  expect(t.slack.posts).toHaveLength(1);
  expect(t.slack.posts[0]?.text).toMatch(/the tracker write failed after 5 attempts: tracker worker failed: the worker failed: the MCP server timed out\. No ticket was created\.\n\[benny:other\]$/);
  expect(readLog(t.automation.store).filter((entry) => entry.kind === 'outbox-failed')).toHaveLength(OUTBOX_RETRY_LIMIT);
});

test.for([
  ['text that is not JSON', 'I created the issue.'],
  ['an unknown outcome', '{"outcome":"deleted","id":"LIN-1"}'],
  ['an outcome that does not match the operation', '{"outcome":"closed","id":"LIN-1"}'],
  ['a missing id', '{"outcome":"created"}'],
  ['a reported failure', '{"outcome":"failed","reason":"no such team"}'],
])('%s from the tracker worker is not a result, so the action is not recorded as landed', async ([, finalText]) => {
  const t = linear();
  await dispatched(t);
  await completeSettledRuns(t.automation);
  settleWorker(t.project.dir, t.spawns[1]?.runId as RunId, { phase: 'idle', finalText: finalText as string });
  await completeSettledRuns(t.automation);
  expect(trackerEntry(t)).toMatchObject({ state: 'pending', attempts: 1 });
  expect(t.slack.posts).toHaveLength(0);
});

test('an adapter skill the project does not have blocks the case with an explicit error and spawns nothing', async () => {
  const t = linear({ adapterSkill: null });
  expect(await t.automation.handle(REPORT)).toMatchObject({ status: 'blocked', missing: ['tracker'], problems: [expect.stringMatching(/tracker adapter skill issue-tracker-adapter-placeholder is not in any Pi skill location/)] });
  expect(t.spawns).toHaveLength(0);
  expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'blocked', problems: [expect.stringContaining('issue-tracker-adapter-placeholder')] }));
});

test('an adapter skill name that is not a skill name blocks the case', async () => {
  const t = linear({ adapterSkill: '../../etc/passwd' });
  expect(await t.automation.handle(REPORT)).toMatchObject({ status: 'blocked', missing: ['tracker'], problems: [expect.stringContaining('is not a skill name')] });
});

const SOURCE_URL = 'https://slack.com/archives/CSOURCE01/p1762900000000100';
const briefOfWorker = (t: ReturnType<typeof linear>, index: number) => read(join(dirname(t.spawns[index]?.assignmentPath ?? ''), 'brief.md'));

test.for(['create', 'update', 'comment'] as const)('the %s brief has the worker search by the source permalink after the marker and before any write', async (operation) => {
  const t = linear();
  const run = await t.automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error('not dispatched');
  const intent = operation === 'create' ? { operation, title: 'Export button does nothing', body: 'Expected a download.' } : { operation, targetId: 'LIN-7', body: 'Seen again.' };
  settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: JSON.stringify({ text: VERDICT, tracker: intent }) });
  await completeSettledRuns(t.automation);
  const brief = briefOfWorker(t, 1);
  const marker = brief.indexOf('Search first');
  const permalink = brief.indexOf(`\`Source: ${SOURCE_URL}\``);
  const write = brief.indexOf('Only if both searches find nothing');
  expect(marker).toBeGreaterThan(-1);
  expect(permalink).toBeGreaterThan(marker);
  expect(write).toBeGreaterThan(permalink);
  expect(brief).toContain('"already-linked"');
});

test('the compensation close brief does not search by the permalink, because the issue it closes is linked to it by construction', async () => {
  const t = linear();
  const { buildTrackerBrief } = await import('../../src/automation/tracker-adapter.ts');
  const brief = buildTrackerBrief({ id: 'act-0123456789abcdef' as never, kind: 'tracker', operation: 'close', targetId: 'LIN-7', body: '', sourceUrl: SOURCE_URL }, '/skills/linear/SKILL.md', t.project.config('triage').tracker);
  expect(brief).not.toContain('already-linked');
  expect(brief).not.toContain('Search by the source permalink');
});

test('a permalink the tracker already links makes the action a no-op the parent honors: no second write, no second worker, and the verdict carries the linked issue', async () => {
  const t = linear();
  await dispatched(t);
  await completeSettledRuns(t.automation);
  settleWorker(t.project.dir, t.spawns[1]?.runId as RunId, { phase: 'idle', finalText: '{"outcome":"already-linked","id":"LIN-3","url":"https://linear.app/x/issue/LIN-3"}' });
  expect(await completeSettledRuns(t.automation)).toBe(1);
  expect(t.spawns).toHaveLength(2);
  expect(trackerEntry(t)).toMatchObject({ state: 'done', destinationTs: 'LIN-3', reconciled: true, alreadyLinked: true });
  expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: `${VERDICT} tracker=https://linear.app/x/issue/LIN-3` }]);
  const restarted = t.build();
  await restarted.reconcile();
  expect(await completeSettledRuns(restarted)).toBe(0);
  expect(t.spawns).toHaveLength(2);
  expect(t.slack.posts).toHaveLength(1);
});

test('already-linked is not an outcome of a compensation close: the close is not recorded as landed', async () => {
  const { parseAdapterResult } = await import('../../src/automation/tracker-adapter.ts');
  expect(() => parseAdapterResult('{"outcome":"already-linked","id":"LIN-3"}', 'close')).toThrow(/not found or closed/);
  expect(parseAdapterResult('{"outcome":"already-linked","id":"LIN-3"}', 'comment')).toMatchObject({ id: 'LIN-3', reconciled: true, alreadyLinked: true });
});

test.each([
  ['no tracker-mcp.json', undefined, /tracker-mcp\.json is missing/],
  ['an empty tool list', [], /lists no tools/],
  ['a wildcard entry', ['mcp__linear__*'], /exact tool names and no patterns/],
  ['a namespace entry', ['mcp__linear'], /exact tool names and no patterns/],
] as const)('a tracker other than GitHub with %s is blocked with a setup error, and no worker starts', async (_name, tools, message) => {
  const agentDir = tools === undefined ? trackerAgentDir() : trackerAgentDir(tools);
  if (tools === undefined) rmSync(join(agentDir, 'pstack', 'tracker-mcp.json'));
  const t = linear({ env: { PI_CODING_AGENT_DIR: agentDir } });
  expect(await t.automation.handle(REPORT)).toMatchObject({ status: 'blocked', missing: ['tracker'], problems: [expect.stringMatching(message)] });
  expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'blocked', problems: [expect.stringContaining('tracker write authorization')] }));
  expect(t.spawns).toEqual([]);
  rmSync(agentDir, { recursive: true, force: true });
});

test('a tool list in the project cannot satisfy the tracker write authorization', async () => {
  const agentDir = trackerAgentDir();
  rmSync(join(agentDir, 'pstack', 'tracker-mcp.json'));
  const t = linear({ env: { PI_CODING_AGENT_DIR: agentDir } });
  for (const dir of [join(t.project.dir, '.pi', 'pstack'), join(t.project.dir, '.pi', 'benny')]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tracker-mcp.json'), JSON.stringify({ tools: ['mcp__linear__save_issue'] }));
  }
  expect(await t.automation.handle(REPORT)).toMatchObject({ status: 'blocked', missing: ['tracker'], problems: [expect.stringMatching(/tracker-mcp\.json is missing/)] });
  expect(t.spawns).toEqual([]);
  rmSync(agentDir, { recursive: true, force: true });
});
