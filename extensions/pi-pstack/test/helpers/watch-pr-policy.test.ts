import './leak-preload.ts';
import { expect, test } from 'vitest';
import { type FakeReaderOptions, failedCheck, fakeReader, passingCheck, pendingCheck } from '../../skills/poteto-mode/scripts/watch-pr/fakes.test-helper.ts';
import { WatcherQueryError } from '../../skills/poteto-mode/scripts/watch-pr/github.ts';
import {
  applyQueueSnapshot,
  assessGitHubMerge,
  classifyPr,
  createQueueState,
  evaluateQueue,
  planQueue,
  type QueueState,
  readSnapshot,
  runQueued,
  runSimple,
  selectTierMajorStackDecision,
  type WatchClock,
} from '../../skills/poteto-mode/scripts/watch-pr/policy.ts';
import type { Check, GitHubReader, MergeBlocker, NonEmpty, PollingOptions, PrContext, PrNumber, ProgressVerdict, PrSnapshot, PullRequestFacts, ReviewThread, RollupState } from '../../skills/poteto-mode/scripts/watch-pr/types.ts';
import { parsePrNumber } from '../../skills/poteto-mode/scripts/watch-pr/types.ts';

const at = (n: number): PrContext => ({ owner: 'owner', repo: 'repo', number: parsePrNumber(n) });
const base: PollingOptions = { interval: 10, sweepInterval: 300, timeout: 0, maxQueryErrors: 5, allowDraft: false };
const MERGED = { state: 'MERGED', mergedAt: '2026-07-26T00:00:00Z' } as const;

interface Harness {
  readonly clock: WatchClock;
  readonly sleeps: number[];
  readonly events: ProgressVerdict[];
  readonly emit: (verdict: ProgressVerdict) => void;
  readonly advance: (seconds: number) => void;
}
function harness(): Harness {
  let now = 0;
  const sleeps: number[] = [];
  const events: ProgressVerdict[] = [];
  return {
    sleeps,
    events,
    emit: (verdict) => events.push(verdict),
    advance: (seconds) => {
      now += seconds;
    },
    clock: {
      now: () => now,
      observedAt: () => '2026-07-26T00:00:00.000Z',
      async sleep(seconds) {
        sleeps.push(seconds);
        now += seconds;
      },
    },
  };
}
const deps = (h: Harness, reader: GitHubReader) => ({ reader, clock: h.clock, emit: h.emit });

type PerPr = Record<number, Partial<Omit<PullRequestFacts, 'context'>>[]>;
function scripted(h: Harness, perPr: PerPr, options: FakeReaderOptions = {}, readCost = 0): GitHubReader & { readonly reads: number[] } {
  const reader = fakeReader(options);
  const seen = new Map<number, number>();
  const reads: number[] = [];
  return {
    ...reader,
    reads,
    async pullRequest(context) {
      const sequence = perPr[context.number] ?? [{}];
      const index = seen.get(context.number) ?? 0;
      seen.set(context.number, index + 1);
      reads.push(context.number);
      h.advance(readCost);
      const facts = await reader.pullRequest(context);
      return { ...facts, ...sequence[Math.min(index, sequence.length - 1)] };
    },
  };
}
const snap = async (facts: FakeReaderOptions['facts'] = {}, options: FakeReaderOptions = {}, n = 1, history: 'include' | 'omit' = 'include', allowDraft = false): Promise<PrSnapshot> =>
  readSnapshot({ reader: fakeReader({ ...options, facts }), context: at(n), pendingHistory: history, allowDraft });
const open = async (facts: FakeReaderOptions['facts'] = {}, options: FakeReaderOptions = {}, history: 'include' | 'omit' = 'include', allowDraft = false) => {
  const row = await snap(facts, options, 1, history, allowDraft);
  if (row.kind !== 'open') throw new Error('expected an open snapshot');
  return row;
};
const kinds = (events: ProgressVerdict[]) => events.map((event) => event.kind);
const human = (id: string): ReviewThread => ({ id, firstComment: null, isBugbot: false, bugbotReviewPasses: 0 });
const bot = (id: string): ReviewThread => ({ id, firstComment: null, isBugbot: true, bugbotReviewPasses: 1 });
const queue = (...numbers: number[]) => numbers.map(at) as unknown as NonEmpty<PrContext>;

