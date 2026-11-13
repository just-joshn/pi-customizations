// A real forge for the PR families: a fresh set of branches and PRs in the throwaway GitHub repository, a small Actions
// workflow that gives each PR a real check, and a reader that turns the repository's state into one JSON document (facts)
// from the GitHub API. Checkers read the facts; nothing here touches anything outside SANDBOX_REPO, and every run removes
// what it created (PRs closed, branches deleted). Opt-in: the callers run only when PSTACK_REAL_FORGE=1.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PKG } from '../lib/driver.ts';
import type { Ctx } from '../lib/driver.ts';

export const SANDBOX_REPO = process.env['PSTACK_REAL_FORGE_REPO'] ?? 'just-joshn/pstack-parity-sandbox';
export const [SANDBOX_OWNER, SANDBOX_NAME] = SANDBOX_REPO.split('/') as [string, string];
export const REAL_FORGE_ENABLED = process.env['PSTACK_REAL_FORGE'] === '1';
export const REPO_FLAG = `--repo ${SANDBOX_REPO}`;
export const WATCH_PR = join(PKG, 'generated/skills/poteto-mode/scripts/watch-pr/watch-pr');
export const OPERATOR = join(PKG, 'tests/workflow-parity/fixtures/real-forge-operator.mjs');

/**
 * `.ci-mode` on a branch picks what its check does: pass, fail, or flaky (fails on attempt 1, passes on a rerun). It runs on
 * push, not pull_request, so a PR that conflicts with trunk (no merge ref, so no pull_request run) still has a check, which
 * is what the real watch-pr needs to classify it: with no check at all it answers RETRY, not merge-conflicts.
 */
export const WORKFLOW = `name: CI
on:
  push:
    branches: ['pf/**', '!pf/**/trunk']
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - name: build
        run: |
          mode=$(cat .ci-mode 2>/dev/null || echo pass)
          echo "mode=$mode attempt=$GITHUB_RUN_ATTEMPT"
          case "$mode" in
            fail) echo "Error: test suite failed in src/cart.js"; exit 1 ;;
            flaky) if [ "$GITHUB_RUN_ATTEMPT" = 1 ]; then echo "Run npm ci"; echo "npm error network request to https://registry.npmjs.org/left-pad failed, reason: read ECONNRESET"; echo "Error: Process completed with exit code 1."; exit 1; fi ;;
          esac
`;
export const WORKFLOW_PATH = '.github/workflows/pstack-parity-ci.yml';

export function gh(args: string[], options: { input?: string; allowFail?: boolean } = {}): string {
  const run = spawnSync('gh', args, { encoding: 'utf8', input: options.input, maxBuffer: 64 << 20 });
  if (run.status !== 0 && options.allowFail !== true) throw new Error(`gh ${args.slice(0, 4).join(' ')} failed (${run.status}): ${run.stderr.trim().slice(0, 400)}`);
  return run.stdout;
}
export const api = <T = unknown>(path: string, extra: string[] = []): T => JSON.parse(gh(['api', ...extra, path])) as T;
const graphql = <T = unknown>(query: string, variables: Record<string, string | number>): T => JSON.parse(gh(['api', 'graphql', '-f', `query=${query}`, ...Object.entries(variables).flatMap(([key, value]) => [typeof value === 'number' ? '-F' : '-f', `${key}=${value}`])])) as T;

const sleepSync = (seconds: number): void => void spawnSync('sleep', [String(seconds)]);

/**
 * The environment a Pi run needs to reach the real forge. The run's HOME is the sandbox's, which hides the macOS keychain
 * the operator's gh login lives in, so the parent gets the login's token in GH_TOKEN. A container worker gets it the
 * package's way: PSTACK_CONTAINER_FORGE_TOKEN, which the host hands to the worker on stdin.
 */
