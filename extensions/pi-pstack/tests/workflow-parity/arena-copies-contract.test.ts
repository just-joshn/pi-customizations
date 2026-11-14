import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, test } from 'vitest';
import { arenaFamily } from './families/design.ts';
import type { RunView } from './lib/view.ts';

test.for([true, false])('anonymous labelled copies must preserve each candidate artifact (%s)', (valid) => {
  const repo = mkdtempSync(join(tmpdir(), 'arena-copies-'));
  try {
    const workers = ['one', 'two'].map((id, index) => {
      const worktree = join(repo, 'workers', id, 'worktree');
      for (const file of ['src/coupon.js', 'test/coupon.test.js']) {
        for (const root of [worktree, join(repo, 'candidates', index === 0 ? 'A' : 'B')]) {
          const path = join(root, file);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, `${id}: ${file}`);
        }
      }
      return { id, assignment: { role: 'candidate' }, worktree };
    });
    if (!valid) writeFileSync(join(repo, 'candidates/B/src/coupon.js'), 'not candidate two');
    const judge = { id: 'judge', assignment: { role: 'judge' }, brief: 'Rubric: correctness, simplicity, coverage.\nCandidates are at `candidates/A/` and `candidates/B/`, relative to the repository root.' };
    const view = { repo, parent: { messages: [], toolCalls: [] }, runs: [{ workers: [...workers, judge] }] } as unknown as RunView;
    expect(arenaFamily.checks.find((check) => check.id === 'arena.judge-brief')?.run(view)).toMatchObject({ ok: valid });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
