import { randomUUID } from 'node:crypto';

import { InMemoryCredentialStore, type OAuthCredential } from '@earendil-works/pi-ai';
import { PROVIDER_ID } from '../../src/catalog.ts';

const ONE_HOUR_MS = 60 * 60 * 1000;

export function oauthCredential(): OAuthCredential {
  return { type: 'oauth', access: randomUUID(), refresh: randomUUID(), expires: Date.now() + ONE_HOUR_MS };
}

export async function storeWith(credential: OAuthCredential): Promise<InMemoryCredentialStore> {
  const store = new InMemoryCredentialStore();
  await store.modify(PROVIDER_ID, async () => credential);
  return store;
}
