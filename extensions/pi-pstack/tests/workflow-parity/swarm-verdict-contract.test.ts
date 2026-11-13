import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { laneClean, verificationWorkers } from './families/pr-autopilot.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView, WorkerView } from './lib/view.ts';

test('general swarm verifiers report PASS at their assigned head without an invented protocol', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'swarm-verdict-'));
  const head = 'a'.repeat(40);
  const worker = { id: 'audit', brief: 'Independently verify this change. Audit the diff.', assignment: { role: 'general', workspace: { inputCommit: head } }, report: `**PASS** Head verified: ${head}` } as unknown as WorkerView;
  const view = { sandbox, runs: [{ workers: [worker] }] } as unknown as RunView;
  try {
    mkdirSync(forgeDirOf(sandbox), { recursive: true });
    writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify({ prs: {} }));
    writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), '');
    expect(verificationWorkers(view, head)).toEqual([worker]);
    expect(laneClean(view, worker, head)).toBe(true);
    expect(verificationWorkers(view, 'b'.repeat(40))).toEqual([]);
    for (const report of [`Checked head ${head}`, `ISSUES at ${head}`, `BLOCKED at ${head}`, `PASS at ${'b'.repeat(40)}`]) {
      worker.report = report;
      expect(laneClean(view, worker, head), report).toBe(false);
    }
    worker.assignment['role'] = 'owner';
    expect(verificationWorkers(view, head)).toEqual([]);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
