import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/start-run.mjs', import.meta.url));
const playbooks = fileURLToPath(new URL('../../vendor/upstream-pstack/skills/poteto-mode/playbooks/', import.meta.url));
const names = readdirSync(playbooks).filter((name) => name.endsWith('.md')).sort();
const revision = '3dbd22ff12742fb28c9700b9760baa29ed41dc13';
const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-todo-'));
  temporary.push(dir);
  return dir;
}
function cli(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}
function run(cwd: string, name: string, runId = 'test-run', extra: string[] = []) {
  return cli(cwd, ['--playbook', name, '--title', 'Test run', '--run-id', runId, ...extra]);
}
const todoPath = (cwd: string, id = 'test-run') => join(cwd, '.pi/pstack/runs', id, 'TODO.md');
function rawBlock(todo: Buffer): Buffer {
  const start = Buffer.from('<!-- upstream-steps:start -->\n');
  const end = Buffer.from('\n<!-- upstream-steps:end -->');
  const at = todo.indexOf(start);
  expect(at).toBeGreaterThanOrEqual(0);
  const stop = todo.indexOf(end, at + start.length);
  expect(stop).toBeGreaterThanOrEqual(at + start.length);
  return todo.subarray(at + start.length, stop);
}
interface Step { n: number; status: string; requiredProof: string; source: string; evidence: string[]; skip: string | null }
function ledger(todo: Buffer): Step[] {
  const json = todo.toString().split('## Status ledger\n\n```json\n')[1]?.split('\n```')[0];
  if (json === undefined) throw new Error('Missing status ledger');
  return JSON.parse(json) as Step[];
}

// Independent source slicing. No production extractor or generated skill participates in this oracle.
function sourceBlock(source: Buffer): Buffer {
  const text = source.toString();
  const first = /^\d+\. /m.exec(text);
  if (first === null) return Buffer.alloc(0);
  const lines = text.slice(first.index).split(/(?<=\n)/);
  let last = 0;
  let offset = Buffer.byteLength(text.slice(0, first.index));
  let fence = false;
  let end = offset;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && /^\d+\. /m.test(line)) last = offset;
    offset += Buffer.byteLength(line);
  }
  const tail = source.subarray(last).toString().split(/(?<=\n)/);
  end = last;
  for (const [index, line] of tail.entries()) {
    if (index > 0 && !/^[ \t\r\n]/.test(line)) break;
    end += Buffer.byteLength(line);
  }
  return source.subarray(Buffer.byteLength(text.slice(0, first.index)), end);
}

test('the source inventory contains all 23 playbooks', () => expect(names).toHaveLength(23));

test.for(names)('CLI preserves pinned source bytes and a separate pending ledger for %s', (filename) => {
  const cwd = project();
  const name = filename.slice(0, -3);
  const result = run(cwd, name);
  expect(result.status, result.stderr).toBe(0);
  const todo = readFileSync(todoPath(cwd));
  const expected = sourceBlock(readFileSync(join(playbooks, filename)));
  expect(rawBlock(todo).equals(expected)).toBe(true);
  const steps = ledger(todo);
  const numbers = [...expected.toString().matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));
  expect(steps.map((step) => step.n)).toEqual(numbers);
  for (const step of steps) {
    expect(step).toMatchObject({ status: 'pending', evidence: [], skip: null });
    expect(step.requiredProof.length).toBeGreaterThan(0);
    expect(step.source).toMatch(new RegExp(`/blob/${revision}/pstack/skills/poteto-mode/playbooks/${filename}#L\\d+$`));
  }
  expect(todo.toString().indexOf('## Original playbook steps')).toBeLessThan(todo.toString().indexOf('## Status ledger'));
  expect(todo.toString().endsWith('## Task-specific work\n')).toBe(true);
  expect(JSON.parse(readFileSync(join(cwd, '.pi/pstack/runs/test-run/run.json'), 'utf8'))).toMatchObject({
    schemaVersion: 1, runId: 'test-run', playbook: name, title: 'Test run', upstreamRevision: revision, inputCommit: null,
  });
});

test('ledger edits retain skipped and blocked steps without changing the raw source', () => {
  const cwd = project();
  expect(run(cwd, 'feature').status).toBe(0);
  const before = rawBlock(readFileSync(todoPath(cwd)));
  for (const [n, status, extra] of [
    ['1', 'running', []], ['1', 'passed', ['--evidence', 'r1']],
    ['2', 'skipped', ['--skip', 'not applicable']], ['3', 'blocked', []],
  ] as const) {
    const result = cli(cwd, ['--run-id', 'test-run', '--step', n, '--status', status, ...extra]);
    expect(result.status, result.stderr).toBe(0);
    expect(rawBlock(readFileSync(todoPath(cwd))).equals(before)).toBe(true);
  }
  const steps = ledger(readFileSync(todoPath(cwd)));
  expect(steps.slice(0, 3)).toMatchObject([
    { n: 1, status: 'passed', evidence: ['r1'] }, { n: 2, status: 'skipped', skip: 'skip: not applicable' }, { n: 3, status: 'blocked' },
  ]);
  const archived = cli(cwd, ['--run-id', 'test-run', '--archive']);
  expect(archived.status, archived.stderr).toBe(0);
  expect(readFileSync(join(cwd, '.pi/pstack/runs/test-run/TODO.archived.md')).equals(readFileSync(todoPath(cwd)))).toBe(true);
  expect(run(cwd, 'bug-fix', 'next-run').status).toBe(0);
});

