import { copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import type { Automation } from '../../adapters/automation-events.ts';
import type { RunId } from '../../src/automation/model.ts';
import { completeSettledRuns } from '../../src/automation/settle.ts';
import { readLog } from '../../src/automation/store.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import { beginTurn, type BennyProject, bennyProject, fakeGh, fakeSlack, OPS_CHANNEL, REPORT, ROOT_TS, settleWorker, TRIAGE_USER, wiringDeps, writeProof } from './benny-fakes.ts';

const projects: BennyProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project.dir, { recursive: true, force: true });
});

const WINDOW_MINUTES = 10;
const REPRODUCED = JSON.stringify({ text: 'Reproduced twice on Safari 17.1.', status: 'Reproduced', operations: 'The worker says: reproduced twice.' });
const FIX_URL = 'https://github.com/acme/app/pull/9';

function repro() {
  const project = bennyProject({ operationsChannel: OPS_CHANNEL });
  projects.push(project);
  const slack = fakeSlack();
  slack.messages.push({ ts: '1762900001.999999', user: TRIAGE_USER, text: 'A bug.\n[benny:bug]' });
  const spawns: { runId: RunId; assignmentPath: string }[] = [];
  const steers: { runId: RunId; text: string }[] = [];
  let clock = Date.parse('2026-11-12T08:00:00Z');
  const build = (): Automation =>
    wireBenny(project.config('reproduce'), wiringDeps(slack, fakeGh(), { spawnWorker: async (runId, assignmentPath) => void spawns.push({ runId, assignmentPath }), now: () => new Date(clock), steer: async (_root, runId, text) => { steers.push({ runId, text }); beginTurn(project.dir, runId); }, abort: async () => 'stopped', slackUpload: { sleep: async () => undefined } }));
  return { project, slack, spawns, steers, build, automation: build(), later: (minutes: number) => void (clock += minutes * 60_000), now: () => new Date(clock) };
}
type Repro = ReturnType<typeof repro>;

async function dispatch(t: Repro): Promise<RunId> {
  const run = await t.automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
  return run.runId;
}
async function report(t: Repro, runId: RunId, finalText = REPRODUCED) {
  settleWorker(t.project.dir, runId, { phase: 'idle', finalText });
  expect(await completeSettledRuns(t.automation)).toBe(1);
}
const folder = (t: Repro, runId: RunId) => join(t.project.dir, 'artifacts', runId);
const root = (t: Repro) => t.slack.ops.filter((message) => message.thread_ts === undefined);
const status = (t: Repro) => root(t)[0]?.text.split('\n')[0];
const opsReplies = (t: Repro) => t.slack.ops.filter((message) => message.thread_ts !== undefined).map((message) => message.text);
const outcome = (t: Repro) => readLog(t.automation.store).find((entry) => entry.kind === 'repro-outcome');
const settleWindow = async (t: Repro) => {
  t.later(WINDOW_MINUTES + 1);
  await t.automation.advanceRepro();
};
const record = (t: Repro, runId: RunId, body: unknown) => writeFileSync(join(folder(t, runId), 'repro.json'), JSON.stringify(body));
const run = (at: Date, artifact: string, state = 'the Export button does nothing') => ({ at: at.toISOString(), artifact, state });

