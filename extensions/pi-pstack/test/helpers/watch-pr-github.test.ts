import { expect, test } from 'bun:test';

import { failedCheck, fakeReader, passingCheck } from '../../skills/poteto-mode/scripts/watch-pr/fakes.test-helper.ts';
import {
  ChecksUnavailable,
  discoverStack,
  GhGitHubReader,
  isNoChecksReading,
  mapRollupNode,
  orderStack,
  parseFastCheck,
  parseReviewThreads,
  REVIEW_THREADS_QUERY,
  resolveChecks,
  resolveContext,
  WatcherQueryError,
} from '../../skills/poteto-mode/scripts/watch-pr/github.ts';
import { readSnapshot } from '../../skills/poteto-mode/scripts/watch-pr/policy.ts';
import type { Check } from '../../skills/poteto-mode/scripts/watch-pr/types.ts';
import { parsePrNumber } from '../../skills/poteto-mode/scripts/watch-pr/types.ts';
import { commitsPage, emptyBin, type FakeBin, type FakeRule, fakeEnv, fastCheck, installFakeBin, ok, prView, rollupPage, thread, threadsPage, withEnv } from './watch-pr-fakes.test-helper.ts';

const rollupQuery = ['query', 'Pr' + 'CheckRollup'].join(' ');
const ctx = { owner: 'o', repo: 'r', number: parsePrNumber(7) };
const pr = (n: number) => ({ owner: 'o', repo: 'r', number: parsePrNumber(n) });

async function withFakes<T>(rules: readonly FakeRule[], body: (bin: FakeBin) => Promise<T>, extra: Record<string, string> = {}): Promise<T> {
  const bin = installFakeBin(rules);
  return withEnv(fakeEnv(bin, extra), () => body(bin));
}
const gh = (match: string[], ...replies: FakeRule['replies'][number][]): FakeRule => ({ tool: 'gh', match, replies });
const git = (match: string[], ...replies: FakeRule['replies'][number][]): FakeRule => ({ tool: 'git', match, replies });
const argvOf = (bin: FakeBin, index = 0): readonly string[] => bin.calls()[index].argv;
async function failureOf(promise: Promise<unknown>): Promise<WatcherQueryError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WatcherQueryError) return error;
    throw error;
  }
  throw new Error('expected a WatcherQueryError');
}

const PR_FIELDS = 'mergeable,mergeStateStatus,reviewDecision,headRefOid,headRefName,baseRefName,state,mergedAt,isDraft';

test(`${GhGitHubReader.name}.pullRequest runs gh pr view with the documented field list and parses the facts`, async () => {
  await withFakes([gh(['pr view'], ok(prView({ reviewDecision: '' })))], async (bin) => {
    const facts = await new GhGitHubReader().pullRequest(ctx);
    expect(argvOf(bin)).toEqual(['pr', 'view', '7', '--repo', 'o/r', '--json', PR_FIELDS]);
    expect(facts).toMatchObject({ mergeable: 'MERGEABLE', reviewDecision: null, headRefOid: 'head', state: 'OPEN', isDraft: false });
  });
});

test(`${GhGitHubReader.name}.openPullRequests lists open PRs with limit 300 and parses number and refs`, async () => {
  const items = [{ number: 4, headRefName: 'b', baseRefName: 'main' }];
  await withFakes([gh(['pr list'], ok(items))], async (bin) => {
    const open = await new GhGitHubReader().openPullRequests({ owner: 'o', repo: 'r' });
    expect(argvOf(bin)).toEqual(['pr', 'list', '--repo', 'o/r', '--state', 'open', '--limit', '300', '--json', 'number,headRefName,baseRefName']);
    expect(open).toEqual(items.map((item) => ({ ...item, number: parsePrNumber(item.number) })));
  });
});

