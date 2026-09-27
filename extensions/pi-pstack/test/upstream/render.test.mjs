import { expect, test } from 'bun:test';
import { renderJson, renderPretty, renderStatusTable } from '../watch-pr/render.ts';
import { classifyPr, readSnapshot } from '../watch-pr/policy.ts';
import { fakeReader, failedCheck, pendingCheck } from '../watch-pr/fakes.test-helper.ts';

const context = { owner: 'owner', repo: 'repo', number: 1 };
const second = { ...context, number: 2 };
const stamp = { schemaVersion: 1, sequence: 1, observedAt: '2026-09-26T00:00:00Z', mode: 'single' };
const event = (kind, details) => ({ ...stamp, kind, ...details });
const snapshot = options => readSnapshot({ reader: fakeReader(options), context, pendingHistory: 'include', allowDraft: false });

test('JSON output preserves the machine event and its trailing newline', () => {
  expect(renderJson(event('QUEUE', { terminal: false, queue: [context] }))).toBe(
    '{"schemaVersion":1,"sequence":1,"observedAt":"2026-09-26T00:00:00Z","mode":"single","kind":"QUEUE","terminal":false,"queue":[{"owner":"owner","repo":"repo","number":1}]}\n',
  );
});

test('status rows distinguish pending history, review automation, failures, and closed PRs', async () => {
  const oldPass = { commitRollups: [{ oid: 'old', state: 'SUCCESS' }] };
  const thread = { id: 'T1', firstComment: null, isBugbot: false, bugbotReviewPasses: 0 };
  const cases = [
    [{}, '✅ | ✅ | ✅'],
    [{ fastPath: { kind: 'checks', checks: [pendingCheck()] }, ...oldPass }, '⏳ 1 pending, was ✅ | ✅ | ✅'],
    [{ fastPath: { kind: 'checks', checks: [failedCheck(), pendingCheck()] }, ...oldPass }, '❌ 1 failed, 1 pending, was ✅ | ✅ | ✅'],
    [{ fastPath: { kind: 'checks', checks: [failedCheck()] } }, '❌ 1 failed | ✅ | ✅'],
    [{ facts: { mergeStateStatus: 'BLOCKED' }, commitRollups: [{ oid: 'head', state: 'FAILURE' }] }, '❌ GitHub reports failing checks | ✅ | ✅'],
    [{ fastPath: { kind: 'checks', checks: [pendingCheck('bugbot')] } }, '⏳ 1 pending | 🤖 running | ✅'],
    [{ fastPath: { kind: 'checks', checks: [pendingCheck('security review')] }, threads: [thread] }, '⏳ 1 pending | 🤖 running, 1 open | ✅'],
    [{ threads: [thread] }, '✅ | 📝 1 open | ✅'],
    [{ facts: { isDraft: true } }, '✅ | ✅ | ⏸ draft'],
    [{ facts: { reviewDecision: 'CHANGES_REQUESTED' } }, '✅ | ✅ | ⚠️ changes requested'],
    [{ facts: { mergeable: 'CONFLICTING' } }, '✅ | ✅ | ⚠️ conflict'],
    [{ facts: { mergeStateStatus: 'DIRTY' } }, '✅ | ✅ | ⚠️ conflict'],
    [{ facts: { state: 'MERGED' } }, '— | — | ✅ merged'],
    [{ facts: { state: 'CLOSED' } }, '— | — | ❌ closed'],
  ];
  for (const [options, expected] of cases) {
    const rows = [await snapshot(options)];
    const table = '| PR | CI | Review | Merge |\n| --- | --- | --- | --- |\n'
      + `| [#1](https://github.com/owner/repo/pull/1) | ${expected} |\n`;
    expect(renderStatusTable(rows)).toBe(table);
    expect(renderPretty(event('STATUS', { rows }))).toBe(table);
  }
});

test('queue progress and timeouts preserve singular and plural CLI messages', () => {
  const cases = [
    ['QUEUE', { queue: [context] }, 'QUEUE: captured 1 PR bottom-to-top: #1\n'],
    ['QUEUE', { queue: [context, second] }, 'QUEUE: captured 2 PRs bottom-to-top: #1,#2\n'],
    ['WAITING', { frontier: context, reason: { kind: 'pending-checks', pending: [pendingCheck()] } }, 'WAITING: frontier=#1; 1 check pending\n'],
    ['WAITING', { frontier: second, reason: { kind: 'pending-checks', pending: [pendingCheck(), pendingCheck('build')] } }, 'WAITING: frontier=#2; 2 checks pending\n'],
    ['WAITING', { frontier: context, reason: { kind: 'merge-queue', unmergedCount: 1 } }, 'WAITING: frontier=#1 is blocker-free; waiting for merge queue (1 PR unmerged)\n'],
    ['WAITING', { frontier: context, reason: { kind: 'merge-queue', unmergedCount: 2 } }, 'WAITING: frontier=#1 is blocker-free; waiting for merge queue (2 PRs unmerged)\n'],
    ['ADVANCE', { merged: context, frontier: second, remaining: 1 }, 'ADVANCE: merged #1; next=#2; remaining=1\n'],
    ['RETRY', { retryInSeconds: 60, failure: { detail: 'rate limited' } }, 'RETRY: GitHub status query failed; retrying in 60s\ndetail=rate limited\n'],
    ['COMPLETE', { queue: [context] }, 'COMPLETE: queued stack merged (1 PR)\n'],
    ['COMPLETE', { queue: [context, second] }, 'COMPLETE: queued stack merged (2 PRs)\n'],
    ['TIMEOUT', { reason: { kind: 'pending-checks' } }, 'TIMEOUT: checks still pending\n'],
    ['TIMEOUT', { reason: { kind: 'status-unavailable' } }, 'TIMEOUT: GitHub status remained unavailable\n'],
    ['TIMEOUT', { reason: { kind: 'queued-stack', frontier: context, unmergedCount: 1 } }, 'TIMEOUT: queued stack still has 1 PR unmerged; frontier=#1\n'],
    ['TIMEOUT', { reason: { kind: 'queued-stack', frontier: second, unmergedCount: 2 } }, 'TIMEOUT: queued stack still has 2 PRs unmerged; frontier=#2\n'],
  ];
  for (const [kind, details, expected] of cases) expect(renderPretty(event(kind, details))).toBe(expected);
});

