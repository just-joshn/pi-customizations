import type { SystemMessage } from '@earendil-works/pi-ai';
import { expect } from 'vitest';
import { agentMessageBlocks, bytesPerToken, contextBudget, countBlocks, estimateMessages, payloadModelId, payloadTokens } from '../src/context/tokens.ts';
import { test } from './network-guard.ts';
import { assistantTurn, PIXEL, toolResult, user } from './support/context.ts';

const FOUR_BYTE_MODELS = [
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
  'claude-3-7-sonnet',
  'claude-opus-4-0',
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-sonnet-4-0',
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];

test.for(FOUR_BYTE_MODELS)('%s counts four bytes per token', (modelId) => {
  expect(bytesPerToken(modelId)).toBe(4);
});

test.for(['claude-opus-5-5', 'claude-sonnet-5-5', 'unknown-model'])('%s counts three bytes per token', (modelId) => {
  expect(bytesPerToken(modelId)).toBe(3);
});

test('a missing model id counts four bytes per token', () => {
  expect(bytesPerToken('')).toBe(4);
});

test('dots and underscores normalize before the allowlist lookup', () => {
  expect(bytesPerToken('claude.opus.4.5')).toBe(4);
  expect(bytesPerToken('CLAUDE_SONNET_4_6')).toBe(4);
});

test('a one-million-token window reserves the compact and blocking margins', () => {
  expect(contextBudget({ id: 'claude-opus-5-5', contextWindow: 1_000_000, maxTokens: 128_000 })).toStrictEqual({ bytesPerToken: 3, compactAt: 967_000, blockAt: 977_000 });
});

test('a two-hundred-thousand-token window computes the same thresholds', () => {
  expect(contextBudget({ id: 'claude-sonnet-4-6', contextWindow: 200_000, maxTokens: 64_000 })).toStrictEqual({ bytesPerToken: 4, compactAt: 167_000, blockAt: 177_000 });
});

test('a small output limit lowers the reserve', () => {
  expect(contextBudget({ id: 'claude-haiku-4-5', contextWindow: 200_000, maxTokens: 8_192 })).toMatchObject({ compactAt: 178_808, blockAt: 188_808 });
});

test('counting rounds each block before summing', () => {
  expect(countBlocks([{ kind: 'text', text: 'a' }], 3)).toBe(0);
  expect(
    countBlocks(
      [
        { kind: 'text', text: 'a' },
        { kind: 'text', text: 'a' },
      ],
      3,
    ),
  ).toBe(0);
  expect(countBlocks([{ kind: 'text', text: 'ab' }], 3)).toBe(1);
  expect(countBlocks([{ kind: 'thinking', text: 'abc' }], 3)).toBe(1);
  expect(countBlocks([{ kind: 'json', json: '1234' }], 3)).toBe(1);
});

test('counting measures UTF-8 bytes rather than UTF-16 code units', () => {
  expect(countBlocks([{ kind: 'text', text: '漢' }], 3)).toBe(1);
  expect(countBlocks([{ kind: 'text', text: '漢'.repeat(3) }], 3)).toBe(3);
  expect(countBlocks([{ kind: 'text', text: '😀' }], 3)).toBe(1);
  expect(countBlocks([{ kind: 'text', text: '😀' }], 4)).toBe(1);
});

test('a tool call counts its name and serialized arguments', () => {
  const argumentsJson = JSON.stringify({ path: 'a.txt' });
  expect(countBlocks([{ kind: 'toolCall', name: 'read', argumentsJson }], 3)).toBe(Math.round(Buffer.byteLength(`read${argumentsJson}`, 'utf8') / 3));
});

test('a tool result counts its text once and each image at the flat rate', () => {
  expect(countBlocks([{ kind: 'toolResult', content: 'hello', imageCount: 1 }], 3)).toBe(2002);
  expect(countBlocks([{ kind: 'image' }], 3)).toBe(2000);
});

test('a user message counts its text and image blocks', () => {
  expect(agentMessageBlocks(user('hello'))).toStrictEqual([{ kind: 'text', text: 'hello' }]);
  expect(agentMessageBlocks(user([{ type: 'text', text: 'hi' }, PIXEL]))).toStrictEqual([{ kind: 'text', text: 'hi' }, { kind: 'image' }]);
});

