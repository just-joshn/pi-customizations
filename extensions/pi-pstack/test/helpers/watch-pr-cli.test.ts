import { expect, test } from 'bun:test';

import { type CliRuntime, main, parseArgs } from '../../skills/poteto-mode/scripts/watch-pr/cli.ts';
import { type FakeReaderOptions, failedCheck, fakeReader, pendingCheck } from '../../skills/poteto-mode/scripts/watch-pr/fakes.test-helper.ts';
import { GhGitHubReader, WatcherQueryError } from '../../skills/poteto-mode/scripts/watch-pr/github.ts';
import { readSnapshot } from '../../skills/poteto-mode/scripts/watch-pr/policy.ts';
import { renderStatusTable } from '../../skills/poteto-mode/scripts/watch-pr/render.ts';
import type { GitHubReader, PrContext, ReviewThread } from '../../skills/poteto-mode/scripts/watch-pr/types.ts';
import { parsePrNumber } from '../../skills/poteto-mode/scripts/watch-pr/types.ts';
import { emptyBin, withEnv } from './watch-pr-fakes.test-helper.ts';

const silent = { stdout: () => {}, stderr: () => {} };
const PR = ['--owner', 'o', '--repo', 'r', '--pr', '1'];
const MERGED = { state: 'MERGED', mergedAt: '2026-07-26T00:00:00Z' } as const;

interface VerdictRow {
  readonly context: { readonly owner: string; readonly repo: string; readonly number: number };
  readonly facts: { readonly mergeable: string };
}

interface VerdictLine {
  readonly kind: string;
  readonly reason: string;
  readonly blocker: { readonly kind: string; readonly reason: string; readonly failure: { readonly kind: string } };
  readonly scope: { readonly pr: { readonly proof: { readonly gate: { readonly draft: string } } }; readonly prs: readonly VerdictRow[] };
  readonly rows: readonly VerdictRow[];
}

interface Run {
  readonly code: number;
  readonly lines: VerdictLine[];
  readonly text: string;
  readonly sleeps: number[];
}
async function run(argv: string[], reader: GitHubReader): Promise<Run> {
  let now = 0;
  const out: string[] = [];
  const sleeps: number[] = [];
  const runtime: CliRuntime = {
    reader,
    clock: {
      now: () => now,
      observedAt: () => '2026-07-26T00:00:00.000Z',
      async sleep(seconds) {
        sleeps.push(seconds);
        now += seconds;
      },
    },
    stdout: (value) => out.push(value),
    stderr: () => {},
  };
  const code = await main(argv, runtime);
  const text = out.join('');
  const lines = text.startsWith('{')
    ? text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
  return { code, lines, text, sleeps };
}
const last = (r: Run) => r.lines[r.lines.length - 1];
const thread = (id: string, isBugbot: boolean): ReviewThread => ({ id, firstComment: null, isBugbot, bugbotReviewPasses: isBugbot ? 1 : 0 });

test('parseArgs --stack alone selects stack mode', () => {
  expect(parseArgs(['--stack'], silent).mode).toBe('stack');
});

test('parseArgs --pr strips a leading # and keeps the number', () => {
  expect(parseArgs(['--pr', '#5'], silent).pr).toBe(parsePrNumber(5));
  expect(parseArgs([], silent).pr).toBeNull();
});

for (const value of ['0', '1.5', '-2', 'abc', '#0']) {
  test(`parseArgs rejects --pr ${value} as a usage error`, () => {
    expect(() => parseArgs(['--pr', value], silent)).toThrow();
  });
}

for (const argv of [
  ['--interval', '0'],
  ['--stack', '--queued-stack'],
  ['--stack-prs', '1,2'],
  ['--timeout', '-1'],
]) {
  test(`main exits 64 and prints nothing to stdout for ${argv.join(' ')}`, async () => {
    const r = await run(argv, fakeReader());
    expect(r).toMatchObject({ code: 64, text: '' });
  });
}

test('main exits 0 on STATUS for a merged PR with schemaVersion 1, sequence 1, mode single and a merged row', async () => {
  const r = await run([...PR, '--status-only'], fakeReader({ facts: MERGED }));
  expect(r.code).toBe(0);
  expect(r.lines).toHaveLength(1);
  expect(last(r)).toMatchObject({
    schemaVersion: 1,
    sequence: 1,
    mode: 'single',
    kind: 'STATUS',
    terminal: true,
    exitCode: 0,
    reason: 'status-only',
    rows: [{ kind: 'merged', facts: { state: 'MERGED' } }],
  });
});

test('main prints the status table for --pretty --status-only', async () => {
  const r = await run([...PR, '--status-only', '--pretty'], fakeReader({ facts: MERGED }));
  expect(r.code).toBe(0);
  expect(r.text.startsWith('| PR | CI | Review | Merge |')).toBe(true);
  expect(r.text).toContain('✅ merged');
});

test('main exits 0 on STATUS with a conflicting row because status-only never blocks', async () => {
  const r = await run([...PR, '--status-only'], fakeReader({ facts: { mergeable: 'CONFLICTING' } }));
  expect(r.code).toBe(0);
  expect(last(r).rows[0].facts.mergeable).toBe('CONFLICTING');
});

