import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import type { Automation } from '../../adapters/automation-events.ts';
import { fixPrompt } from '../../src/automation/repro-turns.ts';
import type { RunId } from '../../src/automation/model.ts';
import { completeSettledRuns } from '../../src/automation/settle.ts';
import { readLog } from '../../src/automation/store.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import { beginTurn, type BennyProject, bennyProject, fakeGh, fakeSlack, gitProject, OPS_CHANNEL, REPORT, settleWorker, TRIAGE_USER, wiringDeps, writeProof } from './benny-fakes.ts';

const projects: BennyProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project.dir, { recursive: true, force: true });
});

const WINDOW_MINUTES = 10;
const REPRODUCED = JSON.stringify({ text: 'Reproduced twice on Safari 17.1.', status: 'Reproduced', operations: 'Evidence: the Export button does nothing, twice.' });
const PR = { title: 'Fix the Export button on Safari', body: 'Repro steps, root cause, test result, before and after evidence, blast radius.' };
const FIXED = JSON.stringify({ status: 'Attempting bounded fix', pullRequest: PR, operations: 'Fixed.' });

function repro(options: { repositoryUrl?: string; aborts?: boolean } = {}) {
  const project = bennyProject({ operationsChannel: OPS_CHANNEL });
  projects.push(project);
  const git = gitProject(project.dir);
  const slack = fakeSlack();
  slack.messages.push({ ts: '1762900001.999999', user: TRIAGE_USER, text: 'A bug.\n[benny:bug]' });
  const gh = fakeGh();
  const steers: { runId: RunId; text: string }[] = [];
  const aborts: RunId[] = [];
  let clock = Date.parse('2026-11-12T08:00:00Z');
  const config = { ...project.config('reproduce'), ...(options.repositoryUrl === undefined ? {} : { repositoryUrl: options.repositoryUrl }) };
  const build = (): Automation =>
    wireBenny(config, wiringDeps(slack, gh, { inputCommit: () => git.commit, spawnWorker: async () => undefined, now: () => new Date(clock), steer: async (_root, runId, text) => { steers.push({ runId, text }); beginTurn(project.dir, runId); }, abort: async (_root, runId) => { aborts.push(runId); return 'stopped'; } }));
  return { project, git, slack, gh, steers, aborts, build, automation: build(), later: (minutes: number) => void (clock += minutes * 60_000), now: () => new Date(clock) };
}
type Repro = ReturnType<typeof repro>;

/** A case whose worker has reported a proven repro and whose worktree exists. */
async function reported(t: Repro): Promise<RunId> {
  const run = await t.automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
  t.git.startWorker(run.runId);
  writeProof(t.project.dir, run.runId, t.now());
  settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: REPRODUCED });
  expect(await completeSettledRuns(t.automation)).toBe(1);
  return run.runId;
}
/** The window closes and the worker is sent the go-ahead. */
async function goAhead(t: Repro, runId: RunId) {
  t.later(WINDOW_MINUTES + 1);
  await t.automation.advanceRepro();
  expect(t.steers.filter((steer) => steer.text.includes('Start the fix phase now'))).toHaveLength(1);
  return runId;
}
/** The worker commits, records the patched proof, and ends its fix turn. */
async function fixed(t: Repro, runId: RunId, finalText = FIXED, options: { commit?: boolean; proof?: boolean } = {}) {
  if (options.commit !== false) t.git.commitIn(runId, 'fix.txt', 'the fix');
  if (options.proof !== false) writeProof(t.project.dir, runId, t.now(), { section: 'fix.patched', tag: 'patched' });
  settleWorker(t.project.dir, runId, { phase: 'idle', finalText });
  await t.automation.advanceRepro();
  await t.automation.advanceRepro();
}
const root = (t: Repro) => t.slack.ops.filter((message) => message.thread_ts === undefined);
const status = (t: Repro) => root(t)[0]?.text.split('\n')[0];
const opsReplies = (t: Repro) => t.slack.ops.filter((message) => message.thread_ts !== undefined).map((message) => message.text);
const sourceReplies = (t: Repro) => t.slack.posts.map((post) => post.text);
const created = (t: Repro) => t.gh.calls.filter((call) => call[0] === 'pr' && call[1] === 'create');

