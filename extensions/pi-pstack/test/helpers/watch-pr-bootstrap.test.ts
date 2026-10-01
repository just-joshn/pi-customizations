import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { commitsPage, type FakeBin, fakeEnv, fastCheck, installFakeBin, ok, prView, threadsPage } from './watch-pr-fakes.test-helper.ts';

const shipped = new URL('../../skills/poteto-mode/scripts', import.meta.url).pathname;
const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `watch-pr-${label}-`));

function freshScripts(): string {
  const root = scratch('scripts');
  cpSync(shipped, join(root, 'scripts'), { recursive: true, filter: (source) => !source.includes('node_modules') });
  return join(root, 'scripts');
}
const launcher = (scripts: string): string => join(scripts, 'watch-pr', 'watch-pr');
const keyPath = (scripts: string): string => join(scripts, 'node_modules', '.poteto-mode-tools-install-key');
const lockPath = (scripts: string): string => join(scripts, '.poteto-mode-tools-install.lock');
const expectedKey = (scripts: string): string =>
  createHash('sha256')
    .update(readFileSync(join(scripts, 'package.json')))
    .update('\0')
    .update(readFileSync(join(scripts, 'bun.lock')))
    .digest('hex');

function launch(scripts: string, args: string[], cwd = scratch('cwd')) {
  const result = Bun.spawnSync(['bun', launcher(scripts), ...args], { cwd, env: process.env });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString(), cwd };
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('bootstrap installs under the scripts directory, not the cwd, when the launcher runs from an unrelated directory', () => {
  const scripts = freshScripts();
  const run = launch(scripts, ['--help']);
  expect(run.code).toBe(0);
  expect(run.stdout).toContain('Usage');
  expect(existsSync(join(scripts, 'node_modules', 'commander', 'package.json'))).toBe(true);
  expect(existsSync(join(run.cwd, 'node_modules'))).toBe(false);
});

test('bootstrap writes the install key as sha256 of package.json, a NUL byte, then bun.lock, plus a newline', () => {
  const scripts = freshScripts();
  launch(scripts, ['--help']);
  expect(readFileSync(keyPath(scripts), 'utf8')).toBe(`${expectedKey(scripts)}\n`);
});

test('bootstrap returns without reinstalling when the manifest, commander, and a matching key are present', async () => {
  const scripts = freshScripts();
  launch(scripts, ['--help']);
  const before = statSync(keyPath(scripts)).mtimeMs;
  await sleep(30);
  const again = launch(scripts, ['--help']);
  expect(again.code).toBe(0);
  expect(statSync(keyPath(scripts)).mtimeMs).toBe(before);
});

test('bootstrap reinstalls and rewrites the key when the stored key is stale', () => {
  const scripts = freshScripts();
  launch(scripts, ['--help']);
  writeFileSync(keyPath(scripts), 'stale\n');
  expect(launch(scripts, ['--help']).code).toBe(0);
  expect(readFileSync(keyPath(scripts), 'utf8')).toBe(`${expectedKey(scripts)}\n`);
});

test('bootstrap derives a new key and reinstalls when package.json changes', () => {
  const scripts = freshScripts();
  launch(scripts, ['--help']);
  const old = expectedKey(scripts);
  writeFileSync(join(scripts, 'package.json'), `${readFileSync(join(scripts, 'package.json'), 'utf8')}\n`);
  expect(launch(scripts, ['--help']).code).toBe(0);
  expect(expectedKey(scripts)).not.toBe(old);
  expect(readFileSync(keyPath(scripts), 'utf8')).toBe(`${expectedKey(scripts)}\n`);
});

test('bootstrap retries an interrupted install because the key file is only written after a verified install', () => {
  const scripts = freshScripts();
  launch(scripts, ['--help']);
  rmSync(keyPath(scripts));
  expect(launch(scripts, ['--help']).code).toBe(0);
  expect(existsSync(keyPath(scripts))).toBe(true);
});

test('launcher exit 7 with a bootstrap-failed BLOCKER and an untouched bun.lock when the frozen install fails', () => {
  const scripts = freshScripts();
  const manifest = JSON.parse(readFileSync(join(scripts, 'package.json'), 'utf8'));
  manifest.dependencies.commander = '13.0.0';
  writeFileSync(join(scripts, 'package.json'), JSON.stringify(manifest));
  const lockBefore = readFileSync(join(scripts, 'bun.lock'));
  const run = launch(scripts, ['--help']);
  expect(run.code).toBe(7);
  expect(run.stdout.trim().split('\n')).toHaveLength(1);
  const verdict = JSON.parse(run.stdout.trim());
  expect(verdict).toMatchObject({ kind: 'BLOCKER', exitCode: 7, blocker: { kind: 'status-query', failure: { kind: 'bootstrap-failed', retryable: false } } });
  expect(verdict.blocker.failure.detail).toContain('bun install --frozen-lockfile exited with status');
  expect(run.stderr.length).toBeGreaterThan(0);
  expect(readFileSync(join(scripts, 'bun.lock')).equals(lockBefore)).toBe(true);
  expect(existsSync(keyPath(scripts))).toBe(false);
});

