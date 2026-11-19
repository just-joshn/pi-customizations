import { OAUTH_CONFIG } from './config.ts';

export type Pkce = {
  readonly verifier: string;
  readonly challenge: string;
};

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export async function generatePkce(): Promise<Pkce> {
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(OAUTH_CONFIG.pkceVerifierBytes)));
  const hash = await crypto.subtle.digest(OAUTH_CONFIG.pkceDigest, new TextEncoder().encode(verifier));
  return { verifier, challenge: toBase64Url(new Uint8Array(hash)) };
}
