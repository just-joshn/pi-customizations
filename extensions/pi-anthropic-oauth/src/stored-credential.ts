import { existsSync } from 'node:fs';

import type { OAuthCredential } from '@earendil-works/pi-ai';
import { readStoredCredential } from '@earendil-works/pi-coding-agent';

/** What the host has stored for the provider. `unavailable` means the host keeps credentials somewhere this provider cannot read. */
export type StoredCredential = { readonly kind: 'unavailable' } | { readonly kind: 'none' } | { readonly kind: 'oauth'; readonly credential: OAuthCredential };

/** The provider's entry in an auth.json. A host with no auth.json keeps credentials elsewhere, so it says nothing about a logout. */
export function storedIn(providerId: string, authPath: string | undefined): StoredCredential {
  if (authPath === undefined || !existsSync(authPath)) return { kind: 'unavailable' };
  const stored = readStoredCredential(providerId, authPath);
  return stored?.type === 'oauth' ? { kind: 'oauth', credential: stored } : { kind: 'none' };
}

export function storedOAuth(stored: StoredCredential): OAuthCredential | undefined {
  return stored.kind === 'oauth' ? stored.credential : undefined;
}

export function sameStored(a: StoredCredential, b: StoredCredential): boolean {
  switch (a.kind) {
    case 'unavailable':
    case 'none':
      return b.kind === a.kind;
    case 'oauth':
      return b.kind === 'oauth' && b.credential.access === a.credential.access;
    default: {
      const _exhaustive: never = a;
      return _exhaustive;
    }
  }
}
