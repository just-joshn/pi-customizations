import { expect, test } from 'vitest';
import { laneClean } from './families/pr-autopilot.ts';
import type { RunView, WorkerView } from './lib/view.ts';

test.for(['**Issues:** none.', '**Issues:** none reproduced.'])('markdown no-issues report is clean (%s)', (issues) => {
  const worker = { id: 'lane', finalText: `**PASS** at ${'a'.repeat(40)}\n${issues}` } as WorkerView;
  expect(laneClean({} as RunView, worker, 'a'.repeat(40))).toBe(true);
  worker.finalText = `**PASS** at ${'a'.repeat(40)}\n**ISSUES** one blocking defect`;
  expect(laneClean({} as RunView, worker, 'a'.repeat(40))).toBe(false);
});
