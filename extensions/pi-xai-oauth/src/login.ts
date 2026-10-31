import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';

export const GROK_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const GROK_OAUTH_SCOPE = 'openid profile email offline_access grok-cli:access api:access conversations:read conversations:write workspaces:read workspaces:write';
/** Grok 1.0.70 sends this on the browser authorize request. */
const GROK_OAUTH_REFERRER = 'grok-build';

const AUTHORIZE_URL = 'https://auth.x.ai/oauth2/authorize';
/** Pi refreshes a stored token this early, so a first login must expire this early too. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const TOKEN_URL = 'https://auth.x.ai/oauth2/token';
const DEVICE_URL = 'https://auth.x.ai/oauth2/device/code';
const CALLBACK_PATH = '/callback';
const CALLBACK_REJECTED = 'xAI OAuth callback was rejected';
const DEVICE_HOST = 'accounts.x.ai';
const BROWSER_LIMIT_MS = 15 * 60 * 1000;

type TokenResponse = { access: string; refresh: string; expiresIn: number };

/** Byte-for-byte the query Grok 1.0.70 prints, including parameter order and %20 scope separators. */
export function authorizeUrl(input: { redirectUri: string; challenge: string; state: string; nonce: string }): string {
  const pairs: readonly (readonly [string, string])[] = [
    ['response_type', 'code'],
    ['client_id', GROK_OAUTH_CLIENT_ID],
    ['redirect_uri', input.redirectUri],
    ['scope', GROK_OAUTH_SCOPE],
    ['code_challenge', input.challenge],
    ['code_challenge_method', 'S256'],
    ['state', input.state],
    ['nonce', input.nonce],
    ['referrer', GROK_OAUTH_REFERRER],
  ];
  return `${AUTHORIZE_URL}?${pairs.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&')}`;
}

export async function loginGrokBuild(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
  throwIfCancelled(interaction.signal);
  const method = await interaction.prompt({
    type: 'select',
    message: 'Sign in to Grok Build',
    options: [
      { id: 'browser', label: 'Browser', description: "Opens auth.x.ai. This is Grok Build's default." },
      { id: 'device', label: 'Device code', description: 'For a remote or headless machine.' },
    ],
  });
  throwIfCancelled(interaction.signal);
  if (method === 'device') return deviceLogin(interaction);
  if (method === 'browser') return browserLogin(interaction);
  throw new Error('Login cancelled');
}

async function browserLogin(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
  const { verifier, challenge } = await createPkce();
  const state = randomUUID();
  const nonce = randomUUID();
  const callback = await listenForCallback(state, interaction.signal);
  try {
    interaction.notify({
      type: 'auth_url',
      url: authorizeUrl({ redirectUri: callback.redirectUri, challenge, state, nonce }),
      instructions: 'Approve access in the browser. If it cannot reach this machine, paste the redirect URL.',
    });
    const promptAbort = new AbortController();
    const stopPrompt = () => promptAbort.abort();
    interaction.signal.addEventListener('abort', stopPrompt, { once: true });
    const pasted = interaction
      .prompt({ type: 'manual_code', message: 'Paste the redirect URL', signal: promptAbort.signal })
      .then((value) => parsePastedCode(value, state))
      .catch((error: unknown) => {
        if (promptAbort.signal.aborted || interaction.signal.aborted) return undefined;
        throw error;
      });
    void callback.code.catch(() => undefined);
    void pasted.catch(() => undefined);
    const code = await Promise.race([callback.code, pasted]);
    promptAbort.abort();
    interaction.signal.removeEventListener('abort', stopPrompt);
    if (!code) throw new Error('Login cancelled');
    return credentialFrom(await exchangeCode(code, callback.redirectUri, verifier, interaction.signal));
  } finally {
    await callback.close();
  }
}

async function deviceLogin(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
  const started = await postForm(DEVICE_URL, { client_id: GROK_OAUTH_CLIENT_ID, scope: GROK_OAUTH_SCOPE }, interaction.signal);
  if (!started.ok) throw tokenError('device authorization', started.status, started.body);
  const device = deviceFrom(started.body);
  interaction.notify({
    type: 'device_code',
    userCode: device.userCode,
    verificationUri: device.verificationUri,
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: device.expiresIn,
  });
  const deadline = Date.now() + device.expiresIn * 1000;
  let interval = device.intervalSeconds;
  while (Date.now() < deadline) {
    throwIfCancelled(interaction.signal);
    const polled = await postForm(TOKEN_URL, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: GROK_OAUTH_CLIENT_ID, device_code: device.deviceCode }, interaction.signal);
    const outcome = pollOutcome(polled.status, polled.body);
    if (outcome === 'complete') return credentialFrom(tokensFrom(polled.body));
    if (outcome === 'failed') throw tokenError('device token polling', polled.status, polled.body);
    interval = outcome === 'slow_down' ? interval + 5 : Math.max(interval, 1);
    await sleep(interval * 1000, interaction.signal);
  }
  throw new Error('xAI device code expired');
}