describe('a repro is accepted only with its proof', () => {
  test('two timestamped reproductions, each with its own capture, are accepted: the source reply posts, the window is held, and the fix goes ahead when it closes', async () => {
    const t = repro();
    const runId = await dispatch(t);
    writeProof(t.project.dir, runId, t.now());
    await report(t, runId);
    expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: 'Reproduced twice on Safari 17.1.' }]);
    expect(status(t)).toBe('✅ Reproduced');
    expect(outcome(t)).toMatchObject({ status: 'Reproduced' });
    await settleWindow(t);
    expect(t.steers).toHaveLength(1);
    expect(t.steers[0]?.text).toContain('Start the fix phase now');
  });

  test('with no record the worker\'s Reproduced is recorded as Could not reproduce: nothing in the source thread, the reason in the operations thread, and no fix', async () => {
    const t = repro();
    const runId = await dispatch(t);
    await report(t, runId);
    expect(t.slack.posts).toEqual([]);
    expect(status(t)).toBe('⚪ Could not reproduce');
    expect(opsReplies(t)).toEqual([expect.stringContaining('there is no proof record (repro.json)')]);
    expect(opsReplies(t)[0]).not.toContain('The worker says');
    expect(outcome(t)).toMatchObject({ status: 'Could not reproduce', unverified: expect.stringContaining('no proof record') });
    await settleWindow(t);
    expect(t.steers).toEqual([]);
    expect(readLog(t.automation.store).some((entry) => entry.kind === 'repro-window')).toBe(false);
  });

  test('a restart after the downgrade finds the same outcome and posts nothing more', async () => {
    const t = repro();
    const runId = await dispatch(t);
    await report(t, runId);
    const restarted = t.build();
    await restarted.reconcile();
    expect(await completeSettledRuns(restarted)).toBe(0);
    expect(t.slack.posts).toEqual([]);
    expect(opsReplies(t)).toHaveLength(1);
  });

  test('the text and evidence of an unproven repro are never posted or uploaded', async () => {
    const t = repro();
    const runId = await dispatch(t);
    mkdirSync(folder(t, runId), { recursive: true });
    writeFileSync(join(folder(t, runId), 'broken.png'), Buffer.from([1, 2, 3]));
    await report(t, runId, JSON.stringify({ text: 'Reproduced twice.', status: 'Reproduced', operations: 'ok', evidence: ['broken.png'] }));
    expect(t.slack.posts).toEqual([]);
    expect(t.slack.uploadCalls).toEqual([]);
  });

  test.for([
    ['one reproduction only', (t: Repro, runId: RunId) => writeProof(t.project.dir, runId, t.now(), { runs: 1 }), /1 of 2 required observations are usable/],
    ['the same capture twice', (t: Repro, runId: RunId) => {
      writeProof(t.project.dir, runId, t.now(), { runs: 1 });
      copyFileSync(join(folder(t, runId), 'repro-1.png'), join(folder(t, runId), 'copy.png'));
      utimesSync(join(folder(t, runId), 'copy.png'), t.now(), t.now());
      record(t, runId, { reproductions: [run(t.now(), 'repro-1.png'), run(new Date(t.now().getTime() + 1000), 'copy.png')] });
    }, /1 of 2 required observations are usable/],
    ['two observations with one timestamp', (t: Repro, runId: RunId) => {
      writeProof(t.project.dir, runId, t.now());
      record(t, runId, { reproductions: [run(t.now(), 'repro-1.png'), run(t.now(), 'repro-2.png')] });
    }, /1 of 2 required observations are usable/],
    ['a timestamp before the case started', (t: Repro, runId: RunId) => {
      writeProof(t.project.dir, runId, t.now());
      record(t, runId, { reproductions: [run(new Date(t.now().getTime() - 3_600_000), 'repro-1.png'), run(t.now(), 'repro-2.png')] });
    }, /before the work it proves started/],
    ['a timestamp in the future', (t: Repro, runId: RunId) => {
      writeProof(t.project.dir, runId, t.now());
      record(t, runId, { reproductions: [run(t.now(), 'repro-1.png'), run(new Date(t.now().getTime() + 3_600_000), 'repro-2.png')] });
    }, /in the future/],
    ['a timestamp that is not a time', (t: Repro, runId: RunId) => {
      writeProof(t.project.dir, runId, t.now());
      record(t, runId, { reproductions: [run(t.now(), 'repro-1.png'), { at: 'yesterday', artifact: 'repro-2.png', state: 'broken' }] });
    }, /no usable timestamp/],
    ['an observation with no state', (t: Repro, runId: RunId) => {
      writeProof(t.project.dir, runId, t.now());
      record(t, runId, { reproductions: [run(t.now(), 'repro-1.png'), run(new Date(t.now().getTime() + 1000), 'repro-2.png', ' ')] });
    }, /names no observed state/],
    ['a capture that is missing', (t: Repro, runId: RunId) => {
      writeProof(t.project.dir, runId, t.now());
      rmSync(join(folder(t, runId), 'repro-2.png'));
    }, /artifact does not exist/],
    ['a capture that is not a screenshot, a recording or a note', (t: Repro, runId: RunId) => {
      writeProof(t.project.dir, runId, t.now());
      record(t, runId, { reproductions: [run(t.now(), 'repro-1.png'), run(new Date(t.now().getTime() + 1000), 'repro-2.sh')] });
    }, /no screenshot, recording or note artifact/],
    ['a capture reached through a link out of the folder', (t: Repro, runId: RunId) => {
      writeProof(t.project.dir, runId, t.now());
      writeFileSync(join(t.project.dir, 'elsewhere.png'), 'not from this run');
      rmSync(join(folder(t, runId), 'repro-2.png'));
      symlinkSync(join(t.project.dir, 'elsewhere.png'), join(folder(t, runId), 'repro-2.png'));
    }, /artifact is not inside the run's artifact directory/],
    ['a capture written before the case started', (t: Repro, runId: RunId) => {
      writeProof(t.project.dir, runId, t.now());
      const old = new Date(t.now().getTime() - 3_600_000);
      utimesSync(join(folder(t, runId), 'repro-2.png'), old, old);
    }, /artifact was not written during this case/],
    ['a record that is not JSON', (t: Repro, runId: RunId) => {
      mkdirSync(folder(t, runId), { recursive: true });
      writeFileSync(join(folder(t, runId), 'repro.json'), 'twice, honest');
    }, /is not valid JSON/],
    ['a record with no reproductions', (t: Repro, runId: RunId) => {
      mkdirSync(folder(t, runId), { recursive: true });
      record(t, runId, { notes: 'it was broken' });
    }, /lists no reproductions/],
  ] as const)('%s is not accepted', async ([, prepare, reason]) => {
    const t = repro();
    const runId = await dispatch(t);
    prepare(t, runId);
    await report(t, runId);
    expect(t.slack.posts).toEqual([]);
    expect(outcome(t)).toMatchObject({ status: 'Could not reproduce', unverified: expect.stringMatching(reason) });
    await settleWindow(t);
    expect(t.steers).toEqual([]);
  });

  test.for(['Could not reproduce', 'Blocked', 'Reproducing'])('%s claims nothing the parent could refute, so it needs no record', async (reported) => {
    const t = repro();
    const runId = await dispatch(t);
    await report(t, runId, JSON.stringify({ text: '', status: reported, operations: 'Tried twice.' }));
    expect(outcome(t)).toMatchObject({ status: reported });
    expect(outcome(t)).not.toHaveProperty('unverified');
    expect(opsReplies(t)).toEqual(['Tried twice.']);
  });

  test('the brief tells the worker where the record goes and what the parent will check', async () => {
    const t = repro();
    const runId = await dispatch(t);
    const brief = readFileSync(join(dirname(t.spawns[0]?.assignmentPath ?? ''), 'brief.md'), 'utf8');
    expect(brief).toContain('## Proof record');
    expect(brief).toContain(join(folder(t, runId), 'repro.json'));
    expect(brief).toContain('"reproductions"');
    expect(brief).toContain('Never reuse or copy a capture');
    expect(brief).toContain('"existingFix"');
  });
});

