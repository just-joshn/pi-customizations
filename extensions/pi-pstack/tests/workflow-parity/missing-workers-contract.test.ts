import { expect, test } from 'vitest';
import { opsFamilies } from './families/ops.ts';
import { babysitFamilies } from './families/pr-babysit.ts';
import { orchestrateSubFamily } from './families/pr-orchestrate-sub.ts';
import { evaluate } from './lib/check.ts';
import { required } from './lib/required.ts';
import type { RunView } from './lib/view.ts';

const empty = { repo: '/nonexistent', parent: { file: '/session', messages: [], toolCalls: [] }, runs: [], git: {} } as unknown as RunView;

test('cleanup reports missing workers as workflow failures instead of checker exceptions', () => {
  const ids = ['cleanup.audit-ran-as-a-watch-and-woke-the-parent', 'cleanup.audit-output-covers-every-worktree', 'cleanup.pinned-set-wins-and-usage-was-verified'];
  const checks = required(opsFamilies.find((family) => family.id === 'worktree-cleanup')).checks.filter((check) => ids.includes(check.id));
  const results = evaluate(checks, empty);
  expect(results.map((result) => result.verdict)).toEqual(['FAIL', 'FAIL', 'FAIL']);
  expect(results.every((result) => !/checker threw/i.test(result.evidence))).toBe(true);
});
test('duplicate-watcher behavior is inconclusive when the first request never armed a watcher', () => {
  const checks = babysitFamilies.flatMap((family) => family.checks).filter((check) => ['babysit.single.the-second-request-armed-no-second-watcher', 'babysit.single.only-one-watcher-ever-polled-the-pr'].includes(check.id));
  expect(evaluate(checks, empty).map((result) => result.verdict)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE']);
});

test('cleanup reports disk and held-back reasons without prescribed labels', () => {
  const checks = required(opsFamilies.find((family) => family.id === 'worktree-cleanup')).checks.filter((check) => check.id === 'cleanup.reply-has-disk-pruned-and-held-back-with-reasons');
  const value = structuredClone(empty);
  value.parent.messages = [{ order: 3, role: 'assistant', text: 'Disk before 40G free, after 41G free. Removed wt-clean. Held wt-wip for dirty uncommitted changes and wt-active because its chat is ongoing.' }];
  value.parent.toolCalls = [1, 2].map((order) => ({ order, name: 'bash', args: { command: 'df -h /' }, resultText: '41G', isError: false }));
  expect(evaluate(checks, value)[0]?.verdict).toBe('PASS');
  required(value.parent.messages[0]).text = 'Disk before 40G free, after 41G free. Removed wt-clean. Held wt-wip and wt-active.';
  expect(evaluate(checks, value)[0]?.verdict).toBe('FAIL');
});

test('a missing subcoordinator is a workflow failure with a direct reason', () => {
  const checks = orchestrateSubFamily.checks.filter((check) => check.id.startsWith('orchestrate.sub.') && !check.id.includes('no-merge') && !check.id.includes('no-tool-errors'));
  const results = evaluate(checks, empty);
  expect(results.every((result) => result.verdict === 'FAIL' && !/checker threw/i.test(result.evidence))).toBe(true);
});
