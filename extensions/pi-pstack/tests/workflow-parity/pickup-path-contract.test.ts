import { expect, test } from 'vitest';
import { opsFamilies } from './families/ops.ts';
import { evaluate } from './lib/check.ts';
import { required } from './lib/required.ts';
import type { RunView } from './lib/view.ts';

const check = required(opsFamilies.find((family) => family.id === 'session-pickup')).checks.filter((entry) => entry.id === 'pickup.nothing-redone');
const verdict = (path: string) => evaluate(check, { repo: '/Users/operator/src/project/sandbox/repo', parent: { toolCalls: [{ name: 'edit', args: { path } }] }, git: { commitsSinceBase: [], dirty: [] } } as unknown as RunView)[0]?.verdict;

test('src in the sandbox ancestry does not turn a TODO edit into a source rewrite', () => {
  expect(verdict('/Users/operator/src/project/sandbox/repo/.pi/pstack/runs/r/TODO.md')).toBe('PASS');
});
test('absolute and relative source rewrites still fail', () => {
  expect(verdict('/Users/operator/src/project/sandbox/repo/src/cart.js')).toBe('FAIL');
  expect(verdict('test/cart.test.js')).toBe('FAIL');
});