describe('a later turn that still says Reproduced owes new proof', () => {
  const reviewed = async (t: Repro, runId: RunId, withProof: boolean) => {
    writeProof(t.project.dir, runId, t.now());
    await report(t, runId);
    t.slack.messages.push({ ts: '1762900050.000000', user: 'U2', text: 'You used the wrong account.' });
    t.later(2);
    await t.automation.advanceRepro();
    expect(t.steers).toHaveLength(1);
    if (withProof) writeProof(t.project.dir, runId, t.now(), { tag: 'corrected' });
    settleWorker(t.project.dir, runId, { phase: 'idle', finalText: JSON.stringify({ decision: 'continue', corrected: true, status: 'Reproduced', operations: 'Corrected, still reproduces.' }) });
    await t.automation.advanceRepro();
    await t.automation.advanceRepro();
  };

  test('a corrected repro with fresh proof keeps the window, and the fix goes ahead when it closes', async () => {
    const t = repro();
    await reviewed(t, await dispatch(t), true);
    expect(status(t)).toBe('✅ Reproduced');
    await settleWindow(t);
    expect(t.steers).toHaveLength(2);
    expect(t.steers[1]?.text).toContain('Start the fix phase now');
  });

  test('a corrected repro with only the old observations is recorded as Could not reproduce and no fix follows', async () => {
    const t = repro();
    await reviewed(t, await dispatch(t), false);
    expect(status(t)).toBe('⚪ Could not reproduce');
    expect(opsReplies(t).join('\n')).toContain('could not verify the evidence behind the reported Reproduced');
    await settleWindow(t);
    expect(t.steers).toHaveLength(1);
    expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'repro-closed', reason: expect.stringContaining('no longer holds') }));
  });

  test('a rerun that confirms the repro without new proof posts no source reply', async () => {
    const t = repro();
    const runId = await dispatch(t);
    await report(t, runId, JSON.stringify({ text: '', status: 'Could not reproduce', operations: 'Tried twice.' }));
    t.slack.ops.push({ ts: '1762900200.000000', user: 'U2', text: 'Wrong account, retry as admin.', thread_ts: root(t)[0]?.ts ?? '' });
    await t.automation.advanceFollowUps();
    settleWorker(t.project.dir, t.spawns[1]?.runId as RunId, { phase: 'idle', finalText: JSON.stringify({ text: 'Rerunning.', rerun: { correction: 'Use admin.' } }) });
    await t.automation.advanceFollowUps();
    expect(t.steers).toHaveLength(1);
    settleWorker(t.project.dir, runId, { phase: 'idle', finalText: JSON.stringify({ status: 'Reproduced', text: 'Reproduced with admin.', operations: 'It reproduces.' }) });
    await t.automation.advanceRepro();
    await t.automation.advanceRepro();
    expect(t.slack.posts).toEqual([]);
    expect(status(t)).toBe('⚪ Could not reproduce');
  });
});