test.for(['whitespace', 'order'])('refuses ledger updates when immutable source %s changes', (mutation) => {
  const cwd = project();
  expect(run(cwd, 'feature').status).toBe(0);
  const text = readFileSync(todoPath(cwd), 'utf8');
  const changed = mutation === 'whitespace' ? text.replace('1. `how`', '1.  `how`') : text.replace('1. `how` over the affected subsystem.\n2. `architect` for parallel design exploration.', '2. `architect` for parallel design exploration.\n1. `how` over the affected subsystem.');
  writeFileSync(todoPath(cwd), changed);
  const result = cli(cwd, ['--run-id', 'test-run', '--step', '1', '--status', 'running']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('immutable');
  expect(readFileSync(todoPath(cwd), 'utf8')).toBe(changed);
});

test('only the coordinator session can update its active TODO', () => {
  const cwd = project();
  expect(run(cwd, 'feature', 'test-run', ['--parent-session-file', '/parent.jsonl']).status).toBe(0);
  const before = readFileSync(todoPath(cwd));
  for (const env of [{ PI_SESSION_FILE: '/other.jsonl' }, { PI_SESSION_FILE: '/parent.jsonl', PSTACK_WORKER: '1', PSTACK_RUN_ROOT: join(cwd, '.pi/pstack/runs/test-run') }]) {
    const result = cli(cwd, ['--run-id', 'test-run', '--step', '1', '--status', 'running'], env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('coordinator');
    expect(readFileSync(todoPath(cwd)).equals(before)).toBe(true);
  }
  expect(cli(cwd, ['--run-id', 'test-run', '--step', '1', '--status', 'running'], { PI_SESSION_FILE: '/parent.jsonl' }).status).toBe(0);
});

test.for([
  ['--status', 'done'], ['--status', 'skipped'], ['--status', 'skipped', '--skip', ''],
  ['--status', 'skipped', '--skip', 'two\nlines'], ['--status', 'passed'],
  ['--status', 'running', '--required-proof', ''], ['--status', 'running', '--step', '99'],
])('rejects invalid ledger edits atomically (%j)', (extra) => {
  const cwd = project();
  expect(run(cwd, 'feature').status).toBe(0);
  const before = readFileSync(todoPath(cwd));
  const result = cli(cwd, ['--run-id', 'test-run', '--step', '1', ...extra]);
  expect(result.status).toBe(1);
  expect(readFileSync(todoPath(cwd)).equals(before)).toBe(true);
  expect(readdirSync(join(cwd, '.pi/pstack/runs/test-run')).some((name) => name.endsWith('.tmp'))).toBe(false);
});

test('task-specific edits and archive leave source bytes and ledger unchanged', () => {
  const cwd = project();
  expect(run(cwd, 'feature').status).toBe(0);
  const before = readFileSync(todoPath(cwd));
  for (const extra of [[], ['--task-status', 'passed']]) {
    const result = cli(cwd, ['--run-id', 'test-run', '--task', 'Own work', ...extra]);
    expect(result.status, result.stderr).toBe(0);
  }
  const after = readFileSync(todoPath(cwd));
  expect(rawBlock(after).equals(rawBlock(before))).toBe(true);
  expect(ledger(after)).toEqual(ledger(before));
  expect(after.toString()).toContain('## Task-specific work\n- [x] Own work\n');
});

test('keeps a single active run and refuses to overwrite an existing run', () => {
  const cwd = project();
  expect(run(cwd, 'feature').status).toBe(0);
  const before = readFileSync(todoPath(cwd));
  expect(run(cwd, 'bug-fix').status).toBe(1);
  const second = run(cwd, 'bug-fix', 'second');
  expect(second.status).toBe(1);
  expect(second.stderr).toContain('active');
  expect(readFileSync(todoPath(cwd)).equals(before)).toBe(true);
});

test.for(['../escape', 'UPPER', '', 'a'.repeat(41)])('rejects invalid run id %j without creating a run', (id) => {
  const cwd = project();
  const result = run(cwd, 'feature', id);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Invalid run id');
  expect(existsSync(join(cwd, '.pi'))).toBe(false);
});

test('rejects playbook path traversal', () => {
  const cwd = project();
  expect(run(cwd, '../feature').status).toBe(1);
  expect(existsSync(join(cwd, '.pi'))).toBe(false);
});

test('uses the git project root and records the parent session and input commit', () => {
  const cwd = project();
  execFileSync('git', ['init', '-q', cwd]);
  execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Initial', '--allow-empty']);
  const commit = execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const child = join(cwd, 'child');
  mkdirSync(child);
  const result = run(child, 'feature', 'git-run', ['--parent-session-file', '/parent-session.jsonl']);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(readFileSync(join(cwd, '.pi/pstack/runs/git-run/run.json'), 'utf8'))).toMatchObject({ inputCommit: commit, parentSessionFile: '/parent-session.jsonl' });
});
