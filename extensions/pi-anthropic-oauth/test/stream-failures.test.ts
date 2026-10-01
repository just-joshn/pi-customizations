import { isContextOverflow, normalizeContext } from '@earendil-works/pi-ai';
import { expect } from 'vitest';
import { ask } from './support/context.ts';
import { OAUTH_ACCESS_TOKEN } from './support/credentials.ts';
import { test } from './support/fixtures.ts';
import { errorReply, openStreamReply, rawSseReply, sseReply } from './support/messages-server.ts';
import { collect } from './support/run-stream.ts';
import { frame, frames, messageStart, textBlock } from './support/sse.ts';

test('an overflow response ends as an error', async ({ models, model, server }) => {
  server.respond(errorReply(400, 'prompt is too long: 9 tokens > 8 maximum'));
  const { message } = await collect(models.streamSimple(model, ask('hi')));
  expect(message.stopReason).toBe('error');
});

test('an overflow response is recognized as context overflow', async ({ models, model, server }) => {
  server.respond(errorReply(400, 'prompt is too long: 9 tokens > 8 maximum'));
  const { message } = await collect(models.streamSimple(model, ask('hi')));
  expect(isContextOverflow(message, model.contextWindow)).toBe(true);
});

test('a rate limit is not mistaken for context overflow', async ({ models, model, server }) => {
  server.respond(errorReply(429, 'rate limited'));
  const { message } = await collect(models.streamSimple(model, ask('hi'), { maxRetries: 0 }));
  expect(isContextOverflow(message, model.contextWindow)).toBe(false);
});

test('aborting before send ends as aborted', async ({ provider, model }) => {
  const stream = provider.streamSimple(model, normalizeContext(ask('hi')), { apiKey: OAUTH_ACCESS_TOKEN, signal: AbortSignal.abort() });
  const { message } = await collect(stream);
  expect(message.stopReason).toBe('aborted');
});

test('aborting before send through Models reaches no server', async ({ models, model, server }) => {
  const { message } = await collect(models.streamSimple(model, ask('hi'), { signal: AbortSignal.abort() }));
  expect(message).toMatchObject({ errorMessage: expect.stringMatching(/abort/i) });
  expect(server.requests).toHaveLength(0);
});

test('aborting mid-stream ends as aborted with an error message', async ({ models, model, server }) => {
  const controller = new AbortController();
  server.respond(openStreamReply(frame(messageStart())));
  const { message } = await collect(models.streamSimple(model, ask('hi'), { signal: controller.signal, onProviderStreamEvent: () => controller.abort() }));
  expect(message).toMatchObject({ stopReason: 'aborted', errorMessage: expect.any(String) });
});

const malformed = [
  { name: 'an invalid JSON frame', reply: rawSseReply('event: message_start\ndata: {not json\n\n'), reason: 'JSON' },
  { name: 'a stream cut before message_stop', reply: sseReply([messageStart(), ...textBlock(0, 'partial')]), reason: 'message_stop' },
  { name: 'a mid-stream error event', reply: sseReply([messageStart(), { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]), reason: 'Overloaded' },
];

test.for(malformed)('$name ends as an error result', async ({ reply, reason }, { models, model, server }) => {
  server.respond(reply);
  const { message } = await collect(models.streamSimple(model, ask('hi')));
  expect(message).toMatchObject({ stopReason: 'error', errorMessage: expect.stringContaining(reason) });
});

test('text received before a failure stays in the error result', async ({ models, model, server }) => {
  server.respond(rawSseReply(frames([messageStart(), ...textBlock(0, 'partial')])));
  const { message } = await collect(models.streamSimple(model, ask('hi')));
  expect(message.content).toStrictEqual([{ type: 'text', text: 'partial' }]);
});
