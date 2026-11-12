import { mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import type { Automation } from '../../adapters/automation-events.ts';
import type { RunId } from '../../src/automation/model.ts';
import { stageEvidence } from '../../src/automation/evidence-files.ts';
import { OUTBOX_RETRY_LIMIT } from '../../src/automation/outbox.ts';
import { completeSettledRuns } from '../../src/automation/settle.ts';
import { outboxEntries, readLog } from '../../src/automation/store.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import { beginTurn, type BennyProject, bennyProject, fakeGh, fakeSlack, OPS_CHANNEL, REPORT, ROOT_TS, settleWorker, TRIAGE_USER, wiringDeps, writeProof } from './benny-fakes.ts';

const projects: BennyProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project.dir, { recursive: true, force: true });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const MP4 = Buffer.from('not really a recording but bytes all the same');

function repro(options: { operationsChannel?: string | null } = {}) {
  const project = bennyProject(options.operationsChannel === null ? {} : { operationsChannel: options.operationsChannel ?? OPS_CHANNEL });
  projects.push(project);
  const slack = fakeSlack();
  slack.messages.push({ ts: '1762900001.999999', user: TRIAGE_USER, text: 'A bug.\n[benny:bug]' });
  const spawns: { runId: RunId; assignmentPath: string }[] = [];
  let clock = Date.now();
  const build = (): Automation =>
    wireBenny(project.config('reproduce'), wiringDeps(slack, fakeGh(), { spawnWorker: async (runId, assignmentPath) => void spawns.push({ runId, assignmentPath }), now: () => new Date(clock), slackUpload: { sleep: async () => undefined }, steer: async (_root, runId) => void beginTurn(project.dir, runId), abort: async () => 'stopped' }));
  const t = { project, slack, spawns, build, automation: build(), later: (minutes: number) => void (clock += minutes * 60_000), now: () => new Date(clock) };
  return t;
}
type Repro = ReturnType<typeof repro>;

const artifactsOf = (t: Repro, runId: RunId) => join(t.project.dir, 'artifacts', runId);
function artifact(t: Repro, runId: RunId, name: string, bytes: Buffer | string) {
  const path = join(artifactsOf(t, runId), name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}
async function dispatch(t: Repro): Promise<RunId> {
  const run = await t.automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
  writeProof(t.project.dir, run.runId, t.now());
  return run.runId;
}
const result = (evidence: unknown) => JSON.stringify({ text: 'Reproduced twice on Safari 17.1.', status: 'Reproduced', operations: 'Evidence: the Export button does nothing.', evidence });
async function settle(t: Repro, runId: RunId, evidence: unknown) {
  settleWorker(t.project.dir, runId, { phase: 'idle', finalText: result(evidence) });
  expect(await completeSettledRuns(t.automation)).toBe(1);
}
const opsLink = (t: Repro) => `https://slack.com/archives/${OPS_CHANNEL}/p${(t.slack.ops.find((message) => message.thread_ts === undefined)?.ts ?? '').replace('.', '')}`;
const staged = (t: Repro) => readLog(t.automation.store).find((entry) => entry.kind === 'evidence-staged');

describe('the allowed evidence goes up with the one source reply', () => {
  test('a screenshot, a recording and a note are uploaded with the parent credential as one reply in the source thread', async () => {
    const t = repro();
    const runId = await dispatch(t);
    artifact(t, runId, 'broken.png', PNG);
    artifact(t, runId, 'path.mp4', MP4);
    artifact(t, runId, 'steps.md', '1. Click Export.\n2. Nothing happens.\n');
    await settle(t, runId, ['broken.png', 'path.mp4', 'steps.md']);

    expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: 'Reproduced twice on Safari 17.1.' }]);
    expect(t.slack.uploads).toHaveLength(1);
    const [reply] = t.slack.uploads;
    expect(reply?.files.map((file) => file.name)).toEqual(['broken.png', 'path.mp4', 'steps.md']);
    expect(reply?.files[0]?.bytes.equals(PNG)).toBe(true);
    expect(reply?.files[1]?.bytes.equals(MP4)).toBe(true);
    expect(reply?.files[0]?.title).toMatch(/^broken\.png \(pstack-action:act-[0-9a-f]{16}\)$/);
    expect(t.slack.uploadCalls[0]).toBe(`getUploadURLExternal:broken.png:${PNG.length}`);
    expect(staged(t)).toMatchObject({ attached: 3, skipped: [] });
    expect(t.slack.messages.filter((message) => message.files !== undefined)).toHaveLength(1);
  });

  test('the Slack credential goes to the Slack API and never to the upload host, and the worker never holds it', async () => {
    const t = repro();
    const runId = await dispatch(t);
    artifact(t, runId, 'broken.png', PNG);
    await settle(t, runId, ['broken.png']);
    expect(t.slack.uploadState.credentialsSeenByUploadHost).toEqual([null]);
    const workerFiles = [join(dirname(t.spawns[0]?.assignmentPath ?? ''), 'brief.md'), t.spawns[0]?.assignmentPath ?? ''];
    for (const file of workerFiles) expect(readFileSync(file, 'utf8')).not.toContain('xoxb-test');
  });

  test('the brief names the run\'s own artifact directory and the evidence field, and says what the parent does with it', async () => {
    const t = repro();
    const runId = await dispatch(t);
    const brief = readFileSync(join(dirname(t.spawns[0]?.assignmentPath ?? ''), 'brief.md'), 'utf8');
    expect(brief).toContain('## Evidence files');
    expect(brief).toContain(artifactsOf(t, runId));
    expect(brief).toContain('`evidence` array');
    expect(brief).toContain('which you never hold');
  });

  test('a crash after the upload landed but before it was acknowledged finds the reply by its marker and uploads nothing again', async () => {
    const t = repro();
    const runId = await dispatch(t);
    artifact(t, runId, 'broken.png', PNG);
    t.slack.dropAck.add('files.completeUploadExternal');
    settleWorker(t.project.dir, runId, { phase: 'idle', finalText: result(['broken.png']) });
    await completeSettledRuns(t.automation);
    expect(t.slack.uploads).toHaveLength(1);

    t.later(1);
    const restarted = t.build();
    await restarted.reconcile();
    await completeSettledRuns(restarted);
    expect(t.slack.uploads).toHaveLength(1);
    expect(t.slack.posts).toHaveLength(1);
    expect(outboxEntries(t.automation.store).find((entry) => entry.action.kind === 'thread-reply' && entry.action.channel !== OPS_CHANNEL)).toMatchObject({ state: 'done', reconciled: true });
  });

  test('a message Slack has not shown yet is waited for, not uploaded a second time', async () => {
    const t = repro();
    const runId = await dispatch(t);
    artifact(t, runId, 'broken.png', PNG);
    t.slack.uploadState.hideReads = 3;
    await settle(t, runId, ['broken.png']);
    expect(t.slack.uploads).toHaveLength(1);
    expect(t.slack.posts).toHaveLength(1);
    const restarted = t.build();
    await restarted.reconcile();
    expect(t.slack.uploads).toHaveLength(1);
  });

  test('a restart after everything landed uploads nothing', async () => {
    const t = repro();
    const runId = await dispatch(t);
    artifact(t, runId, 'broken.png', PNG);
    await settle(t, runId, ['broken.png']);
    const restarted = t.build();
    await restarted.reconcile();
    expect(await completeSettledRuns(restarted)).toBe(0);
    expect(t.slack.uploads).toHaveLength(1);
  });
});

