import { type Message, normalizeContext } from '@earendil-works/pi-ai';
import { expect } from 'vitest';
import { calculateContextTokens, estimateContextTokens, estimateMessageTokens, estimateTextAndImageContentTokens, estimateTextTokens } from '../src/pi-ai/estimate.ts';
import { headersToRecord, providerHeadersToRecord } from '../src/pi-ai/headers.ts';
import { adjustMaxTokensForThinking, buildBaseOptions, clampMaxTokensToContext, clampReasoning, clampThinkingBudgetToAnswerRoom, resolveSamplingParams, thinkingBudgetForLevel } from '../src/pi-ai/simple-options.ts';
import { test } from './network-guard.ts';
import { assistant, googleModel, usage } from './pi-ai-fixtures.ts';

const emptyContext = normalizeContext({ messages: [] });

test('header conversion uses normalized native header names', () => {
  expect(headersToRecord(new Headers({ 'X-Test': 'value', Accept: 'application/json' }))).toEqual({ accept: 'application/json', 'x-test': 'value' });
});

test('provider headers override case-insensitively with null deletion', () => {
  expect(providerHeadersToRecord(undefined, { Authorization: 'old', Accept: 'json' }, { authorization: 'new', ACCEPT: null, 'X-Test': 'yes' })).toEqual({ authorization: 'new', 'X-Test': 'yes' });
  expect(providerHeadersToRecord(undefined, {}, { gone: null })).toBeUndefined();
});

test.for([
  { text: '', tokens: 0 },
  { text: 'abcde', tokens: 2 },
  { text: '😀你好', tokens: 1 },
])('text token estimates round up character count', ({ text, tokens }) => {
  expect(estimateTextTokens(text)).toBe(tokens);
  expect(estimateTextAndImageContentTokens(text)).toBe(tokens);
});

test('image content reserves a fixed token allowance', () => {
  expect(
    estimateTextAndImageContentTokens([
      { type: 'image', mimeType: 'image/png', data: 'AA==' },
      { type: 'text', text: 'hello' },
    ]),
  ).toBe(1202);
});

test('context token totals prefer reported totals with a component fallback', () => {
  expect(calculateContextTokens(usage)).toBe(15);
  expect(calculateContextTokens({ ...usage, totalTokens: 0 })).toBe(15);
});

test.for([
  { message: { role: 'user', content: 'hello', timestamp: 1 }, tokens: 2 },
  { message: { role: 'toolResult', toolCallId: '1', toolName: 'run', content: [{ type: 'text', text: '123456789' }], isError: false, timestamp: 1 }, tokens: 3 },
  { message: { role: 'system', content: '12345678', timestamp: 1 }, tokens: 2 },
  {
    message: assistant({
      content: [
        { type: 'thinking', thinking: '1234' },
        { type: 'text', text: '5678' },
        { type: 'toolCall', id: '1', name: 'run', arguments: { x: 1 } },
      ],
    }),
    tokens: 5,
  },
] satisfies { message: Message; tokens: number }[])('message estimates count caller-visible content', ({ message, tokens }) => {
  expect(estimateMessageTokens(message)).toBe(tokens);
});

test('system messages include added plus removed tool declarations', () => {
  expect(estimateMessageTokens({ role: 'system', content: '', timestamp: 1, toolsAdded: [{ name: 'a', description: '', parameters: { type: 'object' } }], toolsRemoved: [] })).toBe(16);
});

test('unserializable tool arguments remain estimable', () => {
  const message = { ...assistant(), content: [{ type: 'toolCall', id: '1', name: 'run', arguments: { n: 1n } }] };
  expect(Reflect.apply(estimateMessageTokens, undefined, [message])).toBe(5);
});

test('latest valid usage includes only subsequent estimated tokens', () => {
  const messages: Message[] = [{ role: 'user', content: 'hello', timestamp: 1 }, assistant(), { role: 'user', content: '123456789', timestamp: 3 }];
  expect(estimateContextTokens(messages)).toEqual({ tokens: 18, usageTokens: 15, trailingTokens: 3, lastUsageIndex: 1 });
  expect(estimateContextTokens(normalizeContext({ messages }))).toEqual({ tokens: 18, usageTokens: 15, trailingTokens: 3, lastUsageIndex: 1 });
});

