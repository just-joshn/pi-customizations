import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { type Automation, startEventSource } from '../../adapters/automation-events.ts';
import { workerDir } from '../../src/automation/dispatch.ts';
import type { RunId } from '../../src/automation/model.ts';
import { completeSettledRuns, startSettler } from '../../src/automation/settle.ts';
import { readLog } from '../../src/automation/store.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import { type BennyProject, bennyProject, fakeGh, fakeSlack, REPORT, ROOT_TS, wiringDeps } from './benny-fakes.ts';

const projects: BennyProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project.dir, { recursive: true, force: true });
});

const VERDICT = 'Reproducible export failure in the Safari download path.\n[benny:bug]';
const CREATE = { text: VERDICT, tracker: { operation: 'create', title: 'Export button does nothing on Safari', body: 'Expected a download. Observed nothing.' } };

/** Writes what a settled host leaves behind: its state file and the native session file with the worker's final message. */
function settleWorker(dir: string, runId: RunId, outcome: { phase: 'idle' | 'failed' | 'aborted'; reason?: string; finalText?: string }) {
  const worker = workerDir(dir, runId);
  const sessionFile = join(worker, 'session', 'fake.jsonl');
  mkdirSync(join(worker, 'session'), { recursive: true });
  const message = outcome.finalText === undefined ? '' : `${JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: outcome.finalText }] } })}\n`;
  writeFileSync(sessionFile, message);
  const state = { schemaVersion: 1, runId, workerId: 'owner', kind: 'pi', digest: 'x', instance: 'i1', hostPid: 2 ** 22 - 1, childPid: null, tmuxSession: 's', socketPath: '/nonexistent', phase: 'idle', reason: null, model: null, sessionFile, briefSent: true, generation: 1, settles: [{ sequence: 1, generation: 1, phase: outcome.phase, reason: outcome.reason ?? null, at: new Date().toISOString() }], exit: null, updatedAt: new Date().toISOString() };
  writeFileSync(join(worker, 'state.json'), JSON.stringify(state));
}

function triage(options: { gh?: ReturnType<typeof fakeGh>; slack?: ReturnType<typeof fakeSlack>; project?: BennyProject } = {}) {
  const project = options.project ?? bennyProject();
  if (options.project === undefined) projects.push(project);
  const slack = options.slack ?? fakeSlack();
  const gh = options.gh ?? fakeGh();
  const spawns: RunId[] = [];
  const build = (): Automation => wireBenny(project.config('triage'), wiringDeps(slack, gh, { spawnWorker: async (runId) => void spawns.push(runId) }));
  return { project, slack, gh, spawns, build, automation: build() };
}

const created = (gh: ReturnType<typeof fakeGh>) => gh.calls.filter((call) => call.includes('POST') && call.includes(`repos/acme/app/issues`));