describe('what upstream does not allow is not attached', () => {
  test('a file outside the run\'s directory, behind a link, outside the allowed types, past the retention window or missing is skipped with its reason, the fourth good file goes in the operations thread, and the reply links the operations thread', async () => {
    const t = repro();
    const runId = await dispatch(t);
    artifact(t, runId, 'broken.png', PNG);
    writeFileSync(join(t.project.dir, 'secret.txt'), 'token=abc');
    symlinkSync(join(t.project.dir, 'secret.txt'), join(artifactsOf(t, runId), 'looks-fine.txt'));
    artifact(t, runId, 'session.log', 'logs may hold secrets');
    const old = artifact(t, runId, 'old.png', PNG);
    utimesSync(old, new Date(Date.now() - 25 * 3_600_000), new Date(Date.now() - 25 * 3_600_000));
    for (const name of ['a.png', 'b.png', 'c.png']) artifact(t, runId, name, PNG);
    await settle(t, runId, ['broken.png', join(t.project.dir, 'secret.txt'), '../../secret.txt', 'looks-fine.txt', 'session.log', 'old.png', 'missing.png', 'a.png', 'b.png', 'c.png']);

    expect(t.slack.uploads.map((upload) => [upload.channel, upload.files.map((file) => file.name)])).toEqual([['CSOURCE01', ['broken.png', 'a.png', 'b.png']], [OPS_CHANNEL, ['c.png']]]);
    const entry = staged(t);
    expect(entry).toMatchObject({ attached: 3, further: [{ name: 'c.png' }] });
    const reasons = Object.fromEntries((entry?.kind === 'evidence-staged' ? entry.skipped : []).map((skip) => [skip.requested.split('/').at(-1), skip.reason]));
    expect(reasons['secret.txt']).toMatch(/is not inside the run's artifact directory/);
    expect(reasons['looks-fine.txt']).toMatch(/is not inside the run's artifact directory/);
    expect(reasons['session.log']).toMatch(/is not a screenshot, a recording or a note/);
    expect(reasons['old.png']).toMatch(/older than the 24-hour retention window/);
    expect(reasons['missing.png']).toBe('does not exist');
    expect(reasons['c.png']).toBeUndefined();
    expect(t.slack.uploads[0]?.text).toBe(`Reproduced twice on Safari 17.1.\nEvidence: ${opsLink(t)}`);
  });

  test('with nothing attachable the reply is text only and links the operations thread, and nothing is uploaded', async () => {
    const t = repro();
    const runId = await dispatch(t);
    await settle(t, runId, ['missing.png']);
    expect(t.slack.uploadCalls).toEqual([]);
    expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: `Reproduced twice on Safari 17.1.\nEvidence: ${opsLink(t)}` }]);
  });

  test('with no operations channel the files that cannot be attached leave the reply as the worker wrote it', async () => {
    const t = repro({ operationsChannel: null });
    const runId = await dispatch(t);
    await settle(t, runId, ['missing.png']);
    expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: 'Reproduced twice on Safari 17.1.' }]);
  });

  test('a result with no evidence field posts exactly the worker\'s reply, as before', async () => {
    const t = repro();
    const runId = await dispatch(t);
    await settle(t, runId, undefined);
    expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: 'Reproduced twice on Safari 17.1.' }]);
    expect(t.slack.uploadCalls).toEqual([]);
  });
});