async function queueState(rows: [number, FakeReaderOptions['facts'], FakeReaderOptions?][], frontier: number | null = null): Promise<QueueState> {
  const snapshots = new Map<PrNumber, PrSnapshot>();
  for (const [n, facts, options] of rows) snapshots.set(parsePrNumber(n), await snap(facts, options ?? {}, n, 'omit'));
  const state = createQueueState(queue(...rows.map(([n]) => n)), 0);
  return { ...state, snapshots, work: null, nextSweepAt: 300, frontier: frontier === null ? null : at(frontier) };
}

test('runQueued emits QUEUE then a sweep STATUS then COMPLETE exit 0 when every PR is merged, with a stamped envelope', async () => {
  const h = harness();
  const verdict = await runQueued({ dependencies: deps(h, fakeReader({ facts: MERGED })), contexts: queue(1, 2), options: base });
  expect(kinds(h.events)).toEqual(['QUEUE', 'STATUS']);
  expect(verdict).toMatchObject({ kind: 'COMPLETE', terminal: true, exitCode: 0, mode: 'queued-stack' });
  expect(verdict.kind === 'COMPLETE' && verdict.merged.map((m) => m.context.number)).toEqual([parsePrNumber(1), parsePrNumber(2)]);
  const stamped = [...h.events, verdict];
  expect(stamped.map((event) => event.sequence)).toEqual([1, 2, 3]);
  for (const event of stamped) expect(event).toMatchObject({ schemaVersion: 1, observedAt: '2026-07-26T00:00:00.000Z' });
});

test('runQueued returns a BLOCKER exit 2 for an upstack conflict found in the first sweep', async () => {
  const h = harness();
  const reader = scripted(h, { 2: [{ mergeable: 'CONFLICTING' }] });
  const verdict = await runQueued({ dependencies: deps(h, reader), contexts: queue(1, 2), options: base });
  expect(verdict).toMatchObject({ kind: 'BLOCKER', exitCode: 2, blocker: { kind: 'merge-conflicts', pr: { number: 2 } } });
});

test('runQueued waits with reason merge-queue for a blocker-free frontier, never emits READY, and ends in TIMEOUT 5', async () => {
  const h = harness();
  const verdict = await runQueued({ dependencies: deps(h, fakeReader()), contexts: queue(1), options: { ...base, timeout: 25 } });
  const waits = h.events.filter((event) => event.kind === 'WAITING');
  expect(waits).toHaveLength(1);
  expect(waits[0]).toMatchObject({ reason: { kind: 'merge-queue', unmergedCount: 1 }, frontier: { number: 1 } });
  expect(kinds(h.events)).not.toContain('READY');
  expect(verdict).toMatchObject({ kind: 'TIMEOUT', exitCode: 5, reason: { kind: 'queued-stack', unmergedCount: 1 } });
});

test('runQueued blocks with merge-gate closed-without-merge exit 6 when the frontier closes, without an ADVANCE', async () => {
  const h = harness();
  const reader = scripted(h, { 1: [{}, { state: 'CLOSED' }] });
  const verdict = await runQueued({ dependencies: deps(h, reader), contexts: queue(1, 2), options: base });
  expect(verdict).toMatchObject({ kind: 'BLOCKER', exitCode: 6, blocker: { kind: 'merge-gate', reason: 'closed-without-merge' } });
  expect(kinds(h.events)).not.toContain('ADVANCE');
});

