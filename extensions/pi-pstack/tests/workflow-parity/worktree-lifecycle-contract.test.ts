import { expect, test } from 'vitest';

import { evaluate } from './lib/check.ts';
import { worktreeIsolation } from './lib/checks.ts';
import type { RunView } from './lib/view.ts';

const source = { file: 'arena/SKILL.md', anchor: 'Give each candidate its own output location' };
const workers = ['a', 'b'].map((id) => ({ id, dir: `/runs/r/workers/${id}`, assignment: { workspace: { mode: 'worktree' } }, session: { cwd: `/runs/r/workers/${id}/worktree` } }));
const view = () => ({ runs: [{ id: 'r', workers: structuredClone(workers) }], git: { worktrees: [], branchCommits: { 'pstack-run/r/a': ['a'], 'pstack-run/r/b': ['b'] } } }) as unknown as RunView;
const verdict = (value: RunView) => evaluate([worktreeIsolation('isolation', source)], value)[0]?.verdict;

test('cleaned worktrees retain session cwd and branch evidence of isolation', () => {
  expect(verdict(view())).toBe('PASS');
});
test('a shared session cwd still fails after cleanup', () => {
  const value = view();
  value.runs[0]!.workers[1]!.session!.cwd = workers[0]!.session.cwd;
  expect(verdict(value)).toBe('FAIL');
});
test('a missing worktree and no branch evidence cannot establish isolation', () => {
  const value = view();
  value.git.branchCommits = {};
  expect(verdict(value)).toBe('FAIL');
});