const fastCases: readonly [string, { code?: number; stdout?: string }, 'checks' | 'unusable'][] = [
  ['exit 0 with checks', { code: 0, stdout: JSON.stringify([fastCheck('ci', 'pass', 'SUCCESS')]) }, 'checks'],
  ['exit 1 with checks (failing)', { code: 1, stdout: JSON.stringify([fastCheck('ci', 'fail', 'FAILURE')]) }, 'checks'],
  ['exit 8 with checks (pending)', { code: 8, stdout: JSON.stringify([fastCheck('ci', 'pending', 'PENDING')]) }, 'checks'],
  ['exit 2 is unusable even with output', { code: 2, stdout: JSON.stringify([fastCheck('ci', 'pass', 'SUCCESS')]) }, 'unusable'],
  ['exit 0 with blank stdout is unusable', { code: 0, stdout: '  \n' }, 'unusable'],
  ['exit 0 with invalid JSON degrades to unusable', { code: 0, stdout: '{not json' }, 'unusable'],
  ['exit 0 with a non-array object is unusable', { code: 0, stdout: '{"a":1}' }, 'unusable'],
];
for (const [label, reply, kind] of fastCases) {
  test(`GhGitHubReader.checksFastPath ${label}`, async () => {
    await withFakes([gh(['pr checks'], reply)], async (bin) => {
      const fast = await new GhGitHubReader().checksFastPath(ctx);
      expect(fast.kind).toBe(kind);
      expect(argvOf(bin)).toEqual(['pr', 'checks', '7', '--repo', 'o/r', '--json', 'name,state,description,link,workflow,bucket']);
    });
  });
}

const node = { __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'u' };
const cursorCases: readonly [string, Record<string, unknown>, string | null][] = [
  ['hasNextPage with a cursor returns the cursor', { hasNextPage: true, endCursor: 'C9' }, 'C9'],
  ['hasNextPage false drops the cursor', { hasNextPage: false, endCursor: 'C9' }, null],
  ['hasNextPage with a null cursor ends the walk', { hasNextPage: true, endCursor: null }, null],
];
for (const [label, pageInfo, cursor] of cursorCases) {
  test(`GhGitHubReader.checkRollupPage ${label}`, async () => {
    await withFakes([gh([rollupQuery], ok(rollupPage([node], pageInfo)))], async () => {
      const page = await new GhGitHubReader().checkRollupPage(ctx, null);
      expect(page.endCursor).toBe(cursor);
      expect(page.checks.map((check) => check.name)).toEqual(['ci']);
    });
  });
}

test(`${GhGitHubReader.name}.checkRollupPage sends the cursor as -f after and passes owner repo with -f and pr with -F`, async () => {
  await withFakes([gh([rollupQuery], ok(rollupPage([], { hasNextPage: false, endCursor: null })))], async (bin) => {
    await new GhGitHubReader().checkRollupPage(ctx, 'CUR');
    const argv = argvOf(bin);
    expect(argv.slice(0, 3)).toEqual(['api', 'graphql', '-f']);
    expect(argv[3]).toStartWith('query=');
    expect(argv[3]).toContain('contexts(first: 100, after: $after)');
    expect(argv.slice(4)).toEqual(['-f', 'owner=o', '-f', 'repo=r', '-F', 'pr=7', '-f', 'after=CUR']);
  });
});

test(`${GhGitHubReader.name}.checkRollupPage reads an absent statusCheckRollup as no checks`, async () => {
  const empty = { data: { repository: { pullRequest: { commits: { nodes: [{ commit: { statusCheckRollup: null } }] } } } } };
  await withFakes([gh([rollupQuery], ok(empty))], async () => {
    expect(await new GhGitHubReader().checkRollupPage(ctx, null)).toEqual({ checks: [], endCursor: null });
  });
});

test(`${GhGitHubReader.name}.reviewThreads sends the threads query with -f owner repo and -F pr and no cursor on page one`, async () => {
  await withFakes([gh(['query ReviewThreads'], ok(threadsPage([thread('t1', false)], { hasNextPage: false, endCursor: null })))], async (bin) => {
    const threads = await new GhGitHubReader().reviewThreads(ctx);
    const argv = argvOf(bin);
    expect(argv[3]).toContain('reviewThreads(first: 100');
    expect(argv[3]).toContain('comments(first: 10)');
    expect(argv.slice(4)).toEqual(['-f', 'owner=o', '-f', 'repo=r', '-F', 'pr=7']);
    expect(threads.map((t) => t.id)).toEqual(['t1']);
  });
});

