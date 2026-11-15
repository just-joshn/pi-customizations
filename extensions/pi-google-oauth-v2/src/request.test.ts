import { readFileSync } from 'node:fs';

import type { AssistantMessage, Message, Model, SimpleStreamOptions, ToolResultMessage, TranscriptContext } from '@earendil-works/pi-ai';
import { describe, expect, test } from 'vitest';
import { API_ID, PROVIDER_ID } from './constants.ts';
import { catalogModels } from './models.ts';
import { buildCodeAssistRequest } from './request.ts';

const models = catalogModels(JSON.parse(readFileSync(new URL('../test/catalog-fixture.json', import.meta.url), 'utf8')));
const model = (id: string): Model<string> => {
  const found = models.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no model ${id}`);
  return found;
};
const gemini3 = model('gemini-3.8-flash');
const gemini25 = { ...gemini3, id: 'gemini-2.5-pro' };

function build(messages: Message[], options: SimpleStreamOptions = {}, target: Model<string> = gemini3) {
  return buildCodeAssistRequest({ model: target, context: { messages } as TranscriptContext, project: 'proj-1', options });
}

const user = (content: string): Message => ({ role: 'user', content, timestamp: 1 });
const system = (content: string, extra: object = {}): Message => ({ role: 'system', content, timestamp: 1, ...extra });
const assistant = (content: AssistantMessage['content'], extra: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: 'assistant',
  content,
  api: API_ID,
  provider: PROVIDER_ID,
  model: gemini3.id,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'stop',
  timestamp: 1,
  ...extra,
});
const toolResult = (id: string, text: string, extra: Partial<ToolResultMessage> = {}): Message => ({ role: 'toolResult', toolCallId: id, toolName: 'read', content: [{ type: 'text', text }], isError: false, timestamp: 1, ...extra });
const call = (id: string, extra: object = {}) => ({ type: 'toolCall' as const, id, name: 'read', arguments: { path: 'a.ts' }, ...extra });
const SIGNATURE = 'QUJDRA==';

describe('envelope', () => {
  test('carries the Antigravity identity, a request id, and the session id', () => {
    const body = build([user('hi')], { sessionId: 'sess-1' });
    expect(body).toMatchObject({ model: 'gemini-3.8-flash-medium', project: 'proj-1', userAgent: 'antigravity', requestType: 'agent', request: { sessionId: 'sess-1' } });
    expect(body.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(build([user('hi')]).requestId).not.toBe(body.requestId);
    expect(body).not.toHaveProperty('user_prompt_id');
    expect(body.request).not.toHaveProperty('session_id');
  });

  test('maps temperature and maxTokens into generationConfig', () => {
    expect(build([user('hi')], { temperature: 0.2, maxTokens: 900 }).request.generationConfig).toMatchObject({ temperature: 0.2, maxOutputTokens: 900 });
  });

  test('replays system messages into systemInstruction only', () => {
    const body = build([system('Be brief.'), user('hi'), system('Also be kind.')]);
    expect(body.request.systemInstruction).toEqual({ role: 'user', parts: [{ text: 'Be brief.\n\nAlso be kind.' }] });
    expect(body.request.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  test('drops the sentence naming pi as the harness, which Google answers with a 429', () => {
    const body = build([system('You are a coding assistant running inside pi, a coding agent harness. Help users inspect files.'), user('hi')]);
    expect(body.request.systemInstruction).toEqual({ role: 'user', parts: [{ text: 'You are a coding assistant. Help users inspect files.' }] });
  });
});

describe('user content', () => {
  test('converts text and image blocks', () => {
    const body = build([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image', mimeType: 'image/png', data: 'AAAA' },
        ],
        timestamp: 1,
      },
    ]);
    expect(body.request.contents).toEqual([{ role: 'user', parts: [{ text: 'look' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }]);
  });

  test('drops unpaired surrogates', () => {
    expect(build([user('a\uD83Db')]).request.contents[0]?.parts).toEqual([{ text: 'ab' }]);
  });
});

describe('assistant content', () => {
  test('keeps thinking, text, and signatures from the same model', () => {
    const body = build([
      user('hi'),
      assistant([
        { type: 'thinking', thinking: 'hmm', thinkingSignature: SIGNATURE },
        { type: 'text', text: 'ok', textSignature: SIGNATURE },
      ]),
      user('more'),
    ]);
    expect(body.request.contents[1]).toEqual({
      role: 'model',
      parts: [
        { thought: true, text: 'hmm', thoughtSignature: SIGNATURE },
        { text: 'ok', thoughtSignature: SIGNATURE },
      ],
    });
  });

  test('drops thinking and signatures from another model', () => {
    const other = assistant(
      [
        { type: 'thinking', thinking: 'hmm', thinkingSignature: SIGNATURE },
        { type: 'text', text: 'ok', textSignature: SIGNATURE },
      ],
      { provider: 'anthropic', api: 'anthropic-messages', model: 'claude' },
    );
    expect(build([user('hi'), other, user('more')]).request.contents[1]).toEqual({ role: 'model', parts: [{ text: 'ok' }] });
  });

  test('drops signatures that are not base64', () => {
    const body = build([user('hi'), assistant([{ type: 'text', text: 'ok', textSignature: 'not base64!' }]), user('more')]);
    expect(body.request.contents[1]?.parts).toEqual([{ text: 'ok' }]);
  });

  test('drops empty text blocks and skips a message left with no parts', () => {
    const body = build([user('hi'), assistant([{ type: 'text', text: '  ' }]), user('more')]);
    expect(body.request.contents.map((content) => content.role)).toEqual(['user', 'user']);
  });

  test('skips assistant messages that ended in error or abort', () => {
    const body = build([user('hi'), assistant([{ type: 'text', text: 'half' }], { stopReason: 'error' }), assistant([{ type: 'text', text: 'cut' }], { stopReason: 'aborted' }), user('retry')]);
    expect(body.request.contents.map((content) => content.parts[0]?.text)).toEqual(['hi', 'retry']);
  });
});

describe('tool calls and results', () => {
  test('sends a sanitized id on both the call and its result for Gemini 3', () => {
    const id = `openai|call/${'x'.repeat(80)}`;
    const body = build([user('hi'), assistant([call(id)], { stopReason: 'toolUse' }), toolResult(id, 'file')]);
    const wireId = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    expect(wireId).toHaveLength(64);
    expect(body.request.contents[1]?.parts[0]?.functionCall).toEqual({ id: wireId, name: 'read', args: { path: 'a.ts' } });
    expect(body.request.contents[2]?.parts[0]?.functionResponse).toEqual({ id: wireId, name: 'read', response: { output: 'file' } });
  });

  test('sends no ids for Gemini 2.5', () => {
    const body = build([user('hi'), assistant([call('c1')], { stopReason: 'toolUse', model: gemini25.id }), toolResult('c1', 'file')], {}, gemini25);
    expect(body.request.contents[1]?.parts[0]?.functionCall).toEqual({ name: 'read', args: { path: 'a.ts' } });
    expect(body.request.contents[2]?.parts[0]?.functionResponse).toEqual({ name: 'read', response: { output: 'file' } });
  });

  test('keeps the thought signature on a same-model tool call', () => {
    const body = build([user('hi'), assistant([call('c1', { thoughtSignature: SIGNATURE })], { stopReason: 'toolUse' }), toolResult('c1', 'ok')]);
    expect(body.request.contents[1]?.parts[0]).toMatchObject({ thoughtSignature: SIGNATURE });
  });

  test('sends an error result under the error key', () => {
    const body = build([user('hi'), assistant([call('c1')], { stopReason: 'toolUse' }), toolResult('c1', 'denied', { isError: true })]);
    expect(body.request.contents[2]?.parts[0]?.functionResponse?.response).toEqual({ error: 'denied' });
  });

  test('merges consecutive tool results into one user turn', () => {
    const body = build([user('hi'), assistant([call('c1'), call('c2')], { stopReason: 'toolUse' }), toolResult('c1', 'one'), toolResult('c2', 'two')]);
    expect(body.request.contents).toHaveLength(3);
    expect(body.request.contents[2]?.parts.map((part) => part.functionResponse?.response)).toEqual([{ output: 'one' }, { output: 'two' }]);
  });

  test('answers a call that never got a result', () => {
    const body = build([user('hi'), assistant([call('c1')], { stopReason: 'toolUse' }), user('never mind')]);
    expect(body.request.contents[2]).toMatchObject({ role: 'user', parts: [{ functionResponse: { name: 'read', response: { error: 'No result provided' } } }] });
    expect(body.request.contents[3]).toEqual({ role: 'user', parts: [{ text: 'never mind' }] });
  });

  test('nests image results in the response for Gemini 3', () => {
    const image = { type: 'image' as const, mimeType: 'image/png', data: 'AAAA' };
    const body = build([user('hi'), assistant([call('c1')], { stopReason: 'toolUse' }), toolResult('c1', '', { content: [image] })]);
    expect(body.request.contents[2]?.parts[0]?.functionResponse).toMatchObject({ response: { output: '(see attached image)' }, parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] });
  });

  test('sends image results as a separate turn for Gemini 2.5', () => {
    const image = { type: 'image' as const, mimeType: 'image/png', data: 'AAAA' };
    const body = build([user('hi'), assistant([call('c1')], { stopReason: 'toolUse', model: gemini25.id }), toolResult('c1', '', { content: [image] })], {}, gemini25);
    expect(body.request.contents[3]).toEqual({ role: 'user', parts: [{ text: 'Tool result image:' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] });
  });

  test('keeps parallel Gemini 2.5 tool results in one turn and puts image turns after it', () => {
    const image = { type: 'image' as const, mimeType: 'image/png', data: 'AAAA' };
    const body = build([user('hi'), assistant([call('c1'), call('c2')], { stopReason: 'toolUse', model: gemini25.id }), toolResult('c1', '', { content: [image] }), toolResult('c2', 'two')], {}, gemini25);
    expect(body.request.contents.slice(2)).toEqual([
      { role: 'user', parts: [{ functionResponse: expect.objectContaining({ response: { output: '(see attached image)' } }) }, { functionResponse: expect.objectContaining({ response: { output: 'two' } }) }] },
      { role: 'user', parts: [{ text: 'Tool result image:' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] },
    ]);
  });
});

describe('tools', () => {
  const tools = [{ name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { mode: { const: 'fast' }, path: { type: 'string' } } } }];
  const withTools = (extra: Message[] = []): Message[] => [system('s', { toolsAdded: tools }), user('hi'), ...extra];

  test('declares the current tools with const rewritten to enum', () => {
    expect(build(withTools()).request.tools).toEqual([{ functionDeclarations: [{ name: 'read', description: 'Read a file', parametersJsonSchema: { type: 'object', properties: { mode: { enum: ['fast'] }, path: { type: 'string' } } } }] }]);
  });

  test('omits tools when none are declared', () => {
    expect(build([user('hi')]).request).not.toHaveProperty('tools');
  });

  test('maps toolChoice none to mode NONE', () => {
    expect(build(withTools(), { toolChoice: 'none' }).request.toolConfig).toEqual({ functionCallingConfig: { mode: 'NONE' } });
  });

  test('sends no toolConfig for auto or unset', () => {
    expect(build(withTools(), { toolChoice: 'auto' }).request).not.toHaveProperty('toolConfig');
    expect(build(withTools()).request).not.toHaveProperty('toolConfig');
  });
});

describe('effort', () => {
  const hydrogen = model('gemini-4-hydrogen');
  const argon = model('gemini-4-argon');
  const gptOss = model('gpt-oss-120b');

  test.for([
    [undefined, 'gemini-4-hydrogen-medium', 'MEDIUM'],
    ['minimal', 'gemini-4-hydrogen-low', 'LOW'],
    ['low', 'gemini-4-hydrogen-low', 'LOW'],
    ['medium', 'gemini-4-hydrogen-medium', 'MEDIUM'],
    ['high', 'gemini-4-hydrogen-high', 'HIGH'],
    ['xhigh', 'gemini-4-hydrogen-xhigh', 'HIGH'],
  ] as const)('reasoning %s on gemini-4-hydrogen sends %s and thinking level %s', ([reasoning, wire, thinkingLevel]) => {
    const body = build([user('hi')], reasoning === undefined ? {} : { reasoning }, hydrogen);
    expect(body.model).toBe(wire);
    expect(body.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel });
  });

  test('clamps a level the model lacks to the nearest wire id', () => {
    expect(build([user('hi')], { reasoning: 'xhigh' }, argon).model).toBe('gemini-4-argon-high');
    expect(build([user('hi')], { reasoning: 'max' }, argon).model).toBe('gemini-4-argon-high');
    expect(build([user('hi')], { reasoning: 'high' }, gptOss).model).toBe('gpt-oss-120b-medium');
    expect(build([user('hi')], { reasoning: 'low' }, gptOss).request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'MEDIUM' });
  });

  test('sends the wire id as the model, not the Pi base id', () => {
    expect(build([user('hi')], { reasoning: 'low' }, model('gemini-pro-orchestrator-g1-pro')).model).toBe('gemini-pro-orchestrator-g1-pro');
  });

  test('omits thinkingConfig and sends the wire id for a model without thinking', () => {
    const [plain] = catalogModels({ models: { 'plain-model': { displayName: 'Plain', maxTokens: 10, maxOutputTokens: 5 } }, agentModelSorts: [{ groups: [{ modelIds: ['plain-model'] }] }] });
    if (!plain) throw new Error('no model');
    const body = build([user('hi')], { reasoning: 'high' }, plain);
    expect(body.model).toBe('plain-model');
    expect(body.request.generationConfig).not.toHaveProperty('thinkingConfig');
  });
});
