import { expect, test } from 'vitest';
import { showWorkFamily } from './families/history.ts';
import type { RunView } from './lib/view.ts';

test('Attention can point to multiple rows without a singular label', () => {
  const message = { role: 'assistant', order: 1, text: 'Attention\nreviewed by model\nRows 2 and 4 need review.' };
  const view = { parent: { messages: [message], toolCalls: [] } } as unknown as RunView;
  const check = showWorkFamily.checks.find((entry) => entry.id === 'trail.reply-ends-with-attention');
  expect(check?.run(view)).toMatchObject({ ok: true });
  message.text = 'Attention\nreviewed by model\nSome things need review.';
  expect(check?.run(view)).toMatchObject({ ok: false });
});
