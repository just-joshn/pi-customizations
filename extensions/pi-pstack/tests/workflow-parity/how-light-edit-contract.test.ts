import { expect, test } from 'vitest';
import { investigationFamilies } from './families/investigation.ts';
import type { RunView } from './lib/view.ts';

test('light edits to the first line do not hide the presented how sections', () => {
  const original = '### Overview\nThe money helper rounds the running total before formatting the value.\n### Key Concepts\nCents.\n### How It Works\nRound.\n### Where Things Live\nsrc/money.js\n### Gotchas\nFloating point.';
  const message = { role: 'assistant', order: 2, text: original.replace('rounds the running total', 'rounds a total') };
  const view = { runs: [{ workers: [{ id: 'explainer', assignment: { role: 'general' }, finalText: original }] }], parent: { messages: [message], toolCalls: [] } } as unknown as RunView;
  const check = investigationFamilies.flatMap((family) => family.checks).find((entry) => entry.id === 'how.output-sections');
  expect(check?.run(view)).toMatchObject({ ok: true });
  message.text += '\n### Open questions\nNone.';
  expect(check?.run(view)).toMatchObject({ ok: false });
});
