// The fake forge a PR workflow runs against: a local bare `origin`, a fake `gh` (and optionally `origin`) executable that
// reads and writes <origin.git>/forge/state.json, and an append-only action log the checkers read. Real git decides head
// SHAs, conflicts and merges, so a rebase, a force-push or a merge is a fact in the bare repository, not a claim.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PKG, REAL_MODEL, REAL_MODEL_B } from '../lib/driver.ts';
import { packagesRegistering, providerOf } from '../lib/providers.ts';
import type { Ctx } from '../lib/driver.ts';
import type { RunView } from '../lib/view.ts';

export const FORGE_CLI = join(PKG, 'tests/workflow-parity/fixtures/forge-cli.mjs');
export const WATCH_PR = join(PKG, 'generated/skills/poteto-mode/scripts/watch-pr/watch-pr');
export const FORGE_TOKEN = 'ghp_workflowparityforgetoken0123456789';

export interface CheckDef {
  name: string;
  runId: number;
  state: 'SUCCESS' | 'FAILURE' | 'PENDING';
  workflow?: string;
  /** The next `pendingReads` reads of the checks report PENDING, then the check settles on `then`. */
  pendingReads?: number;
  then?: 'SUCCESS' | 'FAILURE';
  log?: string;
  /** What a whole-run rerun leads to. */
  rerun?: { pendingReads: number; then: 'SUCCESS' | 'FAILURE' };
}

export interface ThreadDef {
  id: string;
  comments: { id: string; author: string; body: string; path: string; line: number; createdAt: string }[];
  resolved?: boolean;
}

export interface PrDef {
  number: number;
  title: string;
  body?: string;
  head: string;
  base: string;
  author: string;
  /** Checks per head: wave 0 is the first head the forge sees, wave 1 the next, and the last repeats. */
  waves?: CheckDef[][];
  threads?: ThreadDef[];
  reviewDecision?: string;
  isDraft?: boolean;
}

export interface BranchDef {
  name: string;
  from: string;
  files: Record<string, string>;
  message: string;
}

export type ChaosStep =
  | { type: 'advance-trunk'; branch: string; file: string; content: string; message?: string }
  | { type: 'rebase'; onto: string; branches: string[]; edits?: Record<string, { file: string; content: string }>; resolve?: Record<string, { file: string; content: string }> };

export interface ForgeEvent {
  when: { op: 'comment'; pr?: number; match?: string; /** Fire only once each of these PRs has a verdict comment. */ verdictsFor?: number[] };
  do: ChaosStep[];
}

export interface ForgeDef {
  owner: string;
  name: string;
  /** The repository merges through a queue: `gh pr merge` only queues. */
  queue?: boolean;
  branches: BranchDef[];
  /** Commits landed on trunk after the branches were cut, so a branch that touches the same lines conflicts for real. */
  trunkAfter?: { file: string; content: string; message: string }[];
  prs: PrDef[];
  events?: ForgeEvent[];
  /** Put an `origin` executable on PATH. Absent, `command -v origin` fails and a run stays on `gh`. */
  originCli?: boolean;
  /** PR numbers a head branch gets when it is opened, so a scripted run can name a PR before it exists. */
  reserve?: Record<string, number>;
  /** `gh auth token` fails, so a container worker cannot be given a forge token. */
  noToken?: boolean;
}

export interface ForgeHandle {
  bare: string;
  dir: string;
  bin: string;
  /** SHA of a branch tip in the bare repository now. */
  tip: (branch: string) => string;
}

