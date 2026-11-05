import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { makeSandbox, type PiEvent, script, startRpc, toolEnds } from './harness.ts';

const slug = (cwd: string) => `--${cwd.replace(/^\//, '').replace(/[/\\:]/g, '-')}--`;
const assistantText = (events: PiEvent[]) =>
  events
    .filter((event) => event.type === 'message_end' && (event['message'] as { role?: string } | undefined)?.role === 'assistant')
    .map((event) => JSON.stringify(event['message']))
    .at(-1) ?? '';

test('a chat that starts a Project gets its tracker, store, and chats in context, and so do its subagents (G2)', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const rpc = startRpc(sandbox);
  onTestFinished(async () => {
    await rpc.close();
    sandbox.dispose();
  });
  rpc.send({ id: 'new', type: 'prompt', message: '/project new Payments Migration' });
  await rpc.waitFor((event) => event.type === 'response' && event['id'] === 'new');
  const dir = join(sandbox.agentDir, 'pstack/workspaces', slug(sandbox.workDir), 'projects/payments-migration');
  expect([existsSync(join(dir, 'notes.md')), existsSync(join(dir, 'store'))]).toEqual([true, true]);
  rpc.send({ id: 'sys', type: 'prompt', message: '@@sys' });
  await rpc.waitFor((event) => event.type === 'agent_settled');
  expect(assistantText(rpc.events)).toContain(`This chat belongs to the Project \\"Payments Migration\\". Its tracker is ${join(dir, 'notes.md')}`);
  const mark = rpc.events.length;
  rpc.send({ type: 'prompt', message: script([{ tool: 'Task', args: { description: 'child', prompt: 'go\n@@sys' } }]) });
  await rpc.waitFor((event) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= mark);
  expect(toolEnds(rpc.events.slice(mark), 'Task')[0]?.text).toContain('This chat belongs to the Project "Payments Migration"');
  const project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as { name: string; chats: { sessionFile: string }[] };
  expect(project.name).toBe('Payments Migration');
  expect(project.chats).toHaveLength(1);
});

test('the footer counts the subscriptions this chat listens to (G2)', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const rpc = startRpc(sandbox);
  onTestFinished(async () => {
    await rpc.close();
    sandbox.dispose();
  });
  rpc.send({ type: 'prompt', message: script([{ tool: 'subscribe_timer', args: { name: 'daily', prompt: 'check', cron: '0 8 * * *' } }]) });
  await rpc.waitFor((event) => event.type === 'agent_settled');
  const status = rpc.events.filter((event) => event.type === 'extension_ui_request' && event['method'] === 'setStatus' && event['statusKey'] === 'pstack-listening').at(-1);
  expect(status?.['statusText']).toBe('listening: 1');
});
