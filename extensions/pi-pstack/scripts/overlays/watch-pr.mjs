const dir = 'skills/poteto-mode/scripts';

import { readFileSync } from 'node:fs';

const L = (...lines) => lines.join('\n');
const snippet = (name) => readFileSync(new URL(`./watch-pr-snippets/${name}.ts.txt`, import.meta.url), 'utf8').replace(/\n$/, '');

const noChecksReason = '{ readonly kind: "no-checks-unconfirmed"; readonly readings: number; readonly required: number }';

const types = {
  path: `${dir}/watch-pr/types.ts`,
  edits: [
    [
      L('  | {', '      readonly kind: "invalid-context-url";'),
      L(
        '  | {',
        '      readonly kind: "gh-missing";',
        '      readonly retryable: false;',
        '      readonly detail: string;',
        '    }',
        '  | {',
        '      readonly kind: "bootstrap-failed";',
        '      readonly retryable: false;',
        '      readonly detail: string;',
        '    }',
        '  | {',
        '      readonly kind: "stack-cycle";',
        '      readonly retryable: false;',
        '      readonly detail: string;',
        '    }',
        '  | {',
        '      readonly kind: "invalid-context-url";',
      ),
      'Add non-retryable failure kinds for a missing gh, a failed dependency install, and a cyclic stack so each reaches the exit-7 BLOCKER path.',
    ],
    [
      '        | { readonly kind: "merge-queue"; readonly unmergedCount: number };',
      L('        | { readonly kind: "merge-queue"; readonly unmergedCount: number }', `        | ${noChecksReason};`),
      'Give a zero-check PR that has not yet persisted across polls its own WAITING reason.',
    ],
    [
      '    | { readonly kind: "status-unavailable"; readonly failure: QueryFailure }',
      L('    | { readonly kind: "status-unavailable"; readonly failure: QueryFailure }', `    | ${noChecksReason}`),
      'Let the deadline report a zero-check PR that never confirmed.',
    ],
  ],
};

const runOriginal = snippet('run-original');

const runReplacement = snippet('run-replacement');

const remoteOriginal = snippet('remote-original');

const remoteReplacement = L('  normalized = normalized.replace(/^git@([^:/]+):/, "https://$1/");', '  normalized = normalized.replace(/^ssh:\\/\\/git@([^/:]+)\\//, "https://$1/");');

const originRepoOriginal = L('    const result = await run(["git", "remote", "get-url", "origin"]);', '    return result.code === 0 ? parseRemote(result.stdout) : null;');

const originRepoReplacement = L('    try {', '      const result = await run(["git", "remote", "get-url", "origin"]);', '      return result.code === 0 ? parseRemote(result.stdout) : null;', '    } catch {', '      return null;', '    }');

const openListOriginal = snippet('open-list-original');

const openListReplacement = L('    const value = await listOpenPullRequests(repository);', '    return value.map((item, index) => {');

const githubHelpers = snippet('github-helpers');

const threadsOriginal = snippet('threads-original');

const threadsReplacement = snippet('threads-replacement');

const downOriginal = L(
  '  const down: T.OpenPullRequest[] = [];',
  '  let current = start;',
  '  while (byHead.has(current.baseRefName)) {',
  '    const parent = byHead.get(current.baseRefName);',
  '    if (parent === undefined) break;',
  '    down.push(parent);',
  '    current = parent;',
  '  }',
);

const downReplacement = snippet('down-replacement');

const checksSignatureOriginal = L('export async function resolveChecks(', '  reader: T.GitHubReader,', '  context: T.PrContext', '): Promise<T.CheckRead> {');

const checksSignatureReplacement = L(
  'const NO_CHECKS_PLACEHOLDER: T.Check = {',
  '  kind: "skipped",',
  '  name: "no checks reported",',
  '  reportedState: "NONE",',
  '  description: "gh pr checks and the GraphQL rollup both report zero checks",',
  '  link: "",',
  '  workflow: "",',
  '};',
  'export function isNoChecksReading(checks: readonly T.Check[]): boolean {',
  '  return checks.length === 1 && checks[0] === NO_CHECKS_PLACEHOLDER;',
  '}',
  'function confirmsNoChecks(fast: T.ChecksFastPath): boolean {',
  '  if (fast.kind === "checks") return true;',
  '  return fast.exitCode === 1 && /no checks reported/i.test(fast.stderr);',
  '}',
  'export async function resolveChecks(',
  '  reader: T.GitHubReader,',
  '  context: T.PrContext,',
  '  allowEmpty = false',
  '): Promise<T.CheckRead> {',
);

const fallbackOriginal = '  if (fallback !== null) return { source: "graphql-rollup", checks: fallback };';
const fallbackReplacement = snippet('fallback-replacement');

const hostCheck = (tail) => L('      url.hostname !== "github.com" ||', '      url.port ||', '      url.username ||', '      url.password ||', '      url.search ||', '      url.hash ||', `      parts.length !== ${tail}`);
const hostCheckKnown = (tail) => hostCheck(tail).replace('url.hostname !== "github.com"', '!isKnownHost(url.hostname)');

