import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { repoFacts } from '../../src/adapters/repo.ts';
import { localShell } from '../../src/adapters/shell.ts';
import { defaultContext, runCli } from '../../src/cli/commands.ts';
import { loadState, saveState } from '../../src/orchestrator/persistence.ts';
import { testContext } from '../support/context.ts';
import { freshRun, graphNode, INSTALLED } from '../unit/support.ts';
import { git, tempRepo, writeAndCommit } from './repo.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const cwd = tempRepo();
  dirs.push(cwd);
  return cwd;
}

test('preflight detects languages, test commands, build commands', async () => {
  const cwd = repo();
  writeAndCommit(
    cwd,
    {
      'package.json': JSON.stringify({ scripts: { test: 'vitest run', 'test:e2e': 'vitest run e2e', build: 'tsc', lint: 'biome check' }, dependencies: { react: '19.0.0' } }),
      'tsconfig.json': '{}\n',
      'bun.lock': '',
      Makefile: 'verify:\n\tbun run test\n',
      'GLOSSARY.md': '# Glossary\n',
      'docs/adr/0001-csv.md': '# CSV\n',
    },
    'manifests',
  );
  const facts = await repoFacts(cwd, localShell(cwd, undefined));
  expect({ ...facts, repositoryRoot: '', revision: '' }).toEqual({
    repositoryRoot: '',
    remote: null,
    revision: '',
    dirty: false,
    languages: ['typescript', 'javascript'],
    packageManager: 'bun',
    testCommands: ['bun run test', 'bun run test:e2e', 'make verify'],
    buildCommands: ['bun run build'],
    instructions: [],
    glossary: ['GLOSSARY.md'],
    adrs: 1,
    issueTrackerDoc: false,
    reactStack: true,
  });
});

test('concurrent nodes get their own git worktrees', async () => {
  const cwd = repo();
  const context = testContext(cwd);
  await runCli(['registry', 'refresh', '--from', 'leaderboard.2026-10-07.json', '--sources', 'skill-sources.2026-10-07.json'], context);
  await runCli(['feature', 'two slices', '--installed', INSTALLED.map((skill) => skill.name).join(','), '--capabilities', '{"independentAgents":true,"isolatedWorktrees":true}'], context);
  const loaded = await loadState(join(cwd, '.s50'));
  if (loaded.kind !== 'ok') throw new Error(loaded.kind);
  const nodes = ['a', 'b'].map((id) => graphNode(id, 'pending', { owner: `worker-${id}` }));
  const implementing = { ...loaded.state, run: { ...loaded.state.run, phase: 'IMPLEMENT' as const }, graph: { schemaVersion: 1 as const, nodes } };
  await saveState(join(cwd, '.s50'), loaded.state, implementing, []);
  const started = await runCli(['apply', JSON.stringify({ kind: 'start_nodes', ids: ['a', 'b'] })], context);
  expect(JSON.parse(started.stdout).workspaces).toEqual(['.s50/worktrees/a', '.s50/worktrees/b']);
  expect([existsSync(join(cwd, '.s50/worktrees/a/.git')), git(cwd, 'branch', '--list', 's50/*').split('\n').length]).toEqual([true, 2]);
});

test('a JSONL line from a newer schema is refused', async () => {
  const cwd = repo();
  const dir = join(cwd, '.s50');
  await saveState(dir, null, freshRun(), []);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'evidence.jsonl'), `${JSON.stringify({ schemaVersion: 2, claim: 'c' })}\n`);
  const loaded = await loadState(dir);
  expect(loaded.kind === 'invalid' && loaded.reason.endsWith('evidence.jsonl:1: unsupported record schema version 2')).toBe(true);
});

const { S50_LIVE: live } = process.env;

test.runIf(live === '1')('live registry refresh locks the current top 50', { timeout: 120_000 }, async () => {
  const cwd = repo();
  const result = await runCli(['registry', 'refresh'], defaultContext(cwd, undefined));
  expect(result.stdout).toMatch(/^locked 18 skills at \d{4}-\d{2}-\d{2}T/);
  expect(await runCli(['registry', 'verify'], defaultContext(cwd, undefined))).toEqual({ code: 0, stdout: 'registry lock verified\n' });
});
