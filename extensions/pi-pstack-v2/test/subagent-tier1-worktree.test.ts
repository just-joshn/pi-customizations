import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { beforeEach, describe, expect, test } from 'vitest';
import { says } from './subagent-child-output.ts';
import { type FakeChild, fakePi } from './subagent-fake-pi.ts';
import { loadSubagent, makeCtx, textOf, useWorkspace, writeAgent } from './subagent-host.ts';

const workspace = useWorkspace();
const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];

const git = (cwd: string, ...args: string[]): string => execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8' }).trim();

/** Turns the test project into a git repository with one commit. */
function initRepo(): string {
  const { project } = workspace();
  git(project, 'init', '-q');
  fs.writeFileSync(path.join(project, 'README.md'), 'hello\n');
  git(project, 'add', '.');
  git(project, 'commit', '-q', '-m', 'init');
  return project;
}

const worktreesDir = (): string => path.join(workspace().project, '.pi', 'worktrees');
const isWorktree = (cwd: string | undefined): boolean => cwd !== undefined && path.dirname(cwd) === worktreesDir() && /^subagent-custom-[0-9a-f]{6}$/.test(path.basename(cwd));
const branches = (): string[] => git(workspace().project, 'branch', '--list', 'worktree/*', '--format=%(refname:short)').split('\n').filter(Boolean);
const worktreeCount = (): number => git(workspace().project, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).length;

/** Scripts every child to note where it ran, run `work` there, and answer. */
const ranIn = (work: (child: FakeChild) => void = () => undefined): (() => FakeChild[]) => {
  let seen: FakeChild[] = [];
  fakePi.onChild((child) => {
    seen = [...seen, child];
    work(child);
    says('done')(child);
  });
  return () => seen;
};

beforeEach(() => {
  writeAgent(workspace().userAgents, 'custom');
});

const call = (params: Record<string, unknown>) => loadSubagent().call({ agent: 'custom', task: 'look', ...params }, makeCtx(workspace().project));

describe('a worktree the worker leaves clean', () => {
  test('runs the child inside a new worktree under .pi/worktrees of the repository', async () => {
    initRepo();
    const children = ranIn();
    await call({ isolation: 'worktree' });
    expect(isWorktree(children()[0]?.cwd)).toBe(true);
  });

  test('removes the worktree and its branch once the child exits', async () => {
    initRepo();
    const children = ranIn();
    const result = await call({ isolation: 'worktree' });
    expect(fs.existsSync(children()[0]?.cwd ?? '')).toBe(false);
    expect(branches()).toEqual([]);
    expect(worktreeCount()).toBe(1);
    expect(textOf(result)).not.toContain('Worktree kept');
  });

  test('gives parallel workers a worktree each', async () => {
    initRepo();
    const children = ranIn();
    await loadSubagent().call({ tasks: [{ agent: 'custom', task: 'a', isolation: 'worktree' }, { agent: 'custom', task: 'b', isolation: 'worktree' }] }, makeCtx(workspace().project));
    const [first, second] = children();
    expect(isWorktree(first?.cwd)).toBe(true);
    expect(isWorktree(second?.cwd)).toBe(true);
    expect(first?.cwd).not.toBe(second?.cwd);
  });
});

describe('a worktree the worker leaves work in', () => {
  const keptNote = (cwd: string): string => `Worktree kept: ${cwd} (branch worktree/${path.basename(cwd)})`;

  test('keeps the worktree and branch when the child changed a file, and says where in its report', async () => {
    initRepo();
    const children = ranIn((child) => fs.writeFileSync(path.join(child.cwd, 'new.txt'), 'work\n'));
    const result = await call({ isolation: 'worktree' });
    const cwd = children()[0]?.cwd ?? '';
    expect(fs.readFileSync(path.join(cwd, 'new.txt'), 'utf8')).toBe('work\n');
    expect(branches()).toEqual([`worktree/${path.basename(cwd)}`]);
    expect(textOf(result)).toContain(keptNote(cwd));
  });

  test('keeps the worktree when the child committed and left the tree clean', async () => {
    initRepo();
    const children = ranIn((child) => {
      fs.writeFileSync(path.join(child.cwd, 'done.txt'), 'x\n');
      git(child.cwd, 'add', '.');
      git(child.cwd, 'commit', '-q', '-m', 'work');
    });
    const result = await call({ isolation: 'worktree' });
    const cwd = children()[0]?.cwd ?? '';
    expect(fs.existsSync(cwd)).toBe(true);
    expect(textOf(result)).toContain(keptNote(cwd));
  });

  test('leaves the main checkout untouched', async () => {
    initRepo();
    ranIn((child) => fs.writeFileSync(path.join(child.cwd, 'new.txt'), 'work\n'));
    await call({ isolation: 'worktree' });
    expect(fs.existsSync(path.join(workspace().project, 'new.txt'))).toBe(false);
  });
});

describe('what triggers isolation', () => {
  const frontmatter = (isolation: string) => writeAgent(workspace().userAgents, 'custom', `isolation: ${isolation}\n`);

  test('the agent frontmatter alone isolates its runs', async () => {
    initRepo();
    frontmatter('worktree');
    const children = ranIn();
    await call({});
    expect(isWorktree(children()[0]?.cwd)).toBe(true);
  });

  test('an agent without isolation runs in the project, and so does one with an unknown value', async () => {
    initRepo();
    frontmatter('sandbox');
    const children = ranIn();
    await call({});
    expect(children()[0]?.cwd).toBe(workspace().project);
    expect(fs.existsSync(worktreesDir())).toBe(false);
  });

  test.for([
    ['single', (isolation: string) => ({ isolation })],
    ['parallel', (isolation: string) => ({ agent: undefined, task: undefined, tasks: [{ agent: 'custom', task: 'a', isolation }] })],
    ['chain', (isolation: string) => ({ agent: undefined, task: undefined, chain: [{ agent: 'custom', task: 'a', isolation }] })],
  ] as const)('a per-call isolation in %s mode isolates the run', async ([, params]) => {
    initRepo();
    const children = ranIn();
    await call(params('worktree'));
    expect(isWorktree(children()[0]?.cwd)).toBe(true);
  });

  test('rejects an isolation other than worktree', () => {
    expect(() => call({ isolation: 'container' })).toThrow();
  });
});

describe('a call that cannot get a worktree', () => {
  test('fails without starting the child when the directory is not a git repository', async () => {
    const children = ranIn();
    const result = await call({ isolation: 'worktree' });
    expect(children()).toHaveLength(0);
    expect(result.details?.isError).toBe(true);
    expect(textOf(result)).toMatch(/git repository/i);
  });
});
