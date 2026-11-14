import { expect } from 'vitest';
import { fitPayload, isSummarizationRequest, OMITTED_MARKER } from '../src/context/fit.ts';
import { type ContextBudget, payloadTokens } from '../src/context/tokens.ts';
import { test } from './network-guard.ts';

const budget: ContextBudget = { bytesPerToken: 3, compactAt: 1000, blockAt: 1200 };

function estimate(candidate: unknown): number {
  return payloadTokens(candidate, budget.bytesPerToken);
}

function payload(messages: readonly unknown[], system: readonly unknown[] = []): Record<string, unknown> {
  return { model: 'claude-opus-5-5', system, messages };
}

const summarizationSystem = [{ type: 'text', text: 'You are a context summarization assistant. Only output the structured summary.' }];

interface FittedMessage {
  readonly role: string;
  readonly content: unknown;
}

function isFittedMessage(value: unknown): value is FittedMessage {
  return typeof value === 'object' && value !== null && 'role' in value && typeof value.role === 'string' && 'content' in value;
}

function fittedMessages(value: unknown): readonly FittedMessage[] {
  if (typeof value !== 'object' || value === null || !('messages' in value)) throw new Error('the payload has no messages');
  const messages = value.messages;
  if (!Array.isArray(messages) || !messages.every(isFittedMessage)) throw new Error('the payload messages are not wire messages');
  return messages;
}

function keptText(message: FittedMessage | undefined): string {
  const content = message?.content;
  if (typeof content !== 'string') throw new Error('the kept message text is not a string');
  return content;
}

test('a payload under the blocking threshold is returned unchanged', () => {
  const under = payload([{ role: 'user', content: 'short' }]);
  expect(fitPayload(under, budget, estimate)).toBe(under);
});

test('a payload drops the smallest prefix that ends before a kept user message', () => {
  const fitted = fitPayload(
    payload([
      { role: 'user', content: 'a'.repeat(3600) },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'keep me' },
    ]),
    budget,
    estimate,
  );
  const messages = fittedMessages(fitted);
  expect(messages).toHaveLength(1);
  expect(messages[0]?.role).toBe('user');
  expect(JSON.stringify(messages)).toContain('keep me');
  expect(JSON.stringify(messages)).not.toContain('a'.repeat(20));
  expect(estimate(fitted)).toBeLessThan(budget.blockAt);
});

test('a cut keeps every tool_use together with its tool_result', () => {
  const over = payload([
    { role: 'user', content: 'a'.repeat(3600) },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'read', input: { path: 'a.txt' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'file' }] },
    { role: 'user', content: 'keep me' },
  ]);
  const fitted = fitPayload(over, budget, estimate);
  const serializedFit = JSON.stringify(fitted);
  expect(serializedFit).not.toContain('tool_use');
  expect(serializedFit).not.toContain('tool_result');
  expect(serializedFit).toContain('keep me');
  expect(estimate(fitted)).toBeLessThan(budget.blockAt);
});

test('the marker is a plain block and an existing cache_control stays on its original block', () => {
  const cacheBlock = { type: 'text', text: 'keep me', cache_control: { type: 'ephemeral' } };
  const fitted = fitPayload(
    payload([
      { role: 'user', content: 'a'.repeat(3600) },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: [cacheBlock] },
    ]),
    budget,
    estimate,
  );
  expect(fittedMessages(fitted)[0]?.content).toStrictEqual([{ type: 'text', text: OMITTED_MARKER }, cacheBlock]);
});

test('the last user message is never dropped, even with a trailing system message', () => {
  const over = payload([
    { role: 'user', content: 'a'.repeat(3300) },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'b'.repeat(4000) },
    { role: 'system', content: [{ type: 'text', text: 'output config' }] },
  ]);
  expect(fitPayload(over, budget, estimate)).toBe(over);
});

test('a summarization request is shrunk head and tail around the marker', () => {
  const over = payload(
    [
      { role: 'user', content: 'a'.repeat(5000) },
      { role: 'system', content: [], output_config: { effort: 'medium' } },
    ],
    summarizationSystem,
  );
  const fitted = fitPayload(over, budget, estimate);
  expect(fitted).not.toBe(over);
  const messages = fittedMessages(fitted);
  expect(messages).toHaveLength(2);
  expect(messages[1]).toStrictEqual({ role: 'system', content: [], output_config: { effort: 'medium' } });
  const text = keptText(messages[0]);
  expect(text.startsWith('a')).toBe(true);
  expect(text.endsWith('a')).toBe(true);
  expect(text).toContain(OMITTED_MARKER);
  expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(5000);
  expect(estimate(fitted)).toBeLessThan(budget.blockAt);
});

