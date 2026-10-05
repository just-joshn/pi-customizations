import { type Message, normalizeContext, type Tool, Type } from '@earendil-works/pi-ai';
import { expect } from 'vitest';
import { FinishReason } from '../src/pi-ai/genai.ts';
import {
  convertMessages,
  convertTools,
  getDisabledGoogleThinkingConfig,
  isThinkingPart,
  mapStopReason,
  mapStopReasonString,
  mapToolChoice,
  requiresToolCallId,
  resolveGoogleFunctionCallingMode,
  resolveGoogleThinkingLevel,
  retainThoughtSignature,
  supportsGoogleStrictToolSampling,
  toGoogleSdkThinkingLevel,
  toGoogleThinkingLevel,
  usesGoogleThinkingLevel,
} from '../src/pi-ai/google-shared.ts';
import { test } from './network-guard.ts';
import { assistant, googleModel } from './pi-ai-fixtures.ts';

const tool: Tool = { name: 'run', description: 'Run', parameters: Type.Unsafe({ type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }) };
const strictTool: Tool = { ...tool, constrainedSampling: { type: 'json_schema', strict: 'prefer' } };
const image = { type: 'image', mimeType: 'image/png', data: 'AA==' } as const;
function convert(messages: Message[], id = googleModel.id) {
  return convertMessages({ ...googleModel, id }, normalizeContext({ messages }));
}

test.for([
  { id: 'gemini-3.1-pro-preview', level: true, strict: true, ids: true },
  { id: 'gemini-3-flash', level: true, strict: true, ids: true },
  { id: 'gemini-flash-latest', level: true, strict: false, ids: false },
  { id: 'gemini-flash-lite-latest', level: true, strict: false, ids: false },
  { id: 'gemma4-it', level: true, strict: false, ids: false },
  { id: 'gemma-4-it', level: true, strict: false, ids: false },
  { id: 'gemini-2.5-pro', level: false, strict: false, ids: false },
  { id: 'gemini-live-3-flash', level: false, strict: true, ids: true },
  { id: 'claude-sonnet', level: false, strict: false, ids: true },
  { id: 'gpt-oss-120b', level: false, strict: false, ids: true },
  { id: 'other', level: false, strict: false, ids: false },
])('Google wire capabilities follow model families: $id', ({ id, level, strict, ids }) => {
  expect(usesGoogleThinkingLevel({ ...googleModel, id })).toBe(level);
  expect(supportsGoogleStrictToolSampling(id)).toBe(strict);
  expect(requiresToolCallId(id)).toBe(ids);
});

test.for([
  { level: 'minimal', wire: 'MINIMAL' },
  { level: 'low', wire: 'LOW' },
  { level: 'medium', wire: 'MEDIUM' },
  { level: 'high', wire: 'HIGH' },
] as const)('Google thinking levels translate to SDK enums', ({ level, wire }) => {
  expect(resolveGoogleThinkingLevel(googleModel, level)).toBe(level);
  expect(toGoogleThinkingLevel(level)).toBe(wire);
  expect(toGoogleSdkThinkingLevel(wire)).toBe(wire);
});

test('Google thinking maps reject unsupported vendor values', () => {
  expect(resolveGoogleThinkingLevel({ ...googleModel, thinkingLevelMap: { high: 'LOW' } }, 'high')).toBe('low');
  expect(() => resolveGoogleThinkingLevel({ ...googleModel, thinkingLevelMap: { high: 'INVALID' } }, 'high')).toThrow('Unsupported Google thinking level mapping');
  expect(toGoogleSdkThinkingLevel('THINKING_LEVEL_UNSPECIFIED')).toBe('THINKING_LEVEL_UNSPECIFIED');
  expect(getDisabledGoogleThinkingConfig({ ...googleModel, id: 'gemini-2.5-flash' })).toEqual({ thinkingBudget: 0 });
  expect(getDisabledGoogleThinkingConfig(googleModel)).toEqual({ thinkingBudget: 0 });
});

test('thought markers are distinct from retained signatures', () => {
  expect(isThinkingPart({ thought: true })).toBe(true);
  expect(isThinkingPart({ thoughtSignature: 'AAAA' })).toBe(false);
  expect(retainThoughtSignature('AAAA', '')).toBe('AAAA');
  expect(retainThoughtSignature('AAAA', undefined)).toBe('AAAA');
  expect(retainThoughtSignature('AAAA', 'BBBB')).toBe('BBBB');
  expect(retainThoughtSignature(undefined, undefined)).toBeUndefined();
});

test('user conversion preserves images while repairing lone surrogates', () => {
  expect(
    convert([
      { role: 'user', content: 'hello 😀\ud800!', timestamp: 1 },
      { role: 'user', content: [{ type: 'text', text: '\udc00ok' }, image], timestamp: 2 },
      { role: 'user', content: [], timestamp: 3 },
    ]),
  ).toEqual([
    { role: 'user', parts: [{ text: 'hello 😀!' }] },
    { role: 'user', parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: 'AA==' } }] },
  ]);
});