test(`${GhGitHubReader.name}.commitRollups reads the last 50 commits and maps a null rollup to null`, async () => {
  const page = commitsPage([
    { oid: 'a', state: 'SUCCESS' },
    { oid: 'b', state: null },
  ]);
  await withFakes([gh(['query PrCommitStatuses'], ok(page))], async (bin) => {
    const rollups = await new GhGitHubReader().commitRollups(ctx);
    expect(argvOf(bin)[3]).toContain('commits(last: 50)');
    expect(rollups).toEqual([
      { oid: 'a', state: 'SUCCESS' },
      { oid: 'b', state: null },
    ]);
  });
});

test(`${GhGitHubReader.name} reports hadPreviousPassingCi from an older commit among 50 when only the head fails`, async () => {
  const commits = Array.from({ length: 50 }, (_, i) => ({ oid: i === 0 ? 'old' : i === 49 ? 'head' : `c${i}`, state: i === 0 ? 'SUCCESS' : 'FAILURE' }));
  const rules = [
    gh(['pr view'], ok(prView())),
    gh(['query ReviewThreads'], ok(threadsPage([], { hasNextPage: false, endCursor: null }))),
    gh(['pr checks'], { code: 1, stdout: JSON.stringify([fastCheck('ci', 'fail', 'FAILURE')]) }),
    gh(['query PrCommitStatuses'], ok(commitsPage(commits))),
  ];
  await withFakes(rules, async () => {
    const row = await readSnapshot({ reader: new GhGitHubReader(), context: ctx, pendingHistory: 'include', allowDraft: false });
    expect(row.kind === 'open' && row.ci.hadPreviousPassingCi).toBe(true);
  });
});

const prUrlCases: readonly [string, string, boolean][] = [
  ['canonical github.com URL', 'https://github.com/own/rep/pull/12', true],
  ['http scheme', 'http://github.com/own/rep/pull/12', false],
  ['a port', 'https://github.com:8443/own/rep/pull/12', false],
  ['userinfo', 'https://u@github.com/own/rep/pull/12', false],
  ['a query string', 'https://github.com/own/rep/pull/12?x=1', false],
  ['an issues path', 'https://github.com/own/rep/issues/12', false],
  ['a GitHub Enterprise host', 'https://ghe.example.com/own/rep/pull/12', false],
];
for (const [label, url, valid] of prUrlCases) {
  test(`GhGitHubReader.currentPr ${valid ? 'accepts' : 'rejects as non-retryable invalid-context-url'} ${label}`, async () => {
    await withFakes([gh(['pr view'], ok({ number: 12, url }))], async (bin) => {
      const reading = new GhGitHubReader().currentPr(null);
      if (valid) expect(await reading).toEqual({ owner: 'own', repo: 'rep', number: parsePrNumber(12) });
      else expect(await failureOf(reading)).toMatchObject({ failure: { kind: 'invalid-context-url', retryable: false } });
      expect(argvOf(bin)).toEqual(['pr', 'view', '--json', 'number,url']);
    });
  });
}

test(`${GhGitHubReader.name}.currentPr passes an explicit number to gh pr view and keeps it`, async () => {
  await withFakes([gh(['pr view'], ok({ number: 99, url: 'https://github.com/own/rep/pull/99' }))], async (bin) => {
    expect(await new GhGitHubReader().currentPr(parsePrNumber(5))).toEqual({ owner: 'own', repo: 'rep', number: parsePrNumber(5) });
    expect(argvOf(bin)).toEqual(['pr', 'view', '5', '--json', 'number,url']);
  });
});

