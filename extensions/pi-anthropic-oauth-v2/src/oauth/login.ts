import type { OAuthCredentials, OAuthLoginCallbacks } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { OAUTH_CONFIG } from './config.ts';
import { generatePkce, type Pkce } from './pkce.ts';
import { requestToken } from './token.ts';

type AuthorizationCode = {
  readonly code: string;
  readonly state: string | undefined;
};

const authorizationCodeSchema = z.string().trim().min(1);

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

function parseAuthorizationCode(input: string): AuthorizationCode {
  try {
    const [code = '', state] = authorizationCodeSchema.parse(input).split(OAUTH_CONFIG.codeStateSeparator);
    return { code, state };
  } catch (error) {
    console.error('Authorization code validation failed:', error);
    throw new Error('Paste the authorization code shown after you sign in to Claude.', { cause: error });
  }
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
