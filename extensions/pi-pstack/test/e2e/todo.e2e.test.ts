import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { makeSandbox, type PiEvent, type RpcSession, type Sandbox, script, startRpc } from './harness.ts';

let sandbox: Sandbox;
let rpc: RpcSession;
beforeEach(() => {
  sandbox = makeSandbox();
  rpc = startRpc(sandbox, ['--session-dir', join(sandbox.root, 'sessions')]);
});
afterEach(async () => {
  await rpc.close();
  sandbox.dispose();
});

const settled = (after: number) => (event: PiEvent) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= after;

async function prompt(message: string): Promise<void> {
  const mark = rpc.events.length;
  rpc.send({ type: 'prompt', message });
  await rpc.waitFor(settled(mark));
}

const lastTodoResult = () => {
  const ends = rpc.events.filter((event) => event.type === 'tool_execution_end' && event['toolName'] === 'TodoWrite');
  const result = ends.at(-1)?.['result'] as { content: { text: string }[] } | undefined;
  return result?.content[0]?.text;
};

test('TodoWrite state follows a fork back to the earlier branch and drives the widget (TODO-001, TODO-002)', async () => {
  await prompt(
    script([
      {
        tool: 'TodoWrite',
        args: {
          merge: false,
          todos: [
            { id: 'a', content: 'Alpha', status: 'pending' },
            { id: 'b', content: 'Beta', status: 'pending' },
          ],
        },
      },
    ]),
  );
  await prompt(script([{ tool: 'TodoWrite', args: { merge: true, todos: [{ id: 'a', status: 'completed' }] } }]));
  expect(lastTodoResult()).toBe('Todos (1/2 completed):\n[x] a: Alpha\n[ ] b: Beta');
  const widget = rpc.events.filter((event) => event.type === 'extension_ui_request' && event['method'] === 'setWidget' && event['widgetKey'] === 'pstack-todos').at(-1);
  expect(widget?.['widgetLines']).toEqual(['Todos 1/2', '✓ Alpha', '○ Beta']);

  rpc.send({ id: 'entries', type: 'get_entries' });
  const entries = (await rpc.waitFor((event) => event['id'] === 'entries'))['data'] as { entries: { id: string; type: string; message?: { role: string } }[] };
  const userEntries = entries.entries.filter((entry) => entry.type === 'message' && entry.message?.role === 'user');
  rpc.send({ id: 'fork', type: 'fork', entryId: userEntries[1]?.id });
  await rpc.waitFor((event) => event['id'] === 'fork' && event['success'] === true);

  await prompt(script([{ tool: 'TodoWrite', args: { merge: true, todos: [{ id: 'c', content: 'Gamma', status: 'in_progress' }] } }]));
  expect(lastTodoResult()).toBe('Todos (0/3 completed, 1 in progress):\n[ ] a: Alpha\n[ ] b: Beta\n[>] c: Gamma');
});