test('launcher propagates a non-zero main result to the process exit status with empty stdout', () => {
  const scripts = freshScripts();
  const run = launch(scripts, ['--interval', '0']);
  expect(run.code).toBe(64);
  expect(run.stdout).toBe('');
});

test('bootstrap waits while another process holds the install lock and installs once it is released', async () => {
  const scripts = freshScripts();
  mkdirSync(lockPath(scripts));
  writeFileSync(join(lockPath(scripts), 'pid'), String(process.pid));
  const child = Bun.spawn(['bun', launcher(scripts), '--help'], { cwd: scratch('cwd'), stdout: 'pipe', stderr: 'pipe' });
  await sleep(1200);
  expect(existsSync(join(scripts, 'node_modules'))).toBe(false);
  rmSync(lockPath(scripts), { recursive: true });
  expect(await child.exited).toBe(0);
  expect(existsSync(keyPath(scripts))).toBe(true);
});

test('bootstrap reclaims an install lock whose owner process is gone', () => {
  const scripts = freshScripts();
  mkdirSync(lockPath(scripts));
  writeFileSync(join(lockPath(scripts), 'pid'), '2147483646');
  expect(launch(scripts, ['--help']).code).toBe(0);
  expect(existsSync(lockPath(scripts))).toBe(false);
});

test('two launchers started together on a fresh install both succeed and leave one valid key and no lock', async () => {
  const scripts = freshScripts();
  const spawn = () => Bun.spawn(['bun', launcher(scripts), '--help'], { cwd: scratch('cwd'), stdout: 'pipe', stderr: 'pipe' });
  const children = [spawn(), spawn(), spawn()];
  const codes = await Promise.all(children.map((child) => child.exited));
  expect(codes).toEqual([0, 0, 0]);
  expect(readFileSync(keyPath(scripts), 'utf8')).toBe(`${expectedKey(scripts)}\n`);
  expect(existsSync(lockPath(scripts))).toBe(false);
});

function pendingWatchRules(): FakeBin {
  return installFakeBin([
    { tool: 'gh', match: ['pr view'], replies: [ok(prView())] },
    { tool: 'gh', match: ['query ReviewThreads'], replies: [ok(threadsPage([], { hasNextPage: false, endCursor: null }))] },
    { tool: 'gh', match: ['pr checks'], replies: [{ code: 8, stdout: JSON.stringify([fastCheck('ci', 'pending', 'PENDING')]) }] },
    { tool: 'gh', match: ['query PrCommitStatuses'], replies: [ok(commitsPage([{ oid: 'head', state: 'PENDING' }]))] },
  ]);
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('a signal sent only to the launcher reaches the re-exec child so no polling watcher is orphaned', async () => {
  const scripts = freshScripts();
  const bin = pendingWatchRules();
  const args = ['--owner', 'o', '--repo', 'r', '--pr', '1', '--interval', '300'];
  const parent = Bun.spawn(['bun', launcher(scripts), ...args], { cwd: scratch('cwd'), env: { ...process.env, ...fakeEnv(bin) }, stdout: 'pipe', stderr: 'pipe' });
  let child = 0;
  for (let waited = 0; waited < 20000 && child === 0; waited += 200) {
    await sleep(200);
    child = bin.calls().find((call) => call.argv.includes('checks') || call.argv.join(' ').includes('pr checks'))?.ppid ?? 0;
  }
  try {
    expect(child).toBeGreaterThan(0);
    expect(child).not.toBe(parent.pid);
    parent.kill('SIGTERM');
    await parent.exited;
    await sleep(1500);
    expect(alive(child)).toBe(false);
  } finally {
    if (child > 0 && alive(child)) process.kill(child, 'SIGKILL');
    parent.kill('SIGKILL');
  }
}, 40000);

test('importing orch.ts does not run the dependency install', () => {
  const scripts = freshScripts();
  Bun.spawnSync(['bun', '-e', `await import(${JSON.stringify(join(scripts, 'orch', 'orch.ts'))})`], { cwd: scratch('cwd') });
  expect(existsSync(keyPath(scripts))).toBe(false);
  expect(existsSync(join(scripts, 'node_modules'))).toBe(false);
});
