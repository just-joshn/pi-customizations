import type { AssistantMessage, Message, Model, SimpleStreamOptions, ToolResultMessage, TranscriptContext } from '@earendil-works/pi-ai';
import { describe, expect, test } from 'vitest';
import { API_ID, PROVIDER_ID } from './constants.ts';
import { createCodeAssistModels } from './models.ts';
import { buildCodeAssistRequest } from './request.ts';

const models = createCodeAssistModels();
const model = (id: string): Model<string> => {
  const found = models.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no model ${id}`);
  return found;
};
const gemini3 = model('gemini-3.5-flash');
const gemini25 = model('gemini-2.5-pro');

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
  test('carries model, project, a UUIDv7 prompt id, and the session id', () => {
    const body = build([user('hi')], { sessionId: 'sess-1' });
    expect(body).toMatchObject({ model: 'gemini-3.5-flash', project: 'proj-1', request: { session_id: 'sess-1' } });
    expect(body.user_prompt_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('maps temperature and maxTokens into generationConfig', () => {
    expect(build([user('hi')], { temperature: 0.2, maxTokens: 900 }).request.generationConfig).toMatchObject({ temperature: 0.2, maxOutputTokens: 900 });
  });

  test('replays system messages into systemInstruction only', () => {
    const body = build([system('Be brief.'), user('hi'), system('Also be kind.')]);
    expect(body.request.systemInstruction).toEqual({ parts: [{ text: 'Be brief.\n\nAlso be kind.' }] });
    expect(body.request.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
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

describe('thinking', () => {
  test('maps the clamped level through the model thinking map', () => {
    expect(build([user('hi')], { reasoning: 'high' }).request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'HIGH' });
    expect(build([user('hi')], { reasoning: 'minimal' }, model('gemini-3.1-pro-preview')).request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'LOW' });
  });

  test('uses the lowest supported level when thinking is off', () => {
    expect(build([user('hi')], {}, model('gemini-3.1-pro-preview')).request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  test('uses a token budget on a model without a thinking map', () => {
    expect(build([user('hi')], { reasoning: 'medium' }, gemini25).request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 8192 });
    expect(build([user('hi')], { reasoning: 'medium', thinkingBudgets: { medium: 1234 } }, gemini25).request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 1234 });
  });

  test('leaves thinking to Google when a budget-style model is set to off', () => {
    expect(build([user('hi')], {}, gemini25).request.generationConfig).not.toHaveProperty('thinkingConfig');
  });

  test('sends no thinking config to a model without reasoning', () => {
    expect(build([user('hi')], { reasoning: 'high' }, { ...gemini3, reasoning: false }).request.generationConfig).not.toHaveProperty('thinkingConfig');
  });
});
