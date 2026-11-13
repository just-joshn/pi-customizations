import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { setupForge, type ForgeHandle } from './fixtures/forge.ts';
import type { Ctx } from './lib/driver.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(): { ctx: Ctx; forge: ForgeHandle } {
  const sandbox = mkdtempSync(join(tmpdir(), 'forge-cli-test-'));
  roots.push(sandbox);
  const repo = join(sandbox, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'fixture\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const base = git('rev-parse', 'HEAD');
  const ctx: Ctx = { sandbox, repo, pkg: '', base, commits: [base], runId: 'test', skill: (name) => name, playbook: (name) => name, agentDir: join(sandbox, 'agent'), sessionsDir: join(sandbox, 'sessions') };
  const forge = setupForge(ctx, { owner: 'fixture', name: 'repo', originCli: true, branches: [], prs: [{ number: 71, title: 'Review', head: 'main', base: 'main', author: 'fixture', threads: [{ id: 'thread-1', comments: [{ id: '901', author: 'reviewer', body: 'Finding', path: 'README.md', line: 1, createdAt: '2026-11-13T00:00:00Z' }] }] }] });
  return { ctx, forge };
}

function call(ctx: Ctx, forge: ForgeHandle, tool: string, ...args: string[]) {
  return spawnSync(join(forge.bin, tool), args, { cwd: ctx.repo, encoding: 'utf8', env: { ...process.env, FORGE_GIT_DIR: forge.bare } });
}

test('help at any command depth leaves forge state and actions unchanged', () => {
  const { ctx, forge } = fixture();
  const state = readFileSync(join(forge.dir, 'state.json'), 'utf8');
  const actions = readFileSync(join(forge.dir, 'actions.jsonl'), 'utf8');
  for (const tool of ['gh', 'origin']) {
    for (const args of [['--help'], ['pr', '-h'], ['pr', 'create', '--help'], ['pr', 'merge', '71', '-h'], ['api', 'repos/fixture/repo/pulls/71/comments/901/replies', '--method', 'POST', '--help']]) {
      const result = call(ctx, forge, tool, ...args);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/usage|help/i);
      expect(readFileSync(join(forge.dir, 'state.json'), 'utf8')).toBe(state);
      expect(readFileSync(join(forge.dir, 'actions.jsonl'), 'utf8')).toBe(actions);
    }
  }
  expect(call(ctx, forge, 'gh', 'pr', 'create', '--title', 'Real PR').status).toBe(0);
  expect(JSON.parse(readFileSync(join(forge.dir, 'state.json'), 'utf8')).prs['72'].title).toBe('Real PR');
});

test('review comments expose reply ids and REST replies are readable in the same thread', () => {
  const { ctx, forge } = fixture();
  const endpoint = 'repos/fixture/repo/pulls/71/comments';
  const result = call(ctx, forge, 'gh', 'api', endpoint);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([expect.objectContaining({ id: '901', body: 'Finding', user: { login: 'reviewer' }, path: 'README.md', line: 1 })]);
  const payload = join(ctx.sandbox, 'reply.json');
  writeFileSync(payload, JSON.stringify({ body: 'Reply as data $(not a command)' }));
  const reply = call(ctx, forge, 'gh', 'api', `${endpoint}/901/replies`, '--method', 'POST', '--input', payload);
  expect(reply.status, reply.stderr).toBe(0);
  const comments = JSON.parse(call(ctx, forge, 'gh', 'api', endpoint).stdout);
  expect(comments).toHaveLength(2);
  expect(comments[1]).toMatchObject({ id: JSON.parse(reply.stdout).id, in_reply_to_id: '901', body: 'Reply as data $(not a command)' });
  expect(call(ctx, forge, 'gh', 'api', `${endpoint}/missing/replies`, '--method', 'POST', '--input', payload).status).not.toBe(0);
  expect(JSON.parse(call(ctx, forge, 'gh', 'api', endpoint).stdout)).toHaveLength(2);
});