test('runQueued ends in BLOCKER exit 7 after the query-error budget is exhausted', async () => {
  const h = harness();
  const reader = {
    ...fakeReader(),
    async pullRequest(): Promise<PullRequestFacts> {
      throw new WatcherQueryError({ kind: 'command-exit', retryable: true, code: 1, detail: 'boom' });
    },
  };
  const verdict = await runQueued({ dependencies: deps(h, reader), contexts: queue(1), options: { ...base, maxQueryErrors: 2 } });
  expect(verdict).toMatchObject({ kind: 'BLOCKER', exitCode: 7, blocker: { kind: 'status-query', failures: 2 } });
  expect(kinds(h.events)).toEqual(['QUEUE', 'RETRY']);
});

test('evaluateQueue completes with every merged row when no active rows remain', async () => {
  const state = await queueState([
    [1, MERGED],
    [2, MERGED],
  ]);
  const evaluation = evaluateQueue(state, 0, base);
  expect(evaluation.kind).toBe('complete');
  expect(evaluation.kind === 'complete' && evaluation.merged.map((m) => m.context.number)).toEqual([parsePrNumber(1), parsePrNumber(2)]);
});

test('evaluateQueue returns the tier-major blocker found among the active rows', async () => {
  const state = await queueState([
    [1, {}],
    [2, { mergeable: 'CONFLICTING' }],
  ]);
  expect(evaluateQueue(state, 0, base)).toMatchObject({ kind: 'blocker', blocker: { kind: 'merge-conflicts', pr: { number: 2 } } });
});

test('evaluateQueue times out at exactly the deadline with the frontier and the unmerged count', async () => {
  const state = await queueState([
    [1, {}],
    [2, {}],
  ]);
  expect(evaluateQueue(state, 10, { ...base, timeout: 10 })).toMatchObject({ kind: 'timeout', frontier: { number: 1 }, unmergedCount: 2 });
  expect(evaluateQueue(state, 9, { ...base, timeout: 10 }).kind).toBe('waiting');
});

test('evaluateQueue keys a pending frontier wait by PR and pending count and emits only when the key changes', async () => {
  const one = { fastPath: { kind: 'checks', checks: [pendingCheck('a')] } } as const;
  const state = await queueState([[1, {}, one]]);
  const first = evaluateQueue(state, 0, base);
  expect(first).toMatchObject({ kind: 'waiting', emit: true, reason: { kind: 'pending-checks' } });
  const second = evaluateQueue(first.state, 1, base);
  expect(second).toMatchObject({ kind: 'waiting', emit: false });
  const two = { fastPath: { kind: 'checks', checks: [pendingCheck('a'), pendingCheck('b')] } } as const;
  const changed = await queueState([[1, {}, two]]);
  expect(evaluateQueue({ ...changed, lastWaitKey: second.state.lastWaitKey }, 2, base)).toMatchObject({ kind: 'waiting', emit: true });
});

test('evaluateQueue ignores upstack pending checks and waits on merge-queue for a clean frontier', async () => {
  const pending = { fastPath: { kind: 'checks', checks: [pendingCheck('up')] } } as const;
  const state = await queueState([
    [1, {}],
    [2, {}, pending],
  ]);
  expect(evaluateQueue(state, 0, base)).toMatchObject({ kind: 'waiting', reason: { kind: 'merge-queue', unmergedCount: 2 }, frontier: { number: 1 } });
});

test('planQueue sweeps only the PRs not yet known to be merged', async () => {
  const state = await queueState([
    [1, MERGED],
    [2, {}],
    [3, {}],
  ]);
  const planned = planQueue({ ...state, nextSweepAt: 5 }, 5);
  expect(planned.work).toMatchObject({ kind: 'whole-stack-sweep' });
  expect(planned.work?.kind === 'whole-stack-sweep' && planned.work.remaining.map((c) => c.number)).toEqual([parsePrNumber(2), parsePrNumber(3)]);
});

test('applyQueueSnapshot rejects a snapshot that is not the head of the sweep', async () => {
  const state = createQueueState(queue(1, 2), 0);
  const second = await snap({}, {}, 2, 'omit');
  expect(() => applyQueueSnapshot(state, second, 0, base)).toThrow('snapshot does not match sweep head');
});

