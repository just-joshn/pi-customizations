import { expect, test } from 'vitest';
import { swarmFamily } from './families/design.ts';
import { evaluate } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

const rows = ['cart', 'money', 'checkout'].map((name) => `| audit-${name} | \`src/${name}.js\` | ISSUES | rounding discrepancy |`);
const run = (reply: string, invalid = false) =>
  ({
    base: 'a'.repeat(40),
    parent: { messages: [{ order: 1, role: 'assistant', text: reply }], toolCalls: [] },
    runs: [
      {
        workers: ['cart', 'money', 'checkout'].map((name) => ({
          id: `audit-${name}`,
          assignment: {},
          brief: `src/${name}.js`,
          finalText: invalid && name === 'cart' ? 'ISSUES' : `ISSUES at ${'a'.repeat(40)}, method node --test`,
          state: { settles: [{ phase: 'idle' }] },
        })),
      },
    ],
  }) as unknown as RunView;
const checks = swarmFamily.checks.filter((check) => ['swarm.results-record-sha-and-method', 'swarm.pass-lanes-have-receipts', 'swarm.report-keeps-outcome-distinctions'].includes(check.id));
const verdicts = (reply: string, invalid = false) => evaluate(checks, run(reply, invalid)).map((result) => result.verdict);
const report = `${rows.join('\n')}\nNo dropouts, no gaps.`;

test('the worker column may precede the slice and outcome columns', () => {
  expect(verdicts(report)).toEqual(['PASS', 'PASS', 'PASS']);
});
test('an accepted result without its SHA and method fails', () => {
  expect(verdicts(report, true)[0]).toBe('FAIL');
});
test('a PASS lane without receipts still fails with reordered columns', () => {
  expect(verdicts(report.replace('ISSUES', 'PASS'))[1]).toBe('FAIL');
});
test('an invalid outcome is not a result', () => {
  expect(verdicts(report.replace('ISSUES', 'MOSTLY FINE'))[2]).toBe('FAIL');
});
test('the report must account for gaps or dropouts', () => {
  expect(verdicts(rows.join('\n'))[2]).toBe('FAIL');
});
