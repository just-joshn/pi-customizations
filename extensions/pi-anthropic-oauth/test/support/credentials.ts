import type { OAuthCredential } from '@earendil-works/pi-ai';

// Pi detects a subscription token by this prefix, so the fixture must keep it.
export const OAUTH_ACCESS_TOKEN = 'sk-ant-oat01-test';
export const OAUTH_REFRESH_TOKEN = 'refresh-fixture';
export const REFRESHED_ACCESS_TOKEN = 'sk-ant-oat01-new';
export const REFRESHED_REFRESH_TOKEN = 'refresh-rotated';

const ONE_HOUR_MS = 60 * 60 * 1000;

export function oauthCredential(overrides: Partial<OAuthCredential> = {}): OAuthCredential {
  return {
    type: 'oauth',
    access: OAUTH_ACCESS_TOKEN,
    refresh: OAUTH_REFRESH_TOKEN,
    expires: Date.now() + ONE_HOUR_MS,
    ...overrides,
  };
}