const conflictCases: readonly [PullRequestFacts['mergeable'], PullRequestFacts['mergeStateStatus'], boolean][] = [
  ['CONFLICTING', 'CLEAN', true],
  ['MERGEABLE', 'DIRTY', true],
  ['MERGEABLE', 'CONFLICTING', true],
  ['MERGEABLE', 'BEHIND', false],
  ['UNKNOWN', 'UNKNOWN', false],
];
for (const [mergeable, mergeStateStatus, conflict] of conflictCases) {
  test(`classifyPr ${conflict ? 'blocks merge-conflicts' : 'does not treat a conflict'} for mergeable ${mergeable} and mergeStateStatus ${mergeStateStatus}`, async () => {
    const decision = classifyPr(await open({ mergeable, mergeStateStatus }));
    expect(decision.kind === 'blocker' && decision.blocker.kind === 'merge-conflicts').toBe(conflict);
  });
}

test('classifyPr blocks review-threads for a human thread and for a bot thread', async () => {
  for (const threads of [[human('h')], [bot('b')]]) {
    const row = { ...(await open()), threads };
    expect(classifyPr(row)).toMatchObject({ kind: 'blocker', blocker: { kind: 'review-threads' } });
  }
});

test('classifyPr lets threads outrank pending CI so the PR blocks at once without waiting', async () => {
  const row = { ...(await open({}, { fastPath: { kind: 'checks', checks: [pendingCheck()] } })), threads: [human('h')] };
  expect(classifyPr(row)).toMatchObject({ kind: 'blocker', blocker: { kind: 'review-threads' } });
});

const failing: FakeReaderOptions = { fastPath: { kind: 'checks', checks: [failedCheck()] } };
const pending: FakeReaderOptions = { fastPath: { kind: 'checks', checks: [pendingCheck()] } };
const precedence: readonly [string, FakeReaderOptions['facts'], FakeReaderOptions, ReviewThread[], Exclude<ReturnType<typeof classifyPr>['kind'], 'blocker'> | MergeBlocker['kind']][] = [
  ['conflict beats threads', { mergeable: 'CONFLICTING' }, {}, [human('h')], 'merge-conflicts'],
  ['threads beat failing CI', {}, failing, [human('h')], 'review-threads'],
  ['failing CI beats changes-requested', { reviewDecision: 'CHANGES_REQUESTED' }, failing, [], 'failing-checks'],
  ['changes-requested beats pending CI', { reviewDecision: 'CHANGES_REQUESTED' }, pending, [], 'merge-gate'],
  ['a draft does not gate while checks are pending', { isDraft: true }, pending, [], 'waiting'],
];
for (const [label, facts, options, threads, expected] of precedence) {
  test(`classifyPr precedence: ${label}`, async () => {
    const decision = classifyPr({ ...(await open(facts, options)), threads });
    expect(decision.kind === 'blocker' ? decision.blocker.kind : decision.kind).toBe(expected);
  });
}

test('classifyPr treats a draft as a gate unless allowDraft is set and records draft-allowed in the proof', async () => {
  expect(classifyPr(await open({ isDraft: true }))).toMatchObject({ kind: 'blocker', blocker: { kind: 'merge-gate', reason: 'draft-pr' } });
  const allowed = classifyPr(await open({ isDraft: true }, {}, 'include', true), true);
  expect(allowed).toMatchObject({ kind: 'ready', pr: { proof: { gate: { draft: 'draft-allowed' } } } });
});

test('classifyPr treats REVIEW_REQUIRED and a null review decision as a wait, not a gate', async () => {
  for (const reviewDecision of ['REVIEW_REQUIRED', null] as const) expect(classifyPr(await open({ reviewDecision })).kind).toBe('ready');
});

test('readSnapshot reads a non-null mergedAt as merged even when state says OPEN', async () => {
  const reader = fakeReader({ facts: { state: 'OPEN', mergedAt: '2026-07-26T00:00:00Z' } });
  const row = await readSnapshot({ reader, context: at(1), pendingHistory: 'include', allowDraft: false });
  expect(row.kind).toBe('merged');
  expect(reader.calls).toEqual(['pullRequest']);
  expect(classifyPr(row)).toMatchObject({ kind: 'merged', pr: { kind: 'merged-pr' } });
});

