import type { Message } from '@earendil-works/pi-ai';
import { describe, expect, test, vi } from 'vitest';
import { mapWithConcurrencyLimit } from '../src/subagent/concurrency.ts';
import { createResultStream, finalizeResult, parseMessageEnd } from '../src/subagent/result-stream.ts';
import {
  aggregateUsage,
  createUnstartedResult,
  emptyUsage,
  getDisplayItems,
  getFailureSummary,
  getFinalOutput,
  getResultOutput,
  isActiveResult,
  isFailedResult,
  makeDetails,
  textResult,
  truncateModelOutput,
  truncateParallelOutput,
} from '../src/subagent/results.ts';
import { SubagentParamsSchema, toAgentScope } from '../src/subagent/schema.ts';
import type { SingleResult } from '../src/subagent/types.ts';

const STEP = 2;
const PARALLEL_CAP_BYTES = 51_200;
const OVER_CAP_BYTES = 60_000;
const MANY_LINES = 3000;
const LIMIT = 2;
const ITEM_COUNT = 6;
const TOKENS_IN = 10;
const TOKENS_OUT = 5;
const TOKENS_TOTAL = 15;
const COST = 0.5;
const EXIT_CODE = 3;

const asMessages = (value: unknown): Message[] => value as Message[];
const assistant = (text: string, extra: Record<string, unknown> = {}): Message => asMessages([{ role: 'assistant', content: [{ type: 'text', text }], ...extra }])[0] as Message;
const base = (overrides: Partial<SingleResult> = {}): SingleResult => ({ ...createUnstartedResult('scout', 'look', undefined, 'pending'), ...overrides });
const usageEvent = (extra: Record<string, unknown> = {}) => ({
  role: 'assistant',
  content: [{ type: 'text', text: 'hi' }],
  usage: { input: TOKENS_IN, output: TOKENS_OUT, cacheRead: 1, cacheWrite: 1, totalTokens: TOKENS_TOTAL, cost: { total: COST } },
  ...extra,
});
const endLine = (message: unknown) => JSON.stringify({ type: 'message_end', message });

describe('result helpers', () => {
  test('unstarted results carry their status, step and error', () => {
    const result = createUnstartedResult('a', 't', STEP, 'failed', 'boom');
    expect(result).toMatchObject({ agent: 'a', task: 't', step: STEP, status: 'failed', errorMessage: 'boom', exitCode: null, usage: emptyUsage() });
  });

  test('status predicates split failed from active', () => {
    const failed = (status: SingleResult['status']) => isFailedResult(base({ status }));
    const active = (status: SingleResult['status']) => isActiveResult(base({ status }));
    expect([failed('failed'), failed('aborted'), failed('completed')]).toEqual([true, true, false]);
    expect([active('pending'), active('running'), active('failed')]).toEqual([true, true, false]);
  });

  test('final output is the last assistant text, skipping non-text parts and other roles', () => {
    const messages = asMessages([assistant('first'), { role: 'assistant', content: [{ type: 'toolCall', name: 'x', arguments: {} }] }, { role: 'user', content: 'ignored' }]);
    expect(getFinalOutput(messages)).toBe('first');
    expect(getFinalOutput([])).toBe('');
  });

  test('failure summary prefers error, then signal, then stderr, then output', () => {
    expect(getFailureSummary(base({ errorMessage: ' bad ', terminationSignal: 'SIGKILL' }))).toBe('bad');
    expect(getFailureSummary(base({ terminationSignal: 'SIGKILL' }))).toBe('Terminated by signal SIGKILL');
    expect(getFailureSummary(base({ stderr: ' err \n' }))).toBe('err');
    expect(getFailureSummary(base({ messages: [assistant('said')] }))).toBe('said');
    expect(getFailureSummary(base())).toBe('(no output)');
  });

  test('result output lists distinct failure evidence for failed runs', () => {
    const failed = base({ status: 'failed', errorMessage: 'same', stderr: 'same', terminationSignal: 'SIGKILL', messages: [assistant('final')] });
    expect(getResultOutput(failed)).toBe('Error: same\n\nSignal: SIGKILL\n\nAssistant output: final');
    expect(getResultOutput(base({ status: 'aborted' }))).toBe('(no output)');
  });

  test('result output for success is the final text or a placeholder', () => {
    expect(getResultOutput(base({ status: 'completed', messages: [assistant('done')] }))).toBe('done');
    expect(getResultOutput(base({ status: 'completed' }))).toBe('(no output)');
  });
});

