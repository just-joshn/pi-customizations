import './leak-preload.ts';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { openStore, type Store } from '../../skills/poteto-mode/scripts/orch/store.ts';
import { baseEnv, cleanDirectories, type GtFixture, git, installGh, installGit, installGt, makeDirectory, makeRepo, runCli, stackLog } from './orch-fixtures.ts';

const handles: Store[] = [];
const sha = (char: string) => char.repeat(40);

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

  test('accepts an [origin] PR prefix, a PR line with no status, and Closed', async () => {
    const result = await gtFrontier({ logShort: stackLog('stack/a', 'stack/b'), info: { 'stack/a': '[origin] PR #5 (Merged) done', 'stack/b': 'PR #6' } });
    expect(result.prs.map(({ branches, pr, state }) => ({ branches, pr, state }))).toEqual([
      { branches: 'stack/a', pr: 5, state: 'MERGED' },
      { branches: 'stack/b', pr: 6, state: 'OPEN' },
    ]);
    expect(result.lowestUnmerged).toBe(6);
  });
});

describe('orch frontier sha', () => {
  test('records the remote branch head, not a local branch that lags or leads it', async () => {
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
    expect(git(repo, 'rev-parse', 'stack/a')).not.toBe(remoteHead);
    expect(result.prs[0]?.sha).toBe(remoteHead);
  });
});

const pull = (number: number, head: string, base: string, state = 'OPEN', oid = sha(String(number % 10))) => ({ number, state, headRefName: head, baseRefName: base, headRefOid: oid });

async function ghFrontier(pulls: unknown, options: { checkout?: string; pin?: number[]; detach?: boolean; failGh?: boolean; raw?: string } = {}) {
  const directory = await makeDirectory();
  const repo = await makeRepo(directory, ['stack/a', 'stack/b', 'stack/c']);
  git(repo, 'checkout', '-q', options.detach ? '--detach' : (options.checkout ?? 'stack/b'));
  const body = options.failGh ? 'echo gh broke >&2; exit 1' : `printf '%s' '${options.raw ?? JSON.stringify(pulls)}'`;
  const gh = await installGh(directory, body);
  const gitBin = await installGit(directory);
  const store = await freshStore();
  return withPath(`${gh}:${gitBin}`, () => store.frontier.set(options.pin === undefined ? { repo } : { repo, prs: options.pin }));
}

const stack = [pull(21, 'stack/a', 'main', 'MERGED'), pull(22, 'stack/b', 'stack/a'), pull(23, 'stack/c', 'stack/b'), pull(30, 'other', 'main')];

describe('orch gh frontier without gt', () => {
  test('orders the connected stack bottom to top from any branch in it and records PR head oids', async () => {
    const result = await ghFrontier(stack);
    expect(result.prs).toEqual([
      { branches: 'stack/a', pr: 21, sha: sha('1'), state: 'MERGED' },
      { branches: 'stack/b', pr: 22, sha: sha('2'), state: 'OPEN' },
      { branches: 'stack/c', pr: 23, sha: sha('3'), state: 'OPEN' },
    ]);
    expect(result.lowestUnmerged).toBe(22);
    expect((await ghFrontier(stack, { checkout: 'stack/c' })).prs.map((row) => row.pr)).toEqual([21, 22, 23]);
  });

  test('prefers the open pull request when a head branch has several', async () => {
    const result = await ghFrontier([pull(5, 'stack/b', 'main', 'CLOSED'), pull(6, 'stack/b', 'main', 'OPEN')]);
    expect(result.prs.map((row) => row.pr)).toEqual([6]);
  });

  test.each([
    { name: 'a detached HEAD', pulls: stack, options: { detach: true }, message: 'git symbolic-ref' },
    { name: 'two pull requests on one base', pulls: [...stack, pull(24, 'stack/d', 'stack/b')], options: {}, message: '#23, #24 all target stack/b; the stack is not linear' },
    { name: 'base branches that form a cycle', pulls: [pull(1, 'stack/b', 'stack/c'), pull(2, 'stack/c', 'stack/b')], options: {}, message: 'gh pull request base branches form a cycle' },
    { name: 'a failing gh', pulls: stack, options: { failGh: true }, message: 'gh pr list failed' },
    { name: 'invalid JSON', pulls: stack, options: { raw: 'not json' }, message: 'gh pr list output is not valid JSON' },
    { name: 'a malformed row', pulls: [{ number: 'x' }], options: {}, message: 'gh pr list output has an invalid PR row' },
  ])('rejects $name', async ({ pulls, options, message }) => {
    await expect(ghFrontier(pulls, options)).rejects.toThrow(message);
  });

  test('a checked-out branch with no pull request names the branch', async () => {
    await expect(ghFrontier([pull(1, 'other', 'main')])).rejects.toThrow('no pull request has head branch stack/b');
  });

  test('a pin mismatch names gh as the source', async () => {
    await expect(ghFrontier(stack, { pin: [21, 22] })).rejects.toThrow('frontier pin mismatch: extra in gh: 23');
  });
});

describe('orch frontier set through the CLI without gt', () => {
  test('seeds frontier.json from gh and prints the compact line', async () => {
    const directory = await makeDirectory();
    const repo = await makeRepo(directory, ['stack/a']);
    const gh = await installGh(directory, `printf '%s' '${JSON.stringify([pull(41, 'stack/a', 'main', 'OPEN', sha('a'))])}'`);
    const gitBin = await installGit(directory);
    const store = await makeDirectory();
    const env = baseEnv({ PATH: `${gh}:${gitBin}` });
    expect(runCli(['--store', store, 'init'], { env }).code).toBe(0);
    const result = runCli(['--store', store, 'frontier', 'set', '--repo', repo], { env });
    expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: '' });
    expect(result.stdout).toBe(`generation=1 prs=stack/a#41@${sha('a')}:OPEN lowest-unmerged=41\n`);
  });
});