const gate: Check = { kind: 'code-review-gate', name: 'Code Review Gate', reportedState: 'PENDING', description: '', link: '', workflow: '' };
test('readSnapshot never treats a pending Code Review Gate as pending CI', async () => {
  const row = await open({}, { fastPath: { kind: 'checks', checks: [gate, passingCheck()] } });
  expect(row.ci.kind).toBe('ci-clean');
  expect(classifyPr(row).kind).toBe('ready');
});

test('readSnapshot classifies a completed failing Code Review Gate as a failed check', async () => {
  const row = await open({}, { fastPath: { kind: 'checks', checks: [failedCheck('Code Review Gate')] } });
  expect(row.ci.kind).toBe('ci-failing');
});

const mergeTable: readonly [PullRequestFacts['mergeStateStatus'], RollupState, 'rollup' | 'merge-state'][] = [
  ['BLOCKED', null, 'rollup'],
  ['BLOCKED', 'EXPECTED', 'rollup'],
  ['BLOCKED', 'SUCCESS', 'rollup'],
  ['BLOCKED', 'PENDING', 'rollup'],
  ['CLEAN', 'FAILURE', 'merge-state'],
  ['UNSTABLE', null, 'merge-state'],
];
for (const [mergeStateStatus, headRollupState, basis] of mergeTable) {
  test(`assessGitHubMerge allows ${mergeStateStatus} with ${headRollupState} on basis ${basis}`, () => {
    expect(assessGitHubMerge({ mergeStateStatus, headRollupState })).toMatchObject({ kind: 'allowed', basis });
  });
}

test('readSnapshot reads a null headRefOid as a null head rollup, which GitHub merge assessment allows', async () => {
  const options = { commitRollups: [{ oid: 'other', state: 'FAILURE' }] } as const;
  const row = await open({ headRefOid: null, mergeStateStatus: 'BLOCKED' }, options);
  expect(row.ci.kind).toBe('ci-clean');
});

test('readSnapshot reports ci-github-rejected for a refusal even while other checks are still pending', async () => {
  const options = { fastPath: { kind: 'checks', checks: [pendingCheck()] }, commitRollups: [{ oid: 'head', state: 'FAILURE' }] } as const;
  const row = await open({ mergeStateStatus: 'BLOCKED' }, options);
  expect(row.ci).toMatchObject({ kind: 'ci-github-rejected', github: { kind: 'refused' } });
  expect(row.ci.pending).toHaveLength(1);
});

test('readSnapshot carries a refused assessment on ci-failing when a check also failed', async () => {
  const options = { fastPath: { kind: 'checks', checks: [failedCheck()] }, commitRollups: [{ oid: 'head', state: 'FAILURE' }] } as const;
  const row = await open({ mergeStateStatus: 'BLOCKED' }, options);
  expect(row.ci).toMatchObject({ kind: 'ci-failing', github: { kind: 'refused' } });
});

const rejectedWhilePending: FakeReaderOptions = { fastPath: { kind: 'checks', checks: [pendingCheck()] }, commitRollups: [{ oid: 'head', state: 'FAILURE' }] };
test('pendingHistory include reports a BLOCKED PR with a failed head rollup as a failing-checks blocker at once', async () => {
  const row = await open({ mergeStateStatus: 'BLOCKED' }, rejectedWhilePending, 'include');
  expect(classifyPr(row)).toMatchObject({ kind: 'blocker', blocker: { kind: 'failing-checks' } });
});

test('pendingHistory omit keeps the same PR waiting until the pending checks drain', async () => {
  const row = await open({ mergeStateStatus: 'BLOCKED' }, rejectedWhilePending, 'omit');
  expect(row.ci.kind).toBe('ci-pending');
  expect(classifyPr(row).kind).toBe('waiting');
});