function deviceFrom(body: unknown): { deviceCode: string; userCode: string; verificationUri: string; intervalSeconds: number; expiresIn: number } {
  const record = recordOf(body);
  const deviceCode = requiredString(record, 'device_code');
  const userCode = requiredString(record, 'user_code');
  const verificationUri = trustedDeviceUri(requiredString(record, 'verification_uri'));
  const expiresIn = requiredPositive(record, 'expires_in');
  const interval = record['interval'];
  const intervalSeconds = typeof interval === 'number' && Number.isFinite(interval) && interval > 0 ? interval : 0;
  return { deviceCode, userCode, verificationUri, intervalSeconds, expiresIn };
}

function trustedDeviceUri(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Untrusted verification URI');
  }
  if (url.protocol !== 'https:' || url.hostname !== DEVICE_HOST) throw new Error('Untrusted verification URI');
  return url.href;
}

async function exchangeCode(code: string, redirectUri: string, verifier: string, signal: AbortSignal): Promise<TokenResponse> {
  const response = await postForm(TOKEN_URL, { grant_type: 'authorization_code', client_id: GROK_OAUTH_CLIENT_ID, code, redirect_uri: redirectUri, code_verifier: verifier }, signal);
  if (!response.ok) throw tokenError('token exchange', response.status, response.body);
  return tokensFrom(response.body);
}

function tokensFrom(body: unknown): TokenResponse {
  const record = recordOf(body);
  return { access: requiredString(record, 'access_token'), refresh: requiredString(record, 'refresh_token'), expiresIn: requiredPositive(record, 'expires_in') };
}

function credentialFrom(tokens: TokenResponse): OAuthCredential {
  return { type: 'oauth', access: tokens.access, refresh: tokens.refresh, expires: Date.now() + tokens.expiresIn * 1000 - REFRESH_SKEW_MS };
}

function pollOutcome(status: number, body: unknown): 'complete' | 'pending' | 'slow_down' | 'failed' {
  const record = recordOf(body);
  const error = typeof record['error'] === 'string' ? record['error'] : undefined;
  if (!error && status >= 200 && status < 300) return 'complete';
  if (error === 'authorization_pending') return 'pending';
  if (error === 'slow_down') return 'slow_down';
  return 'failed';
}

async function postForm(url: string, fields: Record<string, string>, signal: AbortSignal): Promise<{ ok: boolean; status: number; body: unknown }> {
  throwIfCancelled(signal);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
      redirect: 'error',
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new Error('Login cancelled');
    throw error;
  }
  const body = await response.json().catch(() => undefined);
  if (signal.aborted) throw new Error('Login cancelled');
  return { ok: response.ok, status: response.status, body };
}

function listenForCallback(expectedState: string, signal: AbortSignal): Promise<{ redirectUri: string; code: Promise<string>; close: () => Promise<void> }> {
  throwIfCancelled(signal);
  const server = createServer();
  let settle: (code: string) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const code = new Promise<string>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const timeout = setTimeout(() => fail(new Error('Login cancelled')), BROWSER_LIMIT_MS);
  const onAbort = () => fail(new Error('Login cancelled'));
  signal.addEventListener('abort', onAbort, { once: true });
  server.on('request', (request, response) => handleCallback(request, response, expectedState, settle, fail));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Login callback could not bind'));
        return;
      }
      resolve({
        redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
        code,
        close: () => closeServer(server, timeout, signal, onAbort),
      });
    });
  });
}

function handleCallback(request: IncomingMessage, response: ServerResponse, expectedState: string, settle: (code: string) => void, fail: (error: Error) => void): void {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== CALLBACK_PATH) {
    response.writeHead(404).end();
    return;
  }
  const denial = rejectionError(url.searchParams);
  if (denial !== undefined) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Access denied</title><h1>Access denied</h1><p>Close this window and try again.</p>');
    fail(new Error(denial));
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

function parsePastedCode(value: string, expectedState: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Paste the redirect URL');
  }
  const denial = rejectionError(url.searchParams);
  if (denial !== undefined) throw new Error(denial);
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  if (!sameSecret(state, expectedState) || code.length === 0) throw new Error(CALLBACK_REJECTED);
  return code;
}

/** RFC 6749 section 4.1.2.1 puts the reason the server refused in these query parameters. */
function rejectionError(params: URLSearchParams): string | undefined {
  const error = params.get('error');
  if (!error) return undefined;
  const description = params.get('error_description');
  return `${CALLBACK_REJECTED}: ${error}${description ? `: ${description}` : ''}`;
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomBytes(32).toString('base64url');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: Buffer.from(digest).toString('base64url') };
}

function tokenError(action: string, status: number, body: unknown): Error {
  const record = recordOf(body);
  const error = typeof record['error'] === 'string' ? record['error'] : undefined;
  return new Error(`xAI OAuth ${action} failed (HTTP ${status})${error ? `: ${error}` : ''}`);
}

function recordOf(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid xAI OAuth response field: ${field}`);
  return value;
}

function requiredPositive(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`Invalid xAI OAuth response field: ${field}`);
  return value;
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Login cancelled');
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  throwIfCancelled(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Login cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function closeServer(server: ReturnType<typeof createServer>, timeout: ReturnType<typeof setTimeout>, signal: AbortSignal, onAbort: () => void): Promise<void> {
  clearTimeout(timeout);
  signal.removeEventListener('abort', onAbort);
  return new Promise((resolve) => server.close(() => resolve()));
}
