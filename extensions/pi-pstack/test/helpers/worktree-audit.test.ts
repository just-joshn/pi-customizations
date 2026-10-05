import './leak-preload.ts';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { expectDefined } from '../support/expect-defined.ts';

const script = new URL('../../skills/poteto-mode/scripts/worktree-audit.sh', import.meta.url).pathname;
const which = (name: string): string | undefined => {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
};
const bash = which('bash') ?? '/bin/bash';

type Row = { size: string; age: string; merged: string; dirty: string; remote: string; pr: string; lastChat: string; bucket: string; path: string };

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function parse(stdout: string): Row[] {
  return stdout
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const [size, age, merged, dirty, remote, pr, lastChat, bucket, path] = line.split('\t');
      return {
        size: expectDefined(size),
        age: expectDefined(age),
        merged: expectDefined(merged),
        dirty: expectDefined(dirty),
        remote: expectDefined(remote),
        pr: expectDefined(pr),
        lastChat: expectDefined(lastChat),
        bucket: expectDefined(bucket),
        path: expectDefined(path),
      };
    });
}

async function fakeGh(directory: string, name: string, body: string): Promise<string> {
  const bin = join(directory, name);
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'gh'), `#!/bin/sh\n${body}\n`);
  await chmod(join(bin, 'gh'), 0o755);
  return bin;
}

function audit(args: string[], options: { directory: string; path?: string; cwd?: string }) {
  return spawnSync(bash, [script, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: options.path ?? process.env['PATH'],
      HOME: options.directory,
      PI_CODING_AGENT_DIR: join(options.directory, 'agent'),
      PI_CODING_AGENT_SESSION_DIR: '',
      GH_TOKEN: 'invalid',
    },
  });
}

let directory = '';
let main = '';
let origin = '';
let ghOk = '';
let ghFail = '';
const prJson = JSON.stringify([
  { number: 7, state: 'OPEN', headRefName: 'openpr' },
  { number: 8, state: 'CLOSED', headRefName: 'closedpr' },
  { number: 9, state: 'MERGED', headRefName: 'mergedpr' },
  { number: 10, state: 'OPEN', headRefName: 'wipopen' },
]);

async function commitOn(worktree: string, file: string, text: string): Promise<void> {
  await writeFile(join(worktree, file), text);
  git(worktree, 'add', file);
  git(worktree, 'commit', '-q', '-m', file);
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'wt-audit-')));
  main = join(directory, 'main');
  origin = join(directory, 'origin.git');
  await mkdir(main);
  git(main, 'init', '-q', '-b', 'main');
  await writeFile(join(main, '.gitignore'), '*.log\n');
  git(main, 'add', '.gitignore');
  git(main, 'commit', '-q', '-m', 'init');
  git(directory, 'init', '-q', '--bare', '--initial-branch=main', origin);
  git(main, 'remote', 'add', 'origin', origin);
  git(main, 'push', '-q', 'origin', 'main');
  const add = (name: string, dir = name) => git(main, 'worktree', 'add', '-q', '-b', name, join(directory, dir));

  add('merged');
  add('wipw');
  await writeFile(join(directory, 'wipw', 'edit.txt'), 'x');
  git(join(directory, 'wipw'), 'add', 'edit.txt');
  add('scratchw');
  await writeFile(join(directory, 'scratchw', 'untracked.txt'), 'x');
  add('ignoredw');
  await writeFile(join(directory, 'ignoredw', 'noise.log'), 'x');
  git(main, 'worktree', 'add', '-q', '--detach', join(directory, 'detachedw'));
  for (const name of ['pushed', 'ahead', 'noremote', 'openpr', 'closedpr', 'mergedpr', 'wipopen']) {
    add(name);
    await commitOn(join(directory, name), `${name}.txt`, name);
  }
  await writeFile(join(directory, 'wipopen', 'edit.txt'), 'x');
  git(join(directory, 'wipopen'), 'add', 'edit.txt');
  for (const name of ['pushed', 'ahead']) git(main, 'push', '-q', 'origin', name);
  await commitOn(join(directory, 'ahead'), 'ahead2.txt', 'more');
  add('big', 'bigwt');
  await commitOn(join(directory, 'bigwt'), 'blob.bin', 'x'.repeat(3_000_000));

  ghOk = await fakeGh(directory, 'gh-ok', `printf '%s' '${prJson}'`);
  ghFail = await fakeGh(directory, 'gh-fail', 'exit 1');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function withGh(bin: string): string {
  return `${bin}:${process.env['PATH']}`;
}

