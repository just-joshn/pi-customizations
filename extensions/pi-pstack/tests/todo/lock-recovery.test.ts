import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/start-run.mjs', import.meta.url));
const preload = new URL('./fixtures/pause-writer.mjs', import.meta.url);
const temporary: string[] = [];
const children: { child: ChildProcessWithoutNullStreams; done: Promise<Result> }[] = [];
interface Result {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}
type Boundary = 'acquired' | 'opened' | 'exit';

afterEach(async () => {
  for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await Promise.all(children.splice(0).map(({ done }) => done));
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-todo-recovery-'));
  temporary.push(dir);
  return dir;
}
function cli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
}
function start(id = 'test-run') {
  return ['--playbook', 'feature', '--title', 'Crash recovery', '--run-id', id];
}
function task(name: string) {
  return ['--run-id', 'test-run', '--task', name];
}
const todoPath = (cwd: string) => join(cwd, '.pi/pstack/runs/test-run/TODO.md');
const lockPath = (cwd: string) => join(cwd, '.pi/pstack/todo.lock');
function immutable(todo: Buffer) {
  const end = todo.indexOf('## Status ledger\n');
  expect(end).toBeGreaterThan(0);
  return todo.subarray(0, end);
}
function writer(cwd: string, args: string[], phase: 'acquired' | 'opened' = 'acquired', gated = false) {
  const url = new URL(preload);
  url.searchParams.set('phase', phase);
  if (gated) url.searchParams.set('gate', '1');
  const child = spawn(process.execPath, ['--import', url.href, script, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (data: string) => {
    stderr += data;
  });
  let atReady: () => void = () => {};
  let atBoundary: (value: Boundary) => void = () => {};
  const ready = new Promise<void>((resolve) => {
    atReady = resolve;
  });
  const boundary = new Promise<Boundary>((resolve) => {
    atBoundary = resolve;
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (line === 'lock-test:ready') atReady();
    if (line === 'lock-test:acquired') atBoundary('acquired');
    if (line === 'lock-test:opened') atBoundary('opened');
  });
  const done = new Promise<Result>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      atReady();
      atBoundary('exit');
      lines.close();
      resolve({ code, signal, stderr });
    });
  });
  children.push({ child, done });
  return { child, ready, boundary, done, release: () => child.stdin.write('x') };
}

async function kill(owner: ReturnType<typeof writer>) {
  expect(owner.child.kill('SIGKILL')).toBe(true);
  expect(await owner.done).toMatchObject({ code: null, signal: 'SIGKILL' });
}

test('a real writer killed at acquisition does not block the next start', async () => {
  const cwd = project();
  const owner = writer(cwd, start());
  expect(await owner.boundary).toBe('acquired');
  expect(existsSync(todoPath(cwd))).toBe(false);
  await kill(owner);
  const recovered = cli(cwd, start());
  expect(recovered.status, recovered.stderr).toBe(0);
  expect(readFileSync(todoPath(cwd), 'utf8')).toContain('# Crash recovery');
});

test('live ownership cannot be stolen and death permits update, archive, and start', async () => {
  const cwd = project();
  expect(cli(cwd, start()).status).toBe(0);
  const before = readFileSync(todoPath(cwd));
  const owner = writer(cwd, task('Killed task'));
  expect(await owner.boundary).toBe('acquired');
  for (const args of [task('Contender'), ['--run-id', 'test-run', '--archive'], start('other-run')]) {
    const contender = cli(cwd, args);
    expect(contender.status, contender.stderr).toBe(1);
    expect(readFileSync(todoPath(cwd)).equals(before)).toBe(true);
  }
  expect(owner.child.exitCode).toBeNull();
  expect(owner.child.signalCode).toBeNull();
  await kill(owner);
  const update = cli(cwd, ['--run-id', 'test-run', '--step', '1', '--status', 'passed', '--evidence', 'recovery-receipt']);
  expect(update.status, update.stderr).toBe(0);
  const after = readFileSync(todoPath(cwd));
  expect(immutable(after).equals(immutable(before))).toBe(true);
  expect(after.toString()).toContain('recovery-receipt');
  expect(after.toString()).not.toContain('Killed task');
  const archive = cli(cwd, ['--run-id', 'test-run', '--archive']);
  expect(archive.status, archive.stderr).toBe(0);
  expect(readFileSync(join(cwd, '.pi/pstack/runs/test-run/TODO.archived.md')).equals(after)).toBe(true);
  expect(cli(cwd, start('next-run')).status).toBe(0);
});

test('death after opening the lock file needs no owner publication to recover', async () => {
  const cwd = project();
  const owner = writer(cwd, start(), 'opened');
  expect(await owner.boundary).toBe('opened');
  expect(existsSync(lockPath(cwd))).toBe(true);
  expect(existsSync(todoPath(cwd))).toBe(false);
  await kill(owner);
  const recovered = cli(cwd, start());
  expect(recovered.status, recovered.stderr).toBe(0);
});

