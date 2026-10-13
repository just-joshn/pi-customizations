import { afterEach, beforeEach, expect, test } from 'vitest';
import { makeSandbox, type PiEvent, runJson, type Sandbox, script, startRpc, toolEnds } from './harness.ts';

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
      ['Pick a reasoning budget', ['unlimited — max reasoning', 'large — xhigh reasoning', 'Other: (type to answer)']],
      ['Which areas matter most? (pick one at a time, then ✓ Done selecting)', ['Response style', 'Subagents', 'Process', 'Other: (type to answer)', '✓ Done selecting']],
      ['Which areas matter most? (picked: Subagents)', ['Response style', 'Process', 'Other: (type to answer)', '✓ Done selecting']],
      ['Which areas matter most? (picked: Subagents, Process)', ['Response style', 'Other: (type to answer)', '✓ Done selecting']],
    ]);
    const result = end['result'] as { content: { text: string }[]; details: unknown };
    expect(result.content[0]?.text).toBe('budget: large (large — xhigh reasoning)\nareas: subagents (Subagents), process (Process)');
    expect(result.details).toEqual({ answers: { budget: ['large'], areas: ['subagents', 'process'] } });
  } finally {
    await rpc.close();
  }
});

test('shows the title and option descriptions of a Cursor-shaped call and still returns IDs (HOST-005)', async () => {
  // Shape observed in Cursor IDE AskQuestion calls: a top-level title and optional option descriptions.
  const confirm = {
    id: 'confirm',
    prompt: 'Write the rule with this table?',
    options: [
      { id: 'accept', label: 'Accept as-is (Recommended)', description: 'Keep all roles on inherit-parent.' },
      { id: 'change', label: 'Change specific roles' },
    ],
  };
  const rpc = startRpc(sandbox, ['--no-session']);
  try {
    const seen: PiEvent[] = [];
    rpc.child.stdout?.on('data', () => {
      for (const event of rpc.events.filter((candidate) => candidate.type === 'extension_ui_request' && candidate['method'] === 'select' && !seen.includes(candidate))) {
        seen.push(event);
        rpc.send({ type: 'extension_ui_response', id: event['id'], value: (event['options'] as string[])[0] });
      }
    });
    rpc.send({ type: 'prompt', message: script([{ tool: 'AskQuestion', args: { title: 'Confirm pstack rule', questions: [confirm] } }]) });
    const end = await rpc.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'AskQuestion');
    expect(seen.map((event) => [event['title'], event['options']])).toEqual([
      ['Confirm pstack rule: Write the rule with this table?', ['Accept as-is (Recommended) — Keep all roles on inherit-parent.', 'Change specific roles', 'Other: (type to answer)']],
    ]);
    expect((end['result'] as { details: unknown }).details).toEqual({ answers: { confirm: ['accept'] } });
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

test('without a UI the questions resolve as skipped, as Cursor print mode reports (HOST-005)', async () => {
  // Observed: cursor-agent -p called AskQuestion and its final reply said the user skipped the question
  // (parity/pi-pstack-two/evidence/cursor-delegate-v21-resume-run1.json).
  const run = await runJson(sandbox, script([{ tool: 'AskQuestion', args: { questions: [budget] } }]), ['--no-session']);
  const [end] = toolEnds(run.events, 'AskQuestion');
  expect(end?.isError).toBe(false);
  expect(end?.text).toBe('budget: skipped (no one can answer questions in this session; decide yourself and say what you chose)');
  expect(end?.details).toEqual({ answers: {}, skipped: ['budget'] });
});

test('every question offers a typed Other answer, as the Cursor question dialog does (HOST-005)', async () => {
  const rpc = startRpc(sandbox, ['--no-session']);
  try {
    const seen: PiEvent[] = [];
    rpc.child.stdout?.on('data', () => {
      for (const event of rpc.events.filter((candidate) => candidate.type === 'extension_ui_request' && !seen.includes(candidate))) {
        seen.push(event);
        if (event['method'] === 'select') rpc.send({ type: 'extension_ui_response', id: event['id'], value: 'Other: (type to answer)' });
        if (event['method'] === 'input') rpc.send({ type: 'extension_ui_response', id: event['id'], value: 'xhigh but cheaper' });
      }
    });
    rpc.send({ type: 'prompt', message: script([{ tool: 'AskQuestion', args: { questions: [budget] } }]) });
    const end = await rpc.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'AskQuestion');
    const select = seen.find((event) => event['method'] === 'select');
    expect((select?.['options'] as string[] | undefined)?.at(-1)).toBe('Other: (type to answer)');
    const result = end['result'] as { content: { text: string }[]; details: unknown };
    expect(result.content[0]?.text).toBe('budget: other ("xhigh but cheaper")');
    expect(result.details).toEqual({ answers: { budget: ['other'] }, other: { budget: 'xhigh but cheaper' } });
  } finally {
    await rpc.close();
  }
});