const remoteCases: readonly [string, string, { owner: string; repo: string } | null][] = [
  ['scp form', 'git@github.com:own/rep.git\n', { owner: 'own', repo: 'rep' }],
  ['ssh form', 'ssh://git@github.com/own/rep.git\n', { owner: 'own', repo: 'rep' }],
  ['https form without .git', 'https://github.com/own/rep\n', { owner: 'own', repo: 'rep' }],
  ['https form with .git', 'https://github.com/own/rep.git\n', { owner: 'own', repo: 'rep' }],
  ['ssh form with a port', 'ssh://git@github.com:22/own/rep.git\n', null],
  ['https with userinfo', 'https://tok@github.com/own/rep\n', null],
  ['https with a query', 'https://github.com/own/rep?x=1\n', null],
  ['https with a hash', 'https://github.com/own/rep#x\n', null],
  ['a nested path', 'https://github.com/own/rep/extra\n', null],
  ['a GitHub Enterprise host', 'https://ghe.example.com/own/rep\n', null],
  ['an scp GitHub Enterprise host', 'git@ghe.example.com:own/rep.git\n', null],
];
for (const [label, stdout, expected] of remoteCases) {
  test(`GhGitHubReader.originRepo parses the ${label}`, async () => {
    await withFakes([git(['remote', 'get-url'], { stdout })], async (bin) => {
      expect(await new GhGitHubReader().originRepo()).toEqual(expected);
      expect(argvOf(bin)).toEqual(['remote', 'get-url', 'origin']);
    });
  });
}

test(`${GhGitHubReader.name}.originRepo returns null when git exits non-zero`, async () => {
  await withFakes([git(['remote'], { code: 2, stderr: 'no such remote' })], async () => {
    expect(await new GhGitHubReader().originRepo()).toBeNull();
  });
});

test(`${GhGitHubReader.name}.originRepo returns null when git is not on PATH`, async () => {
  await withEnv({ PATH: emptyBin() }, async () => {
    expect(await new GhGitHubReader().originRepo()).toBeNull();
  });
});

test(`${GhGitHubReader.name} runs gh with GH_HOST accepted for remotes and PR URLs on GitHub Enterprise`, async () => {
  const rules = [git(['remote'], { stdout: 'git@ghe.example.com:own/rep.git\n' }), gh(['pr view'], ok({ number: 3, url: 'https://ghe.example.com/own/rep/pull/3' }))];
  await withFakes(
    rules,
    async () => {
      const reader = new GhGitHubReader();
      expect(await reader.originRepo()).toEqual({ owner: 'own', repo: 'rep' });
      expect(await reader.currentPr(null)).toEqual({ owner: 'own', repo: 'rep', number: parsePrNumber(3) });
    },
    { GH_HOST: 'ghe.example.com' },
  );
});

test(`${GhGitHubReader.name} maps a non-zero gh exit to command-exit with the first stderr line cut to 240 characters`, async () => {
  await withFakes([gh(['pr view'], { code: 4, stderr: `${'e'.repeat(300)}\nsecond line` })], async () => {
    const error = await failureOf(new GhGitHubReader().pullRequest(ctx));
    expect(error.failure).toEqual({ kind: 'command-exit', retryable: true, code: 4, detail: 'e'.repeat(240) });
  });
});

test(`${GhGitHubReader.name} maps invalid JSON on stdout to a retryable json-parse failure`, async () => {
  await withFakes([gh(['pr view'], { stdout: '<html>' })], async () => {
    const error = await failureOf(new GhGitHubReader().pullRequest(ctx));
    expect(error.failure).toMatchObject({ kind: 'json-parse', retryable: true });
  });
});

test(`${GhGitHubReader.name} turns a missing gh binary into a non-retryable gh-missing failure instead of a crash`, async () => {
  await withEnv({ PATH: emptyBin() }, async () => {
    const error = await failureOf(new GhGitHubReader().pullRequest(ctx));
    expect(error.failure).toMatchObject({ kind: 'gh-missing', retryable: false });
    expect(error.failure.detail).toContain('gh');
  });
});

test(`${GhGitHubReader.name} kills a hung gh after the command timeout and raises a retryable command-exit failure`, async () => {
  const started = performance.now();
  await withFakes(
    [gh(['pr view'], { stdout: '{}', delayMs: 2500 })],
    async () => {
      const error = await failureOf(new GhGitHubReader().pullRequest(ctx));
      expect(error.failure).toMatchObject({ kind: 'command-exit', retryable: true });
      expect(error.failure.detail).toContain('timed out');
    },
    { WATCH_PR_COMMAND_TIMEOUT_SECONDS: '0.3' },
  );
  expect(performance.now() - started).toBeLessThan(1800);
});

