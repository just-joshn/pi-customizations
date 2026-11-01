import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

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
export const CLAUDE_LOOPBACK_CALLBACK_PATH = '/callback';

const LOOPBACK_BIND_HOST = '127.0.0.1';
/** Anthropic's authorize redirect_uri expects localhost, not the bind address. */
const LOOPBACK_REDIRECT_HOST = 'localhost';

export const LOGIN_CANCELLED = 'Login cancelled';
export const LOGIN_TIMED_OUT = 'Login timed out';

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
const LOOPBACK_LIMIT_MS = 15 * 60 * 1000;
const CALLBACK_REJECTED = 'Claude OAuth callback was rejected';

type ClaudeLoginMethod = 'copy-code' | 'loopback' | 'import';

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

async function exchangeAuthorizationCode(
  input: { code: string; state: string; redirectUri: string; verifier: string },
  signal: AbortSignal,
): Promise<OAuthCredential> {
  const token = await postToken(
    {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      code_verifier: input.verifier,
      state: input.state,
    },
    signal,
  );
  return credentialFrom(token);
}

async function chooseLoginMethod(interaction: ProviderAuthInteraction): Promise<ClaudeLoginMethod> {
  const method = await interaction.prompt({
    type: 'select',
    message: 'Sign in to Claude subscription',
    options: [
      {
        id: 'copy-code',
        label: 'Paste code',
        description: 'Default. Complete login in the browser, then paste the code.',
      },
      {
        id: 'loopback',
        label: 'Browser callback',
        description: 'Uses a localhost callback when the browser can reach this machine.',
      },
      {
        id: 'import',
        label: 'Import from Claude Code',
        description: 'Copy an existing Claude Code keychain or .credentials.json session into Pi auth.json.',
      },
    ],
  });
  if (method === 'copy-code' || method === 'loopback' || method === 'import') return method;
  throw new Error(LOGIN_CANCELLED);
}

async function loginCopyCode(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
  const { verifier, challenge, state } = createPkcePair();
  const redirectUri = CLAUDE_COPY_CODE_REDIRECT_URI;
  const url = buildAuthorizeUrl({ challenge, state, redirectUri });
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
  return exchangeAuthorizationCode(
    { code: parsed.code, state: parsed.state ?? state, redirectUri, verifier },
    interaction.signal,
  );
}

async function loginLoopback(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
  const { verifier, challenge, state } = createPkcePair();
  const callback = await listenForCallback(state, interaction.signal);
  try {
    const url = buildAuthorizeUrl({ challenge, state, redirectUri: callback.redirectUri });
    interaction.notify({
      type: 'auth_url',
      url,
      instructions: 'Approve access in the browser. Pi listens on localhost for the callback.',
    });
    const code = await callback.code;
    interaction.notify({ type: 'progress', message: 'Exchanging authorization code for tokens...' });
    return exchangeAuthorizationCode(
      { code, state, redirectUri: callback.redirectUri, verifier },
      interaction.signal,
    );
  } finally {
    await callback.close();
  }
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/** Typed stand-in for Promise.withResolvers (ES2024); repo lib is ES2023. */
function deferredString(): {
  promise: Promise<string>;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function listenForCallback(
  expectedState: string,
  signal: AbortSignal,
): Promise<{ redirectUri: string; code: Promise<string>; close: () => Promise<void> }> {
  signal.throwIfAborted();
  const server = createServer();
  const { promise: code, resolve: settle, reject: fail } = deferredString();
  const timeout = setTimeout(() => fail(new Error(LOGIN_TIMED_OUT)), LOOPBACK_LIMIT_MS);
  const onAbort = () => fail(new Error(LOGIN_CANCELLED));
  signal.addEventListener('abort', onAbort, { once: true });
  server.on('request', (request, response) => handleCallback(request, response, expectedState, settle, fail));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK_BIND_HOST, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Login callback could not bind'));
        return;
      }
      resolve({
        redirectUri: `http://${LOOPBACK_REDIRECT_HOST}:${address.port}${CLAUDE_LOOPBACK_CALLBACK_PATH}`,
        code,
        close: () => closeServer(server, timeout, signal, onAbort),
      });
    });
  });
}

function handleCallback(
  request: IncomingMessage,
  response: ServerResponse,
  expectedState: string,
  settle: (code: string) => void,
  fail: (error: Error) => void,
): void {
  const url = new URL(request.url ?? '/', `http://${LOOPBACK_REDIRECT_HOST}`);
  if (url.pathname !== CLAUDE_LOOPBACK_CALLBACK_PATH) {
    response.writeHead(404).end();
    return;
  }
  const denial = url.searchParams.get('error');
  if (denial) {
    const description = url.searchParams.get('error_description');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Access denied</title><h1>Access denied</h1><p>Close this window and try again.</p>');
    fail(new Error(`${CALLBACK_REJECTED}: ${denial}${description ? `: ${description}` : ''}`));
    return;
  }
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (!sameSecret(state, expectedState) || code.length === 0) {
    response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Sign-in failed</title><p>Sign-in failed. Return to Pi and try again.</p>');
    fail(new Error(CALLBACK_REJECTED));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>Signed in</title><p>Signed in. You can close this tab.</p>');
  settle(code);
}

function closeServer(
  server: ReturnType<typeof createServer>,
  timeout: ReturnType<typeof setTimeout>,
  signal: AbortSignal,
  onAbort: () => void,
): Promise<void> {
  clearTimeout(timeout);
  signal.removeEventListener('abort', onAbort);
  return new Promise((resolve) => server.close(() => resolve()));
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
      const method = await chooseLoginMethod(interaction);
      interaction.signal.throwIfAborted();
      if (method === 'import') return loginImport(interaction, importCredentials);
      if (method === 'loopback') return loginLoopback(interaction);
      return loginCopyCode(interaction);
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
