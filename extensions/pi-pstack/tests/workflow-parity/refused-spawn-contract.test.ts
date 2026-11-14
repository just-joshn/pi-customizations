import { expect, test } from 'vitest';
import { concurrencyFamily } from './families/concurrency.ts';
import { interactionFamily } from './families/interaction.ts';
import type { RunView } from './lib/view.ts';

const spawn = (order: number, id: string, isError = false) => ({ order, name: 'pstack_worker', args: { action: 'spawn', assignmentPath: `/workers/${id}/assignment.json` }, isError, resultText: isError ? 'Container refused' : `tmux -L pstack attach -t ${id}` });

test('interaction attach evidence comes from the successful interactive worker spawn', () => {
  const view = { runs: [{ workers: [{ id: 'live', assignment: { kind: 'pi' }, state: { tmuxSession: 'live' } }] }], parent: { toolCalls: [spawn(1, 'refused', true), spawn(3, 'live')] } } as unknown as RunView;
  const check = interactionFamily.checks.find((entry) => entry.id === 'worker-interaction.spawn-returns-an-attach-command');
  expect(check?.run(view)).toMatchObject({ ok: true });
  view.parent.toolCalls.pop();
  expect(check?.run(view)).toMatchObject({ ok: false });
});

test('independent work before successful spawns does not prove post-spawn concurrency', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const view = { runs: [{ workers: ids.map((id) => ({ id, assignment: {} })) }], parent: { toolCalls: [...ids.map((id) => spawn(1, id, true)), { order: 2, name: 'bash', args: { command: 'git status' } }, ...ids.map((id) => spawn(3, id)), { order: 4, name: 'pstack_worker', args: { action: 'collect', workerId: 'a' } }] } } as unknown as RunView;
  const check = concurrencyFamily.checks.find((entry) => entry.id === 'worker-concurrency.parent-continues-independent-work');
  expect(check?.run(view)).toMatchObject({ ok: false });
  view.parent.toolCalls.splice(-1, 1, { order: 4, name: 'bash', args: { command: 'git status' }, resultText: '', isError: false });
  expect(check?.run(view)).toMatchObject({ ok: true });
});
