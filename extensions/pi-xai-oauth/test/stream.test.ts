import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createModels, type Model } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { expect } from 'vitest';
import { createGrokBuildProvider } from '../src/index.ts';
import { test as base } from './network-guard.ts';
import { builtinXai } from './support/builtin-xai.ts';
import { oauthCredential, storeWith } from './support/credentials.ts';
import { type ResponsesServer, startResponsesServer } from './support/responses-server.ts';

async function streamReply(server: ResponsesServer) {
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
    samplingParams: { top_k: 40, top_p: 0.9, min_p: 0.01 },
    samplingParamsByThinkingLevel: { xhigh: { top_k: 20, min_p: 0.05 } },
  };
  const stream = models.streamSimple(model, { messages: [{ role: 'user', content: 'ping', timestamp: 1 }] }, { sessionId: 'session-1', reasoning: 'xhigh', samplingParams: { min_p: 0.1 } });
  return { credential, message: await stream.result(), requests: server.requests };
}

const test = base.extend<{ server: ResponsesServer; exchange: Awaited<ReturnType<typeof streamReply>> }>({
  server: async ({ networkGuard: _networkGuard }, use) => {
    const server = await startResponsesServer();
    try {
      await use(server);
    } finally {
      await server.close();
    }
  },
  exchange: async ({ server }, use) => {
    await use(await streamReply(server));
  },
});

test('native streaming sends one request to the responses endpoint', ({ exchange }) => {
  expect(exchange.requests).toHaveLength(1);
  expect(exchange.requests[0]?.path).toBe('/v1/responses');
});

test('native streaming preserves the Grok Build identity and bearer token', ({ exchange }) => {
  expect(exchange.requests[0]?.headers).toMatchObject({
    'x-grok-client-version': '1.0.70',
    'x-xai-token-auth': 'xai-grok-cli',
    'x-grok-model-override': 'grok-4.7-build-fast',
    'x-grok-context-window': '256000',
    'x-grok-conv-id': 'session-1',
    authorization: `Bearer ${exchange.credential.access}`,
  });
});

test('native streaming sends the requested model and effort', ({ exchange }) => {
  expect(exchange.requests[0]?.body).toMatchObject({ model: 'grok-4.7-build-fast', reasoning: { effort: 'xhigh' }, store: false, stream: true });
  expect(exchange.requests[0]?.body).toHaveProperty('include', ['reasoning.encrypted_content']);
});

test('native streaming applies default < level < request sampling precedence', ({ exchange }) => {
  expect(exchange.requests[0]?.body).toMatchObject({ top_k: 20, top_p: 0.9, min_p: 0.1 });
});

test('native streaming returns the server text', ({ exchange }) => {
  expect(exchange.message.content.map((block) => (block.type === 'text' ? block.text : ''))).toStrictEqual(['OK']);
});

test('models.json still wins over the headers the package sends', async ({ server }) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-xai-oauth-wire-'));
  const authPath = join(dir, 'auth.json');
  const modelsPath = join(dir, 'models.json');
  const credential = oauthCredential();
  try {
    await writeFile(authPath, JSON.stringify({ 'grok-build': credential }), { mode: 0o600 });
    await writeFile(
      modelsPath,
      JSON.stringify({
        providers: {
          'grok-build': {
            headers: { 'x-grok-client-version': '9.9.9' },
            modelOverrides: { 'grok-4.7-build-fast': { contextWindow: 500000 } },
          },
        },
      }),
    );
    const runtime = await ModelRuntime.create({ authPath, modelsPath, refreshOnCreate: false });
    runtime.registerNativeProvider(createGrokBuildProvider(builtinXai()));
    await runtime.refresh({ allowNetwork: false });
    const listed = runtime.getModel('grok-build', 'grok-4.7-build-fast');
    if (!listed) throw new Error('grok-build/grok-4.7-build-fast is not listed');
    await runtime.streamSimple({ ...listed, baseUrl: server.baseUrl }, { messages: [{ role: 'user', content: 'ping', timestamp: 1 }] }, { sessionId: 'session-1' }).result();
    expect(server.requests[0]?.headers).toMatchObject({
      'x-grok-client-version': '9.9.9',
      'x-xai-token-auth': 'xai-grok-cli',
      'x-grok-model-override': 'grok-4.7-build-fast',
      'x-grok-context-window': '500000',
      'x-grok-conv-id': 'session-1',
      authorization: `Bearer ${credential.access}`,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
