import { randomUUID } from 'node:crypto';

import { InMemoryCredentialStore, type OAuthCredential } from '@earendil-works/pi-ai';
import { PROVIDER_ID } from '../../src/catalog.ts';

const FAR_FUTURE = Date.UTC(2100, 0, 1);

export function oauthCredential(): OAuthCredential {
  return { type: 'oauth', access: randomUUID(), refresh: randomUUID(), expires: FAR_FUTURE };
}

export async function storeWith(credential: OAuthCredential): Promise<InMemoryCredentialStore> {
  const store = new InMemoryCredentialStore();
  await store.modify(PROVIDER_ID, async () => credential);
  return store;
}