test('readSnapshot flags review automation for a PR Review Automation check without changing the classification', async () => {
  const named = await open({}, { fastPath: { kind: 'checks', checks: [pendingCheck('PR Review Automation')] } });
  const plain = await open({}, pending);
  expect(named.reviewAutomationRunning).toBe(true);
  expect(plain.reviewAutomationRunning).toBe(false);
  expect(classifyPr(named).kind).toBe(classifyPr(plain).kind);
});

test('a mergeable PR with zero checks exhausts the query-error budget rather than becoming READY', async () => {
  const h = harness();
  const reader = fakeReader({ fastPath: { kind: 'unusable', exitCode: 1, stderr: "no checks reported on the 'feature' branch" } });
  const verdict = await runSimple({ dependencies: deps(h, reader), contexts: [at(1)], mode: 'single', statusOnly: false, options: { ...base, maxQueryErrors: 2 } });
  expect(kinds(h.events)).toEqual(['RETRY']);
  expect(verdict).toMatchObject({ kind: 'BLOCKER', exitCode: 7, blocker: { kind: 'status-query', failures: 2 } });
});

test('runSimple drives a check-less PR with an unreadable status through the retry budget to BLOCKER exit 7', async () => {
  const h = harness();
  const reader = fakeReader({ fastPath: { kind: 'unusable', exitCode: 8, stderr: 'denied' } });
  const verdict = await runSimple({ dependencies: deps(h, reader), contexts: [at(1)], mode: 'single', statusOnly: false, options: { ...base, maxQueryErrors: 2 } });
  expect(kinds(h.events)).toEqual(['RETRY']);
  expect(verdict).toMatchObject({ kind: 'BLOCKER', exitCode: 7, blocker: { kind: 'status-query', failures: 2 } });
});

function sequenceChecks(steps: Check[][], reader = fakeReader()): GitHubReader {
  let index = 0;
  return {
    ...reader,
    async checksFastPath() {
      const checks = steps[Math.min(index++, steps.length - 1)];
      return { kind: 'checks', checks: checks as unknown as NonEmpty<Check> };
    },
  };
}
const single = (h: Harness, reader: GitHubReader, options: Partial<PollingOptions> = {}) => runSimple({ dependencies: deps(h, reader), contexts: [at(1)], mode: 'single', statusOnly: false, options: { ...base, ...options } });

test('runSimple emits WAITING pending-checks, sleeps the interval, refetches, then returns READY scope single', async () => {
  const h = harness();
  const verdict = await single(h, sequenceChecks([[pendingCheck()], [passingCheck()]]));
  expect(kinds(h.events)).toEqual(['WAITING']);
  expect(h.sleeps).toEqual([10]);
  expect(verdict).toMatchObject({ kind: 'READY', exitCode: 0, scope: { kind: 'single' } });
});

test('runSimple returns TIMEOUT pending-checks exit 5 once the deadline passes while waiting', async () => {
  const h = harness();
  const verdict = await single(h, fakeReader(pending), { interval: 2, timeout: 5 });
  expect(h.sleeps).toEqual([2, 2, 2]);
  expect(kinds(h.events)).toEqual(['WAITING', 'WAITING', 'WAITING', 'WAITING']);
  expect(verdict).toMatchObject({ kind: 'TIMEOUT', exitCode: 5, reason: { kind: 'pending-checks' } });
});

test('runSimple fires TIMEOUT when elapsed time equals the timeout exactly', async () => {
  const h = harness();
  const verdict = await single(h, fakeReader(pending), { interval: 10, timeout: 10 });
  expect(h.sleeps).toEqual([10]);
  expect(verdict.kind).toBe('TIMEOUT');
});

const transient = () => new WatcherQueryError({ kind: 'command-exit', retryable: true, code: 1, detail: 'boom' });
const failingReader = (error: () => Error, h?: Harness): GitHubReader => ({
  ...fakeReader(),
  async pullRequest() {
    h?.advance(5);
    throw error();
  },
});