test('initial system prompt is not emitted as a conversation turn', () => {
  expect(
    convert([
      { role: 'system', content: 'policy', timestamp: 0 },
      { role: 'user', content: '', timestamp: 1 },
    ]),
  ).toEqual([{ role: 'user', parts: [{ text: '' }] }]);
});

test('same-model conversion echoes valid signed empty parts', () => {
  expect(
    convert([
      assistant({
        content: [
          { type: 'text', text: '', textSignature: 'AAAA' },
          { type: 'thinking', thinking: '', thinkingSignature: 'BBBB' },
          { type: 'text', text: ' ' },
          { type: 'thinking', thinking: 'reason', thinkingSignature: 'bad!' },
        ],
      }),
    ]),
  ).toEqual([
    {
      role: 'model',
      parts: [
        { text: '', thoughtSignature: 'AAAA' },
        { thought: true, text: '', thoughtSignature: 'BBBB' },
        { thought: true, text: 'reason' },
      ],
    },
  ]);
});

test.for(['abc', '!!!!', '', undefined])('invalid thought signatures are omitted from visible text', (textSignature) => {
  expect(convert([assistant({ content: [{ type: 'text', text: 'reply', ...(textSignature === undefined ? {} : { textSignature }) }] })])).toEqual([{ role: 'model', parts: [{ text: 'reply' }] }]);
});

test('cross-model conversion keeps visible reasoning as ordinary text', () => {
  expect(
    convert([
      assistant({
        model: 'other',
        content: [
          { type: 'thinking', thinking: 'reason', thinkingSignature: 'AAAA' },
          { type: 'text', text: 'reply', textSignature: 'BBBB' },
        ],
      }),
    ]),
  ).toEqual([{ role: 'model', parts: [{ text: 'reason' }, { text: 'reply' }] }]);
});

test('empty assistant text does not emit an empty model turn', () => {
  expect(convert([assistant({ content: [{ type: 'text', text: ' ' }] }), { role: 'user', content: 'next', timestamp: 3 }])).toEqual([{ role: 'user', parts: [{ text: 'next' }] }]);
});

test('tool calls preserve same-model signatures with explicit IDs', () => {
  expect(
    convert([
      assistant({ content: [{ type: 'toolCall', id: 'a', name: 'run', arguments: { value: 'x' }, thoughtSignature: 'AAAA' }] }),
      { role: 'toolResult', toolCallId: 'a', toolName: 'run', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 3 },
    ]),
  ).toEqual([
    { role: 'model', parts: [{ functionCall: { name: 'run', args: { value: 'x' }, id: 'a' }, thoughtSignature: 'AAAA' }] },
    { role: 'user', parts: [{ functionResponse: { name: 'run', response: { output: 'ok' }, id: 'a' } }] },
  ]);
});

test('older Gemini omits tool IDs on calls plus responses', () => {
  expect(
    convert([assistant({ model: 'other', content: [{ type: 'toolCall', id: 'a|1', name: 'run', arguments: {} }] }), { role: 'toolResult', toolCallId: 'a|1', toolName: 'run', content: [], isError: true, timestamp: 3 }], 'gemini-2.5-flash'),
  ).toEqual([
    { role: 'model', parts: [{ functionCall: { name: 'run', args: {} } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'run', response: { error: '' } } }] },
  ]);
});

test('cross-model Google calls normalize IDs for their responses', () => {
  expect(convert([assistant({ model: 'other', content: [{ type: 'toolCall', id: 'a|1', name: 'run', arguments: {} }] }), { role: 'toolResult', toolCallId: 'a|1', toolName: 'run', content: [], isError: false, timestamp: 3 }])).toEqual([
    { role: 'model', parts: [{ functionCall: { name: 'run', args: {}, id: 'a_1' } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'run', response: { output: '' }, id: 'a_1' } }] },
  ]);
});

test('multimodal tool results nest images with a text fallback', () => {
  expect(
    convert([
      { role: 'toolResult', toolCallId: 'a', toolName: 'run', content: [image], isError: false, timestamp: 1 },
      {
        role: 'toolResult',
        toolCallId: 'b',
        toolName: 'run',
        content: [
          { type: 'text', text: 'line1' },
          { type: 'text', text: 'line2' },
        ],
        isError: true,
        timestamp: 2,
      },
    ]),
  ).toEqual([
    {
      role: 'user',
      parts: [
        { functionResponse: { name: 'run', response: { output: '(see attached image)' }, parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }], id: 'a' } },
        { functionResponse: { name: 'run', response: { error: 'line1\nline2' }, id: 'b' } },
      ],
    },
  ]);
});

