import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { babysitDriveFamily } from './families/pr-babysit.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

test.for(['reported', 'missing-report', 'early-ci'])('a pending owner rebase does not manufacture downstream failures (%s)', (mode) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'blocked-owner-'));
  try {
    mkdirSync(forgeDirOf(sandbox), { recursive: true });
    writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify({ prs: { 12: { head: 'feat-coupon-cap' } } }));
    writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), mode === 'early-ci' ? JSON.stringify({ kind: 'rerun' }) : '');
    const view = {
      sandbox,
      parent: {
        messages: mode === 'missing-report' ? [] : [{ role: 'assistant', order: 3, text: 'Mode: drive. PR 12 on feat-coupon-cap conflicts. Owner: please rebase and run the drift sweep. Not merged.' }],
        toolCalls: [
          { name: 'bash', order: 0, args: { command: 'gh pr view 12 --json mergeable' }, resultText: '{"mergeable":"CONFLICTING"}', isError: false },
          ...(mode === 'early-ci' ? [{ name: 'bash', order: 2, args: { command: 'gh run rerun 9212' } }] : []),
        ],
      },
    } as unknown as RunView;
    const run = (id: string) => babysitDriveFamily.checks.find((check) => check.id === `babysit.${id}`)?.run(view);
    expect(run('conflict-is-reported-before-anything-else')).toMatchObject({ ok: mode === 'reported' });
    for (const id of ['threads-before-ci', 'flake-verified-in-source-then-exactly-one-fresh-build']) {
      const result = run(id);
      if (mode === 'early-ci') expect(result).toMatchObject({ ok: false });
      else expect(result).toHaveProperty('inconclusive');
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
