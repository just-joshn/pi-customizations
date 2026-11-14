import { expect, test } from 'vitest';

import { historyFamilies } from './families/history.ts';
import { evaluate } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

const checks = historyFamilies.find((family) => family.id === 'show-me-your-work')!.checks;
const verdict = (id: string, view: Partial<RunView>) => evaluate(checks.filter((check) => check.id === id), view as RunView)[0]?.verdict;
const reply = (text: string) => ({ parent: { messages: [{ role: 'assistant', text, order: 1 }], toolCalls: [] } }) as unknown as Partial<RunView>;

test('formula-free logs need no invented formula cell', () => {
  expect(verdict('trail.cells-are-spreadsheet-safe', { runs: [{ decisions: [['ts'], ['now', 'review', 'kept code']] }] } as unknown as Partial<RunView>)).toBe('PASS');
});
test('raw formulas still fail', () => {
  expect(verdict('trail.cells-are-spreadsheet-safe', { runs: [{ decisions: [['ts'], ['now', 'review', '=SUM(1,2)']] }] } as unknown as Partial<RunView>)).toBe('FAIL');
});
test('Attention may point to a named row and moment, or explicitly report no flags', () => {
  expect(verdict('trail.reply-ends-with-attention', reply('## Attention\nreviewed by OpenAI GPT\n- Row `review` at 00:28:09Z needs stronger evidence.'))).toBe('PASS');
  expect(verdict('trail.reply-ends-with-attention', reply('## Attention\nreviewed by OpenAI GPT\nNo flags.'))).toBe('PASS');
});
test('a reviewer name alone is not an attention report', () => {
  expect(verdict('trail.reply-ends-with-attention', reply('## Attention\nreviewed by OpenAI GPT'))).toBe('FAIL');
});
