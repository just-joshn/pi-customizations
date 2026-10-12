import { afterEach, beforeEach, expect, test } from 'vitest';
import { contentText, makeSandbox, type PiEvent, type RpcSession, type Sandbox, script, startRpc } from './harness.ts';

let sandbox: Sandbox;
let rpc: RpcSession;
beforeEach(() => {
  sandbox = makeSandbox();
  rpc = startRpc(sandbox, ['--no-session']);
});
afterEach(async () => {
  await rpc.close();
  sandbox.dispose();
});

// Pi sets process.title to "pi", so ps cannot find a child by its arguments; the Task details carry its pid.
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function gone(pids: readonly number[], timeoutMs = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !alive(pid))) return true;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return pids.every((pid) => !alive(pid));
}

async function reply(message: string): Promise<string> {
  const mark = rpc.events.length;
  rpc.send({ type: 'prompt', message });
  await rpc.waitFor((event) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= mark);
  const last = rpc.events
    .slice(mark)
    .filter((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant')
    .at(-1);
  if (last === undefined) throw new Error('the run produced no assistant message');
  return contentText((last['message'] as { content: { type: string; text?: string }[] }).content);
}

async function backgroundAgent(): Promise<number> {
  const mark = rpc.events.length;
  rpc.send({ type: 'prompt', message: script([{ tool: 'Task', args: { description: 'slow', prompt: 'go\n@@sleep 60000 SLOW', run_in_background: true } }]) });
  const end = await rpc.waitFor((event: PiEvent) => event.type === 'tool_execution_end' && event['toolName'] === 'Task' && rpc.events.indexOf(event) >= mark);
  await rpc.waitFor((event) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= mark);
  return (end['result'] as { details: { pid: number } }).details.pid;
}

test('/reload keeps aliases and tools, and stops the old runtime children (PKG-002)', async () => {
  const pid = await backgroundAgent();
  expect(alive(pid)).toBe(true);
  rpc.send({ id: 'reload', type: 'prompt', message: '/test-reload' });
  await rpc.waitFor((event) => event['id'] === 'reload');
  expect(await gone([pid])).toBe(true);
  expect(await reply('/how @@say STILL-ALIASED')).toBe('STILL-ALIASED');
  expect(
    (await reply('tools\n@@tools-list'))
      .split(',')
      .filter((name) => name === 'Task' || name === 'TodoWrite')
      .toSorted(),
  ).toEqual(['Task', 'TodoWrite']);
});

test('a new session resets mode and todos and stops the old children (PKG-002)', async () => {
  rpc.send({ id: 'mode', type: 'prompt', message: '/mode tdd' });
  await rpc.waitFor((event) => event['id'] === 'mode');
  await reply(script([{ tool: 'TodoWrite', args: { merge: false, todos: [{ id: 'a', content: 'Alpha', status: 'pending' }] } }]));
  const pid = await backgroundAgent();
  expect(alive(pid)).toBe(true);
  rpc.send({ id: 'new', type: 'new_session' });
  await rpc.waitFor((event) => event['id'] === 'new');
  expect(await gone([pid])).toBe(true);
  const notice = rpc.events.find((event) => event.type === 'extension_ui_request' && event['method'] === 'notify' && String(event['message']).startsWith('Stopped 1 background'));
  expect(notice?.['message']).toBe('Stopped 1 background subagent (session new). Resume one with its agent ID.');
  expect(await reply('fresh\n@@sys')).not.toContain('<pstack_mode>');
  expect(await reply(script([{ tool: 'TodoWrite', args: { merge: true, todos: [{ id: 'b', content: 'Beta', status: 'pending' }] } }]))).toBe('RESULTS:\n[TodoWrite] Todos (0/1 completed):\n[ ] b: Beta');
});
