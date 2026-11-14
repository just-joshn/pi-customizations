import { expect, test } from 'vitest';

import { tddFamily } from './families/build.ts';
import { evaluate } from './lib/check.ts';
import type { RunView, ToolCall } from './lib/view.ts';

const edit = (path: string): ToolCall => ({ order: 1, name: 'edit', args: { path }, resultText: '', isError: false });
const run = (red: boolean): ToolCall => ({ order: 1, name: 'bash', args: { command: 'node --test' }, resultText: red ? 'not ok 1 regression' : 'pass 4 fail 0', isError: red });
const verdict = (calls: ToolCall[]) => evaluate(tddFamily.checks.filter((check) => check.id === 'tdd.test-first-red-then-fix-then-green'), { repo: '/repo', parent: { toolCalls: calls } } as unknown as RunView)[0]?.verdict;

test('test, failing run, fix and passing run preserve tool order within assistant messages', () => {
  expect(verdict([edit('/repo/test/cart.test.js'), run(true), edit('/repo/src/cart.js'), run(false)])).toBe('PASS');
});
test('fixing before observing red still fails even in one assistant message', () => {
  expect(verdict([edit('/repo/test/cart.test.js'), edit('/repo/src/cart.js'), run(true), run(false)])).toBe('FAIL');
});
test('a passing first run is not red evidence', () => {
  expect(verdict([edit('/repo/test/cart.test.js'), run(false), edit('/repo/src/cart.js'), run(false)])).toBe('FAIL');
});