const page = (ids: [string, boolean][], pageInfo?: Record<string, unknown>) =>
  ok(
    threadsPage(
      ids.map(([id, resolved]) => thread(id, resolved)),
      pageInfo,
    ),
  );

test(`${GhGitHubReader.name}.reviewThreads follows endCursor so an unresolved thread on page two is not hidden`, async () => {
  const rules = [gh(['query ReviewThreads'], page([['t1', true]], { hasNextPage: true, endCursor: 'C1' }), page([['t2', false]], { hasNextPage: false, endCursor: null }))];
  await withFakes(rules, async (bin) => {
    const threads = await new GhGitHubReader().reviewThreads(ctx);
    expect(threads.map((t) => t.id)).toEqual(['t2']);
    expect(argvOf(bin, 1).slice(-2)).toEqual(['-f', 'after=C1']);
  });
});

const brokenPaging: readonly [string, Record<string, unknown> | undefined][] = [
  ['a missing pageInfo', undefined],
  ['hasNextPage without an endCursor', { hasNextPage: true, endCursor: null }],
  ['a repeated cursor', { hasNextPage: true, endCursor: 'C1' }],
];
for (const [label, secondInfo] of brokenPaging) {
  test(`GhGitHubReader.reviewThreads fails closed on ${label}`, async () => {
    const first = page([['t1', true]], label === 'a missing pageInfo' ? undefined : { hasNextPage: true, endCursor: 'C1' });
    const rules = [gh(['query ReviewThreads'], first, page([['t2', false]], secondInfo))];
    await withFakes(rules, async () => {
      const error = await failureOf(new GhGitHubReader().reviewThreads(ctx));
      expect(error.failure).toMatchObject({ retryable: true });
    });
  });
}

test(`${GhGitHubReader.name}.openPullRequests keeps asking with a larger limit until the list is no longer full`, async () => {
  const items = (count: number) => Array.from({ length: count }, (_, i) => ({ number: i + 1, headRefName: `h${i + 1}`, baseRefName: i === 0 ? 'main' : `h${i}` }));
  const rules = [gh(['--limit 300'], ok(items(300))), gh(['--limit 600'], ok(items(301)))];
  await withFakes(rules, async () => {
    const stack = await discoverStack(new GhGitHubReader(), pr(301));
    expect(stack).toHaveLength(301);
    expect(stack[0].number).toBe(parsePrNumber(1));
    expect(stack[300].number).toBe(parsePrNumber(301));
  });
});

const fastMapping: readonly [string, Record<string, string>, Check['kind']][] = [
  ['bucket fail', { bucket: 'fail', state: 'PENDING' }, 'failed'],
  ['state FAILURE with a passing bucket', { bucket: 'pass', state: 'FAILURE' }, 'failed'],
  ['state ERROR', { bucket: 'pass', state: 'ERROR' }, 'failed'],
  ['state ACTION_REQUIRED', { bucket: 'pass', state: 'ACTION_REQUIRED' }, 'failed'],
  ['bucket pending', { bucket: 'pending', state: 'PENDING' }, 'pending'],
  ['bucket pass', { bucket: 'pass', state: 'SUCCESS' }, 'passed'],
  ['bucket skipping', { bucket: 'skipping', state: 'SKIPPED' }, 'skipped'],
  ['bucket cancel fails closed', { bucket: 'cancel', state: 'CANCELLED' }, 'failed'],
  ['lowercase state is normalized', { bucket: 'fail', state: 'failure' }, 'failed'],
];
for (const [label, fields, kind] of fastMapping) {
  test(`parseFastCheck maps ${label} to ${kind}`, () => {
    expect(parseFastCheck({ name: 'ci', description: '', link: '', workflow: '', ...fields }).kind).toBe(kind);
  });
}

