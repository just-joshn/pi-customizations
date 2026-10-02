import { expect, test, vi } from 'vitest';
import { assistantText, foldTurn, initialTurn, type SessionStats, settledPatch, type TurnState, usageFromStats } from '../src/subagents/child-turn.ts';
import type { RpcRecord } from '../src/subagents/rpc-child.ts';
import { taskOutputLimit } from '../src/worker-records.ts';

const assistant = (fields: Record<string, unknown>): RpcRecord => ({ type: 'message_end', message: { role: 'assistant', ...fields } });

test('each finished tool execution adds one tool use', () => {
  const once = foldTurn(initialTurn, { type: 'tool_execution_end' });

  expect(foldTurn(once, { type: 'tool_execution_end' })).toEqual({ toolUses: 2, aborted: false });
});

test.for([
  { name: 'an aborted assistant message', record: assistant({ stopReason: 'aborted' }), expected: { toolUses: 0, aborted: true } },
  { name: 'an error with a message', record: assistant({ stopReason: 'error', errorMessage: 'rate limited' }), expected: { toolUses: 0, aborted: false, failure: 'rate limited' } },
  { name: 'an error without a message', record: assistant({ stopReason: 'error' }), expected: { toolUses: 0, aborted: false, failure: 'The model request failed.' } },
  { name: 'a normal assistant message', record: assistant({ stopReason: 'stop' }), expected: initialTurn },
  { name: 'a user message', record: { type: 'message_end', message: { role: 'user', stopReason: 'error' } }, expected: initialTurn },
  { name: 'an unrelated event', record: { type: 'agent_settled' }, expected: initialTurn },
])('folding $name', ({ record, expected }) => {
  expect(foldTurn(initialTurn, record)).toEqual(expected);
});

test.for([
  {
    name: 'text blocks joined by newlines',
    content: [
      { type: 'text', text: 'one' },
      { type: 'thinking', text: 'hidden' },
      { type: 'text', text: 'two' },
    ],
    expected: 'one\ntwo',
  },
  { name: 'a text block without text', content: [{ type: 'text' }], expected: undefined },
  { name: 'content that is not an array', content: 'plain', expected: undefined },
])('assistant text from $name', ({ content, expected }) => {
  expect(assistantText(assistant({ content }))).toBe(expected);
});

test('assistant text is read only from assistant message ends', () => {
  const block = [{ type: 'text', text: 'x' }];

  expect([
    assistantText({ type: 'message_start', message: { role: 'assistant', content: block } }),
    assistantText({ type: 'message_end', message: { role: 'user', content: block } }),
    assistantText({ type: 'message_end', message: null }),
    assistantText({ type: 'message_end', message: { role: 'assistant', content: block } }),
  ]).toEqual([undefined, undefined, undefined, 'x']);
});

test('usage maps session stats, defaulting missing counters to zero', () => {
  const full: SessionStats = { tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 }, cost: 0.25 };

  expect(usageFromStats(full)).toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 } });
  expect(usageFromStats({})).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
});

function patch(state: Partial<TurnState>, extra: { stopped?: boolean; output?: string; stats?: SessionStats } = {}) {
  return settledPatch({ state: { ...initialTurn, ...state }, output: extra.output ?? 'final text', stopped: extra.stopped ?? false, startedAt: 1000, ...(extra.stats ? { stats: extra.stats } : {}) });
}

test('a clean turn settles with output, tool count, duration', () => {
  vi.spyOn(Date, 'now').mockReturnValue(3500);

  expect(patch({ toolUses: 3 })).toEqual({ status: 'settled', output: 'final text', toolUseCount: 3, durationMs: 2500 });
});

test.for([
  { name: 'a stop request', state: {}, stopped: true },
  { name: 'an aborted message', state: { aborted: true }, stopped: false },
])('$name interrupts the task even with a failure recorded', ({ state, stopped }) => {
  expect(patch({ ...state, failure: 'boom' }, { stopped }).status).toBe('interrupted');
});

test('a failed turn reports the failure instead of the output', () => {
  expect(patch({ failure: 'model exploded' })).toMatchObject({ status: 'failed', output: 'model exploded' });
});

test('session stats add usage plus total tokens to the patch', () => {
  const stats: SessionStats = { tokens: { input: 5, total: 9 }, cost: 1 };

  expect(patch({}, { stats })).toMatchObject({ totalTokens: 9, usage: { input: 5, totalTokens: 9, cost: { total: 1 } } });
  expect(patch({}, { stats: { cost: 1 } })).toMatchObject({ totalTokens: 0 });
});

test('output is cut to the task output limit', () => {
  expect(patch({}, { output: 'y'.repeat(taskOutputLimit + 50) }).output).toHaveLength(taskOutputLimit);
});