const github = {
  path: `${dir}/watch-pr/github.ts`,
  edits: [
    [
      'reviewThreads(first: 100) {\\n        nodes {',
      'reviewThreads(first: 100, after: $after) {\\n        pageInfo {\\n          hasNextPage\\n          endCursor\\n        }\\n        nodes {',
      'Request pageInfo and accept a reference so review threads can be paged.',
    ],
    ['query ReviewThreads($owner: String!, $repo: String!, $pr: Int!) {', 'query ReviewThreads($owner: String!, $repo: String!, $pr: Int!, $after: String) {', 'Declare the review thread reference variable.'],
    [runOriginal, runReplacement, 'Bound every gh and git subprocess with a timeout and report a missing gh as a typed non-retryable failure instead of an uncaught crash.'],
    [
      'function parseRemote(value: string): T.Repository | null {',
      L(
        'function isKnownHost(hostname: string): boolean {',
        '  const configured = process.env["GH_HOST"]?.trim().toLowerCase();',
        '  return (',
        '    hostname === "github.com" ||',
        '    (configured !== undefined && configured !== "" && hostname === configured)',
        '  );',
        '}',
        'function parseRemote(value: string): T.Repository | null {',
      ),
      'Accept the host gh is configured for (GH_HOST) as well as github.com.',
    ],
    [remoteOriginal, remoteReplacement, 'Normalize scp and ssh remotes for any host, then let the host check decide.'],
    [hostCheck(2), hostCheckKnown(2), 'Apply the configured-host rule to origin remotes.'],
    [hostCheck(4), hostCheckKnown(4), 'Apply the configured-host rule to pull request URLs.'],
    [originRepoOriginal, originRepoReplacement, 'Treat a missing or unrunnable git as no origin so context falls back to gh.'],
    [openListOriginal, openListReplacement, 'Read open PRs through a helper that keeps raising the limit until the list is not full.'],
    ['\nexport class GhGitHubReader implements T.GitHubReader {', `\n${githubHelpers}`, 'Add the open PR paging and review thread paging helpers.'],
    [threadsOriginal, threadsReplacement, 'Fetch every review thread page so an unresolved thread past 100 cannot be hidden.'],
    [downOriginal, downReplacement, 'Fail closed on a cyclic stack instead of looping forever.'],
    [checksSignatureOriginal, checksSignatureReplacement, 'Let a caller read a confirmed zero-check PR as one skipped placeholder.'],
    [fallbackOriginal, fallbackReplacement, 'Return the zero-check placeholder only when gh confirms there are no checks.'],
  ],
};

const queuedTimeoutHelper = L(
  'function queuedTimeout(stamp: VerdictStamp, state: QueueState): T.TimeoutVerdict {',
  '  const unmerged = state.queue.filter(',
  '    (context) => state.snapshots.get(context.number)?.kind !== "merged"',
  '  );',
  '  return stamp({',
  '    kind: "TIMEOUT",',
  '    terminal: true,',
  '    exitCode: 5,',
  '    reason: {',
  '      kind: "queued-stack",',
  '      frontier: unmerged[0] ?? state.queue[0],',
  '      unmergedCount: unmerged.length,',
  '    },',
  '  });',
  '}',
  'export async function runQueued(args: {',
);

const noChecksStreakHelpers = snippet('no-checks-streak-helpers');

const noChecksGate = L(
  '    streaks = nextStreaks(streaks, complete);',
  '    const wait = decision.kind === "waiting" ? null : unconfirmed(complete, streaks);',
  '    if (wait !== null) {',
  '      const reason = { kind: "no-checks-unconfirmed", readings: wait.readings, required: NO_CHECKS_READINGS_REQUIRED } as const;',
  '      args.dependencies.emit(stamp({ kind: "WAITING", terminal: false, frontier: wait.context, reason }));',
  '      const onDeadline = () => stamp({ kind: "TIMEOUT", terminal: true, exitCode: 5, reason });',
  '      return { kind: "sleep", seconds: args.options.interval, onDeadline };',
  '    }',
  '    if (decision.kind === "ready" || decision.kind === "merged")',
);