test('readiness states distinguish allowed drafts from merged and stack scopes', async () => {
  const ready = classifyPr(await snapshot({})).pr;
  const prefix = 'READY: no merge conflicts, no unresolved review threads, no failing or pending checks';
  expect(renderPretty(event('READY', { scope: { kind: 'single', pr: ready } }))).toBe(
    `${prefix}\nmergeStateStatus=CLEAN\nreviewDecision=APPROVED\nisDraft=false\n`,
  );
  const draft = { ...ready, proof: { ...ready.proof, gate: { ...ready.proof.gate, draft: 'draft-allowed' } } };
  expect(renderPretty(event('READY', { scope: { kind: 'single', pr: draft } }))).toBe(
    `${prefix}\nmergeStateStatus=CLEAN\nreviewDecision=APPROVED\nisDraft=true\nnote=draft allowed (--allow-draft); leave draft — do not mark ready\n`,
  );
  expect(renderPretty(event('READY', { scope: { kind: 'stack', prs: [ready] } }))).toBe(`${prefix}\n`);
  expect(renderPretty(event('READY', { scope: { kind: 'single', pr: { kind: 'merged-pr', context } } }))).toBe(`${prefix}\n`);
});

test('blocker messages preserve actionable failure details and gate reasons', async () => {
  const failed = { ...failedCheck('unit'), description: 'one failed', link: 'https://ci.example/1' };
  const cases = [
    [{ facts: { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' } }, 'BLOCKER: merge-conflicts\npr=1\nmergeable=CONFLICTING\nmergeStateStatus=DIRTY\naction=resolve merge conflicts before waiting for CI\n'],
    [{ fastPath: { kind: 'checks', checks: [failed] } }, 'BLOCKER: failing-checks\npr=1\nfailed=1\nunit FAILURE one failed https://ci.example/1\n'],
    [{ facts: { mergeStateStatus: 'BLOCKED' }, commitRollups: [{ oid: 'head', state: 'ERROR' }] }, 'BLOCKER: failing-checks\npr=1\nfailed=0\nmergeStateStatus=BLOCKED\nheadRollupState=ERROR\n'],
    [{ facts: { state: 'CLOSED' } }, 'BLOCKER: closed-without-merge\npr=1\naction=restore or remove the closed PR from the queued stack\n'],
    [{ facts: { isDraft: true } }, 'BLOCKER: draft-pr\npr=1\naction=mark the PR ready for review before waiting for the merge queue\n'],
    [{ facts: { reviewDecision: 'CHANGES_REQUESTED' } }, 'BLOCKER: changes-requested\npr=1\naction=resolve the changes-requested review before waiting for the merge queue\n'],
  ];
  for (const [options, expected] of cases) {
    const decision = classifyPr(await snapshot(options));
    expect(renderPretty(event('BLOCKER', { blocker: decision.blocker }))).toBe(expected);
  }
  expect(renderPretty(event('BLOCKER', { blocker: { kind: 'status-query', failures: 5, failure: { detail: 'unavailable' } } }))).toBe(
    'BLOCKER: status-query\nfailures=5\ndetail=unavailable\naction=verify current PR context, GitHub authentication, and API availability, then rearm\n',
  );
});

test('review thread output limits body text and marks missing metadata explicitly', () => {
  const threads = [
    { id: 'T1', firstComment: null, isBugbot: false, bugbotReviewPasses: 0 },
    { id: 'T2', firstComment: { path: 'src/a.ts', line: 0, authorLogin: 'reviewer', body: 'first line\r\nhidden line' }, isBugbot: true, bugbotReviewPasses: 2 },
    { id: 'T3', firstComment: { path: null, line: null, authorLogin: null, body: 'a'.repeat(181) }, isBugbot: false, bugbotReviewPasses: 1 },
  ];
  expect(renderPretty(event('BLOCKER', { blocker: { kind: 'review-threads', pr: context, threads } }))).toBe(
    'BLOCKER: review-threads\npr=1\nunresolved=3\nT1 None None None isBugBot=false bugbotReviewPasses=0 \n'
    + 'T2 src/a.ts 0 reviewer isBugBot=true bugbotReviewPasses=2 first line\n'
    + `T3 None None None isBugBot=false bugbotReviewPasses=1 ${'a'.repeat(180)}\n`,
  );
});