test('simultaneous starts recover an interrupted first lock initialization without replacing its inode', async () => {
  const cwd = project();
  const owner = writer(cwd, start(), 'opened');
  expect(await owner.boundary).toBe('opened');
  const identity = statSync(lockPath(cwd));
  await kill(owner);
  const contenders = Array.from({ length: 8 }, (_, n) => writer(cwd, start(`run-${n}`), 'acquired', true));
  await Promise.all(contenders.map((contender) => contender.ready));
  for (const contender of contenders) contender.release();
  const outcomes = await Promise.all(contenders.map((contender) => contender.boundary));
  expect(outcomes.filter((outcome) => outcome === 'acquired')).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome === 'exit')).toHaveLength(7);
  const winner = outcomes.indexOf('acquired');
  const accepted = contenders[winner];
  if (accepted === undefined) throw new Error('No recovery winner');
  accepted.release();
  const results = await Promise.all(contenders.map((contender) => contender.done));
  expect(results.filter((result) => result.code === 0)).toHaveLength(1);
  expect(results.filter((result) => result.code === 1)).toHaveLength(7);
  expect(readFileSync(join(cwd, '.pi/pstack/active-run'), 'utf8')).toBe(`run-${winner}\n`);
  expect(readdirSync(join(cwd, '.pi/pstack/runs'))).toEqual([`run-${winner}`]);
  expect(statSync(lockPath(cwd)).ino).toBe(identity.ino);
});

test('simultaneous recovery contenders admit only one writer and retain every accepted edit', async () => {
  const cwd = project();
  expect(cli(cwd, start()).status).toBe(0);
  const before = readFileSync(todoPath(cwd));
  const owner = writer(cwd, task('Killed task'));
  expect(await owner.boundary).toBe('acquired');
  await kill(owner);
  const contenders = Array.from({ length: 8 }, (_, n) => writer(cwd, task(`Task ${n}`), 'acquired', true));
  await Promise.all(contenders.map((contender) => contender.ready));
  for (const contender of contenders) contender.release();
  const outcomes = await Promise.all(contenders.map((contender) => contender.boundary));
  expect(outcomes.filter((outcome) => outcome === 'acquired')).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome === 'exit')).toHaveLength(7);
  expect(readFileSync(todoPath(cwd)).equals(before)).toBe(true);
  const winner = outcomes.indexOf('acquired');
  for (const [n, contender] of contenders.entries()) {
    if (n === winner) continue;
    expect(await contender.done).toMatchObject({ code: 1, signal: null });
  }
  const late = cli(cwd, task('Late contender'));
  expect(late.status, late.stderr).toBe(1);
  expect(readFileSync(todoPath(cwd)).equals(before)).toBe(true);
  const accepted = contenders[winner];
  if (accepted === undefined) throw new Error('No recovery winner');
  accepted.release();
  expect(await accepted.done).toMatchObject({ code: 0, signal: null });
  const first = readFileSync(todoPath(cwd), 'utf8');
  expect(first).toContain(`- [ ] Task ${winner}\n`);
  for (const [n] of contenders.entries()) {
    if (n !== winner) {
      expect(first).not.toContain(`- [ ] Task ${n}\n`);
      const retried = cli(cwd, task(`Task ${n}`));
      expect(retried.status, retried.stderr).toBe(0);
    }
  }
  const after = readFileSync(todoPath(cwd));
  expect(immutable(after).equals(immutable(before))).toBe(true);
  for (const [n] of contenders.entries()) expect(after.toString().split(`- [ ] Task ${n}\n`)).toHaveLength(2);
  expect(after.toString()).not.toContain('Killed task');
});

test.for(['empty', 'populated'])('legacy %s directory ownership remains unknowable and is never removed', (contents) => {
  const cwd = project();
  mkdirSync(lockPath(cwd), { recursive: true });
  if (contents === 'populated') writeFileSync(join(lockPath(cwd), 'operator-note'), 'Do not steal this lock\n');
  const result = cli(cwd, start());
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Legacy TODO lock');
  expect(statSync(lockPath(cwd)).isDirectory()).toBe(true);
  expect(readdirSync(lockPath(cwd))).toEqual(contents === 'empty' ? [] : ['operator-note']);
  if (contents === 'populated') expect(readFileSync(join(lockPath(cwd), 'operator-note'), 'utf8')).toBe('Do not steal this lock\n');
  expect(existsSync(todoPath(cwd))).toBe(false);
});

test('the stable lock file blocks legacy mkdir writers and survives action errors', () => {
  const cwd = project();
  expect(cli(cwd, start()).status).toBe(0);
  const identity = statSync(lockPath(cwd));
  expect(identity.isFile()).toBe(true);
  expect(() => mkdirSync(lockPath(cwd))).toThrow();
  const failed = cli(cwd, ['--run-id', 'test-run', '--step', '999', '--status', 'running']);
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain('Unknown source step');
  expect(cli(cwd, task('After error')).status).toBe(0);
  expect(statSync(lockPath(cwd)).ino).toBe(identity.ino);
});
