import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { contentText, makeSandbox, type PiEvent, type RpcSession, script, startRpc } from './harness.ts';

/** Answers each select or confirm dialog with the next scripted value, in order. */
function answerDialogs(rpc: RpcSession, answers: (string | boolean)[]): PiEvent[] {
  const seen: PiEvent[] = [];
  rpc.child.stdout?.on('data', () => {
    for (const event of rpc.events.filter((candidate) => candidate.type === 'extension_ui_request' && (candidate['method'] === 'select' || candidate['method'] === 'confirm') && !seen.includes(candidate))) {
      seen.push(event);
      const answer = answers.shift();
      rpc.send({ type: 'extension_ui_response', id: event['id'], ...(typeof answer === 'boolean' ? { confirmed: answer } : { value: answer }) });
    }
  });
  return seen;
}

const settledAfter = (rpc: RpcSession, mark: number) => rpc.waitFor((event) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= mark);

// Cursor's plan mode ends in a plan file the user reviews, a choice to build it, and markdown-only edits meanwhile.
test('plan mode saves a Cursor-shaped plan, asks whether to build it, and builds it on yes', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const rpc = startRpc(sandbox);
  onTestFinished(() => rpc.close());
  const dialogs = answerDialogs(rpc, ['No, propose changes', 'Yes, build locally']);
  const notify = (prefix: string) => rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'notify' && String(event['message']).startsWith(prefix));

  rpc.send({ type: 'prompt', message: '/plan' });
  await notify('Plan mode on');

  writeFileSync(join(sandbox.workDir, 'code.ts'), 'export {};\n');
  const mark = rpc.events.length;
  const steps = [
    { tool: 'CreatePlan', args: { name: 'Ship it', overview: 'Prove the file.', plan: '# Ship it\n\n- prove the file exists', todos: [{ id: 'prove', content: 'Prove the file exists' }] } },
    { tool: 'write', args: { path: 'notes.md', content: '# notes\n' } },
    { tool: 'edit', args: { path: 'code.ts', edits: [{ oldText: 'export {};', newText: 'export const x = 1;' }] } },
  ];
  rpc.send({ type: 'prompt', message: script(steps) });
  await settledAfter(rpc, mark);
  const ends = rpc.events.slice(mark).filter((event) => event.type === 'tool_execution_end');
  const planFile = String((ends.find((event) => event['toolName'] === 'CreatePlan')?.['result'] as { details?: { planFile?: string } } | undefined)?.details?.planFile ?? '');
  expect(planFile).toMatch(/\/pstack\/plans\/Ship it-[0-9a-f]{8}\.plan\.md$/);
  expect(readFileSync(planFile, 'utf8')).toMatch(/^<!-- [0-9a-f-]+ -->\n---\ntodos:\n {2}- id: "prove"\n {4}content: "Prove the file exists"\n {4}status: pending\nisProject: false\n---\n# Ship it\n\n- prove the file exists$/);
  expect(ends.map((event) => [event['toolName'], event['isError']])).toEqual([
    ['CreatePlan', false],
    ['write', false],
    ['edit', true],
  ]);
  expect([existsSync(join(sandbox.workDir, 'notes.md')), readFileSync(join(sandbox.workDir, 'code.ts'), 'utf8')]).toEqual([true, 'export {};\n']);

  await rpc.waitFor(() => dialogs.length === 1);
  expect(dialogs[0]?.['options']).toEqual(['Yes, build locally', 'No, propose changes']);

  const again = rpc.events.length;
  rpc.send({ type: 'prompt', message: script([{ tool: 'edit', args: { path: planFile, edits: [{ oldText: '- prove the file exists', newText: '- prove the file exists twice' }] } }]) });
  await settledAfter(rpc, again);
  rpc.send({ type: 'prompt', message: script([{ tool: 'CreatePlan', args: { plan: '# Ship it\n\n- prove the file exists twice' } }]) });
  const build = await rpc.waitFor((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'user' && contentText((event['message'] as { content: string }).content).startsWith('Build the plan saved at'));
  expect(contentText((build['message'] as { content: string }).content)).toBe([`Build the plan saved at ${planFile}. Follow it.`, '', '# Ship it', '', '- prove the file exists twice'].join('\n'));
  const footer = rpc.events.filter((event) => event.type === 'extension_ui_request' && event['method'] === 'setStatus' && event['statusKey'] === 'pstack-plan').at(-1);
  expect(footer?.['statusText']).toBeUndefined();
});

test('SwitchMode enters plan mode with the user approving, and /plan build starts the saved plan', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const rpc = startRpc(sandbox);
  onTestFinished(() => rpc.close());
  answerDialogs(rpc, [true, 'No, propose changes']);
  const mark = rpc.events.length;
  rpc.send({
    type: 'prompt',
    message: script([
      { tool: 'SwitchMode', args: { target_mode_id: 'plan', explanation: 'Several designs fit.' } },
      { tool: 'CreatePlan', args: { plan: '# Switched plan' } },
    ]),
  });
  await settledAfter(rpc, mark);
  const ends = rpc.events.slice(mark).filter((event) => event.type === 'tool_execution_end');
  expect(ends.map((event) => [event['toolName'], event['isError']])).toEqual([
    ['SwitchMode', false],
    ['CreatePlan', false],
  ]);
  const planFile = String((ends[1]?.['result'] as { details?: { planFile?: string } } | undefined)?.details?.planFile);
  await rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'select');
  rpc.send({ type: 'prompt', message: '/plan build' });
  const build = await rpc.waitFor((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'user' && contentText((event['message'] as { content: string }).content).startsWith('Build the plan saved at'));
  expect(contentText((build['message'] as { content: string }).content)).toBe([`Build the plan saved at ${planFile}. Follow it.`, '', '# Switched plan'].join('\n'));
});