export function realForgeEnv(ctx: Ctx, options: { container?: boolean; scripted?: boolean } = {}): Record<string, string> {
  const token = gh(['auth', 'token']).trim();
  const env: Record<string, string> = { GH_TOKEN: token, GH_PROMPT_DISABLED: '1' };
  if (options.container === true) {
    env['PSTACK_CONTAINER_FORGE_TOKEN'] = token;
    const engine = process.env['DOCKER_HOST'] ?? spawnSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8' }).stdout.trim();
    if (engine !== '') env['DOCKER_HOST'] = engine;
    if (options.scripted === true) {
      env['PSTACK_CONTAINER_PROVIDER_PACKAGES'] = [join(PKG, 'tests/workflow-parity/fixtures/sim-provider'), join(ctx.sandbox, 'sim-scenario')].join(':');
      env['PSTACK_SCENARIO'] = join(ctx.sandbox, 'sim-scenario', 'scenario.json');
    }
  }
  return env;
}

export interface BranchDef {
  /** Short name; the real branch is `<prefix>/<name>`. */
  name: string;
  /** Short name of the parent branch, or absent for trunk. */
  from?: string;
  files: Record<string, string>;
  message: string;
  author?: string;
}

export interface PrDef {
  head: string;
  /** Short name of the base branch, or absent for trunk. */
  base?: string;
  title: string;
  body: string;
}

export interface FactPr {
  number: number;
  url: string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  merged: boolean;
  mergedAt: string | null;
  mergeCommit: string | null;
  base: string;
  head: string;
  headSha: string;
  /** Author name of the head commit, which stands for the PR owner. */
  owner: string;
  isDraft: boolean;
  mergeableState: string;
  autoMerge: boolean;
  reviewDecision: string;
  comments: { author: string; body: string; createdAt: string }[];
  threads: { id: string; resolved: boolean; comments: { id: number; author: string; body: string; path: string | null; line: number | null; createdAt: string }[] }[];
  timeline: { event: string; actor: string; createdAt: string; sha: string | null }[];
  checks: { name: string; status: string; conclusion: string | null; runId: number; url: string }[];
  runs: { id: number; headSha: string; attempt: number; conclusion: string | null; url: string; attempts: { attempt: number; conclusion: string | null; url: string; startedAt: string | null }[] }[];
  patchId: string;
  /** The head commit's parent, so a stacked PR can be shown to sit on its parent's tip. */
  parentSha: string;
  testPassesAtHead: boolean | null;
}

export interface Facts {
  repo: string;
  family: string;
  capturedAt: string;
  trunk: string;
  trunkBase: string;
  trunkCommits: { sha: string; message: string; parents: number }[];
  prefix: string;
  settled: boolean;
  prs: FactPr[];
  operator: { at: string; kind: string; [key: string]: unknown }[];
  notes: Record<string, unknown>;
  /** The real watch-pr, run once over the final state: its exit code and verdict kinds. */
  watch: { code: number; kinds: string[] } | null;
  actions: { name: string; url: string }[];
}

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const CREDENTIALS = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];
const remoteUrl = `https://github.com/${SANDBOX_REPO}.git`;
const authed = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...CREDENTIALS, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The run's own prefix keeps every branch it makes under one name, so cleanup is one sweep by name, safe to repeat. */
export class RealForge {
  readonly stamp: string;
  readonly prefix: string;
  readonly trunk: string;
  numbers: Record<string, number> = {};
  shas: Record<string, string> = {};
  trunkBase = '';
  notes: Record<string, unknown> = {};
  private operator: ReturnType<typeof spawn> | undefined;
  private operatorLog = '';
  readonly family: string;
  constructor(family: string, stamp = Date.now().toString(36)) {
    this.family = family;
    this.stamp = stamp;
    this.prefix = `pf/${stamp}/${family}`;
    this.trunk = `${this.prefix}/trunk`;
  }
  readonly branch = (name?: string): string => (name === undefined ? this.trunk : `${this.prefix}/${name}`);

