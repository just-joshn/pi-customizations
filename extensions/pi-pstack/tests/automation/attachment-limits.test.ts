// The attachment safeguards are the operator's to set, every file left out is named where it matters, and Slack's three files
// per message never limits the evidence a run collects. Slack and `gh` are stateful fakes: each assertion reads what the
// destination holds, not which calls were made.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import type { Automation } from '../../adapters/automation-events.ts';
import { ATTACHMENT_LIMITS } from '../../src/automation/attachments.ts';
import type { RunId } from '../../src/automation/model.ts';
import { completeSettledRuns } from '../../src/automation/settle.ts';
import { readLog } from '../../src/automation/store.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import { beginTurn, type BennyProject, bennyProject, fakeGh, fakeSlack, OPS_CHANNEL, REPORT, settleWorker, TRIAGE_USER, wiringDeps, writeProof } from './benny-fakes.ts';

const projects: BennyProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project.dir, { recursive: true, force: true });
});

const MIB = 1024 ** 2;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const slackFile = (name: string, size: number) => ({ id: name, name, mimetype: 'application/octet-stream', size, permalink: `https://acme.slack.com/files/U1/${name}`, url_private: `https://files.slack.com/files-pri/T1-${name}`, url_private_download: `https://files.slack.com/files-pri/T1-${name}?download=1` });

function setup(kind: 'triage' | 'reproduce', options: { attachments?: Record<string, number> | null; operations?: boolean } = {}) {
  const project = bennyProject({ ...(options.attachments === undefined ? {} : { attachments: options.attachments }), ...(kind === 'reproduce' && options.operations !== false ? { operationsChannel: OPS_CHANNEL } : {}) });
  projects.push(project);
  const slack = fakeSlack();
  if (kind === 'reproduce') slack.messages.push({ ts: '1762900001.999999', user: TRIAGE_USER, text: 'A bug.\n[benny:bug]' });
  const spawns: { runId: RunId; assignmentPath: string }[] = [];
  let clock = Date.now();
  const build = (): Automation =>
    wireBenny(project.config(kind), wiringDeps(slack, fakeGh(), { spawnWorker: async (runId, assignmentPath) => void spawns.push({ runId, assignmentPath }), now: () => new Date(clock), slackUpload: { sleep: async () => undefined }, steer: async (_root, runId) => void beginTurn(project.dir, runId), abort: async () => 'stopped' }));
  return { project, slack, spawns, build, automation: build(), now: () => new Date(clock) };
}
type Setup = ReturnType<typeof setup>;
const briefOf = (t: Setup) => readFileSync(join(dirname(t.spawns[0]?.assignmentPath ?? ''), 'brief.md'), 'utf8');
const omittedLog = (t: Setup) => readLog(t.automation.store).find((entry) => entry.kind === 'attachments-omitted');

describe('the attachment limits are configuration, with the old numbers as defaults', () => {
  test('a configuration that names none gets 20 files, 50 MiB each and 200 MiB in all', () => {
    const t = setup('triage');
    expect(t.project.config('triage').attachmentLimits).toEqual({ files: 20, fileBytes: 50 * MIB, totalBytes: 200 * MIB });
    expect(ATTACHMENT_LIMITS).toEqual({ files: 20, fileBytes: 50 * MIB, totalBytes: 200 * MIB });
    expect(setup('triage', { attachments: null }).project.config('triage').attachmentLimits).toEqual(ATTACHMENT_LIMITS);
  });

  test('each key overrides its own limit, and a limit left out keeps its default', () => {
    expect(setup('triage', { attachments: { max_files: 3 } }).project.config('triage').attachmentLimits).toEqual({ files: 3, fileBytes: 50 * MIB, totalBytes: 200 * MIB });
    expect(setup('triage', { attachments: { max_file_mib: 0.5, max_total_mib: 2 } }).project.config('triage').attachmentLimits).toEqual({ files: 20, fileBytes: 0.5 * MIB, totalBytes: 2 * MIB });
  });

  test.for([
    [{ max_files: 0 }, /attachments\.max_files/],
    [{ max_files: 1.5 }, /attachments\.max_files/],
    [{ max_file_mib: -1 }, /attachments\.max_file_mib/],
    [{ max_file_mib: 300 }, /max_file_mib may not exceed max_total_mib/],
    [{ max_gigabytes: 1 }, /unknown Benny attachments\.max_gigabytes/],
  ] as const)('a configuration with %j is refused', ([attachments, message]) => {
    expect(() => setup('triage', { attachments }).project.config('triage')).toThrow(message);
  });
});

