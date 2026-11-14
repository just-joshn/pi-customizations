import { expect, test } from 'vitest';
import { opsFamilies } from './families/ops.ts';
import { evaluate } from './lib/check.ts';
import { required } from './lib/required.ts';
import type { RunView } from './lib/view.ts';

const checks = required(opsFamilies.find((family) => family.id === 'autonomous-run')).checks;
const view = (watchers = 1, rows = 1) => ({ runs: [{ runJson: { playbook: 'autonomous-run' }, workers: Array.from({ length: watchers }, (_, i) => ({ id: `w${i}`, assignment: { kind: 'watch', role: 'watcher', watch: { argv: ['sleep', '1'], cwd: '/repo' } } })), decisions: [['ts', 'phase', 'decision', 'why', 'evidence', 'result'], ...Array.from({ length: rows }, () => ['now', 'iteration', 'changed lookup', 'fewer comparisons', 'bench output', 'predicate met'])] }], parent: { messages: Array.from({ length: watchers }, (_, i) => ({ order: i * 2 + 2, role: 'custom', customType: 'pstack-worker', details: { workerId: `w${i}`, phase: 'exited' } })), toolCalls: [...Array.from({ length: watchers }, (_, i) => ({ name: 'pstack_worker', order: i * 2 + 1, args: { action: 'spawn', assignmentPath: `/workers/w${i}/assignment.json` } })), { name: 'bash', order: 10, args: { command: 'node bench/bench.js | test 400 -le 1000' } }] } }) as unknown as RunView;
const verdict = (id: string, value: RunView) => evaluate(checks.filter((check) => check.id === id), value)[0]?.verdict;

test('a one-iteration solution needs one watch and one checkpoint', () => {
  expect(verdict('auto.watch-loop-re-arms-after-each-wake', view())).toBe('PASS');
  expect(verdict('auto.one-row-per-iteration', view())).toBe('PASS');
});
test('a missing checkpoint for the second iteration still fails', () => {
  expect(verdict('auto.one-row-per-iteration', view(2, 1))).toBe('FAIL');
});
test('a watcher spawned before the preceding wake is still a violation', () => {
  const value = view(2, 2);
  required(value.parent.toolCalls[1]).order = 1;
  expect(verdict('auto.watch-loop-re-arms-after-each-wake', value)).toBe('FAIL');
});