describe('the reply never fails for want of its files', () => {
  test('a workspace that refuses uploads gets the reply without them, with the operations link, in one message', async () => {
    const t = repro();
    const runId = await dispatch(t);
    artifact(t, runId, 'broken.png', PNG);
    t.slack.uploadState.deny = 'missing_scope';
    await settle(t, runId, ['broken.png']);
    expect(t.slack.uploads).toHaveLength(0);
    expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: `Reproduced twice on Safari 17.1.\nEvidence: ${opsLink(t)}` }]);
  });

  test('an upload that keeps failing for another reason is retried, and the last attempt posts the reply without the files', async () => {
    const t = repro();
    const runId = await dispatch(t);
    artifact(t, runId, 'broken.png', PNG);
    t.slack.uploadState.deny = 'internal_error';
    settleWorker(t.project.dir, runId, { phase: 'idle', finalText: result(['broken.png']) });
    await completeSettledRuns(t.automation);
    expect(t.slack.posts).toEqual([]);
    for (let attempt = 1; attempt < OUTBOX_RETRY_LIMIT; attempt += 1) {
      t.later(10);
      await t.automation.flush();
    }
    expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: `Reproduced twice on Safari 17.1.\nEvidence: ${opsLink(t)}` }]);
    expect(t.slack.uploadCalls.filter((call) => call === 'completeUploadExternal')).toHaveLength(OUTBOX_RETRY_LIMIT - 1);
  });
});

describe('a rerun that confirms the repro', () => {
  test('attaches its evidence to the one source reply it may post', async () => {
    const t = repro();
    const runId = await dispatch(t);
    settleWorker(t.project.dir, runId, { phase: 'idle', finalText: JSON.stringify({ text: '', status: 'Could not reproduce', operations: 'Tried twice.' }) });
    await completeSettledRuns(t.automation);
    const rootTs = t.slack.ops.find((message) => message.thread_ts === undefined)?.ts ?? '';
    t.slack.ops.push({ ts: '1762900200.000000', user: 'U2', text: 'Wrong account, retry as admin.', thread_ts: rootTs });
    await t.automation.advanceFollowUps();
    settleWorker(t.project.dir, t.spawns[1]?.runId as RunId, { phase: 'idle', finalText: JSON.stringify({ text: 'Rerunning.', rerun: { correction: 'Use admin.' } }) });
    await t.automation.advanceFollowUps();
    t.later(1);
    writeProof(t.project.dir, runId, t.now(), { tag: 'rerun' });
    artifact(t, runId, 'admin.png', PNG);
    settleWorker(t.project.dir, runId, { phase: 'idle', finalText: result(['admin.png']) });
    await t.automation.advanceRepro();
    await t.automation.advanceRepro();
    expect(t.slack.uploads).toHaveLength(1);
    expect(t.slack.uploads[0]?.files.map((file) => file.name)).toEqual(['admin.png']);
  });
});

describe('staging', () => {
  test('the parent uploads the bytes it checked: a file the worker changes afterwards does not change the copy', () => {
    const root = join(projects[0]?.dir ?? bennyProject().dir);
    projects.push({ dir: root, config: () => { throw new Error('unused'); } });
    const dir = join(root, 'artifacts', 'run-1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'broken.png'), PNG);
    const options = { requested: ['broken.png'], artifactDirectory: join(root, 'artifacts'), retentionHours: 24, runId: 'run-1', now: new Date(), into: join(root, 'staged') };
    const first = stageEvidence(options);
    writeFileSync(join(dir, 'broken.png'), 'swapped after the check');
    const second = stageEvidence(options);
    expect(readFileSync(first.files[0]?.path ?? '').equals(PNG)).toBe(true);
    expect(second.files).toEqual(first.files);
    expect(readFileSync(second.files[0]?.path ?? '').equals(PNG)).toBe(true);
  });

  test('with no artifact directory or retention in the configuration nothing is attached', () => {
    const result = stageEvidence({ requested: ['broken.png'], artifactDirectory: undefined, retentionHours: undefined, runId: 'run-1', now: new Date(), into: '/nonexistent' });
    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual([expect.objectContaining({ requested: 'broken.png' })]);
  });
});
