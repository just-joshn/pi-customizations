import { webcrypto } from 'node:crypto';

import type { OAuthCredentials, OAuthLoginCallbacks } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { parseOrThrow } from '../validation.ts';
import { OAUTH_CONFIG } from './config.ts';

type Pkce = {
  readonly verifier: string;
  readonly challenge: string;
};

type TokenGrant = Readonly<Record<string, string | undefined>>;

const authorizationCodeSchema = z.string().trim().min(1);

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function generatePkce(): Promise<Pkce> {
  const verifier = toBase64Url(webcrypto.getRandomValues(new Uint8Array(OAUTH_CONFIG.pkceVerifierBytes)));
  const hash = await webcrypto.subtle.digest(OAUTH_CONFIG.pkceDigest, new TextEncoder().encode(verifier));
  return { verifier, challenge: toBase64Url(new Uint8Array(hash)) };
}

function buildAuthorizeUrl(pkce: Pkce): string {
  const params = new URLSearchParams({
    code: 'true',
    client_id: OAUTH_CONFIG.clientId,
    response_type: 'code',
    redirect_uri: OAUTH_CONFIG.redirectUri,
    scope: OAUTH_CONFIG.scopes,
    code_challenge: pkce.challenge,
    code_challenge_method: OAUTH_CONFIG.pkceMethod,
    state: pkce.verifier,
  });
  return `${OAUTH_CONFIG.authorizeUrl}?${params.toString()}`;
}

function parseAuthorizationCode(input: string): { readonly code: string; readonly state: string | undefined } {
  const pasted = parseOrThrow(authorizationCodeSchema, input, 'Paste the authorization code shown after you sign in to Claude.');
  const [code = '', state] = pasted.split(OAUTH_CONFIG.codeStateSeparator);
  return { code, state };
}

async function postToken(grant: TokenGrant, failure: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(grant),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    console.error(`${failure}: token request did not complete`, error);
    throw new Error(`${failure}: could not reach Anthropic. Check your connection and try again.`, { cause: error });
  }
}

async function readToken(response: Response, failure: string): Promise<z.infer<typeof tokenResponseSchema>> {
  if (!response.ok) {
    const detail = await response.text();
    console.error(`${failure}: Anthropic answered ${response.status}`, detail);
    throw new Error(`${failure}: ${detail}`);
  }
  // A body that is not JSON reaches the schema as undefined and fails with the same message as a body with the wrong fields.
  const body = await response.json().catch(() => undefined);
  return parseOrThrow(tokenResponseSchema, body, `${failure}: Anthropic returned an unexpected token response.`);
}

async function requestToken(grant: TokenGrant, failure: string, signal?: AbortSignal): Promise<OAuthCredentials> {
  const token = await readToken(await postToken(grant, failure, signal), failure);
  return {
    refresh: token.refresh_token,
    access: token.access_token,
    expires: Date.now() + token.expires_in * OAUTH_CONFIG.secondsToMs - OAUTH_CONFIG.expirySkewMs,
  };
}

export async function loginAnthropic(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const pkce = await generatePkce();
  callbacks.onAuth({ url: buildAuthorizeUrl(pkce) });
  const { code, state } = parseAuthorizationCode(await callbacks.onPrompt({ message: OAUTH_CONFIG.codePrompt }));
  const grant = {
    grant_type: 'authorization_code',
    client_id: OAUTH_CONFIG.clientId,
    code,
    state,
    redirect_uri: OAUTH_CONFIG.redirectUri,
    code_verifier: pkce.verifier,
  };
  return requestToken(grant, 'Token exchange failed');
}

export function refreshAnthropicToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials> {
  const grant = { grant_type: 'refresh_token', client_id: OAUTH_CONFIG.clientId, refresh_token: credentials.refresh };
  return requestToken(grant, 'Token refresh failed', signal);
}
