import { expect } from 'vitest';
import { ask, PIXEL, readTool, toolCallTurn, toolResult, user } from './support/context.ts';
import { test } from './support/fixtures.ts';
import { sseReply } from './support/messages-server.ts';
import { messagesOf, soleRequest } from './support/request-body.ts';
import { collect, textOf } from './support/run-stream.ts';
import { finish, messageStart, textBlock, textMessage, type UsageCounts } from './support/sse.ts';

const WIRE_PIXEL = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };

test('an ordinary text reply becomes one text block', async ({ models, model, server }) => {
  server.respond(sseReply(textMessage('hello')));
  const { message } = await collect(models.streamSimple(model, ask('hi')));
  expect(message.content).toStrictEqual([{ type: 'text', text: 'hello' }]);
});

test('an ordinary text reply stops with stop', async ({ models, model, server }) => {
  server.respond(sseReply(textMessage('hello')));
  const { message } = await collect(models.streamSimple(model, ask('hi')));
  expect(message.stopReason).toBe('stop');
});

test('an empty text reply finishes without text', async ({ models, model, server }) => {
  server.respond(sseReply(textMessage('')));
  const { message } = await collect(models.streamSimple(model, ask('hi')));
  expect([message.stopReason, textOf(message)]).toStrictEqual(['stop', '']);
});

test('a tool result is sent back as a tool_result block', async ({ models, model, server }) => {
  const context = { tools: [readTool], messages: [user('read a'), toolCallTurn('toolu_1'), toolResult('toolu_1', [{ type: 'text', text: 'contents' }])] };
  await collect(models.streamSimple(model, context));
  expect(messagesOf(soleRequest(server).body).slice(1)).toMatchObject([
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: 'a.txt' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'contents' }] },
  ]);
});

test('an image in the prompt is sent as a base64 source', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, { messages: [user([{ type: 'text', text: 'what is this' }, PIXEL])] }));
  expect(messagesOf(soleRequest(server).body)).toMatchObject([{ role: 'user', content: [{ type: 'text', text: 'what is this' }, WIRE_PIXEL] }]);
});

test('an image in a tool result is sent inside the tool_result', async ({ models, model, server }) => {
  const context = { tools: [readTool], messages: [user('look'), toolCallTurn('toolu_1'), toolResult('toolu_1', [PIXEL])] };
  await collect(models.streamSimple(model, context));
  expect(messagesOf(soleRequest(server).body)[2]).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: '(see attached image)' }, WIRE_PIXEL] }] });
});

test('usage counts the tokens the stream reports', async ({ models, model, server }) => {
  server.respond(sseReply(textMessage('hello')));
  const { message } = await collect(models.streamSimple(model, ask('hi')));
  expect(message.usage).toMatchObject({ input: 10, output: 7, cacheRead: 4, cacheWrite: 2, totalTokens: 23 });
});

test('cost follows the catalog price of the model', async ({ models, model, server }) => {
  server.respond(sseReply(textMessage('hello')));
  const { message } = await collect(models.streamSimple(model, ask('hi')));
  const { cost } = message.usage;
  expect(cost.input).toBeCloseTo(0.00003, 9);
  expect(cost.output).toBeCloseTo(0.000105, 9);
  expect(cost.cacheRead).toBeCloseTo(0.0000012, 9);
  expect(cost.cacheWrite).toBeCloseTo(0.0000075, 9);
  expect(cost.total).toBeCloseTo(0.0001437, 9);
});

test('a message without cache counts reports zero cache usage', async ({ models, model, server }) => {
  const usage: UsageCounts = { input_tokens: 5, output_tokens: 0 };
  server.respond(sseReply([messageStart(usage), ...textBlock(0, 'x'), ...finish('end_turn', 3)]));
  const { message } = await collect(models.streamSimple(model, ask('hi')));
  expect(message.usage).toMatchObject({ input: 5, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 8 });
});

test('a thinking turn from another provider is replayed as text', async ({ models, model, server }) => {
  const foreignId = 'call_1|fc 2.x';
  const handoff = toolCallTurn(foreignId, {
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-5',
    content: [
      { type: 'thinking', thinking: 'plan the read', thinkingSignature: 'opaque' },
      { type: 'toolCall', id: foreignId, name: 'read', arguments: { path: 'a.txt' } },
    ],
  });
  const reply = toolResult(foreignId, [{ type: 'text', text: 'contents' }]);
  await collect(models.streamSimple(model, { tools: [readTool], messages: [user('read a'), handoff, reply] }));
  expect(messagesOf(soleRequest(server).body).slice(1)).toMatchObject([
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'plan the read' },
        { type: 'tool_use', id: 'call_1_fc_2_x', name: 'Read' },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1_fc_2_x' }] },
  ]);
});

test('a lone surrogate in the prompt is removed before sending', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('a\ud83db')));
  expect(messagesOf(soleRequest(server).body)).toMatchObject([{ content: [{ type: 'text', text: 'ab' }] }]);
});

test('an astral emoji in the prompt survives unchanged', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('go \u{1F642}')));
  expect(messagesOf(soleRequest(server).body)).toMatchObject([{ content: [{ type: 'text', text: 'go \u{1F642}' }] }]);
});
