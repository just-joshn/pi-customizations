import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { pickupFamily } from './families/ops.ts';
import { required } from './lib/required.ts';
import type { RunView } from './lib/view.ts';

test('pickup recognizes session reads after cd, not session listings', () => {
  const calls = [
    { name: 'read', order: 0, args: { path: '/repo/.pi/pstack/runs/prior-run/workers/old-worker/report.md' }, isError: false, resultText: '' },
    { name: 'bash', order: 1, args: { command: 'cd /repo/.pi/pstack/runs/prior-run/workers/old-worker/session && wc -l *.jsonl && cat *.jsonl | head -c 60000' }, isError: false, resultText: 'session' },
  ];
  const view = { parent: { messages: [], toolCalls: calls } } as unknown as RunView;
  const check = pickupFamily.checks.find((entry) => entry.id === 'pickup.trail-read-inside-this-workspace');
  expect(check?.run(view)).toMatchObject({ ok: true });
  required(calls[1]).args.command = 'cd /repo/.pi/pstack/runs/prior-run/workers/old-worker/session && ls *.jsonl';
  expect(check?.run(view)).toMatchObject({ ok: false });
});

test('an observed successful inherited-head test needs no fixture receipt id', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'pickup-observed-'));
  const repo = join(sandbox, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'parity@example.test');
    git('config', 'user.name', 'Parity');
    writeFileSync(join(repo, 'test.cjs'), "require('node:test')('works', () => {});\n");
    git('add', '.');
    git('commit', '-qm', 'base');
    git('branch', 'pstack-run/prior-run/old-worker');
    const output = execFileSync('node', ['--test'], { cwd: repo, encoding: 'utf8' });
    const call = { name: 'bash', order: 1, args: { command: `cd ${repo} && node --test` }, isError: false, resultText: output };
    const view = { sandbox, repo, runs: [], parent: { messages: [], toolCalls: [call] } } as unknown as RunView;
    const check = pickupFamily.checks.find((entry) => entry.id === 'pickup.inherited-claims-verified-on-the-real-artifact');
    expect(check?.run(view)).toMatchObject({ ok: true });
    call.args.command = `cd ${sandbox} && node --test`;
    expect(check?.run(view)).toMatchObject({ ok: false });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