  /** Points the sandbox checkout at the real remote, puts its history on a fresh trunk branch, and creates the branches and PRs. */
  setup(ctx: Ctx, def: { branches: BranchDef[]; trunkAfter?: { file: string; content: string; message: string }[]; prs: PrDef[]; awaitConflict?: string }): void {
    git(ctx.repo, 'remote', 'add', 'origin', remoteUrl);
    git(ctx.repo, 'config', '--add', 'credential.helper', '');
    git(ctx.repo, 'config', '--add', 'credential.helper', '!gh auth git-credential');
    git(ctx.repo, 'config', 'user.name', 'operator');
    git(ctx.repo, 'config', 'user.email', 'operator@users.noreply.github.com');
    authed(ctx.repo, 'push', '-q', 'origin', `main:refs/heads/${this.trunk}`);
    const initial = git(ctx.repo, 'rev-parse', 'HEAD');
    this.trunkBase = initial;
    const scratch = mkdtempSync(join(tmpdir(), 'real-forge-'));
    try {
      git(scratch, 'clone', '-q', ctx.repo, '.');
      git(scratch, 'remote', 'set-url', 'origin', remoteUrl);
      const commit = (author: string, message: string) => execFileSync('git', ['-C', scratch, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message], { env: { ...process.env, GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: `${author}@users.noreply.github.com`, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: `${author}@users.noreply.github.com` } });
      for (const branch of def.branches) {
        git(scratch, 'checkout', '-q', '-B', this.branch(branch.name), branch.from === undefined ? initial : this.branch(branch.from));
        for (const [path, content] of Object.entries(branch.files)) {
          mkdirSync(join(scratch, path, '..'), { recursive: true });
          writeFileSync(join(scratch, path), content);
        }
        git(scratch, 'add', '-A');
        commit(branch.author ?? 'owner', branch.message);
        authed(scratch, 'push', '-q', 'origin', `${this.branch(branch.name)}:refs/heads/${this.branch(branch.name)}`);
        this.shas[branch.name] = git(scratch, 'rev-parse', 'HEAD');
      }
      git(scratch, 'checkout', '-q', '-B', 'trunk-work', initial);
      for (const trunkCommit of def.trunkAfter ?? []) {
        writeFileSync(join(scratch, trunkCommit.file), trunkCommit.content);
        git(scratch, 'add', '-A');
        commit('trunk', trunkCommit.message);
        authed(scratch, 'push', '-q', 'origin', `HEAD:refs/heads/${this.trunk}`);
        this.trunkBase = git(scratch, 'rev-parse', 'HEAD');
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    authed(ctx.repo, 'fetch', '-q', 'origin');
    for (const pr of def.prs) {
      const body = join(tmpdir(), `real-forge-body-${this.stamp}-${pr.head}.md`);
      writeFileSync(body, pr.body);
      const url = gh(['pr', 'create', '--repo', SANDBOX_REPO, '--title', pr.title, '--body-file', body, '--base', this.branch(pr.base), '--head', this.branch(pr.head)]).trim();
      rmSync(body, { force: true });
      this.numbers[pr.head] = Number(url.split('/').at(-1));
    }
    if (def.awaitConflict !== undefined) {
      this.awaitMergeable(this.numbers[def.awaitConflict] as number, 'dirty');
      this.notes['initialMergeableState'] = 'dirty';
    }
  }

  awaitMergeable(number: number, state: string, seconds = 120): void {
    for (let i = 0; i < seconds / 2; i += 1) {
      if (api<{ mergeable_state: string }>(`repos/${SANDBOX_REPO}/pulls/${number}`).mergeable_state === state) return;
      sleepSync(2);
    }
    throw new Error(`PR ${number} never became ${state}`);
  }

  /** The next issue or PR number GitHub will hand out, for a scripted reply that names a PR the run has not opened yet. */
  nextNumber(): number {
    return Number(gh(['api', `repos/${SANDBOX_REPO}/issues?state=all&per_page=1&sort=created&direction=desc`, '--jq', '.[0].number // 0']).trim()) + 1;
  }

  /** Starts the owner stand-in: it rebases a PR when a comment asks for it and then leaves a review thread on the new head. */
  startOperator(ctx: Ctx, config: Record<string, unknown>): void {
    this.operatorLog = join(ctx.sandbox, 'operator.jsonl');
    writeFileSync(this.operatorLog, '');
    const file = join(ctx.sandbox, 'operator-config.json');
    writeFileSync(file, JSON.stringify({ repo: SANDBOX_REPO, trunk: this.trunk, log: this.operatorLog, ...config }));
    this.operator = spawn('node', [OPERATOR, file], { stdio: 'ignore', detached: true, env: { ...process.env, GH_PROMPT_DISABLED: '1' } });
    this.operator.unref();
  }
  stopOperator(): void {
    if (this.operator?.pid !== undefined) {
      try {
        process.kill(-this.operator.pid);
      } catch {
        /* already gone */
      }
    }
  }

  /** Reads the repository's state for this run's PRs from the GitHub API and writes it beside the sandbox's other artifacts. */
  capture(ctx: Pick<Ctx, 'sandbox' | 'repo'>, options: { waitSeconds?: number; testFiles?: Record<number, string>; watch?: string[] } = {}): Facts {
    const deadline = Date.now() + (options.waitSeconds ?? 420) * 1000;
    let facts = this.read(ctx, options.testFiles ?? {});
    while (facts.prs.length > 0 && !facts.settled && Date.now() < deadline) {
      sleepSync(10);
      facts = this.read(ctx, options.testFiles ?? {});
    }
    if (options.watch !== undefined) {
      const run = spawnSync(WATCH_PR, [...options.watch, '--timeout', '60', '--interval', '5'], { encoding: 'utf8', timeout: 120_000 });
      facts.watch = { code: run.status ?? -1, kinds: [...run.stdout.matchAll(/"kind":"(\w+)"/g)].map((match) => match[1] as string) };
    }
    writeFileSync(join(ctx.sandbox, 'real-facts.json'), JSON.stringify(facts, null, 2));
    return facts;
  }

  private read(ctx: Pick<Ctx, 'sandbox' | 'repo'>, testFiles: Record<number, string>): Facts {
    authed(ctx.repo, 'fetch', '-q', 'origin');
    const prs = this.discover().map((number) => this.readPr(ctx, number, testFiles[number]));
    const trunkCommits = api<{ sha: string; commit: { message: string }; parents: unknown[] }[]>(`repos/${SANDBOX_REPO}/commits?sha=${encodeURIComponent(this.trunk)}&per_page=30`, []).map((entry) => ({ sha: entry.sha, message: entry.commit.message.split('\n')[0] as string, parents: entry.parents.length }));
    const settled = prs.length > 0 && prs.every((pr) => pr.runs.length > 0 && pr.runs.filter((run) => run.headSha === pr.headSha).every((run) => run.conclusion !== null) && pr.checks.every((check) => check.status === 'completed'));
    const operator = this.operatorLog !== '' && existsSync(this.operatorLog) ? readFileSync(this.operatorLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Facts['operator'][number]) : [];
    return { repo: SANDBOX_REPO, family: this.family, capturedAt: new Date().toISOString(), trunk: this.trunk, trunkBase: this.trunkBase, trunkCommits, prefix: this.prefix, settled, prs, operator, notes: this.notes, watch: null, actions: prs.flatMap((pr) => pr.runs.map((run) => ({ name: `PR ${pr.number} run ${run.id}`, url: run.url }))) };
  }

  /** Every PR, open or closed, whose head branch is under this run's prefix: the ones the setup made and the ones the run opened. */
  discover(): number[] {
    return api<{ number: number; head: { ref: string } }[]>(`repos/${SANDBOX_REPO}/pulls?state=all&per_page=100`).filter((pr) => pr.head.ref.startsWith(`${this.prefix}/`)).map((pr) => pr.number).sort((a, b) => a - b);
  }

  private readPr(ctx: Pick<Ctx, 'sandbox' | 'repo'>, number: number, testFile: string | undefined): FactPr {
    const base = `repos/${SANDBOX_REPO}`;
    const pull = api<{ html_url: string; title: string; body: string | null; state: 'open' | 'closed'; merged: boolean; merged_at: string | null; merge_commit_sha: string | null; base: { ref: string }; head: { ref: string; sha: string }; draft: boolean; mergeable_state: string; auto_merge: unknown }>(`${base}/pulls/${number}`);
    const comments = api<{ user: { login: string }; body: string; created_at: string }[]>(`${base}/issues/${number}/comments?per_page=100`);
    const review = graphql<{ data: { repository: { pullRequest: { reviewDecision: string | null; reviewThreads: { nodes: { id: string; isResolved: boolean; comments: { nodes: { databaseId: number; author: { login: string } | null; body: string; path: string | null; line: number | null; createdAt: string }[] } }[] } } } } }>(
      'query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) { reviewDecision reviewThreads(first: 50) { nodes { id isResolved comments(first: 30) { nodes { databaseId author { login } body path line createdAt } } } } } } }',
      { owner: SANDBOX_OWNER, name: SANDBOX_NAME, pr: number },
    ).data.repository.pullRequest;
    const timeline = api<{ event?: string; actor?: { login: string } | null; created_at?: string; sha?: string; commit_id?: string | null }[]>(`${base}/issues/${number}/timeline?per_page=100`).filter((entry) => entry.event !== undefined && ['head_ref_force_pushed', 'merged', 'closed', 'reopened', 'committed', 'auto_merge_enabled', 'base_ref_changed', 'ready_for_review'].includes(entry.event)).map((entry) => ({ event: entry.event as string, actor: entry.actor?.login ?? '', createdAt: entry.created_at ?? '', sha: entry.sha ?? entry.commit_id ?? null }));
    const checkRuns = api<{ check_runs: { name: string; status: string; conclusion: string | null; id: number; html_url: string; details_url: string | null }[] }>(`${base}/commits/${pull.head.sha}/check-runs`).check_runs;
    const runs = api<{ workflow_runs: { id: number; head_sha: string; run_attempt: number; conclusion: string | null; html_url: string }[] }>(`${base}/actions/runs?branch=${encodeURIComponent(pull.head.ref)}&per_page=50`).workflow_runs;
    const owner = git(ctx.repo, 'log', '-1', '--format=%an', pull.head.sha);
    return {
      number,
      url: pull.html_url,
      title: pull.title,
      body: pull.body ?? '',
      state: pull.state,
      merged: pull.merged,
      mergedAt: pull.merged_at,
      mergeCommit: pull.merge_commit_sha,
      base: pull.base.ref,
      head: pull.head.ref,
      headSha: pull.head.sha,
      owner,
      isDraft: pull.draft,
      mergeableState: pull.mergeable_state,
      autoMerge: pull.auto_merge !== null,
      reviewDecision: review.reviewDecision ?? '',
      comments: comments.map((entry) => ({ author: entry.user.login, body: entry.body, createdAt: entry.created_at })),
      threads: review.reviewThreads.nodes.map((thread) => ({ id: thread.id, resolved: thread.isResolved, comments: thread.comments.nodes.map((entry) => ({ id: entry.databaseId, author: entry.author?.login ?? '', body: entry.body, path: entry.path, line: entry.line, createdAt: entry.createdAt })) })),
      timeline,
      checks: checkRuns.map((entry) => ({ name: entry.name, status: entry.status, conclusion: entry.conclusion, runId: Number(/runs\/(\d+)/.exec(entry.details_url ?? entry.html_url)?.[1] ?? 0), url: entry.html_url })),
      runs: runs.map((run) => ({ id: run.id, headSha: run.head_sha, attempt: run.run_attempt, conclusion: run.conclusion, url: run.html_url, attempts: Array.from({ length: run.run_attempt }, (_, index) => index + 1).map((attempt) => { const detail = api<{ conclusion: string | null; html_url: string; run_started_at: string | null }>(`${base}/actions/runs/${run.id}/attempts/${attempt}`); return { attempt, conclusion: detail.conclusion, url: detail.html_url, startedAt: detail.run_started_at }; }) })),
      patchId: this.patchId(ctx.repo, pull.head.sha),
      parentSha: git(ctx.repo, 'rev-parse', `${pull.head.sha}^`),
      testPassesAtHead: testFile === undefined ? null : this.testAt(ctx.repo, pull.head.sha, testFile),
    };
  }

  private patchId(repo: string, sha: string): string {
    const patch = spawnSync('git', ['-C', repo, 'show', '--format=', '-p', sha], { encoding: 'utf8' }).stdout;
    return spawnSync('git', ['patch-id', '--stable'], { input: patch, encoding: 'utf8' }).stdout.split(' ')[0] ?? '';
  }

  private testAt(repo: string, sha: string, file: string): boolean {
    const command = `d=$(mktemp -d) && git -C '${repo}' archive ${sha} | tar -x -C "$d" && cd "$d" && node --test ${file} >/dev/null 2>&1; code=$?; rm -rf "$d"; exit $code`;
    return spawnSync('sh', ['-c', command], { timeout: 60_000 }).status === 0;
  }

  /** Closes every open PR of this run and deletes every branch under its prefix. Safe to run twice and after a crash. */
  cleanup(): { closed: number[]; deleted: string[] } {
    this.stopOperator();
    const closed: number[] = [];
    const heads = api<{ number: number; state: string; head: { ref: string } }[]>(`repos/${SANDBOX_REPO}/pulls?state=open&per_page=100`).filter((pr) => pr.head.ref.startsWith(`${this.prefix}/`));
    for (const pr of heads) {
      gh(['pr', 'close', String(pr.number), '--repo', SANDBOX_REPO], { allowFail: true });
      closed.push(pr.number);
    }
    const deleted: string[] = [];
    const refs = gh(['api', `repos/${SANDBOX_REPO}/git/matching-refs/heads/${this.prefix}/`, '--jq', '.[].ref'], { allowFail: true }).split('\n').filter(Boolean);
    for (const ref of refs) {
      gh(['api', '--method', 'DELETE', `repos/${SANDBOX_REPO}/git/${ref}`], { allowFail: true });
      deleted.push(ref.replace('refs/heads/', ''));
    }
    return { closed, deleted };
  }

  /** What is still left under this run's prefix: open PRs and branches. Empty after a clean cleanup. */
  leftovers(): { openPrs: number[]; branches: string[] } {
    const openPrs = api<{ number: number; head: { ref: string } }[]>(`repos/${SANDBOX_REPO}/pulls?state=open&per_page=100`).filter((pr) => pr.head.ref.startsWith(`${this.prefix}/`)).map((pr) => pr.number);
    const branches = gh(['api', `repos/${SANDBOX_REPO}/git/matching-refs/heads/${this.prefix}/`, '--jq', '.[].ref'], { allowFail: true }).split('\n').filter(Boolean);
    return { openPrs, branches };
  }
}

export const readFacts = (sandbox: string): Facts => JSON.parse(readFileSync(join(sandbox, 'real-facts.json'), 'utf8')) as Facts;

/** The sandbox's workflow file as one commit of the fixture history, so trunk carries it and every PR runs it. */
export const WORKFLOW_COMMIT = { message: 'ci: parity sandbox workflow', files: { [WORKFLOW_PATH]: WORKFLOW } };

export function writeContainerScenario(ctx: Ctx, scenario: unknown): void {
  if (ctx.driver !== 'scripted') return;
  const dir = join(ctx.sandbox, 'sim-scenario');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sim-scenario', private: true, pi: { extensions: [] } }));
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify(scenario));
  chmodSync(dir, 0o755);
}