test('parseFastCheck classifies a pending Code Review Gate as the gate and a failed one as failed', () => {
  const gate = { name: 'Code Review Gate', description: '', link: '', workflow: '' };
  expect(parseFastCheck({ ...gate, bucket: 'pending', state: 'PENDING' }).kind).toBe('code-review-gate');
  expect(parseFastCheck({ ...gate, bucket: 'fail', state: 'FAILURE' }).kind).toBe('failed');
});

const statusCases: readonly [string, string | undefined, string, string][] = [
  ['SUCCESS', 'SUCCESS', 'passed', 'SUCCESS'],
  ['an empty state', '', 'failed', 'FAILURE'],
  ['a missing state', undefined, 'failed', 'FAILURE'],
  ['PENDING', 'PENDING', 'pending', 'PENDING'],
  ['EXPECTED', 'EXPECTED', 'pending', 'PENDING'],
  ['an unknown state', 'WEIRD', 'failed', 'WEIRD'],
];
for (const [label, state, kind, reported] of statusCases) {
  test(`mapRollupNode maps a StatusContext with ${label}`, () => {
    expect(mapRollupNode({ __typename: 'StatusContext', context: 's', state })).toMatchObject({ kind, reportedState: reported });
  });
}

test('mapRollupNode prefers targetUrl, then link, then detailsUrl for the check link', () => {
  expect(mapRollupNode({ __typename: 'StatusContext', context: 's', state: 'SUCCESS', targetUrl: 'T', link: 'L', detailsUrl: 'D' })).toMatchObject({ link: 'T' });
  expect(mapRollupNode({ __typename: 'StatusContext', context: 's', state: 'SUCCESS', link: 'L', detailsUrl: 'D' })).toMatchObject({ link: 'L' });
  expect(mapRollupNode({ __typename: 'CheckRun', name: 'c', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'D' })).toMatchObject({ link: 'D' });
});

test('mapRollupNode skips node types that are neither CheckRun nor StatusContext', () => {
  expect(mapRollupNode({ __typename: 'Other' })).toBeNull();
});

const bugbot = (id: string, runId: string | null, author = 'cursor-bugbot') => ({
  id,
  isResolved: false,
  comments: { nodes: [{ body: runId ? `bug\nRUN_ID: ${runId}` : 'bug', createdAt: 't', path: null, line: null, author: { login: author } }] },
});

test('parseReviewThreads counts one bugbot pass when a keyless bugbot thread exists and zero for human threads only', () => {
  const keyless = parseReviewThreads(threadsPage([bugbot('b1', null)]));
  expect(keyless[0].bugbotReviewPasses).toBe(1);
  const human = parseReviewThreads(threadsPage([thread('h1', false)]));
  expect(human[0]).toMatchObject({ isBugbot: false, bugbotReviewPasses: 0 });
});

test('parseReviewThreads counts distinct run keys across resolved and unresolved bugbot threads', () => {
  const resolved = { ...bugbot('b3', 'run-9'), isResolved: true };
  const threads = parseReviewThreads(threadsPage([bugbot('b1', 'run-1'), bugbot('b2', 'run-2'), resolved]));
  expect(threads.map((t) => t.bugbotReviewPasses)).toEqual([3, 3]);
});

const badThreads: readonly [string, Record<string, unknown>][] = [
  ['isResolved', { id: 't', comments: { nodes: [] } }],
  ['id', { isResolved: false, comments: { nodes: [] } }],
  ['comments.nodes', { id: 't', isResolved: false, comments: {} }],
];
for (const [field, node] of badThreads) {
  test(`parseReviewThreads rejects a thread missing ${field} with a retryable missing-key failure`, () => {
    try {
      parseReviewThreads(threadsPage([node]));
    } catch (error) {
      expect(error).toBeInstanceOf(WatcherQueryError);
      expect((error as WatcherQueryError).failure).toMatchObject({ kind: 'missing-key', retryable: true });
      return;
    }
    throw new Error('expected a failure');
  });
}

