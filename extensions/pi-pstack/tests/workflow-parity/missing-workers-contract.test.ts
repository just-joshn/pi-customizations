import { expect, test } from 'vitest';

import { opsFamilies } from './families/ops.ts';
import { orchestrateSubFamily } from './families/pr-orchestrate-sub.ts';
import { evaluate } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

const empty = { repo: '/nonexistent', parent: { file: '/session', messages: [], toolCalls: [] }, runs: [], git: {} } as unknown as RunView;

test('cleanup reports missing workers as workflow failures instead of checker exceptions', () => {
  const ids = ['cleanup.audit-ran-as-a-watch-and-woke-the-parent', 'cleanup.audit-output-covers-every-worktree', 'cleanup.pinned-set-wins-and-usage-was-verified'];
  const checks = opsFamilies.find((family) => family.id === 'worktree-cleanup')!.checks.filter((check) => ids.includes(check.id));
  const results = evaluate(checks, empty);
  expect(results.map((result) => result.verdict)).toEqual(['FAIL', 'FAIL', 'FAIL']);
  expect(results.every((result) => !/checker threw/i.test(result.evidence))).toBe(true);
});
test('a missing subcoordinator is a workflow failure with a direct reason', () => {
  const checks = orchestrateSubFamily.checks.filter((check) => check.id.startsWith('orchestrate.sub.') && !check.id.includes('no-merge') && !check.id.includes('no-tool-errors'));
  const results = evaluate(checks, empty);
  expect(results.every((result) => result.verdict === 'FAIL' && !/checker threw/i.test(result.evidence))).toBe(true);
});
