import { expect } from 'vitest';
import { ask } from './support/context.ts';
import { test } from './support/fixtures.ts';
import { BILLING_TEXT, CLAUDE_CODE_PREAMBLE, eventType, soleRequest, systemBlocks } from './support/request-body.ts';
import { collect } from './support/run-stream.ts';

const REPLACEMENT = { model: 'claude-sonnet-4-6', max_tokens: 5, stream: true, messages: [{ role: 'user', content: 'replaced' }] };

test('onPayload sees the billing block first', async ({ models, model }) => {
  const seen: unknown[] = [];
  await collect(
    models.streamSimple(model, ask('hi'), {
      onPayload: (payload) => {
        seen.push(systemBlocks(payload)[0]);
        return undefined;
      },
    }),
  );
  expect(seen).toStrictEqual([{ type: 'text', text: BILLING_TEXT }]);
});

test('a replacement payload from onPayload is what the server receives', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('hi'), { onPayload: () => REPLACEMENT }));
  expect(soleRequest(server).body).toStrictEqual(REPLACEMENT);
});

test('an undefined onPayload result keeps the billed payload', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('hi'), { onPayload: () => undefined }));
  expect(systemBlocks(soleRequest(server).body)[0]).toStrictEqual({ type: 'text', text: BILLING_TEXT });
});

test('an async onPayload replacement is awaited', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('hi'), { onPayload: async () => REPLACEMENT }));
  expect(soleRequest(server).body).toStrictEqual(REPLACEMENT);
});

test('onResponse receives the HTTP status', async ({ models, model }) => {
  const statuses: number[] = [];
  await collect(models.streamSimple(model, ask('hi'), { onResponse: (response) => void statuses.push(response.status) }));
  expect(statuses).toStrictEqual([200]);
});

test('onProviderStreamEvent receives every provider event in order', async ({ models, model }) => {
  const types: (string | undefined)[] = [];
  await collect(models.streamSimple(model, ask('hi'), { onProviderStreamEvent: (data) => void types.push(eventType(data)) }));
  expect(types).toStrictEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
});

test('provider-scoped env reaches the Anthropic implementation', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('hi'), { env: { PI_CACHE_RETENTION: 'long' } }));
  expect(systemBlocks(soleRequest(server).body)).toMatchObject([{ text: BILLING_TEXT }, { text: CLAUDE_CODE_PREAMBLE, cache_control: { type: 'ephemeral', ttl: '1h' } }]);
});
