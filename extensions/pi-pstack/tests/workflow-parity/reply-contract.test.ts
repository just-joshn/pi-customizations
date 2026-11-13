import { expect, test } from 'vitest';
import { babysitRestartFamily } from './families/pr-babysit-restart.ts';
import { openingFamily } from './families/pr-review.ts';
import type { RunView } from './lib/view.ts';

const result = (family: typeof openingFamily, id: string, text: string, watcher = false) => family.checks.find((entry) => entry.id === id)!.run({ runs: [{ workers: watcher ? [{ assignment: { kind: 'watch' } }] : [] }], parent: { toolCalls: [], messages: [{ role: 'assistant', order: 1, text }] } } as unknown as RunView);
test('opening has no required no-babysit reply phrase', () => {
  expect(result(openingFamily, 'open.opening-does-not-start-a-babysit', 'I did not start a babysit on either PR.')).toMatchObject({ ok: true });
  expect(result(openingFamily, 'open.opening-does-not-start-a-babysit', 'No babysit started', true)).toMatchObject({ ok: false });
});
test('restart reports merge-ready without inventing an adoption reply template', () => {
  expect(result(babysitRestartFamily, 'babysit.restart.reply-says-merge-ready-from-the-adopted-watcher', 'The PR is merge-ready. Landing belongs to Shipping.')).toMatchObject({ ok: true });
  expect(result(babysitRestartFamily, 'babysit.restart.reply-says-merge-ready-from-the-adopted-watcher', 'The PR is still blocked.')).toMatchObject({ ok: false });
});
