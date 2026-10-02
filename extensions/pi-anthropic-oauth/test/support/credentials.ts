import { randomUUID } from 'node:crypto';

import type { OAuthCredential } from '@earendil-works/pi-ai';

// Pi detects a subscription token by this prefix, so the fixture must keep it.
const OAUTH_PREFIX = 'sk-ant-oat01-';

export const OAUTH_ACCESS_TOKEN = `${OAUTH_PREFIX}${randomUUID()}`;
export const OAUTH_REFRESH_TOKEN = `refresh-${randomUUID()}`;
export const REFRESHED_ACCESS_TOKEN = `${OAUTH_PREFIX}${randomUUID()}`;
export const REFRESHED_REFRESH_TOKEN = `refresh-${randomUUID()}`;

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
