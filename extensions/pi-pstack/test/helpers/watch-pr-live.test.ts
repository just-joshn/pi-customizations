import { expect, test } from 'bun:test';

import { GhGitHubReader } from '../../skills/poteto-mode/scripts/watch-pr/github.ts';
import { parsePrNumber } from '../../skills/poteto-mode/scripts/watch-pr/types.ts';

const scripts = new URL('../../skills/poteto-mode/scripts', import.meta.url).pathname;
const authenticated = Bun.spawnSync(['gh', 'auth', 'status']).exitCode === 0;
const merged = { owner: 'cli', repo: 'cli', number: parsePrNumber(1) };

function watch(args: string[]) {
  const result = Bun.spawnSync(['bun', `${scripts}/watch-pr/watch-pr`, '--owner', merged.owner, '--repo', merged.repo, '--pr', '1', ...args]);
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

test.skipIf(!authenticated)('live gh: --status-only on a public merged PR prints one STATUS verdict with a merged row and exits 0', () => {
  const run = watch(['--status-only']);
  expect(run.code).toBe(0);
  const lines = run.stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0])).toMatchObject({
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

test.skipIf(!authenticated)('live gh: --status-only --pretty prints a one-row table with a merged row and exits 0', () => {
  const run = watch(['--status-only', '--pretty']);
  expect(run.code).toBe(0);
  expect(run.stdout).toBe('| PR | CI | Review | Merge |\n| --- | --- | --- | --- |\n| [#1](https://github.com/cli/cli/pull/1) | — | — | ✅ merged |\n');
});

test.skipIf(!authenticated)('live gh: a merged PR without --status-only reaches READY merged-pr and exits 0', () => {
  const run = watch([]);
  expect(run.code).toBe(0);
  expect(JSON.parse(run.stdout.trim())).toMatchObject({ kind: 'READY', exitCode: 0, scope: { kind: 'single', pr: { kind: 'merged-pr' } } });
});

test.skipIf(!authenticated)('live gh: GhGitHubReader reads facts and the open PR list from a public repository with read-only calls', async () => {
  const reader = new GhGitHubReader();
  expect(await reader.pullRequest(merged)).toMatchObject({ state: 'MERGED', context: merged });
  const open = await reader.openPullRequests({ owner: merged.owner, repo: merged.repo });
  expect(open.length).toBeGreaterThan(0);
  expect(open[0]).toMatchObject({ number: expect.any(Number), headRefName: expect.any(String), baseRefName: expect.any(String) });
});
