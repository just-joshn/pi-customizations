import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { agentBrowserAvailable } from '../../src/adapters/browser.ts';
import { changedPaths, ensureWorktree, isDirty, remoteHead, remoteUrl, revision } from '../../src/adapters/git.ts';
import { type CommandResult, localShell, type Shell } from '../../src/adapters/shell.ts';
import { hashInstalled, parseInstalled } from '../../src/adapters/skills.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function shell(responses: Readonly<Record<string, CommandResult | Error>>): Shell {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const response = responses[key];
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error(`unexpected shell call: ${key}`);
    return response;
  };
}

const ok = (stdout: string): CommandResult => ({ stdout, stderr: '', exitCode: 0 });
const fail = (stderr: string, exitCode = 1): CommandResult => ({ stdout: '', stderr, exitCode });

describe('parseInstalled', () => {
  test('parses bare names and name=hash pairs, dropping empties', () => {
    expect(parseInstalled('')).toEqual([]);
    expect(parseInstalled('  ,  ')).toEqual([]);
    expect(parseInstalled(' tdd , bug-finder=sha256:abc , , frontend ')).toEqual([
      { name: 'tdd', contentHash: null },
      { name: 'bug-finder', contentHash: 'sha256:abc' },
      { name: 'frontend', contentHash: null },
    ]);
  });
});

describe('hashInstalled', () => {
  test('hashes readable files and nulls missing paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's50-skills-'));
    dirs.push(dir);
    const path = join(dir, 'SKILL.md');
    await writeFile(path, 'name: tdd\n');
    expect(
      await hashInstalled([
        { name: 'tdd', path },
        { name: 'missing', path: join(dir, 'gone.md') },
      ]),
    ).toEqual([
      { name: 'tdd', contentHash: 'sha256:78a509b11888f3647f921849e81acca774812f987ec5eba04b45543882ac5918' },
      { name: 'missing', contentHash: null },
    ]);
  });
});

describe('agentBrowserAvailable', () => {
  test('is true when agent-browser --version exits 0', async () => {
    expect(await agentBrowserAvailable(shell({ 'agent-browser --version': ok('1.0.0') }))).toBe(true);
  });

  test('is false when the binary is missing or fails', async () => {
    expect(await agentBrowserAvailable(shell({ 'agent-browser --version': fail('not found') }))).toBe(false);
    expect(await agentBrowserAvailable(async () => Promise.reject(new Error('ENOENT')))).toBe(false);
  });
});

describe('git adapter', () => {
  test('revision returns trimmed HEAD', async () => {
    expect(await revision(shell({ 'git rev-parse HEAD': ok('abc\n') }))).toBe('abc');
  });

  test('revision throws when git fails', async () => {
    await expect(revision(shell({ 'git rev-parse HEAD': fail('boom') }))).rejects.toThrow('git rev-parse HEAD failed: boom');
  });

  test('remoteUrl returns null when origin is missing', async () => {
    expect(await remoteUrl(shell({ 'git remote get-url origin': fail('no remote') }))).toBeNull();
  });

  test('changedPaths returns [] for empty diff and splits paths otherwise', async () => {
    expect(await changedPaths(shell({ 'git diff --name-only --no-renames --relative a b': ok('') }), 'a', 'b')).toEqual([]);
    expect(await changedPaths(shell({ 'git diff --name-only --no-renames --relative a b': ok('src/a.ts\nsrc/b.ts') }), 'a', 'b')).toEqual(['src/a.ts', 'src/b.ts']);
  });

  test('isDirty is true when porcelain status is non-empty', async () => {
    expect(await isDirty(shell({ 'git status --porcelain': ok(' M src/a.ts') }))).toBe(true);
    expect(await isDirty(shell({ 'git status --porcelain': ok('') }))).toBe(false);
  });

  test('ensureWorktree adds when missing and no-ops when the branch matches', async () => {
    const calls: string[] = [];
    const recording: Shell = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      calls.push(key);
      if (key === 'git worktree prune') return ok('');
      if (key === 'git rev-parse --show-toplevel') return ok('/repo');
      if (key === 'git rev-parse --show-prefix') return ok('');
      if (key === 'git worktree list --porcelain') return ok('worktree /repo/.s50/worktrees/a\nbranch refs/heads/s50/r1/a\n');
      if (key === 'git worktree add -B s50/r2/a .s50/worktrees/b') return ok('');
      throw new Error(`unexpected: ${key}`);
    };
    await ensureWorktree(recording, '.s50/worktrees/a', 's50/r1/a');
    expect(calls).not.toContain('git worktree add -B s50/r1/a .s50/worktrees/a');

    const addCalls: string[] = [];
    const adding: Shell = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      addCalls.push(key);
      if (key === 'git worktree prune') return ok('');
      if (key === 'git rev-parse --show-toplevel') return ok('/repo');
      if (key === 'git rev-parse --show-prefix') return ok('');
      if (key === 'git worktree list --porcelain') return ok('');
      if (key === 'git worktree add -B s50/r1/b .s50/worktrees/b') return ok('');
      throw new Error(`unexpected: ${key}`);
    };
    await ensureWorktree(adding, '.s50/worktrees/b', 's50/r1/b');
    expect(addCalls).toContain('git worktree add -B s50/r1/b .s50/worktrees/b');
  });

  test('ensureWorktree rejects an existing worktree on another branch', async () => {
    const existing: Shell = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key === 'git worktree prune') return ok('');
      if (key === 'git rev-parse --show-toplevel') return ok('/repo');
      if (key === 'git rev-parse --show-prefix') return ok('');
      if (key === 'git worktree list --porcelain') return ok('worktree /repo/.s50/worktrees/a\nbranch refs/heads/other\n');
      throw new Error(`unexpected: ${key}`);
    };
    await expect(ensureWorktree(existing, '.s50/worktrees/a', 's50/r1/a')).rejects.toThrow('worktree .s50/worktrees/a is checked out on another branch; remove it with git worktree remove .s50/worktrees/a');
  });

  test('remoteHead returns a 40-char sha and rejects junk', async () => {
    const sha = 'a'.repeat(40);
    expect(await remoteHead(shell({ 'git ls-remote https://github.com/acme/app HEAD': ok(`${sha}\tHEAD`) }), 'acme/app')).toBe(sha);
    await expect(remoteHead(shell({ 'git ls-remote https://github.com/acme/app HEAD': ok('not-a-sha') }), 'acme/app')).rejects.toThrow('git ls-remote acme/app HEAD returned no commit');
  });
});

describe('localShell', () => {
  test('returns exitCode 0 for a successful command', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's50-shell-'));
    dirs.push(dir);
    const result = await localShell(dir, undefined)('node', ['-e', 'process.stdout.write("hi")']);
    expect(result).toEqual({ stdout: 'hi', stderr: '', exitCode: 0 });
  });

  test('rejects AbortError when the signal aborts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's50-shell-'));
    dirs.push(dir);
    const controller = new AbortController();
    const pending = localShell(dir, controller.signal)('node', ['-e', 'setTimeout(() => {}, 30_000)']);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
