import './leak-preload.ts';

import { cpSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { GhGitHubReader } from '../../skills/poteto-mode/scripts/watch-pr/github.ts';
import { parsePrNumber } from '../../skills/poteto-mode/scripts/watch-pr/types.ts';
import { removeScratch, scratchDir } from './scratch.ts';
import { fakeEnv, installFakeBin, ok, prView, withEnv } from './watch-pr-fakes.test-helper.ts';
import { runProcess } from './watch-pr-process.ts';

const scripts = new URL('../../skills/poteto-mode/scripts', import.meta.url).pathname;
afterEach(removeScratch);
const openPrs = [{ number: 2, headRefName: 'feature', baseRefName: 'main' }];
const boundary = () =>
  installFakeBin([
    { tool: 'gh', match: ['pr view'], replies: [ok(prView({ state: 'MERGED', mergedAt: '2026-07-26T00:00:00Z' }))] },
    { tool: 'gh', match: ['pr list'], replies: [ok(openPrs)] },
  ]);
const merged = { owner: 'cli', repo: 'cli', number: parsePrNumber(1) };

function watch(args: string[]) {
  const copied = join(scratchDir('watch-pr-boundary-'), 'scripts');
  cpSync(scripts, copied, { recursive: true });
  const bin = boundary();
  const result = runProcess(['bun', `${copied}/watch-pr/watch-pr`, '--owner', merged.owner, '--repo', merged.repo, '--pr', '1', ...args], { env: { ...process.env, ...fakeEnv(bin) } });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

test('status-only reports a merged PR successfully', () => {
  const run = watch(['--status-only']);
  expect(run.code).toBe(0);
  const lines = run.stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  expect(JSON.parse(run.stdout)).toMatchObject({
    schemaVersion: 1,
    sequence: 1,
    mode: 'single',
    kind: 'STATUS',
    terminal: true,
    exitCode: 0,
    reason: 'status-only',
    rows: [{ kind: 'merged', context: merged, facts: { state: 'MERGED' } }],
  });
});

test('pretty status displays a merged PR row', () => {
  const run = watch(['--status-only', '--pretty']);
  expect(run.code).toBe(0);
  expect(run.stdout).toBe('| PR | CI | Review | Merge |\n| --- | --- | --- | --- |\n| [#1](https://github.com/cli/cli/pull/1) | — | — | ✅ merged |\n');
});

test('a merged PR completes with READY', () => {
  const run = watch([]);
  expect(run.code).toBe(0);
  expect(JSON.parse(run.stdout.trim())).toMatchObject({ kind: 'READY', exitCode: 0, scope: { kind: 'single', pr: { kind: 'merged-pr' } } });
});

test('PR facts preserve the merged state', async () => {
  const bin = boundary();
  await withEnv(fakeEnv(bin), async () => {
    const reader = new GhGitHubReader();
    expect(await reader.pullRequest(merged)).toEqual({
      context: { owner: 'cli', repo: 'cli', number: 1 },
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: 'APPROVED',
      headRefOid: 'head',
      headRefName: 'feature',
      baseRefName: 'main',
      state: 'MERGED',
      mergedAt: '2026-07-26T00:00:00Z',
      isDraft: false,
    });
    expect(bin.calls().map(({ tool, argv }) => ({ tool, argv }))).toEqual([
      { tool: 'gh', argv: ['pr', 'view', '1', '--repo', 'cli/cli', '--json', 'mergeable,mergeStateStatus,reviewDecision,headRefOid,headRefName,baseRefName,state,mergedAt,isDraft'] },
    ]);
  });
});

test('open PRs preserve branch relationships', async () => {
  const bin = boundary();
  await withEnv(fakeEnv(bin), async () => {
    const reader = new GhGitHubReader();
    expect(await reader.openPullRequests({ owner: merged.owner, repo: merged.repo })).toEqual([{ number: 2, headRefName: 'feature', baseRefName: 'main' }]);
    expect(bin.calls().map(({ tool, argv }) => ({ tool, argv }))).toEqual([{ tool: 'gh', argv: ['pr', 'list', '--repo', 'cli/cli', '--state', 'open', '--limit', '300', '--json', 'number,headRefName,baseRefName'] }]);
  });
});