test('runSimple retries with backoff 60 120 240 300 seconds and the fifth consecutive failure is terminal exit 7', async () => {
  const h = harness();
  const verdict = await single(h, failingReader(transient), { maxQueryErrors: 5 });
  const retries = h.events.filter((event) => event.kind === 'RETRY');
  expect(retries.map((event) => event.kind === 'RETRY' && event.retryInSeconds)).toEqual([60, 120, 240, 300]);
  expect(h.sleeps).toEqual([60, 120, 240, 300]);
  expect(verdict).toMatchObject({ kind: 'BLOCKER', exitCode: 7, blocker: { kind: 'status-query', failures: 5 } });
});

test('runSimple ends at once with BLOCKER exit 7 for a non-retryable query error', async () => {
  const h = harness();
  const fatal = () => new WatcherQueryError({ kind: 'invalid-context-url', retryable: false, detail: 'bad', rawValue: 'x' });
  const verdict = await single(h, failingReader(fatal));
  expect(h.events).toEqual([]);
  expect(verdict).toMatchObject({ kind: 'BLOCKER', exitCode: 7, blocker: { failures: 1, failure: { kind: 'invalid-context-url' } } });
});

test('runSimple returns TIMEOUT status-unavailable exit 5 when the deadline passes after a retryable failure', async () => {
  const h = harness();
  const verdict = await single(h, failingReader(transient, h), { timeout: 1 });
  expect(kinds(h.events)).toEqual(['RETRY']);
  expect(verdict).toMatchObject({ kind: 'TIMEOUT', exitCode: 5, reason: { kind: 'status-unavailable' } });
});

function stackReader(upstackSteps: Check[][]): GitHubReader {
  const reader = fakeReader();
  let polls = 0;
  return {
    ...reader,
    async checksFastPath(context) {
      if (context.number !== 2) return { kind: 'checks', checks: [passingCheck()] };
      return { kind: 'checks', checks: upstackSteps[Math.min(polls++, upstackSteps.length - 1)] as unknown as NonEmpty<Check> };
    },
  };
}
const stack = (h: Harness, reader: GitHubReader) => runSimple({ dependencies: deps(h, reader), contexts: queue(1, 2), mode: 'stack', statusOnly: false, options: base });

test('runSimple in stack mode emits a poll STATUS and a WAITING on every poll, then READY scope stack when clear', async () => {
  const h = harness();
  const verdict = await stack(h, stackReader([[pendingCheck()], [passingCheck()]]));
  expect(kinds(h.events)).toEqual(['STATUS', 'WAITING', 'STATUS']);
  expect(h.events[0]).toMatchObject({ reason: 'poll', terminal: false });
  expect(verdict).toMatchObject({ kind: 'READY', exitCode: 0, scope: { kind: 'stack' } });
});

test('selectTierMajorStackDecision reports an upstack failing PR before a bottom draft and a draft-only stack as merge-gate', async () => {
  const draft = await snap({ isDraft: true }, {}, 1);
  const failed = await snap({}, failing, 2);
  expect(selectTierMajorStackDecision([draft, failed] as unknown as NonEmpty<PrSnapshot>)).toMatchObject({ kind: 'blocker', blocker: { kind: 'failing-checks' } });
  const clean = await snap({}, {}, 2);
  expect(selectTierMajorStackDecision([draft, clean] as unknown as NonEmpty<PrSnapshot>)).toMatchObject({ kind: 'blocker', blocker: { kind: 'merge-gate', reason: 'draft-pr' } });
});

test('selectTierMajorStackDecision is clear with merged-pr then ready-pr for a merged bottom and a clean upstack', async () => {
  const rows = [await snap(MERGED, {}, 1), await snap({}, {}, 2)] as unknown as NonEmpty<PrSnapshot>;
  const decision = selectTierMajorStackDecision(rows);
  expect(decision.kind === 'clear' && decision.prs.map((p) => p.kind)).toEqual(['merged-pr', 'ready-pr']);
});
