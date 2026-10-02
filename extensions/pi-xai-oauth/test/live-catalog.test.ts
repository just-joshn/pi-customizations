import { randomUUID } from 'node:crypto';

import { createModels, type RefreshModelsContext } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import { createGrokBuildProvider } from '../src/index.ts';
import { builtinXai } from './support/builtin-xai.ts';
import { liveBody, liveEntry } from './support/catalog-body.ts';
import { stubCatalogEndpoint } from './support/catalog-endpoint.ts';
import { oauthCredential, storeWith } from './support/credentials.ts';

async function refreshed(reply: () => Response) {
  const credential = oauthCredential();
  const endpoint = stubCatalogEndpoint(reply);
  const models = createModels({ credentials: await storeWith(credential) });
  models.setProvider(createGrokBuildProvider(builtinXai()));
  const result = await models.refresh({ allowNetwork: true, providers: ['grok-build'] });
  return { credential, endpoint, models, error: result.errors.get('grok-build') };
}

test('the refresh sends the bearer token, then lists a live-only model', async () => {
  const body = { ...liveBody(), data: [...liveBody().data, liveEntry('grok-4.8')] };
  const { credential, endpoint, models, error } = await refreshed(() => Response.json(body));
  expect(error).toBeUndefined();
  expect(endpoint.requests).toStrictEqual([{ url: 'https://cli-chat-proxy.grok.com/v1/models', authorization: `Bearer ${credential.access}` }]);
  expect(
    models
      .getModels('grok-build')
      .map((model) => model.id)
      .sort(),
  ).toStrictEqual(['grok-4.5', 'grok-4.6', 'grok-4.7', 'grok-4.7-build-fast', 'grok-4.8']);
});

test('HTTP 401 asks the user to log in again', async () => {
  const { error } = await refreshed(() => new Response('denied', { status: 401 }));
  expect(error?.message).toBe('Grok Build rejected the session (HTTP 401). Run /login and choose Grok Build.');
});

test('HTTP 503 reports the model list failure', async () => {
  const { error } = await refreshed(() => new Response('down', { status: 503 }));
  expect(error?.message).toBe('Grok Build model list failed (HTTP 503).');
});

test('a body that is not a list reports an unreadable catalog', async () => {
  const { error } = await refreshed(() => Response.json({ object: 'list' }));
  expect(error?.message).toBe('Grok Build returned a model list Pi cannot read.');
});

test('a body that is not JSON reports an unreadable catalog', async () => {
  const { error } = await refreshed(() => new Response('<html>', { status: 200 }));
  expect(error?.message).toBe('Grok Build returned a model list Pi cannot read.');
});

test('a credential that yields no access token asks the user to log in', async () => {
  const xai = builtinXai();
  const oauth = xai.auth.oauth;
  if (!oauth) throw new Error("Pi's built-in xai provider has no OAuth");
  const provider = createGrokBuildProvider({ ...xai, auth: { oauth: { ...oauth, toAuth: async () => ({}) } } });
  const context: RefreshModelsContext = { credential: oauthCredential(), allowNetwork: true, signal: new AbortController().signal, publish: async () => true };
  await expect(provider.refreshModels?.(context)).rejects.toThrow('Grok Build is not logged in. Run /login and choose Grok Build.');
});

test('a refresh with an API key credential asks the user to log in', async () => {
  const provider = createGrokBuildProvider(builtinXai());
  const context: RefreshModelsContext = { credential: { type: 'api_key', key: randomUUID() }, allowNetwork: true, signal: new AbortController().signal, publish: async () => true };
  await expect(provider.refreshModels?.(context)).rejects.toThrow('Grok Build is not logged in. Run /login and choose Grok Build.');
});
