import { expect, test } from 'vitest';

import { designFamilies } from './families/design.ts';
import { evaluate } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

const checks = designFamilies.find((family) => family.id === 'arena')!.checks.filter((check) => check.id === 'arena.synthesis-note');
const verdict = (note: string) => evaluate(checks, { parent: { messages: [{ order: 1, role: 'assistant', text: `Base: candidate-1. Cross-judge: clean. Grafts: none. Rejected: candidate-2 for incorrect NaN handling. ${note} Verification: node --test passes.` }], toolCalls: [] }, runs: [{ workers: [{ id: 'judge', assignment: { role: 'judge' } }] }] } as unknown as RunView)[0]?.verdict;

test('a convergence note need not contain the word dropouts', () => {
  expect(verdict('Convergence: both candidates chose the same shape.')).toBe('PASS');
});
test('the synthesis note still accounts for convergence or dropouts', () => {
  expect(verdict('')).toBe('FAIL');
});