describe('result display and totals', () => {
  test('display items keep text and tool calls only', () => {
    const parts = [
      { type: 'text', text: 'a' },
      { type: 'toolCall', name: 'bash', arguments: { c: 1 } },
      { type: 'thinking', thinking: 'z' },
    ];
    const messages = asMessages([
      { role: 'user', content: 'x' },
      { role: 'assistant', content: parts },
    ]);
    expect(getDisplayItems(messages)).toEqual([
      { type: 'text', text: 'a' },
      { type: 'toolCall', name: 'bash', args: { c: 1 } },
    ]);
  });

  test('usage aggregates sums but not context tokens', () => {
    const usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: COST, contextTokens: 99, turns: 1 };
    expect(aggregateUsage([base({ usage }), base({ usage })])).toEqual({ input: 2, output: 4, cacheRead: 6, cacheWrite: 8, cost: 1, contextTokens: 0, turns: 2 });
  });

  test('tool results and details wrap text and error state', () => {
    const details = makeDetails('parallel')([base({ status: 'completed' })]);
    expect(details).toMatchObject({ mode: 'parallel', isError: false });
    expect(makeDetails('single')([base({ status: 'failed' })]).isError).toBe(true);
    expect(makeDetails('chain', true)([]).isError).toBe(true);
    expect(textResult('hi', details)).toEqual({ content: [{ type: 'text', text: 'hi' }], details });
  });
});