test('an assistant message counts text, thinking, and tool calls', () => {
  const message = assistantTurn({
    content: [
      { type: 'text', text: 'answer' },
      { type: 'thinking', thinking: 'reasoning' },
      { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.txt' } },
    ],
  });
  expect(agentMessageBlocks(message)).toStrictEqual([
    { kind: 'text', text: 'answer' },
    { kind: 'thinking', text: 'reasoning' },
    { kind: 'toolCall', name: 'read', argumentsJson: '{"path":"a.txt"}' },
  ]);
});

test('a tool result message charges its images flat, never their base64 size', () => {
  const message = toolResult('call-1', [
    { type: 'text', text: 'file attached' },
    { type: 'image', data: 'A'.repeat(400_000), mimeType: 'image/png' },
  ]);
  expect(agentMessageBlocks(message)).toStrictEqual([{ kind: 'toolResult', content: 'file attached', imageCount: 1 }]);
});

test('an extension-injected custom message counts its content', () => {
  expect(agentMessageBlocks({ role: 'custom', content: 'injected' })).toStrictEqual([{ kind: 'text', text: 'injected' }]);
  expect(agentMessageBlocks({ role: 'custom', content: [PIXEL] })).toStrictEqual([{ kind: 'image' }]);
});

test('a bash execution counts its command and output unless it is excluded', () => {
  expect(agentMessageBlocks({ role: 'bashExecution', command: 'ls', output: 'a.txt' })).toStrictEqual([
    { kind: 'text', text: 'ls' },
    { kind: 'text', text: 'a.txt' },
  ]);
  expect(agentMessageBlocks({ role: 'bashExecution', command: 'ls', output: 'a.txt', excludeFromContext: true })).toStrictEqual([]);
});

test('summary messages count their summary text', () => {
  expect(agentMessageBlocks({ role: 'branchSummary', summary: 'branch' })).toStrictEqual([{ kind: 'text', text: 'branch' }]);
  expect(agentMessageBlocks({ role: 'compactionSummary', summary: 'compacted' })).toStrictEqual([{ kind: 'text', text: 'compacted' }]);
});

test('a system message contributes no layer B tokens', () => {
  const message: SystemMessage = { role: 'system', content: 'You are helpful.', timestamp: 1 };
  expect(agentMessageBlocks(message)).toStrictEqual([]);
  expect(countBlocks(agentMessageBlocks(message), 3)).toBe(0);
});

test('the projection estimate sums every message', () => {
  const messages = [user('user text'), assistantTurn({ content: [{ type: 'text', text: 'assistant text' }] })];
  expect(estimateMessages(messages, 3)).toBe(Math.round(Buffer.byteLength('user text', 'utf8') / 3) + Math.round(Buffer.byteLength('assistant text', 'utf8') / 3));
});

test('the payload estimate counts system, tools, and every message including mid-conversation system blocks', () => {
  const toolAddition = { type: 'tool_addition', tool: { type: 'tool_definition', definition: { name: 'probe' } } };
  const payload = {
    model: 'claude-opus-5-5',
    system: [
      { type: 'text', text: 'system' },
      { type: 'text', text: 'more' },
    ],
    tools: [{ name: 'read', description: 'Read', input_schema: { type: 'object', properties: {} } }],
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: [
              { type: 'text', text: 'ok' },
              { type: 'image', source: {} },
            ],
          },
        ],
      },
      { role: 'system', content: [toolAddition] },
    ],
  };
  const expected =
    2 +
    1 +
    Math.round(Buffer.byteLength(`readRead${JSON.stringify({ type: 'object', properties: {} })}`, 'utf8') / 3) +
    Math.round(Buffer.byteLength('hello', 'utf8') / 3) +
    Math.round(Buffer.byteLength('answer', 'utf8') / 3) +
    Math.round(Buffer.byteLength('ok', 'utf8') / 3) +
    2000 +
    Math.round(Buffer.byteLength(JSON.stringify(toolAddition), 'utf8') / 3);
  expect(payloadTokens(payload, 3)).toBe(expected);
});

test('the payload estimate ignores non-object payloads', () => {
  expect(payloadTokens(null, 3)).toBe(0);
  expect(payloadTokens('text', 3)).toBe(0);
  expect(payloadTokens({ messages: 'nope' }, 3)).toBe(0);
});

test('the payload model id is read from the wire model field', () => {
  expect(payloadModelId({ model: 'claude-opus-5-5' })).toBe('claude-opus-5-5');
  expect(payloadModelId({ model: '' })).toBeUndefined();
  expect(payloadModelId({})).toBeUndefined();
});