describe('worktree-audit.sh columns and buckets', () => {
  let rows = new Map<string, Row>();
  let ordered: Row[] = [];
  beforeEach(() => {
    const result = audit([main], { directory, path: withGh(ghOk) });
    expect(result.status).toBe(0);
    ordered = parse(result.stdout);
    rows = new Map(ordered.map((row) => [row.path.split('/').at(-1) ?? '', row]));
  });

  test.each([
    { name: 'merged', merged: 'YES', dirty: 'clean', remote: 'no-remote', pr: '-', bucket: 'safe' },
    { name: 'wipw', merged: 'YES', dirty: 'wip:1', remote: 'no-remote', pr: '-', bucket: 'hold-wip' },
    { name: 'scratchw', merged: 'YES', dirty: 'scratch:1', remote: 'no-remote', pr: '-', bucket: 'safe' },
    { name: 'ignoredw', merged: 'YES', dirty: 'clean', remote: 'no-remote', pr: '-', bucket: 'safe' },
    { name: 'detachedw', merged: 'YES', dirty: 'clean', remote: 'detached', pr: '-', bucket: 'safe' },
    { name: 'pushed', merged: 'no', dirty: 'clean', remote: 'pushed', pr: '-', bucket: 'review' },
    { name: 'ahead', merged: 'no', dirty: 'clean', remote: 'ahead1', pr: '-', bucket: 'review' },
    { name: 'noremote', merged: 'no', dirty: 'clean', remote: 'no-remote', pr: '-', bucket: 'review' },
    { name: 'openpr', merged: 'no', dirty: 'clean', remote: 'no-remote', pr: '#7/OPEN', bucket: 'hold-open-pr' },
    { name: 'closedpr', merged: 'no', dirty: 'clean', remote: 'no-remote', pr: '#8/CLOSED', bucket: 'safe' },
    { name: 'mergedpr', merged: 'no', dirty: 'clean', remote: 'no-remote', pr: '#9/MERGED', bucket: 'safe' },
    { name: 'wipopen', merged: 'no', dirty: 'wip:1', remote: 'no-remote', pr: '#10/OPEN', bucket: 'hold-wip' },
  ])('$name reports merged=$merged dirty=$dirty remote=$remote pr=$pr bucket=$bucket', ({ name, bucket, ...cells }) => {
    const row = rows.get(name);
    expect(row).toBeDefined();
    expect({ merged: row?.merged, dirty: row?.dirty, remote: row?.remote, pr: row?.pr, bucket: row?.bucket }).toEqual({ ...cells, bucket });
  });

  test('a fresh worktree reports AGE 0d and a numeric SIZE', () => {
    expect(rows.get('merged')?.age).toBe('0d');
    expect(rows.get('merged')?.size).toMatch(/^\d/);
  });

  test('rows sort by human size descending', () => {
    expect(ordered[0]?.path).toBe(join(directory, 'bigwt'));
    expect(ordered[0]?.size).toMatch(/^[23]\.\dM$|^[23]M$/);
  });

  test('the main worktree is excluded', () => {
    expect(rows.has('main')).toBe(false);
  });
});

describe('worktree-audit.sh environment', () => {
  test('outside a git repository with no path it prints the usage hint and exits 1', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'wt-norepo-'));
    try {
      const result = audit([], { directory, cwd: bare });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('not in a git repo; pass a repo path');
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  test('a failing gh leaves every PR cell as a dash', () => {
    const result = audit([main], { directory, path: withGh(ghFail) });
    expect(parse(result.stdout).map((row) => row.pr)).toEqual(Array(parse(result.stdout).length).fill('-'));
  });
});