describe('output truncation', () => {
  test('parallel output under the cap is untouched', () => {
    expect(truncateParallelOutput('short')).toBe('short');
  });

  test('parallel output over the cap is cut on a byte budget with a notice', () => {
    const out = truncateParallelOutput('é'.repeat(OVER_CAP_BYTES));
    const [body = ''] = out.split('\n\n[Output truncated');
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(PARALLEL_CAP_BYTES);
    expect(out).toMatch(/\[Output truncated: \d+ bytes omitted\. Full output preserved in tool details\.\]$/);
  });

  test('model output within limits is untouched', () => {
    expect(truncateModelOutput('ok')).toBe('ok');
  });

  test('model output over the line limit is truncated with a notice', () => {
    const out = truncateModelOutput(Array.from({ length: MANY_LINES }, (_, i) => `line ${i}`).join('\n'));
    expect(out).toContain('line 0');
    expect(out).toMatch(/\[Output truncated: \d+ bytes omitted/);
  });

  test('model output whose first line alone is too large yields only the notice', () => {
    const out = truncateModelOutput('x'.repeat(OVER_CAP_BYTES * LIMIT));
    expect(out).toMatch(/^\[Output truncated: \d+ bytes omitted/);
  });
});

describe('parseMessageEnd', () => {
  test('ignores blank, malformed and non message_end lines', () => {
    expect(parseMessageEnd('  ')).toBeUndefined();
    expect(parseMessageEnd('{nope')).toBeUndefined();
    expect(parseMessageEnd(JSON.stringify({ type: 'agent_start' }))).toBeUndefined();
    expect(parseMessageEnd(endLine({ role: 'custom', content: [] }))).toBeUndefined();
  });

  test('passes user, toolResult and assistant messages through', () => {
    expect(parseMessageEnd(endLine({ role: 'user', content: 'q' }))).toEqual({ role: 'user', content: 'q' });
    expect(parseMessageEnd(endLine({ role: 'toolResult', x: 1 }))).toEqual({ role: 'toolResult', x: 1 });
    expect(parseMessageEnd(endLine(usageEvent()))?.role).toBe('assistant');
  });
});

describe('result stream', () => {
  test('stdout lines split across chunks accumulate usage and emit each change', () => {
    const emit = vi.fn();
    const stream = createResultStream(base({ status: 'running' }), emit);
    const line = endLine(usageEvent({ model: 'm1', stopReason: 'stop' }));
    stream.onStdoutChunk(`${line.slice(0, TOKENS_IN)}`);
    expect(emit).not.toHaveBeenCalled();
    stream.onStdoutChunk(`${line.slice(TOKENS_IN)}\nnot json\n`);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(stream.result()).toMatchObject({ model: 'm1', stopReason: 'stop', usage: { turns: 1, input: TOKENS_IN, cost: COST, contextTokens: TOKENS_TOTAL } });
  });

  test('flush parses a trailing unterminated line and keeps the first model', () => {
    const emit = vi.fn();
    const stream = createResultStream(base({ model: 'orig' }), emit);
    stream.onStdoutChunk(endLine(usageEvent({ model: 'other', errorMessage: 'e' })));
    stream.flush();
    expect(stream.result()).toMatchObject({ model: 'orig', errorMessage: 'e' });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  test('non-assistant messages are recorded without touching usage', () => {
    const stream = createResultStream(base(), vi.fn());
    stream.onStdoutChunk(`${endLine({ role: 'user', content: 'q' })}\n`);
    expect(stream.result().messages).toHaveLength(1);
    expect(stream.result().usage).toEqual(emptyUsage());
  });

  test('stderr chunks append and emit re-sends the current result', () => {
    const emit = vi.fn();
    const stream = createResultStream(base(), emit);
    stream.onStderrChunk('a');
    stream.onStderrChunk('b');
    stream.emit();
    stream.flush();
    expect(stream.result().stderr).toBe('ab');
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe('finalizeResult', () => {
  const run = (partial: Partial<SingleResult>, outcome: Parameters<typeof finalizeResult>[1], aborted = false) => finalizeResult(base({ status: 'running', ...partial }), outcome, aborted);

  test('abort wins and keeps an existing error message', () => {
    expect(run({}, { code: 0, signal: null }, true)).toMatchObject({ status: 'aborted', errorMessage: 'Subagent was aborted' });
    expect(run({ errorMessage: 'x' }, { code: null, signal: 'SIGTERM' })).toMatchObject({ status: 'aborted', errorMessage: 'x', terminationSignal: 'SIGTERM' });
  });

  test('spawn errors, signals and non-zero exits fail with descriptive messages', () => {
    expect(run({}, { code: null, signal: null, spawnError: new Error('ENOENT') }).errorMessage).toBe('Failed to spawn subagent: ENOENT');
    expect(run({}, { code: null, signal: 'SIGKILL' })).toMatchObject({ status: 'failed', errorMessage: 'Subagent terminated by signal SIGKILL' });
    expect(run({}, { code: EXIT_CODE, signal: null })).toMatchObject({ status: 'failed', exitCode: EXIT_CODE, errorMessage: 'Subagent exited with code 3' });
    expect(run({ errorMessage: 'own' }, { code: 1, signal: null }).errorMessage).toBe('own');
  });

  test('clean exits follow the stop reason', () => {
    expect(run({ stopReason: 'aborted' }, { code: 0, signal: null }).status).toBe('aborted');
    expect(run({ stopReason: 'error', errorMessage: 'm' }, { code: 0, signal: null })).toMatchObject({ status: 'failed', errorMessage: 'm' });
    expect(run({ stopReason: 'stop' }, { code: 0, signal: null }).status).toBe('completed');
  });
});

describe('mapWithConcurrencyLimit', () => {
  test('returns an empty list for no items without calling fn', async () => {
    const fn = vi.fn();
    expect(await mapWithConcurrencyLimit([], LIMIT, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  test('keeps input order and never exceeds the limit', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: ITEM_COUNT }, (_, i) => i);
    const out = await mapWithConcurrencyLimit(items, LIMIT, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, ITEM_COUNT - item));
      active -= 1;
      return item * LIMIT;
    });
    expect(out).toEqual(items.map((i) => i * LIMIT));
    expect(peak).toBe(LIMIT);
  });

  test('a non-positive limit still runs one at a time', async () => {
    expect(await mapWithConcurrencyLimit(['a', 'b'], 0, async (item, index) => `${item}${index}`)).toEqual(['a0', 'b1']);
  });

  test('a rejecting item rejects the whole map', async () => {
    await expect(mapWithConcurrencyLimit([1], 1, () => Promise.reject(new Error('no')))).rejects.toThrow('no');
  });
});

describe('schema', () => {
  test('agent scope narrows unknown values to user', () => {
    expect([toAgentScope('project'), toAgentScope('both'), toAgentScope('user'), toAgentScope(undefined), toAgentScope('x')]).toEqual(['project', 'both', 'user', 'user', 'user']);
  });

  test('params schema keeps unknown keys and rejects a non-object', () => {
    const input = { agent: 'a', tasks: [{ agent: 'b', task: 't', extra: true }], agentScope: 'both', future: 1 };
    expect(SubagentParamsSchema.parse(input)).toEqual(input);
    expect(SubagentParamsSchema.safeParse(null).success).toBe(false);
  });
});