const policy = {
  path: `${dir}/watch-pr/policy.ts`,
  edits: [
    [
      '  const checks = await resolveChecks(args.reader, args.context);',
      L('  const checks = await resolveChecks(', '    args.reader,', '    args.context,', '    facts.mergeStateStatus !== "BLOCKED" &&', '      facts.mergeStateStatus !== "UNKNOWN"', '  );'),
      'Read a PR with zero checks as having no required checks unless GitHub reports it blocked or still computing.',
    ],
    ['import { WatcherQueryError, resolveChecks } from "./github.ts";', 'import { WatcherQueryError, isNoChecksReading, resolveChecks } from "./github.ts";', 'Import the zero-check reading predicate.'],
    ['export async function runSimple(args: {', noChecksStreakHelpers, 'Track consecutive same-head zero-check readings per PR.'],
    [
      L('  const stamp = verdictFactory(args.dependencies.clock, args.mode);', '  const step = async (): Promise<StepResult<T.TerminalVerdict>> => {'),
      L('  const stamp = verdictFactory(args.dependencies.clock, args.mode);', '  let streaks: Streaks = new Map();', '  const step = async (): Promise<StepResult<T.TerminalVerdict>> => {'),
      'Keep the zero-check streak across polls of one run.',
    ],
    ['    if (decision.kind === "ready" || decision.kind === "merged")', noChecksGate, 'Fail closed: update the streak, then wait until a zero-check reading persists across two polls at one head SHA.'],
    ['export async function runQueued(args: {', queuedTimeoutHelper, 'Build the queued-stack TIMEOUT verdict in one place.'],
    [
      L('    state = planQueue(state, args.dependencies.clock.now());', '    if (state.work === null) {'),
      L(
        '    state = planQueue(state, args.dependencies.clock.now());',
        '    if (',
        '      state.work !== null &&',
        '      deadlinePassed(',
        '        state.startedAt,',
        '        args.options,',
        '        args.dependencies.clock.now()',
        '      )',
        '    )',
        '      return { kind: "terminal", verdict: queuedTimeout(stamp, state) };',
        '    if (state.work === null) {',
      ),
      'Check the queued deadline between sweep reads so a long sweep cannot overshoot --timeout.',
    ],
    [
      '        return { kind: "sleep", seconds: args.options.interval };',
      L('        return {', '          kind: "sleep",', '          seconds: args.options.interval,', '          onDeadline: () => queuedTimeout(stamp, state),', '        };'),
      'Give the queued waiting sleep a deadline hook like the single and stack runner has.',
    ],
  ],
};

const waitingReplacement = snippet('waiting-replacement');

const render = {
  path: `${dir}/watch-pr/render.ts`,
  edits: [
    ['import type * as T from "./types.ts";', L('import { isNoChecksReading } from "./github.ts";', 'import type * as T from "./types.ts";'), 'Import the zero-check reading predicate.'],
    [L('    case "ci-clean":', '      return "✅";'), L('    case "ci-clean":', '      return isNoChecksReading(row.ci.all) ? "\u2796 no checks" : "✅";'), 'Show a zero-check PR as having no checks instead of a passing mark.'],
    [L('    case "WAITING":', '      return verdict.reason.kind === "pending-checks"'), waitingReplacement, 'Render the zero-check WAITING reason.'],
    [
      '      if (verdict.reason.kind === "status-unavailable")',
      L('      if (verdict.reason.kind === "no-checks-unconfirmed")', '        return "TIMEOUT: no checks reported and none confirmed absent\\n";', '      if (verdict.reason.kind === "status-unavailable")'),
      'Render the zero-check TIMEOUT reason.',
    ],
  ],
};

const bootstrapOriginal = snippet('bootstrap-original');

const bootstrapReplacement = snippet('bootstrap-replacement');

const bootstrap = {
  path: `${dir}/bootstrap.ts`,
  edits: [
    [
      'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
      L('import {', '  existsSync,', '  mkdirSync,', '  readFileSync,', '  rmSync,', '  statSync,', '  writeFileSync,', '} from "node:fs";', 'import { constants } from "node:os";'),
      'Import the filesystem and signal helpers the locked, signal-forwarding install needs.',
    ],
    [bootstrapOriginal, bootstrapReplacement, 'Serialize the install behind an exclusive lock directory, forward SIGINT and SIGTERM to the install and the re-exec child, and wait for a concurrent install instead of racing it.'],
  ],
};

const launcher = {
  path: `${dir}/watch-pr/watch-pr`,
  edits: [
    [
      L('ensureDependenciesInstalled();', 'const { main } = await import("./cli.ts");'),
      L(
        'try {',
        '  await ensureDependenciesInstalled();',
        '} catch (error) {',
        '  const { statusQueryVerdict, verdictFactory } = await import("./policy.ts");',
        '  const { renderJson } = await import("./render.ts");',
        '  const clock = {',
        '    now: () => performance.now() / 1_000,',
        '    observedAt: () => new Date().toISOString(),',
        '    sleep: async () => {},',
        '  };',
        '  const detail = error instanceof Error ? error.message : String(error);',
        '  const verdict = statusQueryVerdict(verdictFactory(clock, "single"), 1, {',
        '    kind: "bootstrap-failed",',
        '    retryable: false,',
        '    detail,',
        '  });',
        '  process.stdout.write(renderJson(verdict));',
        '  process.exit(verdict.exitCode);',
        '}',
        'const { main } = await import("./cli.ts");',
      ),
      'Render a failed dependency install as the documented exit-7 BLOCKER instead of an uncaught throw.',
    ],
  ],
};

const orch = {
  path: `${dir}/orch/orch.ts`,
  edits: [[L('ensureDependenciesInstalled();', 'const {'), L('if (import.meta.main) await ensureDependenciesInstalled();', 'const {'), 'Install dependencies only when orch.ts is the entry point so importing it has no side effect.']],
};

export default [types, github, policy, render, bootstrap, launcher, orch];
