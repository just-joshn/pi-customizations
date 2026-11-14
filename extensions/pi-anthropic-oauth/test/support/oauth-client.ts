import type { OAuthAuth } from '@earendil-works/pi-ai';
import type { ClaudeOAuthClient } from '../../src/auth.ts';

export function refreshingClient(refresh: OAuthAuth['refresh']): ClaudeOAuthClient {
  return {
    login: async () => {
      throw new Error('login is not part of this test');
    },
    refresh,
    toAuth: async (credential) => ({ apiKey: credential.access }),
  };
}