describe('the parent opens the pull request, and only as a draft', () => {
  test('the worker\'s fix becomes a draft pull request the parent pushed and opened: pushed branch, --draft, the worker\'s title and body, the link on the operations thread', async () => {
    const t = repro();
    const runId = await goAhead(t, await reported(t));
    await fixed(t, runId);

    expect(t.git.remoteBranches()).toEqual([`pstack-run/${runId}/owner`]);
    expect(created(t)).toHaveLength(1);
    expect(created(t)[0]).toContain('--draft');
    expect(t.gh.pulls).toEqual([expect.objectContaining({ head: `pstack-run/${runId}/owner`, base: 'main', title: PR.title, draft: true, state: 'OPEN' })]);
    expect(t.gh.pulls[0]?.body).toContain(PR.body);
    expect(t.gh.pulls[0]?.body).toMatch(/<!-- pstack-action:act-[0-9a-f]{16} -->$/);
    expect(status(t)).toBe('🔗 Draft pull request opened');
    expect(opsReplies(t)).toContain('Draft pull request: https://github.com/example-org/example-repo/pull/1');
    expect(sourceReplies(t)).toEqual(['Reproduced twice on Safari 17.1.']);
    expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'repro-closed', reason: 'the fix phase finished' }));
  });

  test('the fix prompt tells the worker to commit and describe the pull request, not to push or open one', () => {
    const prompt = fixPrompt(90);
    expect(prompt).toContain('Do not push it and do not open a pull request');
    expect(prompt).toContain('"pullRequest"');
    expect(prompt).toContain('"fix": { "patched"');
  });

  test('a worker that claims it opened a pull request is not believed: with no commit there is nothing to open and the fix did not land', async () => {
    const t = repro();
    const runId = await goAhead(t, await reported(t));
    await fixed(t, runId, JSON.stringify({ status: 'Draft pull request opened', operations: 'Draft pull request: https://github.com/example-org/example-repo/pull/7' }), { commit: false });
    expect(status(t)).toBe('❌ Fix did not land');
    expect(opsReplies(t).join('\n')).toContain('the worker made no commit on its run branch');
    expect(created(t)).toHaveLength(0);
    expect(t.git.remoteBranches()).toEqual([]);
  });

  test.for([
    ['no proof of the patched build', { proof: false }, /there is no proof that the patched build was run twice/],
  ] as const)('a fix with %s does not land: nothing is pushed or opened', async ([, options, reason]) => {
    const t = repro();
    const runId = await goAhead(t, await reported(t));
    await fixed(t, runId, FIXED, options);
    expect(status(t)).toBe('❌ Fix did not land');
    expect(opsReplies(t).join('\n')).toMatch(reason);
    expect(created(t)).toHaveLength(0);
    expect(t.git.remoteBranches()).toEqual([]);
  });

  test('a fix whose worker described no pull request does not land', async () => {
    const t = repro();
    const runId = await goAhead(t, await reported(t));
    await fixed(t, runId, JSON.stringify({ status: 'Attempting bounded fix', operations: 'Fixed.' }));
    expect(status(t)).toBe('❌ Fix did not land');
    expect(opsReplies(t).join('\n')).toContain('the worker described no pull request');
    expect(created(t)).toHaveLength(0);
  });

  test('a worker that reports Fix did not land is passed through, and nothing is pushed even if it committed', async () => {
    const t = repro();
    const runId = await goAhead(t, await reported(t));
    await fixed(t, runId, JSON.stringify({ status: 'Fix did not land', operations: 'The change grew past the budget.' }));
    expect(status(t)).toBe('❌ Fix did not land');
    expect(created(t)).toHaveLength(0);
    expect(t.git.remoteBranches()).toEqual([]);
  });

  test('a repository that is not on github.com cannot receive a pull request, and the fix did not land', async () => {
    const t = repro({ repositoryUrl: 'https://gitlab.example.com/acme/app' });
    const runId = await goAhead(t, await reported(t));
    await fixed(t, runId);
    expect(status(t)).toBe('❌ Fix did not land');
    expect(opsReplies(t).join('\n')).toContain('repository.url is not a github.com repository');
    expect(t.git.remoteBranches()).toEqual([]);
  });

  test('a worktree whose origin is another repository is never pushed to: after the attempt limit the fix did not land', async () => {
    const t = repro();
    const runId = await goAhead(t, await reported(t));
    t.git.git(t.project.dir, 'remote', 'set-url', 'origin', 'https://github.com/someone-else/other.git');
    await fixed(t, runId);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      t.later(2);
      await t.automation.advanceRepro();
    }
    expect(status(t)).toBe('❌ Fix did not land');
    expect(opsReplies(t).join('\n')).toContain('the worktree\'s origin is not example-org/example-repo');
    expect(t.git.remoteBranches()).toEqual([]);
    expect(created(t)).toHaveLength(0);
  });

  test('a crash after the pull request was opened and before the turn was recorded adopts it: one pull request, one push', async () => {
    const t = repro();
    const runId = await goAhead(t, await reported(t));
    // The read that confirms `gh pr create` fails (the third list of the attempt), as an outage between the write and its confirmation would.
    let lists = 0;
    t.gh.failures.push({ when: (args) => args[1] === 'list' && ++lists === 3, remaining: 1 });
    await fixed(t, runId);
    expect(status(t)).toBe('✅ Reproduced');
    expect(created(t)).toHaveLength(1);

    t.later(2);
    await t.automation.advanceRepro();
    expect(created(t)).toHaveLength(1);
    expect(t.gh.pulls).toHaveLength(1);
    expect(status(t)).toBe('🔗 Draft pull request opened');
    const restarted = t.build();
    await restarted.reconcile();
    await restarted.advanceRepro();
    expect(created(t)).toHaveLength(1);
  });

  test('a worker that already opened a ready-for-review pull request itself has it adopted and converted to a draft, and the operations thread says so', async () => {
    const t = repro();
    const runId = await goAhead(t, await reported(t));
    t.git.commitIn(runId, 'fix.txt', 'the fix');
    t.gh.pulls.push({ number: 1, head: `pstack-run/${runId}/owner`, base: 'main', title: 'mine', body: 'by the worker', draft: false, state: 'OPEN', comments: [] });
    await fixed(t, runId, JSON.stringify({ status: 'Draft pull request opened', operations: 'opened' }), { commit: false });
    expect(created(t)).toHaveLength(0);
    expect(t.gh.pulls[0]?.draft).toBe(true);
    expect(opsReplies(t).join('\n')).toContain('already opened it as ready for review, so the parent converted it to a draft');
    expect(status(t)).toBe('🔗 Draft pull request opened');
  });

  test('every pull request that exists after a run is a draft', async () => {
    const t = repro();
    const runId = await goAhead(t, await reported(t));
    await fixed(t, runId);
    expect(t.gh.pulls.filter((pull) => pull.state === 'OPEN').every((pull) => pull.draft)).toBe(true);
  });
});

