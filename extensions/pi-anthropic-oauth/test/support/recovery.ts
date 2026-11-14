import type { OAuthCredential } from '@earendil-works/pi-ai';
import type { StoredCredential } from '../../src/stored-credential.ts';

/** A recovery with no rotation log: no credential has a recorded successor. */
export const noRotationLog = async (credential: OAuthCredential): Promise<OAuthCredential> => credential;

/** A host whose credentials this provider cannot read, so a logout reaches it only at the next auth resolution. */
export const hostStoreUnavailable = (): StoredCredential => ({ kind: 'unavailable' });
