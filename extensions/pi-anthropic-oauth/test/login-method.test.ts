import type { OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import { subscriptionAuth } from '../src/auth.ts';
import { OAUTH_ACCESS_TOKEN } from './support/credentials.ts';

const CREDENTIAL: OAuthCredential = { type: 'oauth', access: OAUTH_ACCESS_TOKEN, refresh: 'local-refresh', expires: 4102444800000 };

function oauthWithSelect(options: readonly { id: string; label: string }[], answered: { value?: string }): OAuthAuth {
  return {
    name: 'stub',
    login: async (interaction) => {
      answered.value = await interaction.prompt({ type: 'select', message: 'Login method', options });
      return CREDENTIAL;
    },
    refresh: async (credential) => credential,
    toAuth: async () => ({ apiKey: OAUTH_ACCESS_TOKEN }),
  };
}

function login(oauth: OAuthAuth, answer: string): Promise<OAuthCredential> {
  const method = subscriptionAuth(oauth).oauth;
  if (!method) throw new Error('subscriptionAuth must provide an OAuth method');
  return method.login({ signal: new AbortController().signal, notify: () => undefined, prompt: async () => answer });
}

test('login answers the offered paste-code method', async () => {
  const answered: { value?: string } = {};
  const oauth = oauthWithSelect(
    [
      { id: 'browser', label: 'Browser' },
      { id: 'copy_code', label: 'Paste code' },
    ],
    answered,
  );
  await login(oauth, 'browser');
  expect(answered.value).toBe('copy_code');
});

test('login leaves a selector without paste-code to the user', async () => {
  const answered: { value?: string } = {};
  const oauth = oauthWithSelect(
    [
      { id: 'account_a', label: 'Account A' },
      { id: 'account_b', label: 'Account B' },
    ],
    answered,
  );
  await login(oauth, 'account_b');
  expect(answered.value).toBe('account_b');
});