describe('a worker that goes around the parent still leaves no ready pull request', () => {
  const sweepAfter = async (t: Repro, minutes = 2) => {
    t.later(minutes);
    await t.automation.advanceRepro();
  };

  test('a ready pull request the worker opens during its fix turn is made a draft on the next look, once, with one notice', async () => {
    const t = repro();
    const runId = await goAhead(t, await reported(t));
    t.git.commitIn(runId, 'fix.txt', 'the fix');
    t.gh.pulls.push({ number: 1, head: `pstack-run/${runId}/owner`, base: 'main', title: 'mine', body: '', draft: false, state: 'OPEN', comments: [] });
    await sweepAfter(t);
    expect(t.gh.pulls[0]?.draft).toBe(true);
    expect(opsReplies(t).filter((reply) => reply.includes('converted it to a draft'))).toHaveLength(1);
    await sweepAfter(t);
    await sweepAfter(t);
    expect(opsReplies(t).filter((reply) => reply.includes('converted it to a draft'))).toHaveLength(1);
    expect(readLog(t.automation.store).filter((entry) => entry.kind === 'draft-guard')).toHaveLength(1);
  });

  test('the forge is read at most once a minute for a run, however often the settler looks', async () => {
    const t = repro();
    const runId = await goAhead(t, await reported(t));
    t.git.commitIn(runId, 'fix.txt', 'the fix');
    t.gh.calls.length = 0;
    t.later(2);
    for (let pass = 0; pass < 6; pass += 1) await t.automation.advanceRepro();
    expect(t.gh.calls.filter((call) => call[1] === 'list')).toHaveLength(1);
  });

  test('the last look before the worker is shut down converts a pull request opened since the previous one', async () => {
    const t = repro();
    const runId = await goAhead(t, await reported(t));
    await fixed(t, runId);
    t.gh.pulls[0]!.draft = false;
    t.later(46);
    await t.automation.retireWorkers();
    expect(t.gh.pulls[0]?.draft).toBe(true);
    expect(t.aborts).toContain(runId);
  });
});