const HOOK = `#!/bin/sh
# Logs every ref update with who pushed it: the environment of the pushing git reaches this hook.
zero=0000000000000000000000000000000000000000
while read old new ref; do
  if [ "$old" = "$zero" ]; then kind=ref-create
  elif [ "$new" = "$zero" ]; then kind=ref-delete
  elif git merge-base --is-ancestor "$old" "$new" 2>/dev/null; then kind=push
  else kind=force-push; fi
  printf '{"kind":"%s","ref":"%s","old":"%s","new":"%s","worker":"%s","run":"%s","actor":"%s","container":%s}\\n' "$kind" "$ref" "$old" "$new" "\${PSTACK_WORKER_ID:-}" "\${PSTACK_RUN_ID:-}" "\${FORGE_ACTOR:-}" "$([ "\${PSTACK_CONTAINER:-}" = 1 ] && echo true || echo false)" >> "$(pwd)/forge/actions.jsonl"
done
`;

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Builds the bare origin, the branches, the state file, the hook and the executables. Call it from `prepare`, after the repo exists. */
export function setupForge(ctx: Ctx, def: ForgeDef): ForgeHandle {
  const root = join(ctx.sandbox, 'forge');
  const bare = join(root, 'origin.git');
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(ctx.repo, 'remote', 'add', 'origin', bare);
  git(ctx.repo, 'push', '-q', 'origin', 'main');
  const scratch = mkdtempSync(join(tmpdir(), 'forge-fixture-'));
  try {
    git(scratch, 'clone', '-q', bare, '.');
    for (const branch of def.branches) {
      git(scratch, 'checkout', '-q', '-B', branch.name, `origin/${branch.from}`);
      for (const [path, content] of Object.entries(branch.files)) {
        mkdirSync(join(scratch, path, '..'), { recursive: true });
        writeFileSync(join(scratch, path), content);
      }
      git(scratch, 'add', '-A');
      git(scratch, 'commit', '-q', '-m', branch.message);
      git(scratch, 'push', '-q', 'origin', branch.name);
    }
    for (const commit of def.trunkAfter ?? []) {
      git(scratch, 'checkout', '-q', '-B', 'main', 'origin/main');
      writeFileSync(join(scratch, commit.file), commit.content);
      git(scratch, 'add', '-A');
      git(scratch, 'commit', '-q', '-m', commit.message);
      git(scratch, 'push', '-q', 'origin', 'main');
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  git(ctx.repo, 'fetch', '-q', 'origin');
  const dir = join(bare, 'forge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'actions.jsonl'), '');
  const state = {
    repo: { owner: def.owner, name: def.name, trunk: 'main' },
    queue: def.queue === true,
    noToken: def.noToken === true,
    reserve: def.reserve ?? {},
    events: def.events ?? [],
    prs: Object.fromEntries(def.prs.map((pr) => [String(pr.number), { repo: { owner: def.owner, name: def.name }, state: 'OPEN', mergedAt: null, isDraft: pr.isDraft === true, reviewDecision: pr.reviewDecision ?? '', comments: [], threads: (pr.threads ?? []).map((thread) => ({ resolved: false, ...thread })), checks: [], ci: { waves: pr.waves ?? [[{ name: 'build', workflow: 'CI', runId: 9000 + pr.number, state: 'SUCCESS' }]], wave: 0, sha: null, history: [] }, number: pr.number, title: pr.title, body: pr.body ?? '', base: pr.base, baseAtStart: pr.base, head: pr.head, author: pr.author }])),
  };
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2));
  mkdirSync(join(bare, 'hooks'), { recursive: true });
  writeFileSync(join(bare, 'hooks', 'pre-receive'), HOOK);
  chmodSync(join(bare, 'hooks', 'pre-receive'), 0o755);
  copyFileSync(FORGE_CLI, join(bin, 'forge-cli.mjs'));
  writeFileSync(join(bin, 'package.json'), JSON.stringify({ name: 'workflow-parity-forge', private: true, pi: { extensions: ['./index.mjs'] } }));
  writeFileSync(join(bin, 'index.mjs'), `export default function () { process.env.PATH = ${JSON.stringify(bin)} + ':' + process.env.PATH; process.env.FORGE_GIT_DIR = ${JSON.stringify(bare)}; }\n`);
  for (const name of def.originCli === true ? ['gh', 'origin'] : ['gh']) {
    writeFileSync(join(bin, name), `#!/bin/sh\nexport FORGE_GIT_DIR='${bare}'\nexec node '${join(bin, 'forge-cli.mjs')}' ${name} "$@"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return { bare, dir, bin, tip: (branch) => git(bare, 'rev-parse', `refs/heads/${branch}`) };
}

// ---- reading the forge from a finished run

export interface ForgeCheckState {
  name: string;
  runId: number;
  state: string;
  reruns?: number;
}

export interface ForgePrState {
  number: number;
  title: string;
  body: string;
  base: string;
  /** The base the PR was opened with: a retarget changes `base`, never this. */
  baseAtStart?: string;
  head: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  author: string;
  mergedHead?: string;
  queued?: boolean;
  autoMerge?: boolean;
  comments: { author: string; body: string; createdAt: string }[];
  threads: { id: string; resolved: boolean; comments: { id: string; author: string; body: string }[] }[];
  checks: ForgeCheckState[];
}

export interface ForgeState {
  repo: { owner: string; name: string; trunk: string };
  queue: boolean;
  prs: Record<string, ForgePrState>;
}

export interface ForgeAction {
  kind: string;
  tool?: string;
  argv?: string[];
  pr?: number;
  worker: string;
  run: string;
  actor: string;
  container: boolean;
  authenticated?: boolean;
  [key: string]: unknown;
}

export const forgeDirOf = (sandbox: string): string => join(sandbox, 'forge', 'origin.git', 'forge');
export const bareOf = (sandbox: string): string => join(sandbox, 'forge', 'origin.git');

export function readForge(view: Pick<RunView, 'sandbox'>): { state: ForgeState; actions: ForgeAction[] } {
  const dir = forgeDirOf(view.sandbox);
  const text = existsSync(join(dir, 'actions.jsonl')) ? readFileSync(join(dir, 'actions.jsonl'), 'utf8') : '';
  return { state: JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as ForgeState, actions: text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as ForgeAction) };
}

/** The parent's own forge calls and pushes: no worker id and no simulated operator. */
export const byParent = (action: ForgeAction): boolean => action.worker === '' && action.actor === '';
export const isRefUpdate = (action: ForgeAction): boolean => ['push', 'force-push', 'ref-create', 'ref-delete'].includes(action.kind);
export const WRITES = ['merge', 'merge-queued', 'auto-merge', 'create', 'edit-base', 'ready', 'comment', 'reply', 'resolve', 'rerun'];

export function editForge(sandbox: string, change: (actions: ForgeAction[], state: ForgeState) => void): void {
  const dir = forgeDirOf(sandbox);
  const { state, actions } = readForge({ sandbox });
  change(actions, state);
  writeFileSync(join(dir, 'actions.jsonl'), actions.map((action) => JSON.stringify(action)).join('\n') + (actions.length === 0 ? '' : '\n'));
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2));
}

/** Settles a PR's pending checks while a run is live, the way CI finishing would. Takes the forge's own lock so a running `gh` never reads a half-written state. */
export function settleChecks(sandbox: string, pr: number, to: 'SUCCESS' | 'FAILURE' = 'SUCCESS'): void {
  const dir = forgeDirOf(sandbox);
  const lock = join(dir, 'lock');
  for (let tries = 0; ; tries += 1) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (tries > 400) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as { prs: Record<string, { checks: { state: string; pendingReads?: number }[] }> };
    for (const check of state.prs[String(pr)]?.checks ?? []) Object.assign(check, { state: to, pendingReads: 0 });
    writeFileSync(join(dir, 'state.tmp'), JSON.stringify(state, null, 2));
    renameSync(join(dir, 'state.tmp'), join(dir, 'state.json'));
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** `git patch-id --stable` of the diff a commit makes against its parent. */
export function patchIdOf(bare: string, sha: string): string {
  const patch = spawnSync('git', ['--git-dir', bare, 'show', '--format=', '-p', sha], { encoding: 'utf8' }).stdout;
  return spawnSync('git', ['patch-id', '--stable'], { input: patch, encoding: 'utf8' }).stdout.split(' ')[0] ?? '';
}

export const revParse = (bare: string, ref: string): string => spawnSync('git', ['--git-dir', bare, 'rev-parse', ref], { encoding: 'utf8' }).stdout.trim();

/** The environment a PR workflow's Pi gets: the fake `gh` first on PATH, a pinned container engine, and the scripted model for container workers. */
export function forgeEnv(ctx: Ctx, handle: ForgeHandle, options: { container?: boolean; scripted?: boolean; token?: boolean; engine?: boolean } = {}): Record<string, string> {
  const env: Record<string, string> = { PATH: `${handle.bin}:${process.env['PATH'] ?? ''}`, FORGE_GIT_DIR: handle.bare };
  if (options.container === true) {
    const engine = process.env['DOCKER_HOST'] ?? spawnSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8' }).stdout.trim();
    if (engine !== '') env['DOCKER_HOST'] = engine;
    if (options.engine === false) env['DOCKER_HOST'] = 'unix:///nonexistent/pstack-docker.sock';
    if (options.token !== false) env['PSTACK_CONTAINER_FORGE_TOKEN'] = FORGE_TOKEN;
    const providers = options.scripted === true ? [] : [...new Set([REAL_MODEL, REAL_MODEL_B].filter(Boolean).flatMap((model) => packagesRegistering(providerOf(model))))];
    env['PSTACK_CONTAINER_PROVIDER_PACKAGES'] = [handle.bin, ...providers].join(':');
  }
  if (options.container === true && options.scripted === true) {
    env['PSTACK_CONTAINER_PROVIDER_PACKAGES'] = [handle.bin, join(PKG, 'tests/workflow-parity/fixtures/sim-provider'), join(ctx.sandbox, 'sim-scenario')].join(':');
    env['PSTACK_SCENARIO'] = join(ctx.sandbox, 'sim-scenario', 'scenario.json');
  }
  return env;
}

/** Writes the scenario where a container worker can read it, as a package directory with no extensions of its own. */
export function writeContainerScenario(ctx: Ctx, scenario: unknown): void {
  const dir = join(ctx.sandbox, 'sim-scenario');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sim-scenario', private: true, pi: { extensions: [] } }));
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify(scenario));
}

/** Runs the real watch-pr against a copy of the finished forge, so reading it changes nothing in the artifact. */
export function watchVerdict(view: Pick<RunView, 'sandbox'>, args: string[], options: { timeoutMs?: number; until?: string } = {}): { code: number; stdout: string } {
  const scratch = mkdtempSync(join(tmpdir(), 'forge-watch-'));
  try {
    const copy = join(scratch, 'origin.git');
    spawnSync('cp', ['-R', bareOf(view.sandbox), copy]);
    rmSync(join(copy, 'forge', 'lock'), { recursive: true, force: true });
    const bin = join(scratch, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\nexport FORGE_GIT_DIR='${copy}'\nexec node '${FORGE_CLI}' gh "$@"\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}` };
    const run = options.until === undefined ? spawnSync(WATCH_PR, args, { encoding: 'utf8', timeout: options.timeoutMs ?? 60_000, env }) : spawnSync('node', [join(PKG, 'tests/workflow-parity/fixtures/watch-until.mjs'), WATCH_PR, options.until, ...args], { encoding: 'utf8', timeout: 60_000, env });
    return { code: run.status ?? -1, stdout: run.stdout };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export const COMMIT_ENV = { GIT_AUTHOR_NAME: 'owner', GIT_AUTHOR_EMAIL: 'owner@example.com', GIT_COMMITTER_NAME: 'owner', GIT_COMMITTER_EMAIL: 'owner@example.com', GIT_AUTHOR_DATE: '2026-11-12T08:00:00+0000', GIT_COMMITTER_DATE: '2026-11-12T08:00:00+0000' };
/** The shell prefix that makes a commit reproducible: the same tree, parent and message give the same SHA. */
export const COMMIT_PREFIX = Object.entries(COMMIT_ENV).map(([key, value]) => `${key}=${value}`).join(' ');

/** The SHAs a chain of worker commits will have, computed by making the same commits in a scratch clone, so a scripted run can name them before the workers exist. */
export function predictCommits(handle: ForgeHandle, options: { from: string; steps: { files: Record<string, string>; message: string }[] }): string[] {
  const scratch = mkdtempSync(join(tmpdir(), 'forge-predict-'));
  try {
    const run = (...args: string[]) => execFileSync('git', ['-C', scratch, ...args], { encoding: 'utf8', env: { ...process.env, ...COMMIT_ENV } }).trim();
    run('clone', '-q', handle.bare, '.');
    run('checkout', '-q', '--detach', `origin/${options.from}`);
    return options.steps.map((step) => {
      for (const [path, content] of Object.entries(step.files)) {
        mkdirSync(join(scratch, path, '..'), { recursive: true });
        writeFileSync(join(scratch, path), content);
      }
      run('add', '-A');
      run('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', step.message);
      return run('rev-parse', 'HEAD');
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export const predictCommit = (handle: ForgeHandle, options: { from: string; files: Record<string, string>; message: string }): string => predictCommits(handle, { from: options.from, steps: [options] })[0] as string;