test('main exits 0 on READY scope single for a clean open PR', async () => {
  const r = await run(PR, fakeReader());
  expect(r.code).toBe(0);
  expect(last(r)).toMatchObject({ kind: 'READY', exitCode: 0, scope: { kind: 'single', pr: { kind: 'ready-pr' } } });
});

test('main exits 0 on READY merged-pr for a merged PR without --status-only', async () => {
  const r = await run(PR, fakeReader({ facts: MERGED }));
  expect(last(r)).toMatchObject({ kind: 'READY', exitCode: 0, scope: { kind: 'single', pr: { kind: 'merged-pr' } } });
});

test('main reaches READY for a PR whose reviewDecision is null and --pretty prints reviewDecision=null', async () => {
  const r = await run([...PR, '--pretty'], fakeReader({ facts: { reviewDecision: null } }));
  expect(r.code).toBe(0);
  expect(r.text).toContain('READY:');
  expect(r.text).toContain('mergeStateStatus=CLEAN');
  expect(r.text).toContain('reviewDecision=null');
  expect(r.text).toContain('isDraft=false');
});

const exitCases: readonly [string, string[], FakeReaderOptions, number, string][] = [
  ['mergeable CONFLICTING', [], { facts: { mergeable: 'CONFLICTING' } }, 2, 'merge-conflicts'],
  ['mergeStateStatus DIRTY', [], { facts: { mergeStateStatus: 'DIRTY' } }, 2, 'merge-conflicts'],
  ['mergeStateStatus CONFLICTING', [], { facts: { mergeStateStatus: 'CONFLICTING' } }, 2, 'merge-conflicts'],
  ['a human review thread', [], { threads: [thread('h', false)] }, 3, 'review-threads'],
  ['a bot review thread', [], { threads: [thread('b', true)] }, 3, 'review-threads'],
  ['a failed check', [], { fastPath: { kind: 'checks', checks: [failedCheck()] } }, 4, 'failing-checks'],
  ['a closed PR', [], { facts: { state: 'CLOSED' } }, 6, 'closed-without-merge'],
  ['a draft PR', [], { facts: { isDraft: true } }, 6, 'draft-pr'],
  ['CHANGES_REQUESTED', [], { facts: { reviewDecision: 'CHANGES_REQUESTED' } }, 6, 'changes-requested'],
];
for (const [label, extra, options, code, reason] of exitCases) {
  test(`main exits ${code} with BLOCKER ${reason} for ${label}`, async () => {
    const r = await run([...PR, ...extra], fakeReader(options));
    expect(r.code).toBe(code);
    const blocker = last(r).blocker;
    expect(last(r)).toMatchObject({ kind: 'BLOCKER', terminal: true, exitCode: code });
    expect(blocker.kind === 'merge-gate' ? blocker.reason : blocker.kind).toBe(reason);
  });
}

test('main with --allow-draft treats a draft PR as READY and records draft-allowed', async () => {
  const r = await run([...PR, '--allow-draft'], fakeReader({ facts: { isDraft: true } }));
  expect(r.code).toBe(0);
  expect(last(r).scope.pr.proof.gate.draft).toBe('draft-allowed');
});

test('main exits 5 with TIMEOUT pending-checks when --timeout elapses while checks stay pending', async () => {
  const r = await run([...PR, '--timeout', '30', '--interval', '10'], fakeReader({ fastPath: { kind: 'checks', checks: [pendingCheck()] } }));
  expect(r.code).toBe(5);
  expect(last(r)).toMatchObject({ kind: 'TIMEOUT', exitCode: 5, reason: { kind: 'pending-checks' } });
  expect(r.sleeps).toEqual([10, 10, 10]);
});

test('main renders an immediate BLOCKER exit 7 with failures 1 and sequence 1 when context resolution fails', async () => {
  const reader: GitHubReader = {
    ...fakeReader(),
    async currentPr(): Promise<PrContext> {
      throw new WatcherQueryError({ kind: 'invalid-context-url', retryable: false, detail: 'bad url', rawValue: 'x' });
    },
  };
  const r = await run([], reader);
  expect(r.code).toBe(7);
  expect(r.lines).toHaveLength(1);
  expect(last(r)).toMatchObject({ kind: 'BLOCKER', exitCode: 7, sequence: 1, blocker: { kind: 'status-query', failures: 1 } });
});

test('main exits 7 after the query-error budget is exhausted and 7 at once for a non-retryable error', async () => {
  const flaky: GitHubReader = {
    ...fakeReader(),
    async pullRequest() {
      throw new WatcherQueryError({ kind: 'json-parse', retryable: true, detail: 'x' });
    },
  };
  const exhausted = await run([...PR, '--max-query-errors', '2'], flaky);
  expect(exhausted.code).toBe(7);
  expect(last(exhausted).blocker).toMatchObject({ kind: 'status-query', failures: 2 });
  const fatal: GitHubReader = {
    ...fakeReader(),
    async pullRequest() {
      throw new WatcherQueryError({ kind: 'invalid-context-url', retryable: false, detail: 'y', rawValue: 'y' });
    },
  };
  expect(last(await run(PR, fatal)).blocker).toMatchObject({ failures: 1 });
});

