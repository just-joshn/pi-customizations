import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { autopilotStackFamily } from './families/pr-autopilot.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { Ctx } from './lib/driver.ts';
import type { RunView } from './lib/view.ts';

test.for([false, true])('a stacked owner starts at the observed parent head, not the fixture prediction (wrong=%s)', (wrong) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'stack-head-'));
  const repo = join(sandbox, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'test');
    git('config', 'user.email', 'test@example.com');
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    const ctx: Ctx = { driver: 'scripted', sandbox, repo, pkg: process.cwd(), base, commits: [base], runId: 'stack-head', skill: (name) => join(sandbox, 'skills', name, 'SKILL.md'), playbook: (name) => join(sandbox, 'playbooks', `${name}.md`), agentDir: join(sandbox, 'agent'), sessionsDir: join(sandbox, 'sessions') };
    autopilotStackFamily.spec.prepare?.(ctx);
    git('checkout', '-q', '-b', 'feat-greet-stack');
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'actual owner head');
    const parent = git('rev-parse', 'HEAD');
    git('push', '-q', 'origin', 'HEAD');
    git('checkout', '-q', '-b', 'feat-shout-stack');
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'dependent head');
    git('push', '-q', 'origin', 'HEAD');
    const state = JSON.parse(readFileSync(join(forgeDirOf(sandbox), 'state.json'), 'utf8'));
    state.prs = Object.fromEntries([41, 42].map((number, index) => [number, { number, title: 'unit', author: `owner-${number}`, head: index === 0 ? 'feat-greet-stack' : 'feat-shout-stack', base: index === 0 ? 'main' : 'feat-greet-stack' }]));
    writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify(state));
    writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), [41, 42].map((pr) => JSON.stringify({ kind: 'create', tool: 'gh', pr, worker: `owner-${pr}`, run: 'r', container: true })).join('\n'));
    const workers = [41, 42].map((pr, index) => ({ id: `owner-${pr}`, assignment: { role: 'owner', workspace: { mode: 'container', inputCommit: index === 0 || wrong ? base : parent }, capabilities: { forge: true, env: 'minimal', externalWrite: false } }, session: { cwd: '/tmp/workspace' } }));
    const view = { sandbox, runs: [{ id: 'r', workers }] } as unknown as RunView;
    expect(autopilotStackFamily.checks.find((check) => check.id === 'autopilot.stack.one-container-owner-per-pr')?.run(view)).toMatchObject({ ok: !wrong });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