describe('triage end to end', () => {
  test('a report flows to dispatch, the worker settles, an issue is created with its marker, and the reply posts once', async () => {
    const t = triage();
    const run = await t.automation.handle(REPORT);
    if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
    expect(await completeSettledRuns(t.automation)).toBe(0);
    expect(t.slack.posts).toHaveLength(0);

    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: JSON.stringify(CREATE) });
    expect(await completeSettledRuns(t.automation)).toBe(1);

    expect(t.gh.issues).toHaveLength(1);
    const [issue] = t.gh.issues;
    expect(issue?.title).toBe(CREATE.tracker.title);
    expect(issue?.labels).toEqual(['bug', 'intake']);
    expect(issue?.body).toMatch(/<!-- pstack-action:act-[0-9a-f]{16} -->/);
    expect(issue?.body).toContain('Source: https://slack.com/archives/CSOURCE01/p1762900000000100');
    expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: VERDICT }]);

    expect(await completeSettledRuns(t.automation)).toBe(0);
    expect(t.slack.posts).toHaveLength(1);
  });

  test('a serve restart after complete repeats nothing', async () => {
    const t = triage();
    const run = await t.automation.handle(REPORT);
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: JSON.stringify(CREATE) });
    await completeSettledRuns(t.automation);
    const calls = t.gh.calls.length;

    const restarted = t.build();
    await restarted.reconcile();
    expect(restarted.pendingRuns()).toEqual([]);
    expect(await completeSettledRuns(restarted)).toBe(0);
    expect(await restarted.handle(REPORT)).toMatchObject({ status: 'duplicate' });
    expect(t.gh.calls).toHaveLength(calls);
    expect(t.gh.issues).toHaveLength(1);
    expect(t.slack.posts).toHaveLength(1);
    expect(t.spawns).toHaveLength(1);
  });

  test('a crash between the issue and the reply converges to one issue and one reply', async () => {
    const t = triage({ slack: fakeSlack({ failPosts: 1 }) });
    const run = await t.automation.handle(REPORT);
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: JSON.stringify(CREATE) });
    expect(await completeSettledRuns(t.automation)).toBe(0);
    expect(t.gh.issues).toHaveLength(1);
    expect(t.slack.posts).toHaveLength(0);
    expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'outbox-failed', error: expect.stringContaining('ratelimited'), final: false }));

    const restarted = t.build();
    await restarted.reconcile();
    expect(await completeSettledRuns(restarted)).toBe(1);
    expect(t.gh.issues).toHaveLength(1);
    expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: VERDICT }]);
  });

  test.for([{ phase: 'failed' as const, reason: 'model refused' }, { phase: 'aborted' as const }])('a $phase worker posts the failure reply and creates no issue', async (outcome) => {
    const t = triage();
    const run = await t.automation.handle(REPORT);
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    settleWorker(t.project.dir, run.runId, outcome);
    expect(await completeSettledRuns(t.automation)).toBe(1);
    expect(t.gh.issues).toHaveLength(0);
    expect(t.slack.posts).toHaveLength(1);
    expect(t.slack.posts[0]?.text).toMatch(/could not finish this report: the worker (failed|aborted)/);
    expect(t.slack.posts[0]?.text.trimEnd().endsWith('[benny:other]')).toBe(true);
    expect(await completeSettledRuns(t.automation)).toBe(0);
    expect(t.slack.posts).toHaveLength(1);
  });

  test('a host that ended without finishing its work is a failure, not a wait', async () => {
    const t = triage();
    const run = await t.automation.handle(REPORT);
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: VERDICT });
    const path = join(workerDir(t.project.dir, run.runId), 'state.json');
    const state = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...state, generation: 2, phase: 'running' }));
    expect(await completeSettledRuns(t.automation)).toBe(1);
    expect(t.slack.posts[0]?.text).toContain('without finishing its work');
  });

  test('a duplicate report updates the existing issue instead of creating one', async () => {
    const gh = fakeGh([{ title: 'Safari export is broken', body: 'Original report.', state: 'open' }]);
    const t = triage({ gh });
    const run = await t.automation.handle(REPORT);
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    const update = { text: VERDICT, tracker: { operation: 'update', targetId: '1', body: 'Seen again in Slack.' } };
    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: JSON.stringify(update) });
    await completeSettledRuns(t.automation);
    expect(gh.issues).toHaveLength(1);
    expect(gh.issues[0]?.body).toContain('Original report.');
    expect(gh.issues[0]?.body).toContain('Seen again in Slack.');
    expect(gh.issues[0]?.body).toContain('Source: https://slack.com/archives/CSOURCE01/p1762900000000100');
    expect(t.slack.posts).toHaveLength(1);
  });

  test.for([
    ['a feature request', { text: 'This is a feature request.\n[benny:other]', tracker: CREATE.tracker }],
    ['a title that already has an open issue', { ...CREATE, tracker: { ...CREATE.tracker, title: 'EXPORT BUTTON does nothing on safari' } }],
    ['a duplicate update naming a closed issue', { text: VERDICT, tracker: { operation: 'update', targetId: '1', body: 'again' } }],
    ['a target that is not an issue', { text: VERDICT, tracker: { operation: 'update', targetId: '99', body: 'again' } }],
  ])('an ineligible report (%s) creates no issue and still posts its verdict', async ([name, result]) => {
    const gh = fakeGh([
      { title: 'Export button does nothing on Safari', body: 'Existing.', state: 'open' },
      ...(name === 'a duplicate update naming a closed issue' ? [{ title: 'Old', body: 'x', state: 'closed' as const }] : []),
    ]);
    if (name === 'a duplicate update naming a closed issue') (result as { tracker: { targetId: string } }).tracker.targetId = '2';
    const t = triage({ gh });
    const run = await t.automation.handle(REPORT);
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    const before = JSON.stringify(gh.issues);
    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: JSON.stringify(result) });
    expect(await completeSettledRuns(t.automation)).toBe(1);
    expect(JSON.stringify(gh.issues)).toBe(before);
    expect(created(gh)).toHaveLength(0);
    expect(t.slack.posts).toHaveLength(1);
    expect(t.slack.posts[0]?.text).toBe((result as { text: string }).text);
  });

  test('a report whose permalink is already linked gets no second issue', async () => {
    const gh = fakeGh([{ title: 'Other title', body: 'Source: https://slack.com/archives/CSOURCE01/p1762900000000100\n\n<!-- pstack-action:act-0123456789abcdef -->', state: 'open' }]);
    const t = triage({ gh });
    const run = await t.automation.handle(REPORT);
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: JSON.stringify(CREATE) });
    await completeSettledRuns(t.automation);
    expect(gh.issues).toHaveLength(1);
    expect(t.slack.posts).toHaveLength(1);
  });

  test('a reply without exactly one marker becomes the failure reply', async () => {
    const t = triage();
    const run = await t.automation.handle(REPORT);
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: 'Looks like a bug.' });
    await completeSettledRuns(t.automation);
    expect(t.slack.posts).toHaveLength(1);
    expect(t.slack.posts[0]?.text).toContain('could not finish this report');
    expect(readLog(t.automation.store).filter((entry) => entry.kind === 'completed')).toHaveLength(1);
  });

  test('the settler polls on its own and the event source serves the same automation', async () => {
    const t = triage();
    const source = await startEventSource(t.automation, { kind: 'slack-poll', api: { fetch: t.slack.fetch, token: 'x' }, intervalMs: 60_000 });
    const run = await t.automation.handle(REPORT);
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    const settler = startSettler(t.automation, { intervalMs: 100 });
    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: VERDICT });
    const end = Date.now() + 10_000;
    while (t.slack.posts.length === 0 && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
    await settler.stop();
    await source.stop();
    expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: VERDICT }]);
  });
});

