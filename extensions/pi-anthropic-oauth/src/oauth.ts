import { createHash, randomBytes } from 'node:crypto';

import type { LoginOptions, OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';

import { importClaudeAiOauth } from './claude-credentials.ts';

/** Claude Code 2.1.312 cai authorize origin and path. */
export const CLAUDE_AUTHORIZE_ORIGIN = 'https://claude.com';
export const CLAUDE_AUTHORIZE_PATH = '/cai/oauth/authorize';
export const CLAUDE_AUTHORIZE_URL = `${CLAUDE_AUTHORIZE_ORIGIN}${CLAUDE_AUTHORIZE_PATH}`;

/** Prod CLIENT_ID from Claude Code config. */
export const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

/** Login scopes from gto() including user:plugins. */
export const CLAUDE_LOGIN_SCOPES = [
  'org:create_api_key',
  'user:profile',
  'user:inference',
  'user:sessions:claude_code',
  'user:mcp_servers',
  'user:file_upload',
  'user:plugins',
] as const;

/** Refresh scopes from Zxt(); omits org:create_api_key. */
export const CLAUDE_REFRESH_SCOPES = [
  'user:profile',
  'user:inference',
  'user:sessions:claude_code',
  'user:mcp_servers',
  'user:file_upload',
  'user:plugins',
] as const;

export const CLAUDE_OAUTH_SCOPES = CLAUDE_LOGIN_SCOPES.join(' ');
export const CLAUDE_REFRESH_SCOPE = CLAUDE_REFRESH_SCOPES.join(' ');

export const CLAUDE_COPY_CODE_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
export const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';

/** Append order from Claude Y9r for the standard cai login. */
export const CLAUDE_AUTHORIZE_QUERY_ORDER = [
  'code',
  'client_id',
  'response_type',
  'redirect_uri',
  'scope',
  'code_challenge',
  'code_challenge_method',
  'state',
] as const;

const TOKEN_TIMEOUT_MS = 30_000;

function base64url(bytes: Buffer): string {
  return bytes.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function randomToken(): string {
  return base64url(randomBytes(32));
}

function pkceChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function createPkcePair(): { verifier: string; challenge: string; state: string } {
  const verifier = randomToken();
  return { verifier, challenge: pkceChallenge(verifier), state: randomToken() };
}

/** Builds the cai authorize URL with Claude's append order and encoding. */
export function buildAuthorizeUrl(input: { challenge: string; state: string; redirectUri?: string }): string {
  const params = new URLSearchParams();
  params.append('code', 'true');
  params.append('client_id', CLAUDE_OAUTH_CLIENT_ID);
  params.append('response_type', 'code');
  params.append('redirect_uri', input.redirectUri ?? CLAUDE_COPY_CODE_REDIRECT_URI);
  params.append('scope', CLAUDE_OAUTH_SCOPES);
  params.append('code_challenge', input.challenge);
  params.append('code_challenge_method', 'S256');
  params.append('state', input.state);
  return `${CLAUDE_AUTHORIZE_URL}?${params.toString()}`;
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    return {
      ...(code !== null ? { code } : {}),
      ...(state !== null ? { state } : {}),
    };
  } catch {
  }
  if (value.includes('#')) {
    const [code, state] = value.split('#', 2);
    return {
      ...(code !== undefined && code !== '' ? { code } : {}),
      ...(state !== undefined && state !== '' ? { state } : {}),
    };
  }
  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    const code = params.get('code');
    const state = params.get('state');
    return {
      ...(code !== null ? { code } : {}),
      ...(state !== null ? { state } : {}),
    };
  }
  return { code: value };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function postToken(body: Record<string, string>, signal: AbortSignal): Promise<TokenResponse> {
  const response = await fetch(CLAUDE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(TOKEN_TIMEOUT_MS)]),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP request failed. status=${response.status}; url=${CLAUDE_TOKEN_URL}`);
  }
  let data: Partial<TokenResponse>;
  try {
    data = JSON.parse(text) as Partial<TokenResponse>;
  } catch {
    throw new Error(`Token endpoint returned invalid JSON. url=${CLAUDE_TOKEN_URL}`);
  }
  if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
    throw new Error('Token endpoint response lacks an access token');
  }
  return data as TokenResponse;
}

/** Claude stores absolute expiry. Pi's resolver still refreshes about five minutes early. */
function expiresAt(expiresIn: number): number {
  return Date.now() + expiresIn * 1000;
}

function credentialFrom(token: TokenResponse, refreshFallback?: string): OAuthCredential {
  const refresh = token.refresh_token ?? refreshFallback;
  if (!refresh) throw new Error('Token endpoint returned no refresh token');
  return {
    type: 'oauth',
    access: token.access_token,
    refresh,
    expires: expiresAt(token.expires_in),
  };
}

async function loginCopyCode(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
  const { verifier, challenge, state } = createPkcePair();
  const url = buildAuthorizeUrl({ challenge, state });
  interaction.notify({
    type: 'auth_url',
    url,
    instructions: 'Complete login in your browser, then copy the code Anthropic shows and paste it here.',
  });
  const input = await interaction.prompt({
    type: 'manual_code',
    message: 'Paste the code Anthropic shows after you sign in:',
    placeholder: 'code#state',
    signal: interaction.signal,
  });
  const parsed = parseAuthorizationInput(input);
  if (parsed.state && parsed.state !== state) throw new Error('OAuth state mismatch');
  if (!parsed.code) throw new Error('Missing authorization code');
  interaction.notify({ type: 'progress', message: 'Exchanging authorization code for tokens...' });
  const token = await postToken(
    {
      grant_type: 'authorization_code',
      code: parsed.code,
      redirect_uri: CLAUDE_COPY_CODE_REDIRECT_URI,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      code_verifier: verifier,
      state: parsed.state ?? state,
    },
    interaction.signal,
  );
  return credentialFrom(token);
}

export type ClaudeOAuthOptions = {
  /** Override for tests. Defaults to reading Claude Code keychain / `.credentials.json`. */
  importCredentials?: () => Promise<OAuthCredential>;
};

async function loginImport(
  interaction: ProviderAuthInteraction,
  importCredentials: () => Promise<OAuthCredential>,
): Promise<OAuthCredential> {
  interaction.notify({
    type: 'progress',
    message: 'Importing Claude Code credentials into Pi auth storage...',
  });
  return importCredentials();
}

export function createClaudeOAuth(options: ClaudeOAuthOptions = {}): OAuthAuth {
  const importCredentials = options.importCredentials ?? (() => importClaudeAiOauth());
  return {
    name: 'Claude subscription (Provider CLI)',
    loginLabel: 'Claude subscription (Provider CLI)',
    isSubscription: true,
    login: async (interaction, _options?: LoginOptions) => {
      interaction.signal.throwIfAborted();
      const method = await interaction.prompt({
        type: 'select',
        message: 'Claude subscription login',
        options: [
          {
            id: 'paste',
            label: 'Paste code',
            description: 'Sign in in the browser, then paste the code Anthropic shows.',
          },
          {
            id: 'import',
            label: 'Import from Claude Code',
            description: 'Copy an existing Claude Code keychain or .credentials.json session into Pi auth.json.',
          },
        ],
      });
      interaction.signal.throwIfAborted();
      if (method === 'import') return loginImport(interaction, importCredentials);
      if (method === 'paste') return loginCopyCode(interaction);
      throw new Error('Login cancelled');
    },
    refresh: async (credential, signal) => {
      signal.throwIfAborted();
      const token = await postToken(
        {
          grant_type: 'refresh_token',
          refresh_token: credential.refresh,
          client_id: CLAUDE_OAUTH_CLIENT_ID,
          scope: CLAUDE_REFRESH_SCOPE,
        },
        signal,
      );
      return credentialFrom(token, credential.refresh);
    },
    async toAuth(credential) {
      return { apiKey: credential.access };
    },
  };
}
