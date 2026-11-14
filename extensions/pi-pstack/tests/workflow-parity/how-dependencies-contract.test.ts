import { expect, test } from 'vitest';
import { howFamily } from './families/investigation.ts';
import type { RunView } from './lib/view.ts';

const view = { models: null, runs: [], parent: { models: [], messages: [], toolCalls: [] } } as unknown as RunView;
const dependent = ['how.explainer-after-explorers', 'how.explainer-brief-has-findings', 'how.readonly-enforced', 'how.settled-and-collected', 'how.output-sections'];
test.for(dependent)('a missing explainer makes its dependent check derived: %s', (id) => {
  expect(howFamily.checks.find((check) => check.id === id)?.run(view)).toMatchObject({ inconclusive: expect.stringContaining('how.explainer') });
});
test('the missing explainer remains an upstream failure', () => {
  expect(howFamily.checks.find((check) => check.id === 'how.explainer')?.run(view)).toMatchObject({ ok: false });
});
