import { expect, test } from 'vitest';
import { interactionFamily } from './families/interaction.ts';
import type { RunView } from './lib/view.ts';

test('typed and RPC steers are proved by transcript delivery and a subsequent answer', () => {
  const messages = [{ role: 'user', order: 1, text: 'PANE-PROMPT-7f3a' }, { role: 'user', order: 3, text: 'PANE-STEER-91bc' }, { role: 'assistant', order: 4, text: 'The command finished. What should I do next?' }];
  const view = { runs: [{ id: 'r', workers: [{ id: 'chat', assignment: {}, state: { tmuxSession: 't' }, session: { messages, toolCalls: [{ name: 'bash', order: 2, args: { command: 'sleep 6' } }] } }] }], parent: { messages: [{ role: 'toolResult', order: 5, text: 'idle' }, { role: 'user', order: 6, text: 'RPC-STEER-0c2e' }, { role: 'assistant', order: 7, text: 'Received your follow-up.' }], toolCalls: [{ name: 'pstack_worker', order: 4, args: { action: 'inspect' } }] } } as unknown as RunView;
  const run = (suffix: string) => interactionFamily.checks.find((entry) => entry.id === `worker-interaction.${suffix}`)!.run(view);
  expect(run('typed-steer-lands-mid-run')).toMatchObject({ ok: true });
  expect(run('rpc-steer-lands-in-the-parent')).toMatchObject({ ok: true });
  messages[1]!.text = 'lost';
  expect(run('typed-steer-lands-mid-run')).toMatchObject({ ok: false });
  view.parent.messages[1]!.text = 'lost';
  expect(run('rpc-steer-lands-in-the-parent')).toMatchObject({ ok: false });
});
