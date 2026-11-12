import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, onTestFinished, test } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const skills = join(root, 'generated/skills');
function scratch() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-generated-')));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('decision log appends one header and sanitized six-column TSV rows', () => {
  const log = join(scratch(), 'trail/decisions.tsv');
  const script = join(skills, 'show-me-your-work/scripts/log.sh');
  execFileSync('bash', [script, log, 'frame', 'tabs\there', 'new\nline\rhere', 'evidence', '=SUM(A1)']);
  execFileSync('bash', [script, log, 'verify', 'done', 'green', '-', 'ok']);
  const rows = readFileSync(log, 'utf8').trimEnd().split('\n');
  expect(rows).toHaveLength(3);
  expect(rows[0]).toBe('ts\tphase\tdecision\twhy\tevidence\tresult');
  for (const row of rows.slice(1)) expect(row.split('\t')[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  expect(rows[1]?.split('\t').slice(1)).toEqual(['frame', 'tabs here', 'new line here', 'evidence', "'=SUM(A1)"]);
  expect(rows[2]?.split('\t').slice(1)).toEqual(['verify', 'done', 'green', "'-", 'ok']);
});

test('check-plan detects a required section removed from the generated template', () => {
  const template = readFileSync(join(skills, 'poteto-mode/playbooks/multi-phase-plan.md'), 'utf8').split('````markdown\n')[1]?.split('````')[0];
  expect(template).toBeDefined();
  const file = join(scratch(), 'plan.md');
  writeFileSync(file, template!.replace('## How to read this', '## Reading'));
  const result = spawnSync('bun', [join(skills, 'poteto-mode/scripts/check-plan.mjs'), file], { encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('no "## How to read this" section');
});

test('audit protects recent Pi sessions, tracked edits and unmerged work, but permits merged clean work', () => {
  const dir = scratch();
  const repo = join(dir, 'repo');
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  for (const path of [repo, home, bin]) mkdirSync(path);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  writeFileSync(join(repo, 'a'), 'initial');
  git(repo, 'add', 'a');
  git(repo, 'commit', '-qm', 'initial');
  const worktrees = { recent: join(dir, 'recent'), dirty: join(dir, 'dirty'), unmerged: join(dir, 'unmerged'), safe: join(dir, 'safe') };
  for (const [name, path] of Object.entries(worktrees)) git(repo, 'worktree', 'add', '-q', '-b', name, path);
  writeFileSync(join(worktrees.dirty, 'a'), 'edits');
  writeFileSync(join(worktrees.unmerged, 'a'), 'unmerged');
  git(worktrees.unmerged, 'commit', '-qam', 'unmerged');
  const sessionDir = join(home, '.pi/agent/sessions', `--${worktrees.recent.replace(/^\//, '').replace(/[/\\:]/g, '-')}--`);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, '2026-11-11T00-00-00-000Z_test.jsonl'), `${JSON.stringify({ type: 'session', version: 3, id: 'test', timestamp: new Date().toISOString(), cwd: worktrees.recent })}\n`);
  for (const command of ['gh', 'origin']) {
    writeFileSync(join(bin, command), '#!/bin/sh\nexit 1\n');
    chmodSync(join(bin, command), 0o755);
  }
  const result = spawnSync('bash', [join(skills, 'poteto-mode/scripts/worktree-audit.sh'), '-b', 'main', repo], {
    encoding: 'utf8', env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: join(home, '.pi/agent'), PATH: `${bin}:${process.env['PATH']}` },
  });
  expect(result.status, result.stderr).toBe(0);
  const rows = result.stdout.trim().split('\n').slice(2).map((line) => line.split('\t'));
  const buckets = Object.fromEntries(rows.map((row) => [row[8], row[7]]));
  expect(buckets).toEqual({ [worktrees.recent]: 'verify-recent-chat', [worktrees.dirty]: 'hold-wip', [worktrees.unmerged]: 'review', [worktrees.safe]: 'safe' });
});