test('main exits 7 with a gh-missing BLOCKER instead of crashing when gh is not on PATH', async () => {
  await withEnv({ PATH: emptyBin() }, async () => {
    const r = await run(PR, new GhGitHubReader());
    expect(r.code).toBe(7);
    expect(last(r)).toMatchObject({ kind: 'BLOCKER', exitCode: 7, blocker: { kind: 'status-query', failure: { kind: 'gh-missing', retryable: false } } });
  });
});

test('main on GitHub Enterprise without GH_HOST exits 7 invalid-context-url from currentPr', async () => {
  const reader: GitHubReader = {
    ...fakeReader({ origin: null }),
    async currentPr(): Promise<PrContext> {
      throw new WatcherQueryError({ kind: 'invalid-context-url', retryable: false, detail: 'ghe', rawValue: 'https://ghe.example.com/o/r/pull/1' });
    },
  };
  const r = await run(['--pr', '1'], reader);
  expect(r.code).toBe(7);
  expect(last(r).blocker.failure.kind).toBe('invalid-context-url');
});

test('main in stack mode returns READY scope stack for two clean PRs discovered from open PRs', async () => {
  const open = [
    { number: parsePrNumber(1), headRefName: 'a', baseRefName: 'main' },
    { number: parsePrNumber(2), headRefName: 'b', baseRefName: 'a' },
  ];
  const r = await run([...PR, '--stack'], fakeReader({ openPullRequests: open }));
  expect(r.code).toBe(0);
  expect(last(r)).toMatchObject({ kind: 'READY', mode: 'stack', scope: { kind: 'stack' } });
  expect(last(r).scope.prs.map((p) => p.context.number)).toEqual([1, 2]);
});

test('main --queued-stack without --stack-prs discovers the stack once and reports rows bottom to top', async () => {
  const open = [1, 2, 3].map((n) => ({ number: parsePrNumber(n), headRefName: `h${n}`, baseRefName: n === 1 ? 'main' : `h${n - 1}` }));
  const reader = fakeReader({ openPullRequests: open });
  const r = await run(['--owner', 'o', '--repo', 'r', '--pr', '2', '--queued-stack', '--status-only'], reader);
  expect(reader.calls.filter((call) => call === 'openPullRequests')).toHaveLength(1);
  expect(last(r).rows.map((row) => row.context.number)).toEqual([1, 2, 3]);
});

test('main seeds from the first --stack-prs entry and reuses the seed owner and repo for every entry', async () => {
  const reader = fakeReader({ origin: { owner: 'seedowner', repo: 'seedrepo' } });
  const r = await run(['--queued-stack', '--stack-prs', '7,8', '--status-only'], reader);
  const contexts = last(r).rows.map((row) => row.context);
  expect(contexts).toEqual([
    { owner: 'seedowner', repo: 'seedrepo', number: 7 },
    { owner: 'seedowner', repo: 'seedrepo', number: 8 },
  ]);
});

test('main --queued-stack without --status-only emits QUEUE, STATUS whole-stack-sweep, COMPLETE and exits 0 for a merged PR', async () => {
  const r = await run(['--queued-stack', '--stack-prs', '1'], fakeReader({ facts: MERGED }));
  expect(r.code).toBe(0);
  expect(r.lines.map((line) => line.kind)).toEqual(['QUEUE', 'STATUS', 'COMPLETE']);
  expect(r.lines[1].reason).toBe('whole-stack-sweep');
});

const mergeCells: readonly [string, FakeReaderOptions['facts'], string][] = [
  ['draft over conflict', { isDraft: true, mergeable: 'CONFLICTING' }, '⏸ draft'],
  ['draft over changes requested', { isDraft: true, reviewDecision: 'CHANGES_REQUESTED' }, '⏸ draft'],
  ['changes requested over conflict', { reviewDecision: 'CHANGES_REQUESTED', mergeable: 'CONFLICTING' }, '⚠️ changes requested'],
  ['conflict alone', { mergeStateStatus: 'DIRTY' }, '⚠️ conflict'],
];
for (const [label, facts, cell] of mergeCells) {
  test(`renderStatusTable merge cell precedence: ${label}`, async () => {
    const row = await readSnapshot({ reader: fakeReader({ facts }), context: { owner: 'o', repo: 'r', number: parsePrNumber(1) }, pendingHistory: 'include', allowDraft: false });
    expect(renderStatusTable([row])).toContain(`| ${cell} |`);
  });
}

test('renderStatusTable shows the robot review cell for a PR Review Automation check, which never gates', async () => {
  const fastPath = { kind: 'checks', checks: [pendingCheck('PR Review Automation')] } as const;
  const row = await readSnapshot({ reader: fakeReader({ fastPath }), context: { owner: 'o', repo: 'r', number: parsePrNumber(1) }, pendingHistory: 'include', allowDraft: false });
  expect(renderStatusTable([row])).toContain('| 🤖 running |');
});
