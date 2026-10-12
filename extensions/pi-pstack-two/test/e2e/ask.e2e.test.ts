import { afterEach, beforeEach, expect, test } from 'vitest';
import { makeSandbox, type PiEvent, runJson, type Sandbox, script, startRpc } from './harness.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.dispose());

const budget = {
  id: 'budget',
  prompt: 'Pick a reasoning budget',
  options: [
    { id: 'unlimited', label: 'unlimited — max reasoning' },
    { id: 'large', label: 'large — xhigh reasoning' },
  ],
};
const areas = {
  id: 'areas',
  prompt: 'Which areas matter most?',
  allow_multiple: true,
  options: [
    { id: 'style', label: 'Response style' },
    { id: 'subagents', label: 'Subagents' },
    { id: 'process', label: 'Process' },
  ],
};

test('asks each question through UI dialogs and returns option IDs (HOST-005)', async () => {
  const rpc = startRpc(sandbox, ['--no-session']);
  try {
    const answers = ['large — xhigh reasoning', 'Subagents', 'Process', '✓ Done selecting'];
    const seen: PiEvent[] = [];
    rpc.child.stdout?.on('data', () => {
      for (const event of rpc.events.filter((candidate) => candidate.type === 'extension_ui_request' && candidate['method'] === 'select' && !seen.includes(candidate))) {
        seen.push(event);
        rpc.send({ type: 'extension_ui_response', id: event['id'], value: answers.shift() });
      }
    });
    rpc.send({ type: 'prompt', message: script([{ tool: 'AskQuestion', args: { questions: [budget, areas] } }]) });
    const end = await rpc.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'AskQuestion');
    expect(seen.map((event) => [event['title'], event['options']])).toEqual([
      ['Pick a reasoning budget', ['unlimited — max reasoning', 'large — xhigh reasoning']],
      ['Which areas matter most? (pick one at a time, then ✓ Done selecting)', ['Response style', 'Subagents', 'Process', '✓ Done selecting']],
      ['Which areas matter most? (picked: Subagents)', ['Response style', 'Process', '✓ Done selecting']],
      ['Which areas matter most? (picked: Subagents, Process)', ['Response style', '✓ Done selecting']],
    ]);
    const result = end['result'] as { content: { text: string }[]; details: unknown };
    expect(result.content[0]?.text).toBe('budget: large (large — xhigh reasoning)\nareas: subagents (Subagents), process (Process)');
    expect(result.details).toEqual({ answers: { budget: ['large'], areas: ['subagents', 'process'] } });
  } finally {
    await rpc.close();
  }
});

test('a dismissed question is reported, not guessed (HOST-005)', async () => {
  const rpc = startRpc(sandbox, ['--no-session']);
  try {
    let responded = false;
    rpc.child.stdout?.on('data', () => {
      const request = rpc.events.find((event) => event.type === 'extension_ui_request' && event['method'] === 'select');
      if (request === undefined || responded) return;
      responded = true;
      rpc.send({ type: 'extension_ui_response', id: request['id'], cancelled: true });
    });
    rpc.send({ type: 'prompt', message: script([{ tool: 'AskQuestion', args: { questions: [budget] } }]) });
    const end = await rpc.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'AskQuestion');
    expect((end['result'] as { content: { text: string }[] }).content[0]?.text).toBe('budget: no answer (the user dismissed the question)');
  } finally {
    await rpc.close();
  }
});

test('without a UI the tool is withdrawn, as the Cursor CLI has none (HOST-005)', async () => {
  const run = await runJson(sandbox, 'tools\n@@tools-list', ['--no-session']);
  const [tools = ''] = run.events.filter((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant').map((event) => JSON.stringify(event['message']));
  expect([tools.includes('TodoWrite'), tools.includes('AskQuestion')]).toEqual([true, false]);
});