test('older Gemini emits tool images in a separate user turn', () => {
  expect(convert([{ role: 'toolResult', toolCallId: 'a', toolName: 'run', content: [image], isError: false, timestamp: 1 }], 'gemini-2-flash')).toEqual([
    { role: 'user', parts: [{ functionResponse: { name: 'run', response: { output: '(see attached image)' } } }] },
    { role: 'user', parts: [{ text: 'Tool result image:' }, { inlineData: { mimeType: 'image/png', data: 'AA==' } }] },
  ]);
});

test('non-vision Google tool results explain omitted images', () => {
  expect(convertMessages({ ...googleModel, input: ['text'] }, normalizeContext({ messages: [{ role: 'toolResult', toolCallId: 'a', toolName: 'run', content: [image], isError: false, timestamp: 1 }] }))).toEqual([
    { role: 'user', parts: [{ functionResponse: { name: 'run', response: { output: '(tool image omitted: model does not support images)' }, id: 'a' } }] },
  ]);
});

test('tool declarations default to JSON Schema without modifying tools', () => {
  expect(convertTools([tool])).toEqual([{ functionDeclarations: [{ name: 'run', description: 'Run', parametersJsonSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }] }]);
  expect(convertTools([])).toBeUndefined();
});

test('legacy tool declarations strip nested schema metadata', () => {
  const subject = { ...tool, parameters: Type.Unsafe({ type: 'object', $schema: 'schema', $defs: {}, properties: { x: { type: 'string', $id: 'id', enum: ['x'], default: null } } }) };
  expect(convertTools([subject], true)).toEqual([{ functionDeclarations: [{ name: 'run', description: 'Run', parameters: { type: 'object', properties: { x: { type: 'string', enum: ['x'], default: null } } } }] }]);
});

test('strict declarations close object schemas', () => {
  expect(convertTools([strictTool])).toEqual([
    { functionDeclarations: [{ name: 'run', description: 'Run', parametersJsonSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }] },
  ]);
});

test.for([
  { choice: 'auto', expected: 'AUTO', strict: 'VALIDATED' },
  { choice: 'none', expected: 'NONE', strict: 'NONE' },
  { choice: 'any', expected: 'ANY', strict: 'ANY' },
  { choice: 'unknown', expected: 'AUTO', strict: 'VALIDATED' },
])('tool choices map to wire modes: $choice', ({ choice, expected, strict }) => {
  expect(mapToolChoice(choice)).toBe(expected);
  expect(resolveGoogleFunctionCallingMode([strictTool], choice, true)).toBe(strict);
  expect(resolveGoogleFunctionCallingMode([tool], choice, false)).toBe(expected);
});

test('unspecified choices use validated mode only for strict tools', () => {
  expect(resolveGoogleFunctionCallingMode([strictTool], undefined, true)).toBe('VALIDATED');
  expect(resolveGoogleFunctionCallingMode([tool], undefined, true)).toBeUndefined();
});

test.for([
  { reason: FinishReason.STOP, expected: 'stop' },
  { reason: FinishReason.MAX_TOKENS, expected: 'length' },
  { reason: FinishReason.BLOCKLIST, expected: 'error' },
  { reason: FinishReason.PROHIBITED_CONTENT, expected: 'error' },
  { reason: FinishReason.SPII, expected: 'error' },
  { reason: FinishReason.SAFETY, expected: 'error' },
  { reason: FinishReason.IMAGE_SAFETY, expected: 'error' },
  { reason: FinishReason.IMAGE_PROHIBITED_CONTENT, expected: 'error' },
  { reason: FinishReason.IMAGE_RECITATION, expected: 'error' },
  { reason: FinishReason.IMAGE_OTHER, expected: 'error' },
  { reason: FinishReason.RECITATION, expected: 'error' },
  { reason: FinishReason.FINISH_REASON_UNSPECIFIED, expected: 'error' },
  { reason: FinishReason.OTHER, expected: 'error' },
  { reason: FinishReason.LANGUAGE, expected: 'error' },
  { reason: FinishReason.MALFORMED_FUNCTION_CALL, expected: 'error' },
  { reason: FinishReason.UNEXPECTED_TOOL_CALL, expected: 'error' },
  { reason: FinishReason.TOO_MANY_TOOL_CALLS, expected: 'error' },
  { reason: FinishReason.NO_IMAGE, expected: 'error' },
])('SDK finish reasons map to public stop reasons: $reason', ({ reason, expected }) => {
  expect(mapStopReason(reason)).toBe(expected);
});

test.for([
  { reason: 'STOP', expected: 'stop' },
  { reason: 'MAX_TOKENS', expected: 'length' },
  { reason: 'SAFETY', expected: 'error' },
  { reason: 'unknown', expected: 'error' },
])('raw finish reasons map safely: $reason', ({ reason, expected }) => {
  expect(mapStopReasonString(reason)).toBe(expected);
});
