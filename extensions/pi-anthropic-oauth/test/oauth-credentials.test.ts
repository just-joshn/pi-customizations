import { expect } from 'vitest';
import { ask } from './support/context.ts';
import { OAUTH_ACCESS_TOKEN, OAUTH_REFRESH_TOKEN, oauthCredential, REFRESHED_ACCESS_TOKEN, REFRESHED_REFRESH_TOKEN } from './support/credentials.ts';
import { test } from './support/fixtures.ts';
import { soleRequest } from './support/request-body.ts';
import { collect } from './support/run-stream.ts';
import { TOKEN_URL } from './support/token-endpoint.ts';

const EXPIRED = -1000;

test('an unexpired credential is used as stored', async ({ models, model, server, tokenEndpoint }) => {
  await collect(models.streamSimple(model, ask('hi')));
  expect(soleRequest(server).headers).toHaveProperty('authorization', `Bearer ${OAUTH_ACCESS_TOKEN}`);
  expect(tokenEndpoint.requests).toHaveLength(0);
});

test('an expired credential refreshes against the token endpoint', async ({ models, model, credentials, tokenEndpoint }) => {
  await credentials.modify(model.provider, async () => oauthCredential({ expires: Date.now() + EXPIRED }));
  await collect(models.streamSimple(model, ask('hi')));
  expect(tokenEndpoint.requests).toMatchObject([{ url: TOKEN_URL, body: { grant_type: 'refresh_token', refresh_token: OAUTH_REFRESH_TOKEN } }]);
});

test('the request after a refresh uses the new access token', async ({ models, model, server, credentials, tokenEndpoint }) => {
  await credentials.modify(model.provider, async () => oauthCredential({ expires: Date.now() + EXPIRED }));
  await collect(models.streamSimple(model, ask('hi')));
  expect(soleRequest(server).headers).toHaveProperty('authorization', `Bearer ${REFRESHED_ACCESS_TOKEN}`);
  expect(tokenEndpoint.requests).toHaveLength(1);
});

test('the credential store holds the refreshed tokens', async ({ models, model, credentials, tokenEndpoint }) => {
  await credentials.modify(model.provider, async () => oauthCredential({ expires: Date.now() + EXPIRED }));
  await collect(models.streamSimple(model, ask('hi')));
  await expect(credentials.read(model.provider)).resolves.toMatchObject({ type: 'oauth', access: REFRESHED_ACCESS_TOKEN, refresh: REFRESHED_REFRESH_TOKEN });
  expect(tokenEndpoint.requests).toHaveLength(1);
});

test('a refresh with an aborted signal rejects before any request', async ({ provider, tokenEndpoint }) => {
  const oauth = provider.auth.oauth;
  if (!oauth) throw new Error('provider has no OAuth');
  await expect(oauth.refresh(oauthCredential(), AbortSignal.abort())).rejects.toThrow();
  expect(tokenEndpoint.requests).toHaveLength(0);
});

test('a login with an aborted signal rejects', async ({ provider }) => {
  const oauth = provider.auth.oauth;
  if (!oauth) throw new Error('provider has no OAuth');
  const signal = AbortSignal.abort();
  const interaction = { signal, notify: () => undefined, prompt: () => Promise.reject(signal.reason) };
  await expect(oauth.login(interaction)).rejects.toThrow();
});
