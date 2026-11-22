#!/usr/bin/env node
/**
 * End-to-end check against the real `pi` binary.
 *
 * Runs the extension from source in a throwaway workspace and profile, then asserts the
 * delegated work really happened: a foreground subagent, a background subagent in its own git
 * worktree, the await result, the persisted checkpoints, and the child transcript file.
 *
 * Usage:
 *   node test/e2e/verify-subagents.mjs
 *   PI_SUBAGENTS_E2E_MODEL=provider/model node test/e2e/verify-subagents.mjs
 *
 * Needs a logged-in Pi model. Exits 77 when `pi` is missing or the model cannot answer, so a
 * machine without credentials can skip it without looking like a failure.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_CODE = 77;
const ZERO = 0;
const ONE = 1;
const TWO = 2;
const TIMEOUT_MS = 420_000;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(scriptDir, '../../src/index.ts');
const model = process.env.PI_SUBAGENTS_E2E_MODEL ?? 'deepseek-flash';

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(ONE);
}

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', timeout: TIMEOUT_MS });
}

function pi(args, cwd) {
  const result = run('pi', ['-p', '--session-dir', join(workspace, 'sessions'), '-ne', '-e', extensionPath, '-ns', '-np', '--no-themes', '--approve', '--model', model, ...args], cwd);
  if (result.error) {
    console.error(`SKIP pi could not start: ${result.error.message}`);
    process.exit(SKIP_CODE);
  }
  return result;
}

const root = mkdtempSync(join(tmpdir(), 'pi-subagents-e2e-'));
const workspace = join(root, 'workspace');
mkdirSync(join(workspace, '.pi', 'agents'), { recursive: true });
mkdirSync(join(workspace, 'sessions'), { recursive: true });
writeFileSync(
  join(workspace, '.pi', 'agents', 'probe.md'),
  ['---', 'name: probe', 'description: Runs one shell command and reports its stdout verbatim.', 'tools: bash', '---', 'You run exactly the shell command you are given and report its stdout verbatim. Do nothing else.'].join('\n'),
);
execFileSync('git', ['init', '-q'], { cwd: workspace });
execFileSync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: workspace });
execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: workspace });
execFileSync('git', ['add', '-A'], { cwd: workspace });
execFileSync('git', ['commit', '-qm', 'base'], { cwd: workspace });

console.log(`evidence root: ${root}`);

const foreground = pi(
  ['Call the task tool once with subagent_type="probe", description="probe run", and prompt="Run this shell command and report its stdout verbatim: echo subagent-e2e-ok". Then reply with the exact text the subagent returned.'],
  workspace,
);
if (foreground.status !== ZERO) {
  console.error(foreground.stdout);
  console.error(foreground.stderr);
  if (/credentials|not_ready|auth/i.test(`${foreground.stdout}${foreground.stderr}`)) {
    console.error('SKIP model is not authenticated');
    process.exit(SKIP_CODE);
  }
  fail(`foreground run exited ${foreground.status}`);
}
if (!foreground.stdout.includes('subagent-e2e-ok')) {
  fail(`foreground subagent output missing from parent reply: ${foreground.stdout}`);
}
console.log('ok foreground subagent returned its shell output');

const background = pi(
  [
    'Call the task tool once with subagent_type="probe", description="isolated probe", run_in_background=true, worktree=true, prompt="Run this shell command and report its stdout verbatim: git rev-parse --abbrev-ref HEAD". Then call await_subagent with the returned agent_id and reply with the exact branch name it reported.',
  ],
  workspace,
);
if (background.status !== ZERO) {
  console.error(background.stdout);
  console.error(background.stderr);
  fail(`background worktree run exited ${background.status}`);
}
const branchMatch = /pi-subagents\/[a-z0-9-]+-[0-9a-f]{3}/.exec(background.stdout);
if (!branchMatch) {
  fail(`worktree branch missing from parent reply: ${background.stdout}`);
}
const branch = branchMatch[0];
console.log(`ok background subagent ran on ${branch}`);

const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' });
if (!worktrees.includes(branch)) {
  fail(`git does not list a worktree for ${branch}`);
}
console.log('ok git lists the isolated worktree');

const subagentDir = join(workspace, 'sessions', 'subagents');
if (!existsSync(subagentDir) || readdirSync(subagentDir).length === ZERO) {
  fail('no subagent transcript file was written');
}
console.log(`ok child transcripts written to ${subagentDir}`);

const parentSessions = readdirSync(join(workspace, 'sessions'))
  .filter((name) => name.endsWith('.jsonl'))
  .map((name) => join(workspace, 'sessions', name))
  .sort();
if (parentSessions.length === ZERO) {
  fail('no parent session file was written');
}
const snapshots = parentSessions.flatMap((sessionPath) =>
  readFileSync(sessionPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > ZERO)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.customType === 'pi-subagents-state')
    .flatMap((state) => state.data.sessions),
);
// Persisted state is appended as the run advances, so keep the newest snapshot per agent.
const sessions = [
  ...snapshots.reduce((latest, snapshot) => (latest.get(snapshot.agentId) === undefined || latest.get(snapshot.agentId).updatedAt <= snapshot.updatedAt ? latest.set(snapshot.agentId, snapshot) : latest), new Map()).values(),
];
if (sessions.length < TWO) {
  fail(`expected two recorded subagent runs, got ${sessions.length}`);
}
if (!sessions.every((session) => session.checkpoints.length > ZERO)) {
  fail('a recorded subagent run has no checkpoints');
}
if (!sessions.some((session) => session.worktree !== undefined)) {
  fail('no recorded run carries worktree metadata');
}
const roles = new Set(sessions.flatMap((session) => session.transcriptItems.map((item) => item.role)));
for (const role of ['user', 'tool', 'result', 'assistant']) {
  if (!roles.has(role)) {
    fail(`ordered transcript is missing the ${role} role`);
  }
}
console.log(`ok persisted state has ${sessions.length} runs with checkpoints, worktree metadata, and ordered transcripts`);

console.log(`PASS ${root}`);