test.for([assistant({ stopReason: 'error' }), assistant({ stopReason: 'aborted' }), assistant({ usage: { ...usage, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } }), assistant({ timestamp: 0 })])(
  'invalid usage falls back to estimating the current transcript',
  (message) => {
    expect(estimateContextTokens([{ role: 'user', content: 'hello', timestamp: 1 }, message])).toEqual({ tokens: 3, usageTokens: 0, trailingTokens: 3, lastUsageIndex: null });
  },
);

test('empty transcripts have no applicable usage', () => {
  expect(estimateContextTokens([])).toEqual({ tokens: 0, usageTokens: 0, trailingTokens: 0, lastUsageIndex: null });
});

test.for([
  { window: 10000, requested: 8000, expected: 5904 },
  { window: 100, requested: 1000, expected: 1 },
  { window: 0, requested: 9000, expected: 9000 },
  { window: -1, requested: 0, expected: 1 },
])('max token caps reserve context safety room', ({ window, requested, expected }) => {
  expect(clampMaxTokensToContext({ ...googleModel, contextWindow: window }, emptyContext, requested)).toBe(expected);
});

test('sampling overrides merge in caller precedence order', () => {
  const model = { ...googleModel, samplingParams: { topP: 0.7, topK: 20 }, samplingParamsByThinkingLevel: { off: { topP: 0.8 } } };
  expect(resolveSamplingParams(model, 'off', { topK: 5 })).toEqual({ topP: 0.8, topK: 5 });
  expect(resolveSamplingParams(googleModel, 'off')).toBeUndefined();
});

test('base options preserve request controls with explicit key precedence', () => {
  const controller = new AbortController();
  const options = { temperature: 0.5, maxTokens: 2000, apiKey: 'fallback', signal: controller.signal, headers: { 'X-Test': 'x' }, maxRetries: 2, timeoutMs: 100, metadata: { test: 'yes' } };
  const base = buildBaseOptions(googleModel, emptyContext, options, 'explicit');
  expect(base).toMatchObject({ ...options, apiKey: 'explicit' });
  expect(base).not.toHaveProperty('samplingParams');
  expect(buildBaseOptions(googleModel, emptyContext).maxTokens).toBe(4096);
  expect(buildBaseOptions(googleModel, emptyContext, options, '').apiKey).toBe('fallback');
});

test('base options preserve zero-valued controls and empty session identifiers', () => {
  const options = { temperature: 0, maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: 0, websocketConnectTimeoutMs: 0, sessionId: '' };
  expect(buildBaseOptions(googleModel, emptyContext, options)).toStrictEqual({ ...options, maxTokens: 4096 });
});

test.for([
  { level: 'minimal', expected: 1024 },
  { level: 'low', expected: 2048 },
  { level: 'medium', expected: 8192 },
  { level: 'high', expected: 16384 },
  { level: 'xhigh', expected: 16384 },
  { level: 'max', expected: 16384 },
] as const)('thinking budget defaults follow supported reasoning levels', ({ level, expected }) => {
  expect(thinkingBudgetForLevel(level)).toBe(expected);
});

test('reasoning budgets honor custom caps with answer room', () => {
  expect(clampReasoning(undefined)).toBeUndefined();
  expect(clampReasoning('low')).toBe('low');
  expect(clampReasoning('max')).toBe('high');
  expect(thinkingBudgetForLevel('high', { high: 2000 })).toBe(2000);
  expect(clampThinkingBudgetToAnswerRoom(2000, 500)).toBe(0);
  expect(clampThinkingBudgetToAnswerRoom(2000, 2048)).toBe(1024);
  expect(adjustMaxTokensForThinking(undefined, 4096, 'high')).toEqual({ maxTokens: 4096, thinkingBudget: 3072 });
  expect(adjustMaxTokensForThinking(1000, 10000, 'low')).toEqual({ maxTokens: 3048, thinkingBudget: 2048 });
  expect(adjustMaxTokensForThinking(5000, 4096, 'minimal')).toEqual({ maxTokens: 4096, thinkingBudget: 1024 });
});
