import { expect, test } from 'vitest';
import { concurrencyFamily } from './families/concurrency.ts';
import { required } from './lib/required.ts';
import type { RunView } from './lib/view.ts';

test('waiting for a wake is inconclusive when no independent task was requested', () => {
  const workers = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const toolCalls = workers.map((worker, order) => ({ order, name: 'pstack_worker', args: { action: 'spawn', assignmentPath: `/workers/${worker.id}/assignment.json` }, isError: false, resultText: '' }));
  const view = { runs: [{ workers }], parent: { toolCalls } } as unknown as RunView;
  const check = concurrencyFamily.checks.find((entry) => entry.id === 'worker-concurrency.parent-continues-independent-work');
  expect(check?.run(view)).toHaveProperty('inconclusive');
  view.parent.toolCalls.push({ order: 10, name: 'bash', args: { command: 'sleep 30' }, resultText: '', isError: false });
  expect(check?.run(view)).toMatchObject({ ok: false });
  required(view.parent.toolCalls[4]).args = { command: 'git diff' };
  expect(check?.run(view)).toMatchObject({ ok: true });
});
