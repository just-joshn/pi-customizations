import { existsSync, readFileSync } from 'node:fs';

import { expect, test } from 'vitest';
import { contentText, makeSandbox, script, startRpc } from './harness.ts';

// The plan artifact is the behaviour Cursor's plan mode has and a reply-only plan does not: a file the user can
// review, and a build action that starts work from it.
test('plan mode saves a plan file and /plan build starts the work from it', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const rpc = startRpc(sandbox);
  onTestFinished(() => rpc.close());
  const notify = (prefix: string) => rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'notify' && String(event['message']).startsWith(prefix));

  rpc.send({ type: 'prompt', message: '/plan' });
  await notify('Plan mode on');

  const mark = rpc.events.length;
  rpc.send({ type: 'prompt', message: script([{ tool: 'create_plan', args: { name: 'Ship it', content: '# Ship it\n\n- [ ] prove the file exists' } }]) });
  await rpc.waitFor((event) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= mark);
  const saved = rpc.events
    .slice(mark)
    .filter((event) => event.type === 'tool_execution_end' && event['toolName'] === 'create_plan')
    .map((event) => (event['result'] as { details?: { planFile?: string } } | undefined)?.details?.planFile ?? '')
    .at(-1);
  expect(saved).toBeDefined();
  expect(saved).toMatch(/\/pstack\/plans\/Ship it-[0-9a-f]{8}\.plan\.md$/);
  const planFile = saved ?? '';
  expect(existsSync(planFile)).toBe(true);
  expect(readFileSync(planFile, 'utf8')).toContain('- [ ] prove the file exists');

  const before = rpc.events.length;
  rpc.send({ type: 'prompt', message: '/plan build' });
  await notify(`Building ${planFile}`);
  const user = await rpc.waitFor((event) => rpc.events.indexOf(event) >= before && event.type === 'message_end' && (event['message'] as { role: string }).role === 'user');
  expect(contentText((user['message'] as { content: string }).content)).toBe([`Build the plan saved at ${planFile}. Follow it.`, '', '# Ship it', '', '- [ ] prove the file exists'].join('\n'));
  const footer = rpc.events.filter((event) => event.type === 'extension_ui_request' && event['method'] === 'setStatus' && event['statusKey'] === 'pstack-plan').at(-1);
  expect(footer?.['statusText']).toBeUndefined();
});
