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
    worker.report = `VERDICT: pass\nHead: ${head}`;
    expect(laneClean(view, worker, head)).toBe(true);
    expect(verificationWorkers(view, 'b'.repeat(40))).toEqual([]);
    worker.report = `**PASS** at ${head}\nISSUES: none provable.`;
    expect(laneClean(view, worker, head)).toBe(true);
    for (const report of [`Verdict: INCONCLUSIVE at ${head}\nPASS at ${head}`, `VERDICT: ISSUES at ${head}\nPASS at ${head}`, `Checked head ${head}`, `ISSUES at ${head}`, `PASS at ${head}\nISSUES: unsafe merge.`, `PASS at ${head}\nISSUES: none provable.\nISSUES: tests fail.`,  `BLOCKED at ${head}`, `PASS at ${'b'.repeat(40)}`]) {
      worker.report = report;
      expect(laneClean(view, worker, head), report).toBe(false);
    }
    worker.assignment['workspace'] = { mode: 'readonly', path: '/checkout' };
    worker.brief = `Verify the exact head ${head}.`;
    worker.session = { cwd: '/checkout', toolCalls: [{ name: 'bash_readonly', args: { command: 'pwd; git rev-parse HEAD' }, resultText: `/checkout\n${head}\n`, isError: false }] } as unknown as WorkerView['session'];
    expect(verificationWorkers(view, head)).toEqual([worker]);
    expect(verificationWorkers(view, 'b'.repeat(40))).toEqual([]);
    if (worker.session === null) throw new Error('Missing session');
    const probe = worker.session.toolCalls[0];
    if (probe === undefined) throw new Error('Missing head probe');
    probe.resultText = `/checkout\n${'b'.repeat(40)}\n`;
    expect(verificationWorkers(view, head)).toEqual([]);
    worker.session.toolCalls = [];
    expect(verificationWorkers(view, head)).toEqual([]);
    worker.assignment['role'] = 'owner';
    expect(verificationWorkers(view, head)).toEqual([]);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
