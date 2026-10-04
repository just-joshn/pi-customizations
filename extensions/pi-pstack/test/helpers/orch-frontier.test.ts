import './leak-preload.ts';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { openStore, type Store } from '../../skills/poteto-mode/scripts/orch/store.ts';
import { cleanDirectories, type GtFixture, git, installGt, makeDirectory, makeRepo, stackLog } from './orch-fixtures.ts';

const handles: Store[] = [];

async function withPath<T>(path: string, operation: () => Promise<T>): Promise<T> {
  vi.stubEnv('PATH', path);
  try {
    return await operation();
  } finally {
    vi.unstubAllEnvs();
  }
}

async function freshStore(): Promise<Store> {
  const store = openStore(await makeDirectory());
  handles.push(store);
  await store.init();
  return store;
}

afterEach(async () => {
  for (const store of handles.splice(0)) await store.close();
  await cleanDirectories();
});

async function gtFrontier(fixture: GtFixture) {
  const directory = await makeDirectory();
  const repo = await makeRepo(directory, ['stack/a', 'stack/b']);
  const gt = await installGt(directory, repo, fixture);
  const store = await freshStore();
  return withPath(`${gt}:${process.env['PATH']}`, () => store.frontier.set({ repo }));
}

const info = (line: string) => `x\n${line} change`;

describe('orch gt frontier parsing', () => {
  test.each<{ name: string; log: string; infos: Record<string, string>; message: string }>([
    { name: 'a duplicate branch', log: stackLog('stack/a', 'stack/a'), infos: { 'stack/a': info('PR #1 (Needs approvals)') }, message: 'gt log short output contains duplicate branch stack/a' },
    { name: 'a duplicate pull request number', log: stackLog('stack/a', 'stack/b'), infos: { 'stack/a': info('PR #4 (Merged)'), 'stack/b': info('PR #4 (Needs approvals)') }, message: 'gt info output contains duplicate pull requests' },
    { name: 'a branch with no PR line', log: stackLog('stack/a'), infos: { 'stack/a': 'stack/a' }, message: "this clone's gt metadata may predate the submit" },
    { name: 'a branch with two PR lines', log: stackLog('stack/a'), infos: { 'stack/a': 'PR #1 (Merged)\\nPR #2 (Merged)' }, message: 'gt info output contains multiple PRs for branch stack/a' },
    { name: 'a non-whitelisted status', log: stackLog('stack/a'), infos: { 'stack/a': info('PR #1 (Bogus)') }, message: 'gt info output has an unknown PR state for branch stack/a: Bogus' },
    { name: 'an invalid PR row', log: stackLog('stack/a'), infos: { 'stack/a': 'PR #zero (Merged)' }, message: 'gt info output has an invalid PR row for branch stack/a' },
  ])('rejects $name', async ({ log, infos, message }) => {
    await expect(gtFrontier({ logShort: log, info: infos })).rejects.toThrow(message);
  });

  test('accepts an [origin] PR prefix and a PR line with no status', async () => {
    const result = await gtFrontier({ logShort: stackLog('stack/a', 'stack/b'), info: { 'stack/a': '[origin] PR #5 (Merged) done', 'stack/b': 'PR #6' } });
    expect(result.prs.map(({ branches, pr, state }) => ({ branches, pr, state }))).toEqual([
      { branches: 'stack/a', pr: 5, state: 'MERGED' },
      { branches: 'stack/b', pr: 6, state: 'OPEN' },
    ]);
    expect(result.lowestUnmerged).toBe(6);
  });
});

test('frontier records the local branch head even when it differs from origin', async () => {
  const directory = await makeDirectory();
  const repo = await makeRepo(directory, ['stack/a']);
  git(directory, 'init', '-q', '--bare', join(directory, 'origin.git'));
  git(repo, 'remote', 'add', 'origin', join(directory, 'origin.git'));
  git(repo, 'push', '-q', 'origin', 'stack/a');
  const remoteHead = git(repo, 'rev-parse', 'origin/stack/a');
  await writeFile(join(repo, 'more.txt'), 'more');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'local only');
  const gt = await installGt(directory, repo, { logShort: stackLog('stack/a'), info: { 'stack/a': info('PR #8 (Needs approvals)') } });
  const store = await freshStore();
  const result = await withPath(`${gt}:${process.env['PATH']}`, () => store.frontier.set({ repo }));
  const localHead = git(repo, 'rev-parse', 'stack/a');
  expect(localHead).not.toBe(remoteHead);
  expect(result.prs[0]?.sha).toBe(localHead);
});