describe('an existing fix is verified, not competed with', () => {
  const verified = (t: Repro, runId: RunId, outcome: string, tweak: (fix: Record<string, any>) => void = () => undefined) => {
    writeProof(t.project.dir, runId, t.now(), { section: 'baseline', tag: 'base' });
    writeProof(t.project.dir, runId, new Date(t.now().getTime() + 5000), { section: 'patched', tag: 'patched' });
    const file = join(folder(t, runId), 'repro.json');
    const body = JSON.parse(readFileSync(file, 'utf8'));
    body.existingFix = { ...body.existingFix, url: FIX_URL, outcome };
    tweak(body.existingFix);
    writeFileSync(file, JSON.stringify(body));
  };
  const CONFIRMED = JSON.stringify({ text: 'Verified: the open pull request fixes it. Before: broken twice. After: fine twice.', status: 'Verifying existing fix', operations: 'Verified the existing fix.' });

  test('a complete record is accepted: the one source reply posts, no window is held and no fix of the worker\'s own starts', async () => {
    const t = repro();
    const runId = await dispatch(t);
    verified(t, runId, 'confirmed');
    await report(t, runId, CONFIRMED);
    expect(t.slack.posts).toEqual([{ thread_ts: ROOT_TS, text: 'Verified: the open pull request fixes it. Before: broken twice. After: fine twice.' }]);
    expect(outcome(t)).toMatchObject({ status: 'Verifying existing fix', existingFix: true });
    await settleWindow(t);
    expect(t.steers).toEqual([]);
  });

  test('an insufficient fix is reported as Reproduced and still starts no fix of the worker\'s own', async () => {
    const t = repro();
    const runId = await dispatch(t);
    verified(t, runId, 'insufficient');
    await report(t, runId);
    expect(status(t)).toBe('✅ Reproduced');
    expect(outcome(t)).toMatchObject({ status: 'Reproduced', existingFix: true });
    await settleWindow(t);
    expect(t.steers).toEqual([]);
  });

  test.for([
    ['no existingFix section', (t: Repro, runId: RunId) => writeProof(t.project.dir, runId, t.now()), /no existingFix section/],
    ['a link that is not a github.com pull request or commit', (t: Repro, runId: RunId) => verified(t, runId, 'confirmed', (fix) => void (fix['url'] = 'https://example.com/pull/9')), /not a github\.com pull request or commit link/],
    ['a thread claim in place of a link', (t: Repro, runId: RunId) => verified(t, runId, 'confirmed', (fix) => void (fix['url'] = 'Dana said it is fixed')), /not a github\.com pull request or commit link/],
    ['an outcome that is not confirmed', (t: Repro, runId: RunId) => verified(t, runId, 'inconclusive'), /existingFix\.outcome is "inconclusive"/],
    ['a baseline measured once', (t: Repro, runId: RunId) => verified(t, runId, 'confirmed', (fix) => void (fix['baseline'] = fix['baseline'].slice(0, 1))), /baseline runs: 1 of 2/],
    ['no patched runs', (t: Repro, runId: RunId) => verified(t, runId, 'confirmed', (fix) => void delete fix['patched']), /lists no patched runs/],
    ['patched runs measured before the baseline', (t: Repro, runId: RunId) => verified(t, runId, 'confirmed', (fix) => void (fix['patched'] = fix['patched'].map((entry: { at: string }) => ({ ...entry, at: new Date(t.now().getTime() - 1000).toISOString() })))), /before the work it proves started|patched runs/],
  ] as const)('Verifying existing fix with %s is recorded as Blocked, with nothing in the source thread', async ([, prepare, reason]) => {
    const t = repro();
    const runId = await dispatch(t);
    prepare(t, runId);
    await report(t, runId, CONFIRMED);
    expect(t.slack.posts).toEqual([]);
    expect(outcome(t)).toMatchObject({ status: 'Blocked', unverified: expect.stringMatching(reason) });
    expect(status(t)).toBe('⛔ Blocked');
  });
});