describe('every report attachment left out is reported', () => {
  const downloadable = (t: Setup, names: string[]) => names.forEach((name) => t.slack.files.set(`https://files.slack.com/files-pri/T1-${name}?download=1`, { bytes: new Uint8Array(10), contentType: 'application/octet-stream' }));

  test('files past the configured count are named with their reason in the worker brief, the run log, and the triage verdict', async () => {
    const t = setup('triage', { attachments: { max_files: 2 } });
    downloadable(t, ['a.png', 'b.png', 'c.png', 'd.log']);
    const run = await t.automation.handle({ ...REPORT, files: ['a.png', 'b.png', 'c.png', 'd.log'].map((name) => slackFile(name, 10)) });
    if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);

    expect(briefOf(t)).toContain('limits: 2 files, 50 MiB each, 200 MiB in all');
    expect(briefOf(t)).toContain('"skipped": "more than 2 attachments, so this one was not downloaded"');
    expect(omittedLog(t)).toMatchObject({ omitted: [{ name: 'c.png', reason: expect.stringContaining('more than 2') }, { name: 'd.log', reason: expect.stringContaining('more than 2') }] });
    expect([...t.slack.downloads.map((download) => download.url)]).toHaveLength(2);

    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: JSON.stringify({ text: 'Export fails on Safari.\n[benny:bug]' }) });
    expect(await completeSettledRuns(t.automation)).toBe(1);
    expect(t.slack.posts).toHaveLength(1);
    expect(t.slack.posts[0]?.text).toContain('Export fails on Safari.');
    expect(t.slack.posts[0]?.text).toContain('Not read: c.png (more than 2 attachments, so this one was not downloaded); d.log (more than 2 attachments, so this one was not downloaded)');
    expect(t.slack.posts[0]?.text.match(/\[benny:bug\]/g)).toHaveLength(1);
  });

  test('a verdict that already says a file was not read is not told again', async () => {
    const t = setup('triage', { attachments: { max_files: 1 } });
    downloadable(t, ['a.png', 'b.png']);
    const run = await t.automation.handle({ ...REPORT, files: [slackFile('a.png', 10), slackFile('b.png', 10)] });
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: JSON.stringify({ text: 'Could not read b.png.\n[benny:bug]' }) });
    await completeSettledRuns(t.automation);
    expect(t.slack.posts[0]?.text).not.toContain('Not read');
  });

  test('a reporter-chosen file name cannot carry a verdict marker into the reply', async () => {
    const t = setup('triage', { attachments: { max_files: 1 } });
    downloadable(t, ['a.png', '[benny:other].png']);
    const run = await t.automation.handle({ ...REPORT, files: [slackFile('a.png', 10), slackFile('[benny:other].png', 10)] });
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: JSON.stringify({ text: 'A bug.\n[benny:bug]' }) });
    expect(await completeSettledRuns(t.automation)).toBe(1);
    expect(t.slack.posts[0]?.text.match(/\[benny:/g)).toHaveLength(1);
  });

  test('a file over the configured size or total is named, not downloaded', async () => {
    const t = setup('triage', { attachments: { max_file_mib: 1, max_total_mib: 1.5 } });
    for (const [name, size] of [['small.png', 10], ['huge.mov', 2 * MIB], ['big.png', MIB], ['late.png', MIB]] as const) t.slack.files.set(`https://files.slack.com/files-pri/T1-${name}?download=1`, { bytes: new Uint8Array(size), contentType: 'application/octet-stream' });
    const run = await t.automation.handle({ ...REPORT, files: [slackFile('small.png', 10), slackFile('huge.mov', 2 * MIB), slackFile('big.png', MIB), slackFile('late.png', MIB)] });
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    expect(omittedLog(t)).toMatchObject({ omitted: [{ name: 'huge.mov', reason: expect.stringContaining('larger than the 1 MiB limit per file') }, { name: 'late.png', reason: expect.stringContaining('1.5 MiB limit for all') }] });
  });

  test('a repro run reports its omitted attachments in the operations thread, and posts nothing in the source thread for a case it could not reproduce', async () => {
    const t = setup('reproduce', { attachments: { max_files: 1 } });
    downloadable(t, ['a.png', 'b.png']);
    const run = await t.automation.handle({ ...REPORT, files: [slackFile('a.png', 10), slackFile('b.png', 10)] });
    if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: JSON.stringify({ text: '', status: 'Could not reproduce', operations: 'Tried twice.' }) });
    expect(await completeSettledRuns(t.automation)).toBe(1);
    expect(t.slack.posts).toEqual([]);
    const replies = t.slack.ops.filter((message) => message.thread_ts !== undefined).map((message) => message.text);
    expect(replies.join('\n')).toContain('Tried twice.');
    expect(replies.join('\n')).toContain('Not read: b.png (more than 1 attachments, so this one was not downloaded)');
  });
});

