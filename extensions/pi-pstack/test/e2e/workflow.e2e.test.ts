import { afterEach, beforeEach, expect, test } from 'vitest';
import { contentText, makeSandbox, type PiEvent, type Sandbox, startRpc } from './harness.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.dispose());

const messageOf = (event: PiEvent) => event['message'] as { role: string; content: string | { type: string; text?: string }[]; customType?: string };

test('a poteto-mode session carries the mode, a referenced skill, a background poteto-agent, and its completion (WORKFLOW-001)', async () => {
  const rpc = startRpc(sandbox, ['--no-session']);
  try {
    rpc.send({ id: 'mode', type: 'prompt', message: '/mode poteto-mode' });
    await rpc.waitFor((event) => event.type === 'response' && event['id'] === 'mode');
    const steps = [
      { tool: 'Task', args: { description: 'delegate', prompt: 'child task\n@@say CHILD-DONE', subagent_type: 'poteto-agent', run_in_background: true } },
      { tool: 'TodoWrite', args: { todos: [{ id: '1', content: 'fix the drift', status: 'in_progress' }], merge: false } },
    ];
    rpc.send({ type: 'prompt', message: `fix the drift. /show-me-your-work keep a trail\n@@script ${JSON.stringify(steps)}` });
    const notice = await rpc.waitFor((event) => event.type === 'message_end' && messageOf(event).customType === 'pstack/task', 60_000);
    await rpc.waitFor((event) => event.type === 'agent_settled' && rpc.events.indexOf(event) > rpc.events.indexOf(notice), 60_000);

    const user = rpc.events.filter((event) => event.type === 'message_end' && messageOf(event).role === 'user').map((event) => contentText(messageOf(event).content));
    const tools = rpc.events.filter((event) => event.type === 'tool_execution_end').map((event) => [event['toolName'], event['isError']]);
    expect(user[0]?.startsWith('<skill name="show-me-your-work"')).toBe(true);
    expect(user[0]?.endsWith(`fix the drift. /show-me-your-work keep a trail\n@@script ${JSON.stringify(steps)}`)).toBe(true);
    expect(tools).toEqual([
      ['Task', false],
      ['TodoWrite', false],
    ]);
    expect(contentText(messageOf(notice).content)).toContain('CHILD-DONE');

    rpc.send({ type: 'prompt', message: 'show the prompt\n@@sys' });
    const system = await rpc.waitFor((event) => event.type === 'message_end' && messageOf(event).role === 'assistant' && contentText(messageOf(event).content).includes('<pstack_mode_skill>'), 30_000);
    const text = contentText(messageOf(system).content);
    expect(text).toContain('<skill name="poteto-mode"');
    expect(text).toContain('Reminder: you are still in poteto-mode mode.');
  } finally {
    await rpc.close();
  }
});
