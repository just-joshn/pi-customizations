import { createModels, type Model } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import { createGrokBuildProvider } from '../src/index.ts';
import { builtinXai } from './support/builtin-xai.ts';
import { oauthCredential, storeWith } from './support/credentials.ts';
import { startResponsesServer } from './support/responses-server.ts';

test('a streamed request carries the identity headers plus the effort', async ({ onTestFinished }) => {
  const server = await startResponsesServer();
  onTestFinished(() => server.close());
  const credential = oauthCredential();
  const provider = createGrokBuildProvider(builtinXai());
  const models = createModels({ credentials: await storeWith(credential) });
  models.setProvider(provider);
  const physical = models.getModel('grok-build', 'grok-4.7-build-fast');
  if (!physical) throw new Error('grok-build/grok-4.7-build-fast is not listed');
  const model: Model<'openai-responses'> = { ...physical, api: 'openai-responses', baseUrl: server.baseUrl };

  const stream = models.streamSimple(model, { messages: [{ role: 'user', content: 'ping', timestamp: 1 }] }, { sessionId: 'session-1', reasoning: 'xhigh' });
  const message = await stream.result();

  const [recorded] = server.requests;
  expect(server.requests).toHaveLength(1);
  expect(recorded?.path).toBe('/v1/responses');
  expect(recorded?.headers).toMatchObject({
    'x-grok-client-version': '1.0.46',
    'x-xai-token-auth': 'xai-grok-cli',
    'x-grok-model-override': 'grok-4.7-build-fast',
    'x-grok-context-window': '256000',
    'x-grok-conv-id': 'session-1',
    authorization: `Bearer ${credential.access}`,
  });
  expect(recorded?.body).toMatchObject({ model: 'grok-4.7-build-fast', reasoning: { effort: 'xhigh' } });
  expect(message.content.map((block) => (block.type === 'text' ? block.text : ''))).toStrictEqual(['OK']);
});
