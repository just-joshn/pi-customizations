import type { ImageContent, Message, TextContent } from '@earendil-works/pi-ai';
import { expect, vi } from 'vitest';
import { transformMessages } from '../src/pi-ai/transform-messages.ts';
import { test } from './network-guard.ts';
import { assistant, googleModel } from './pi-ai-fixtures.ts';

const image: ImageContent = { type: 'image', mimeType: 'image/png', data: 'AA==' };
const text: TextContent = { type: 'text', text: 'visible' };
const call = { type: 'toolCall', id: 'call|1', name: 'run', arguments: { x: 1 }, thoughtSignature: 'AAAA' } as const;

test('non-vision models replace adjacent images with one placeholder', () => {
  const messages: Message[] = [
    { role: 'user', content: [image, image, text, image], timestamp: 1 },
    { role: 'toolResult', toolCallId: 'a', toolName: 'run', content: [image, image], isError: false, timestamp: 2 },
  ];
  expect(transformMessages(messages, { ...googleModel, input: ['text'] })).toEqual([
    { role: 'user', content: [{ type: 'text', text: '(image omitted: model does not support images)' }, text, { type: 'text', text: '(image omitted: model does not support images)' }], timestamp: 1 },
    { role: 'toolResult', toolCallId: 'a', toolName: 'run', content: [{ type: 'text', text: '(tool image omitted: model does not support images)' }], isError: false, timestamp: 2 },
  ]);
  expect(messages[0]?.content).toEqual([image, image, text, image]);
  expect(transformMessages(messages, googleModel)).toEqual(messages);
});

test('existing image placeholders do not produce duplicates', () => {
  expect(transformMessages([{ role: 'user', content: [{ type: 'text', text: '(image omitted: model does not support images)' }, image], timestamp: 1 }], { ...googleModel, input: ['text'] })).toEqual([
    { role: 'user', content: [{ type: 'text', text: '(image omitted: model does not support images)' }], timestamp: 1 },
  ]);
});

test('same-model replay preserves signed reasoning including opaque blocks', () => {
  const message = assistant({
    content: [
      { type: 'thinking', thinking: '', thinkingSignature: 'AAAA' },
      { type: 'thinking', thinking: 'encrypted', redacted: true },
      { type: 'thinking', thinking: 'reason' },
      { type: 'thinking', thinking: ' ' },
      { type: 'text', text: 'reply', textSignature: 'BBBB' },
    ],
  });
  expect(transformMessages([message], googleModel)[0]?.content).toEqual([
    { type: 'thinking', thinking: '', thinkingSignature: 'AAAA' },
    { type: 'thinking', thinking: 'encrypted', redacted: true },
    { type: 'thinking', thinking: 'reason' },
    { type: 'text', text: 'reply', textSignature: 'BBBB' },
  ]);
});

test('cross-model replay removes signatures while keeping visible reasoning', () => {
  const message = assistant({
    model: 'other',
    content: [
      { type: 'thinking', thinking: 'opaque', redacted: true },
      { type: 'thinking', thinking: '' },
      { type: 'thinking', thinking: 'reason', thinkingSignature: 'AAAA' },
      { type: 'text', text: 'reply', textSignature: 'BBBB' },
    ],
  });
  expect(transformMessages([message], googleModel)[0]?.content).toEqual([
    { type: 'text', text: 'reason' },
    { type: 'text', text: 'reply' },
  ]);
});

test('cross-model tool ID normalization also updates results', () => {
  const messages: Message[] = [assistant({ model: 'other', content: [call] }), { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [text], isError: false, timestamp: 3 }];
  const result = transformMessages(messages, googleModel, () => 'call_1');
  expect(result[0]?.content).toEqual([{ type: 'toolCall', id: 'call_1', name: 'run', arguments: { x: 1 } }]);
  expect(result[1]).toEqual({ role: 'toolResult', toolCallId: 'call_1', toolName: 'run', content: [text], isError: false, timestamp: 3 });
  expect(messages[0]?.content).toEqual([call]);
});

test('unchanged normalized IDs preserve the existing result link', () => {
  const messages: Message[] = [
    assistant({ model: 'other', content: [{ type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments }] }),
    { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [text], isError: false, timestamp: 3 },
  ];
  expect(transformMessages(messages, googleModel, (id) => id)[1]).toEqual(messages[1]);
});

test.for(['end', 'user', 'assistant'] as const)('orphan calls receive synthetic results at %s boundaries', (boundary) => {
  vi.useFakeTimers();
  vi.setSystemTime(100);
  const messages: Message[] = [assistant({ content: [call] })];
  const following: Message[] = boundary === 'user' ? [{ role: 'user', content: 'next', timestamp: 3 }] : boundary === 'assistant' ? [assistant({ timestamp: 3 })] : [];
  expect(transformMessages([...messages, ...following], googleModel)).toEqual([
    ...messages,
    { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: 'No result provided' }], isError: true, timestamp: 100 },
    ...following,
  ]);
});

test('system messages wait until answered tool calls are closed', () => {
  const policy: Message = { role: 'system', content: 'policy', timestamp: 3 };
  const messages: Message[] = [assistant({ content: [call] }), policy, { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [text], isError: false, timestamp: 4 }];
  expect(transformMessages(messages, googleModel)).toEqual([messages[0], messages[2], policy]);
  expect(transformMessages([policy], googleModel)).toEqual([policy]);
});

test.for(['error', 'aborted'] as const)('incomplete %s turns are omitted from replay', (stopReason) => {
  const next: Message = { role: 'user', content: 'retry', timestamp: 3 };
  expect(transformMessages([assistant({ stopReason, content: [call] }), next], googleModel)).toEqual([next]);
});

test.for([null, undefined])('untyped missing content is normalized for callers', (content) => {
  const malformed = Object.assign({ role: 'user', timestamp: 1 }, { content });
  const result: Message[] = Reflect.apply(transformMessages, undefined, [[malformed], googleModel]);
  expect(result).toEqual([{ role: 'user', timestamp: 1, content: [] }]);
});