describe('reproduce prerequisites', () => {
  const reproduce = (project: BennyProject) => {
    const slack = fakeSlack();
    slack.messages.push({ ts: '1762900001.000000', user: 'UTRIAGE01', text: 'A bug.\n[benny:bug]' });
    const spawns: RunId[] = [];
    projects.push(project);
    return { spawns, automation: wireBenny(project.config('reproduce'), wiringDeps(slack, fakeGh(), { spawnWorker: async (runId) => void spawns.push(runId) })) };
  };

  test('dispatches when the tracker, the control skill, and a valid feature map all hold', async () => {
    const r = reproduce(bennyProject());
    expect(await r.automation.handle(REPORT)).toMatchObject({ status: 'dispatched' });
    expect(r.spawns).toHaveLength(1);
  });

  test.for([
    ['no feature map file', { featureMap: null }, ['featureMap']],
    ['the unedited example feature map', { featureMap: readFileSync('generated/automations/benny/skills/reproduce-and-fix-issues/references/feature-map.example.md', 'utf8') }, ['featureMap']],
    ['a control skill that is not shipped', { controlSkill: 'control-target-app' }, ['controlAdapter']],
    ['a control skill name that climbs out of generated/skills', { controlSkill: '../../README' }, ['controlAdapter']],
  ] as const)('blocks with %s', async ([, options, missing]) => {
    const r = reproduce(bennyProject(options));
    expect(await r.automation.handle(REPORT)).toMatchObject({ status: 'blocked', missing });
    expect(r.spawns).toHaveLength(0);
  });
});