test('a single oversized user prompt is not rewritten without a summarization system prompt', () => {
  const over = payload([{ role: 'user', content: 'a'.repeat(5000) }], [{ type: 'text', text: 'You are helpful.' }]);
  expect(fitPayload(over, budget, estimate)).toBe(over);
});

test('a payload with no valid cut is returned unchanged', () => {
  const over = payload([{ role: 'user', content: 'a'.repeat(5000) }]);
  expect(fitPayload(over, budget, estimate)).toBe(over);
});

test.for([
  { name: 'null', value: null },
  { name: 'a string', value: 'payload' },
  { name: 'an array', value: [] },
  { name: 'a missing messages array', value: { system: [] } },
  { name: 'a string messages value', value: { messages: 'nope' } },
  { name: 'an empty messages array', value: { messages: [] } },
  { name: 'a message without a role', value: { messages: [{}] } },
  { name: 'a message with numeric content', value: { messages: [{ role: 'user', content: 42 }] } },
])('$name is returned unchanged', ({ value }) => {
  expect(fitPayload(value, budget, estimate)).toBe(value);
});

test('summarization detection reads the system prompt text', () => {
  expect(isSummarizationRequest(payload([], summarizationSystem))).toBe(true);
  expect(isSummarizationRequest(payload([], [{ type: 'text', text: 'You are helpful.' }]))).toBe(false);
  expect(isSummarizationRequest(null)).toBe(false);
});

test('a normal chat whose system prompt mentions a summarization assistant keeps its first prompt', () => {
  const over = payload([{ role: 'user', content: 'a'.repeat(5000) }], [{ type: 'text', text: 'Project notes: our docs call the helper a summarization assistant.' }]);
  expect(fitPayload(over, budget, estimate)).toBe(over);
});

test('a summarization request fits at the guard maximum bias of 2', () => {
  const biased = (candidate: unknown) => Math.ceil(payloadTokens(candidate, budget.bytesPerToken) * 2);
  const fitted = fitPayload(payload([{ role: 'user', content: 'a'.repeat(15_000) }], summarizationSystem), budget, biased);
  expect(biased(fitted)).toBeLessThan(budget.blockAt);
  expect(JSON.stringify(fitted)).toContain(OMITTED_MARKER);
});

test('a dropped prefix keeps the tool changes it declared', () => {
  const addition = { type: 'tool_addition', tool: { type: 'tool_definition', definition: { name: 'Task', description: 'Spawn a task', input_schema: { type: 'object' } } } };
  const removal = { type: 'tool_removal', tool: { type: 'tool_reference', name: 'Read' } };
  const fitted = fitPayload(
    payload([
      { role: 'user', content: 'a'.repeat(3600) },
      { role: 'system', content: [{ type: 'text', text: 'tools changed' }, addition, removal] },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'use Task' },
    ]),
    budget,
    estimate,
  );
  const messages = fittedMessages(fitted);
  expect(messages.map((message) => message.role)).toStrictEqual(['user', 'system']);
  expect(messages[1]?.content).toStrictEqual([addition, removal]);
  expect(estimate(fitted)).toBeLessThan(budget.blockAt);
});

test('a single prompt followed by a long tool loop drops its oldest tool exchanges', () => {
  const messages: unknown[] = [{ role: 'user', content: 'fix the bug' }];
  for (let index = 0; index < 6; index += 1) {
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: `t${index}`, name: 'read', input: { path: 'a' } }] });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${index}`, content: 'x'.repeat(900) }] });
  }
  const fitted = fitPayload(payload(messages), budget, estimate);
  const kept = fittedMessages(fitted);
  const text = JSON.stringify(kept);
  expect(estimate(fitted)).toBeLessThan(budget.blockAt);
  expect(JSON.stringify(kept[0])).toContain('fix the bug');
  expect(kept.map((message) => message.role)).toStrictEqual(['user', ...kept.slice(1).map((_, index) => (index % 2 === 0 ? 'assistant' : 'user'))]);
  expect([...text.matchAll(/"tool_use_id":"(t\d)"/g)].map((match) => match[1])).toStrictEqual([...text.matchAll(/"type":"tool_use","id":"(t\d)"/g)].map((match) => match[1]));
  expect(text).toContain('"tool_use_id":"t5"');
});
