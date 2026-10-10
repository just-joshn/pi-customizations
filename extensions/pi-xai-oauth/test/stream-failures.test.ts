import { createModels, type Model } from '@earendil-works/pi-ai';
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import { expect } from 'vitest';
import { createGrokBuildProvider } from '../src/index.ts';
import { test as base } from './network-guard.ts';
import { builtinXai } from './support/builtin-xai.ts';
import { oauthCredential, storeWith } from './support/credentials.ts';
import { openStreamReply, type ResponsesServer, responseCreatedFrame, startResponsesServer } from './support/responses-server.ts';

const ASK = { messages: [{ role: 'user' as const, content: 'hi', timestamp: 1 }] };

async function harness(server: ResponsesServer) {
  const credential = oauthCredential();
  const provider = createGrokBuildProvider(builtinXai());
  const models = createModels({ credentials: await storeWith(credential) });
  models.setProvider(provider);
  const physical = models.getModel('grok-build', 'grok-4.7-build-fast');
  if (!physical) throw new Error('grok-build/grok-4.7-build-fast is not listed');
  const model: Model<'openai-responses'> = {
    ...physical,
    api: 'openai-responses',
    baseUrl: server.baseUrl,
  };
  return { credential, models, model, provider };
}

const test = base.extend<{ server: ResponsesServer }>({
  server: async ({ networkGuard: _networkGuard }, use) => {
    const server = await startResponsesServer();
    try {
      await use(server);
    } finally {
      await server.close();
    }
  },
});

test('aborting before send ends as aborted', async ({ server }) => {
  const { provider, model, credential } = await harness(server);
  const message = await provider.streamSimple(model, normalizeContext(ASK), { apiKey: credential.access, signal: AbortSignal.abort() }).result();
  expect(message.stopReason).toBe('aborted');
});

test('aborting before send through Models reaches no server', async ({ server }) => {
  const { models, model } = await harness(server);
  const message = await models.streamSimple(model, ASK, { signal: AbortSignal.abort() }).result();
  expect(message).toMatchObject({ errorMessage: expect.stringMatching(/abort/i) });
  expect(server.requests).toHaveLength(0);
});

test('aborting mid-stream ends as aborted with Grok headers still applied', async ({ server }) => {
  const { models, model, credential } = await harness(server);
  const controller = new AbortController();
  server.respond(openStreamReply(responseCreatedFrame()));
  const message = await models
    .streamSimple(model, ASK, {
      sessionId: 'session-abort',
      signal: controller.signal,
      onProviderStreamEvent: () => controller.abort(),
    })
    .result();
  expect(message).toMatchObject({ stopReason: 'aborted', errorMessage: expect.any(String) });
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]?.headers).toMatchObject({
    'x-grok-client-version': '1.0.46',
    'x-xai-token-auth': 'xai-grok-cli',
    'x-grok-model-override': 'grok-4.7-build-fast',
    'x-grok-context-window': '256000',
    'x-grok-conv-id': 'session-abort',
    authorization: `Bearer ${credential.access}`,
  });
});