test('parseReviewThreads keeps an unresolved thread that has no comments with a null first comment', () => {
  const threads = parseReviewThreads(threadsPage([{ id: 't', isResolved: false, comments: { nodes: [] } }]));
  expect(threads).toEqual([{ id: 't', firstComment: null, isBugbot: false, bugbotReviewPasses: 0 }]);
});

const originOnly = { owner: 'local', repo: 'checkout' };
test('resolveContext lets one explicit owner override the origin owner while keeping the origin repo', async () => {
  const reader = fakeReader({ origin: originOnly });
  expect(await resolveContext({ reader, owner: 'explicit', repo: null, pr: parsePrNumber(3) })).toEqual({ owner: 'explicit', repo: 'checkout', number: parsePrNumber(3) });
});

test('resolveContext lets one explicit repo override the origin repo while keeping the origin owner', async () => {
  const reader = fakeReader({ origin: originOnly });
  expect(await resolveContext({ reader, owner: null, repo: 'explicit', pr: parsePrNumber(3) })).toEqual({ owner: 'local', repo: 'explicit', number: parsePrNumber(3) });
});

test('resolveContext falls back to currentPr when no PR number is given', async () => {
  const reader = fakeReader({ current: { owner: 'cur', repo: 'rep', number: parsePrNumber(8) } });
  expect(await resolveContext({ reader, owner: null, repo: null, pr: null })).toEqual({ owner: 'cur', repo: 'rep', number: parsePrNumber(8) });
  expect(reader.calls.at(-1)).toBe('currentPr');
});

test('resolveContext falls back to currentPr when the origin remote does not parse', async () => {
  const reader = fakeReader({ origin: null, current: { owner: 'cur', repo: 'rep', number: parsePrNumber(8) } });
  expect(await resolveContext({ reader, owner: null, repo: null, pr: parsePrNumber(2) })).toEqual({ owner: 'cur', repo: 'rep', number: parsePrNumber(2) });
  expect(reader.calls).toEqual(['originRepo', 'currentPr']);
});

const open = (number: number, head: string, base: string) => ({ number: parsePrNumber(number), headRefName: head, baseRefName: base });
const numbers = (stack: readonly { number: number }[]) => stack.map((p) => p.number);

test('orderStack returns only the seed when the seed is absent from the open list', () => {
  expect(numbers(orderStack(pr(5), []))).toEqual([5]);
});

test('orderStack orders sibling children of one base by PR number', () => {
  const stack = orderStack(pr(1), [open(1, 'a', 'main'), open(4, 'c4', 'a'), open(2, 'c2', 'a')]);
  expect(numbers(stack)).toEqual([1, 2, 4]);
});

test('orderStack flattens a tree-shaped stack in depth-first order', () => {
  const tree = [open(1, 'b', 'main'), open(2, 'c1', 'b'), open(3, 'c2', 'b'), open(4, 'g', 'c1')];
  expect(numbers(orderStack(pr(1), tree))).toEqual([1, 2, 4, 3]);
});

test('orderStack puts ancestors below a seed taken from the middle of the stack', () => {
  const chain = [open(1, 'a', 'main'), open(2, 'b', 'a'), open(3, 'c', 'b')];
  expect(numbers(orderStack(pr(2), chain))).toEqual([1, 2, 3]);
});

test('orderStack refuses to loop when two PRs name each other as base and reports the cycle as a non-retryable failure', () => {
  const cyclic = [open(1, 'a', 'b'), open(2, 'b', 'a')];
  try {
    orderStack(pr(1), cyclic);
  } catch (error) {
    expect(error).toBeInstanceOf(WatcherQueryError);
    expect((error as WatcherQueryError).failure).toMatchObject({ kind: 'stack-cycle', retryable: false });
    return;
  }
  throw new Error('expected a cycle failure');
});

test('resolveChecks cuts the fast-path stderr in the unavailable detail to its first 240 characters', async () => {
  const reader = fakeReader({ fastPath: { kind: 'unusable', exitCode: 8, stderr: `${'x'.repeat(300)}\nmore` } });
  const error = await failureOf(resolveChecks(reader, ctx));
  expect(error).toBeInstanceOf(ChecksUnavailable);
  expect(error.failure.detail).toContain('x'.repeat(240));
  expect(error.failure.detail).not.toContain('x'.repeat(241));
});