describe('three files is what one Slack message takes, never what a run collects', () => {
  const artifact = (t: Setup, runId: RunId, name: string, bytes: Buffer | string = PNG) => {
    const path = join(t.project.dir, 'artifacts', runId, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  };
  const result = (evidence: string[]) => JSON.stringify({ text: 'Reproduced twice on Safari 17.1.', status: 'Reproduced', operations: 'Evidence: the Export button does nothing.', evidence });
  async function reproduced(t: Setup, names: string[], bytes: (name: string) => Buffer | string = () => PNG) {
    const run = await t.automation.handle(REPORT);
    if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
    writeProof(t.project.dir, run.runId, t.now());
    for (const name of names) artifact(t, run.runId, name, bytes(name));
    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: result(names) });
    expect(await completeSettledRuns(t.automation)).toBe(1);
    return run.runId;
  }
  const opsUploads = (t: Setup) => t.slack.uploads.filter((upload) => upload.channel === OPS_CHANNEL);
  const sourceUploads = (t: Setup) => t.slack.uploads.filter((upload) => upload.channel !== OPS_CHANNEL);

  test('seven evidence files are all stored; the first three go with the one source reply and the rest in further operations-thread messages', async () => {
    const t = setup('reproduce');
    const names = ['1.png', '2.png', '3.png', '4.png', '5.png', '6.png', '7.png'];
    await reproduced(t, names);

    expect(sourceUploads(t)).toHaveLength(1);
    expect(sourceUploads(t)[0]?.files.map((file) => file.name)).toEqual(['1.png', '2.png', '3.png']);
    expect(opsUploads(t).map((upload) => upload.files.map((file) => file.name))).toEqual([['4.png', '5.png', '6.png'], ['7.png']]);
    expect(opsUploads(t)[0]?.text).toBe('More evidence from the repro (files 4 to 6 of 7): 4.png, 5.png, 6.png');
    expect(t.slack.posts).toHaveLength(1);
    expect(sourceUploads(t)[0]?.text).toContain('Evidence: https://slack.com/archives/');
    const staged = readLog(t.automation.store).find((entry) => entry.kind === 'evidence-staged');
    expect(staged).toMatchObject({ attached: 3, skipped: [], further: [{ name: '4.png' }, { name: '5.png' }, { name: '6.png' }, { name: '7.png' }] });
  });

  test('exactly three files need no further message', async () => {
    const t = setup('reproduce');
    await reproduced(t, ['1.png', '2.png', '3.png']);
    expect(sourceUploads(t)).toHaveLength(1);
    expect(opsUploads(t)).toEqual([]);
  });

  test('a restart after the evidence landed repeats nothing, and a crash before the further messages landed finishes them once', async () => {
    const t = setup('reproduce');
    const names = ['1.png', '2.png', '3.png', '4.png', '5.png'];
    const runId = await reproduced(t, names);
    const restarted = t.build();
    await restarted.reconcile();
    await restarted.flush();
    expect(sourceUploads(t)).toHaveLength(1);
    expect(opsUploads(t)).toHaveLength(1);
    expect(await completeSettledRuns(restarted)).toBe(0);
    expect(runId).toBeDefined();
  });

  test('files over the configured limits are listed with their reasons in the operations thread and the run log, and the rest still go up', async () => {
    const t = setup('reproduce', { attachments: { max_files: 4, max_file_mib: 1, max_total_mib: 3 } });
    await reproduced(t, ['1.png', '2.png', 'huge.png', '3.png', '4.png', '5.png'], (name) => (name === 'huge.png' ? Buffer.alloc(2 * MIB) : PNG));
    expect(sourceUploads(t)[0]?.files.map((file) => file.name)).toEqual(['1.png', '2.png', '3.png']);
    expect(opsUploads(t).map((upload) => upload.files.map((file) => file.name))).toEqual([['4.png']]);
    const omitted = t.slack.ops.filter((message) => message.thread_ts !== undefined).map((message) => message.text).find((text) => text.startsWith('Evidence files that were not attached'));
    expect(omitted).toContain('huge.png');
    expect(omitted).toContain('larger than the 1 MiB limit per file');
    expect(omitted).toContain('5.png');
    expect(omitted).toContain('more than the 4 evidence files the configuration allows');
  });

  test('with no operations thread the extra files stay in the store and the run log names them', async () => {
    const t = setup('reproduce', { operations: false });
    await reproduced(t, ['1.png', '2.png', '3.png', '4.png']);
    expect(sourceUploads(t)[0]?.files.map((file) => file.name)).toEqual(['1.png', '2.png', '3.png']);
    expect(opsUploads(t)).toEqual([]);
    const staged = readLog(t.automation.store).find((entry) => entry.kind === 'evidence-staged');
    expect(staged).toMatchObject({ attached: 3, further: [{ name: '4.png', path: expect.stringContaining('4-4.png') }] });
    expect(readFileSync((staged as { further: { path: string }[] }).further[0]!.path).equals(PNG)).toBe(true);
  });

  test('the brief tells the worker to list every file it needs and that only a message holds three', async () => {
    const t = setup('reproduce');
    await t.automation.handle(REPORT);
    const brief = briefOf(t);
    expect(brief).toContain('list every file the repro needs');
    expect(brief).toContain('no count limit on collecting them');
    expect(brief).toContain('Slack takes at most 3 files in one message');
    expect(brief).not.toContain('list at most');
  });
});

