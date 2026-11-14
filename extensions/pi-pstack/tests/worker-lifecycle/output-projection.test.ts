import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { controlSocketPath, parseWorkerId, readHostState } from '../../src/run-files.ts';
import type { HostLaunch } from '../../src/worker-host.ts';

const names = ['session', 'evidence', 'report.md', 'decisions.tsv'] as const;
let root: string;
let workerDir: string;
let assignmentPath: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'p')));
  const runRoot = join(root, 'runs/r');
  workerDir = join(runRoot, 'workers/w');
  assignmentPath = join(workerDir, 'assignment.json');
  mkdirSync(join(workerDir, 'claim'), { recursive: true });
  writeFileSync(join(runRoot, 'run.json'), JSON.stringify({ schemaVersion: 1, runId: 'r', parentSessionFile: null }));
  writeFileSync(assignmentPath, JSON.stringify({ runId: 'r', workerId: 'w', role: 'general', model: 'inherit-parent', brief: 'brief.md', workspace: { mode: 'container', inputCommit: 'abc1234' } }));
  writeFileSync(join(workerDir, 'brief.md'), '@@say DONE');
  writeFileSync(join(workerDir, 'claim/launch-env.json'), JSON.stringify({ PATH: process.env['PATH'], HOME: root, TMPDIR: tmpdir() }), { mode: 0o600 });
  expect(controlSocketPath(runRoot, parseWorkerId('w'))).toBe(join(workerDir, 'control.sock'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

async function withHost(entry: string, check: (output: string) => void): Promise<void> {
  const launch: HostLaunch = {
    piCommand: [process.execPath, resolve(import.meta.dirname, 'fake-pi.mjs')],
    model: null,
    thinkingLevel: null,
    appendSystemPrompt: null,
    tools: null,
    tmuxSession: 'pstack_r_w_12345678',
    extraArgs: [],
    credentialEnv: [],
    container: null,
  };
  const host = spawn(process.execPath, [resolve(import.meta.dirname, '../..', entry), assignmentPath, JSON.stringify(launch)], { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(host, 'close');
  let output = '';
  host.stdout.on('data', (chunk) => {
    output += chunk;
  });
  host.stderr.on('data', (chunk) => {
    output += chunk;
  });
  try {
    await expect.poll(() => readHostState(workerDir)?.phase, { timeout: 10_000 }).toMatch(/^(idle|failed)$/);
    check(output);
    const state = readHostState(workerDir);
    if (state?.phase === 'failed') expect(await closed, output).toEqual([1, null]);
  } finally {
    if (host.exitCode === null && host.signalCode === null) host.stdin.write('shutdown\n');
    await closed;
  }
}

describe.for(['src/worker-host.ts', 'dist/worker-host.js'])('%s output projections', (entry) => {
  test.for(names.flatMap((name) => ['empty-directory', 'nonempty-directory', 'file', 'wrong-symlink', 'dangling-symlink'].map((kind) => ({ name, kind }))))('refuses $kind at $name without changing existing data', async ({ name, kind }) => {
    const path = join(workerDir, name);
    const target = join(root, 'other');
    if (kind.endsWith('directory')) {
      mkdirSync(path);
      if (kind === 'nonempty-directory') writeFileSync(join(path, 'keep.txt'), 'parent evidence');
    } else if (kind === 'file') writeFileSync(path, 'parent file');
    else {
      if (kind === 'wrong-symlink') writeFileSync(target, 'unrelated target');
      symlinkSync(target, path);
    }
    const before = lstatSync(path);
    await withHost(entry, () => {
      expect(lstatSync(path).ino).toBe(before.ino);
      if (kind === 'file') expect(readFileSync(path, 'utf8')).toBe('parent file');
      if (kind === 'nonempty-directory') expect(readFileSync(join(path, 'keep.txt'), 'utf8')).toBe('parent evidence');
      if (before.isSymbolicLink()) expect(readlinkSync(path)).toBe(target);
      if (kind === 'wrong-symlink') expect(readFileSync(target, 'utf8')).toBe('unrelated target');
      if (kind === 'dangling-symlink') expect(existsSync(target)).toBe(false);
      const state = readHostState(workerDir);
      expect(state?.phase).toBe('failed');
      expect(state?.reason).toContain(path);
      expect(state?.reason).toContain(join('out', name));
      expect(state?.reason).toMatch(/preserve|move|fresh worker/i);
      expect(state?.childPid).toBeNull();
      expect(state?.settles).toMatchObject([{ phase: 'failed' }]);
    });
  });

  test.for(['absent', 'relative', 'absolute', 'populated'])('launches with %s projections and exposes worker output', async (existing) => {
    if (existing !== 'absent') for (const name of names) symlinkSync(existing === 'absolute' ? join(workerDir, 'out', name) : join('out', name), join(workerDir, name));
    if (existing === 'populated') {
      for (const name of ['session', 'evidence']) mkdirSync(join(workerDir, 'out', name), { recursive: true });
      writeFileSync(join(workerDir, 'out/evidence/keep.txt'), 'previous evidence');
      writeFileSync(join(workerDir, 'out/report.md'), 'previous report');
      writeFileSync(join(workerDir, 'out/decisions.tsv'), 'previous decisions');
    } else expect(existsSync(join(workerDir, 'report.md'))).toBe(false);
    await withHost(entry, () => {
      const state = readHostState(workerDir);
      assert(state?.phase === 'idle');
      expect(state.childPid).toBeTypeOf('number');
      if (existing === 'populated') {
        expect(readFileSync(join(workerDir, 'evidence/keep.txt'), 'utf8')).toBe('previous evidence');
        expect(readFileSync(join(workerDir, 'report.md'), 'utf8')).toBe('previous report');
        expect(readFileSync(join(workerDir, 'decisions.tsv'), 'utf8')).toBe('previous decisions');
      }
      writeFileSync(join(workerDir, 'out/session/check.jsonl'), 'worker session');
      expect(readFileSync(join(workerDir, 'session/check.jsonl'), 'utf8')).toBe('worker session');
      writeFileSync(join(workerDir, 'out/evidence/check.txt'), 'worker evidence');
      writeFileSync(join(workerDir, 'out/report.md'), 'worker report');
      writeFileSync(join(workerDir, 'out/decisions.tsv'), 'worker decisions');
      expect(readFileSync(join(workerDir, 'evidence/check.txt'), 'utf8')).toBe('worker evidence');
      expect(readFileSync(join(workerDir, 'report.md'), 'utf8')).toBe('worker report');
      expect(readFileSync(join(workerDir, 'decisions.tsv'), 'utf8')).toBe('worker decisions');
      for (const name of names) expect(lstatSync(join(workerDir, name)).isSymbolicLink()).toBe(true);
    });
  });
});