const noChecks = "no checks reported on the 'feature' branch";
const emptyCases: readonly [string, Parameters<typeof fakeReader>[0], boolean][] = [
  ['gh pr checks says no checks reported (exit 1)', { fastPath: { kind: 'unusable', exitCode: 1, stderr: noChecks } }, true],
  ['gh pr checks returned an empty list', { fastPath: { kind: 'checks', checks: [] } }, true],
  ['gh pr checks failed for another reason (exit 8)', { fastPath: { kind: 'unusable', exitCode: 8, stderr: 'denied' } }, false],
  ['gh pr checks exit 1 without the no-checks message', { fastPath: { kind: 'unusable', exitCode: 1, stderr: 'boom' } }, false],
];
for (const [label, options, accepted] of emptyCases) {
  test(`resolveChecks with allowEmpty ${accepted ? 'reads a PR with zero checks as one skipped placeholder' : 'still fails closed'} when ${label}`, async () => {
    const reader = fakeReader(options);
    const reading = resolveChecks(reader, ctx, true);
    if (accepted) expect((await reading).checks.map((c) => c.kind)).toEqual(['skipped']);
    else expect(await failureOf(reading)).toBeInstanceOf(ChecksUnavailable);
  });
}

test('resolveChecks without allowEmpty keeps failing closed for a PR with zero checks', async () => {
  const reader = fakeReader({ fastPath: { kind: 'unusable', exitCode: 1, stderr: noChecks } });
  expect(await failureOf(resolveChecks(reader, ctx))).toBeInstanceOf(ChecksUnavailable);
});

test('isNoChecksReading recognizes only the zero-check placeholder reading', async () => {
  const empty = await resolveChecks(fakeReader({ fastPath: { kind: 'checks', checks: [] } }), ctx, true);
  const real = await resolveChecks(fakeReader({ fastPath: { kind: 'checks', checks: [passingCheck('a')] } }), ctx, true);
  expect(isNoChecksReading(empty.checks)).toBe(true);
  expect(isNoChecksReading(real.checks)).toBe(false);
  expect(isNoChecksReading([])).toBe(false);
});

test('resolveChecks prefers real checks over the zero-check placeholder', async () => {
  const reader = fakeReader({ fastPath: { kind: 'checks', checks: [passingCheck('a'), failedCheck('b')] } });
  expect((await resolveChecks(reader, ctx, true)).checks.map((c) => c.name)).toEqual(['a', 'b']);
});

test('the review threads query pages with a cursor variable and requests pageInfo', () => {
  expect(REVIEW_THREADS_QUERY).toContain('$after: String');
  expect(REVIEW_THREADS_QUERY).toContain('hasNextPage');
});

const READ_ONLY = new Set(['pr view', 'pr checks', 'pr list', 'api graphql', 'remote get-url']);
test(`${GhGitHubReader.name} issues only read-only gh and git subcommands across a snapshot and stack discovery`, async () => {
  const rules = [
    gh(['pr view'], ok(prView())),
    gh(['query ReviewThreads'], ok(threadsPage([], { hasNextPage: false, endCursor: null }))),
    gh(['pr checks'], { code: 0, stdout: JSON.stringify([fastCheck('ci', 'pass', 'SUCCESS')]) }),
    gh(['query PrCommitStatuses'], ok(commitsPage([{ oid: 'head', state: 'SUCCESS' }]))),
    gh(['pr list'], ok([])),
    git(['remote'], { stdout: 'https://github.com/o/r\n' }),
  ];
  await withFakes(rules, async (bin) => {
    const reader = new GhGitHubReader();
    await reader.originRepo();
    await readSnapshot({ reader, context: ctx, pendingHistory: 'include', allowDraft: false });
    await discoverStack(reader, ctx);
    const calls = bin.calls();
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const call of calls) {
      expect(READ_ONLY.has(call.argv.slice(0, 2).join(' '))).toBe(true);
      expect(call.argv.join(' ')).not.toContain('mutation');
    }
  });
});
