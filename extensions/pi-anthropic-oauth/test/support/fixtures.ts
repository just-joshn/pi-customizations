import { type Api, createModels, InMemoryCredentialStore, type Model, type MutableModels, type Provider } from '@earendil-works/pi-ai';
import { test as base, beforeEach, vi } from 'vitest';
import extension from '../../src/index.ts';
import { oauthCredential } from './credentials.ts';
import { captureProvider } from './load-extension.ts';
import { type MessagesServer, sseReply, startMessagesServer } from './messages-server.ts';
import { textMessage } from './sse.ts';
import { stubTokenEndpoint, type TokenEndpoint } from './token-endpoint.ts';

export const MODEL_ID = 'claude-sonnet-4-6';
export const PROVIDER_ID = 'claude-subscription';

interface Fixtures {
  server: MessagesServer;
  provider: Provider;
  credentials: InMemoryCredentialStore;
  models: MutableModels;
  model: Model<Api>;
  tokenEndpoint: TokenEndpoint;
}

beforeEach(() => {
  vi.stubEnv('CLAUDE_CODE_VERSION', undefined);
});

export const test = base.extend<Fixtures>({
  server: async ({ onTestFinished }, use) => {
    const server = await startMessagesServer(sseReply(textMessage('ok')));
    onTestFinished(() => server.close());
    await use(server);
  },
  provider: captureProvider(extension),
  credentials: async ({ provider }, use) => {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify(provider.id, async () => oauthCredential());
    await use(credentials);
  },
  models: async ({ provider, credentials }, use) => {
    const models = createModels({ credentials });
    models.setProvider(provider);
    await use(models);
  },
  model: async ({ models, server }, use) => {
    const model = models.getModel(PROVIDER_ID, MODEL_ID);
    if (!model) throw new Error(`model ${PROVIDER_ID}/${MODEL_ID} is not registered`);
    await use({ ...model, baseUrl: server.baseUrl });
  },
  tokenEndpoint: async ({ onTestFinished }, use) => {
    const guarded = globalThis.fetch;
    onTestFinished(() => {
      vi.stubGlobal('fetch', guarded);
    });
    await use(stubTokenEndpoint());
  },
});