describe('worktree-audit.sh origin and temp files', () => {
  test('a successful fetch updates origin/main and prints no warning', async () => {
    const other = join(directory, 'other-clone');
    git(directory, 'clone', '-q', origin, other);
    await commitOn(other, 'advance.txt', 'advance');
    git(other, 'push', '-q', 'origin', 'main');
    const result = audit([main], { directory, path: withGh(ghFail) });
    expect(result.stderr).not.toContain('could not fetch origin/main');
    expect(git(main, 'rev-parse', 'origin/main')).toBe(git(other, 'rev-parse', 'HEAD'));
  });

  test('a repository with no origin warns that the merged column may be stale', async () => {
    const solo = join(directory, 'solo');
    await mkdir(solo);
    git(solo, 'init', '-q', '-b', 'main');
    git(solo, 'commit', '-q', '--allow-empty', '-m', 'init');
    git(solo, 'worktree', 'add', '-q', '-b', 'topic', join(directory, 'solo-topic'));
    const result = audit([solo], { directory, path: withGh(ghFail) });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('warn: could not fetch origin/main; merged column may be stale');
  });

  test('the temporary PR file is removed', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'wt-tmp-'));
    try {
      const result = spawnSync(bash, [script, main], {
        encoding: 'utf8',
        env: { ...process.env, PATH: withGh(ghOk), TMPDIR: tmp, HOME: directory, PI_CODING_AGENT_DIR: join(directory, 'agent'), PI_CODING_AGENT_SESSION_DIR: '' },
      });
      expect(result.status).toBe(0);
      expect(execFileSync('ls', ['-A', tmp], { encoding: 'utf8' })).toBe('');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('worktree-audit.sh on a scratch repository with no origin', () => {
  test('prints the fetch warning, then a staged-file, an untracked-file, and a detached worktree row', async () => {
    const repo = join(directory, 'scratch-repo');
    await mkdir(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
    git(repo, 'worktree', 'add', '-q', '-b', 'staged', join(directory, 'sc-staged'));
    await writeFile(join(directory, 'sc-staged', 'a.txt'), 'a');
    git(join(directory, 'sc-staged'), 'add', 'a.txt');
    git(repo, 'worktree', 'add', '-q', '-b', 'untracked', join(directory, 'sc-untracked'));
    await writeFile(join(directory, 'sc-untracked', 'b.txt'), 'b');
    git(repo, 'worktree', 'add', '-q', '--detach', join(directory, 'sc-detached'));
    const result = audit([repo], { directory, path: withGh(ghFail) });
    const cells = new Map(parse(result.stdout).map((row) => [row.path.split('/').at(-1), [row.dirty, row.remote, row.bucket]]));
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('warn: could not fetch origin/main; merged column may be stale');
    expect(Object.fromEntries(cells)).toEqual({
      'sc-staged': ['wip:1', 'no-remote', 'hold-wip'],
      'sc-untracked': ['scratch:1', 'no-remote', 'review'],
      'sc-detached': ['clean', 'detached', 'review'],
    });
  });
});

describe('worktree-audit.sh missing tools', () => {
  test.each([
    { tool: 'jq', message: 'jq not found' },
    { tool: 'rg', message: 'rg not found' },
    { tool: 'perl', message: 'perl not found' },
  ])('a PATH without $tool warns on stderr', async ({ tool, message }) => {
    const bin = join(directory, `bin-without-${tool}`);
    await mkdir(bin, { recursive: true });
    const needed = ['awk', 'sed', 'grep', 'sort', 'xargs', 'du', 'date', 'mktemp', 'head', 'rm', 'cat', 'tr', 'dirname', 'basename', 'git', 'jq', 'rg', 'perl', 'gh', 'env', 'wc', 'cut'];
    for (const name of needed.filter((entry) => entry !== tool)) {
      const found = name === 'gh' ? join(ghOk, 'gh') : which(name);
      if (found) await symlink(found, join(bin, name)).catch(() => undefined);
    }
    const result = audit([main], { directory, path: bin });
    expect(result.stderr).toContain(message);
  });
});
