import type { OAuthCredentials } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { OAUTH_CONFIG } from './config.ts';

export type TokenGrant = Readonly<Record<string, string | undefined>>;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
});

async function postToken(grant: TokenGrant, failure: string, signal?: AbortSignal): Promise<Response> {
  try {
    const response = await fetch(OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(grant),
      ...(signal ? { signal } : {}),
    });
    return response;
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
  try {
    const token = tokenResponseSchema.parse(await response.json());
    return token;
  } catch (error) {
    console.error(`${failure}: unexpected token response`, error);
    throw new Error(`${failure}: Anthropic returned an unexpected token response.`, { cause: error });
  }
}

export async function requestToken(grant: TokenGrant, failure: string, signal?: AbortSignal): Promise<OAuthCredentials> {
  const token = await readToken(await postToken(grant, failure, signal), failure);
  return {
    refresh: token.refresh_token,
    access: token.access_token,
    expires: Date.now() + token.expires_in * OAUTH_CONFIG.secondsToMs - OAUTH_CONFIG.expirySkewMs,
  };
}