describe('a fix started before the go-ahead is stopped', () => {
  const expectStopped = async (t: Repro, runId: RunId) => {
    expect(t.aborts).toEqual([runId]);
    expect(readLog(t.automation.store).filter((entry) => entry.kind === 'unprompted-fix')).toHaveLength(1);
    expect(opsReplies(t).filter((reply) => reply.includes('started the fix before the go-ahead'))).toHaveLength(1);
    t.later(WINDOW_MINUTES * 3);
    await t.automation.advanceRepro();
    expect(t.steers).toEqual([]);
    expect(created(t)).toHaveLength(0);
    expect(sourceReplies(t)).toEqual(['Reproduced twice on Safari 17.1.']);
    expect(status(t)).toBe('✅ Reproduced');
  };

  test('a commit on the run branch inside the rejection window stops the worker, keeps the repro report, and sends no fix', async () => {
    const t = repro();
    const runId = await reported(t);
    t.git.commitIn(runId, 'fix.txt', 'too early');
    t.later(2);
    await t.automation.advanceRepro();
    expect(opsReplies(t).join('\n')).toContain('1 commit on its run branch');
    expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'repro-closed', reason: expect.stringContaining('started the fix before the go-ahead') }));
    await expectStopped(t, runId);
  });

  test('a commit made on another branch of the worktree is found in the worktree\'s own reflog', async () => {
    const t = repro();
    const runId = await reported(t);
    t.git.git(t.git.worktree(runId), 'switch', '--quiet', '-c', 'my-fix');
    t.git.commitIn(runId, 'fix.txt', 'elsewhere');
    await t.automation.advanceRepro();
    expect(opsReplies(t).join('\n')).toContain('1 commit in its worktree');
    await expectStopped(t, runId);
  });

  test('a run branch pushed with no local commit is found on the remote at the next forge read', async () => {
    const t = repro();
    const runId = await reported(t);
    t.git.git(t.project.dir, 'push', 'origin', `${t.git.commit}:refs/heads/pstack-run/${runId}/owner`);
    await t.automation.advanceRepro();
    expect(t.aborts).toEqual([runId]);
    expect(opsReplies(t).join('\n')).toContain('a pushed run branch');
    expect(opsReplies(t).join('\n')).toContain('Its branch was left in place');
    expect(t.git.remoteBranches()).toEqual([`pstack-run/${runId}/owner`]);
  });

  test('a pull request the worker opened early is made a draft, closed with a comment, and its branch is left in place', async () => {
    const t = repro();
    const runId = await reported(t);
    t.git.commitIn(runId, 'fix.txt', 'too early');
    t.git.git(t.git.worktree(runId), 'push', 'origin', `refs/heads/pstack-run/${runId}/owner:refs/heads/pstack-run/${runId}/owner`);
    t.gh.pulls.push({ number: 1, head: `pstack-run/${runId}/owner`, base: 'main', title: 'early', body: '', draft: false, state: 'OPEN', comments: [] });
    await t.automation.advanceRepro();
    expect(t.gh.pulls[0]).toMatchObject({ draft: true, state: 'CLOSED' });
    expect(t.gh.pulls[0]?.comments[0]).toContain('before the rejection window closed');
    expect(t.git.remoteBranches()).toEqual([`pstack-run/${runId}/owner`]);
    expect(opsReplies(t).join('\n')).toContain('The pull request was closed.');
  });

  test('a restart after the stop repeats nothing', async () => {
    const t = repro();
    const runId = await reported(t);
    t.git.commitIn(runId, 'fix.txt', 'too early');
    await t.automation.advanceRepro();
    const restarted = t.build();
    await restarted.reconcile();
    await restarted.advanceRepro();
    await restarted.advanceRepro();
    await expectStopped(t, runId);
  });

  test('an operations thread that cannot take the notice yet holds the record, and the stop completes on a later pass with one notice', async () => {
    const t = repro();
    const runId = await reported(t);
    t.git.commitIn(runId, 'fix.txt', 'too early');
    t.slack.state.opsDown = true;
    await t.automation.advanceRepro();
    expect(readLog(t.automation.store).filter((entry) => entry.kind === 'unprompted-fix')).toEqual([]);
    t.slack.state.opsDown = false;
    t.later(1);
    await t.automation.advanceRepro();
    await t.automation.advanceRepro();
    expect(opsReplies(t).filter((reply) => reply.includes('started the fix before the go-ahead'))).toHaveLength(1);
    expect(readLog(t.automation.store).filter((entry) => entry.kind === 'unprompted-fix')).toHaveLength(1);
  });

  test('uncommitted edits and evidence files are not a fix started', async () => {
    const t = repro();
    const runId = await reported(t);
    writeFileSync(join(t.git.worktree(runId), 'scratch.txt'), 'trying things');
    writeFileSync(join(t.git.worktree(runId), 'README.md'), 'edited, not committed');
    t.later(3);
    await t.automation.advanceRepro();
    expect(t.aborts).toEqual([]);
    expect(readLog(t.automation.store).some((entry) => entry.kind === 'unprompted-fix')).toBe(false);
  });

  test('commits after the go-ahead are the fix, not an early one', async () => {
    const t = repro();
    const runId = await goAhead(t, await reported(t));
    t.git.commitIn(runId, 'fix.txt', 'the fix');
    t.later(2);
    await t.automation.advanceRepro();
    expect(t.aborts).toEqual([]);
    expect(readLog(t.automation.store).some((entry) => entry.kind === 'unprompted-fix')).toBe(false);
  });

  test('a worker that commits before it has even reported is stopped, and the case then completes as a failure', async () => {
    const t = repro();
    const run = await t.automation.handle(REPORT);
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    t.git.startWorker(run.runId);
    t.git.commitIn(run.runId, 'fix.txt', 'before any report');
    await t.automation.advanceRepro();
    expect(t.aborts).toEqual([run.runId]);
    expect(readLog(t.automation.store)).toContainEqual(expect.objectContaining({ kind: 'unprompted-fix', runId: run.runId }));
  });

  test('a competing commit while verifying an existing fix is stopped too', async () => {
    const t = repro();
    const run = await t.automation.handle(REPORT);
    if (run.status !== 'dispatched') throw new Error('not dispatched');
    t.git.startWorker(run.runId);
    writeProof(t.project.dir, run.runId, t.now(), { section: 'baseline', tag: 'base' });
    writeProof(t.project.dir, run.runId, new Date(t.now().getTime() + 5000), { section: 'patched', tag: 'patched' });
    const file = join(t.project.dir, 'artifacts', run.runId, 'repro.json');
    const body = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...body, existingFix: { ...body.existingFix, url: 'https://github.com/acme/app/pull/9', outcome: 'confirmed' } }));
    settleWorker(t.project.dir, run.runId, { phase: 'idle', finalText: JSON.stringify({ text: 'Verified.', status: 'Verifying existing fix', operations: 'ok' }) });
    await completeSettledRuns(t.automation);
    t.git.commitIn(run.runId, 'competing.txt', 'a competing patch');
    await t.automation.advanceRepro();
    expect(t.aborts).toEqual([run.runId]);
  });
});
