import { readFileSync } from 'node:fs';

import type { AuthEvent, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { expect, vi } from 'vitest';
import { authorizeUrl, GROK_OAUTH_SCOPE, loginGrokBuild } from '../src/login.ts';
import { test } from './network-guard.ts';

const TOKEN = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_in: 21600,
};

const CAPTURE = JSON.parse(readFileSync(new URL('./fixtures/grok-1.0.50-authorize-url.json', import.meta.url), 'utf8')) as {
  readonly authorizeUrl: string;
};

function deviceStart(overrides: Record<string, unknown> = {}) {
  return { device_code: 'device', user_code: 'CODE-CODE', verification_uri: 'https://accounts.x.ai/oauth2/device', expires_in: 30, interval: 0, ...overrides };
}

function interaction(select: 'browser' | 'device', manual?: string) {
  const events: AuthEvent[] = [];
  const controller = new AbortController();
  const prompts: string[] = [];
  const login: ProviderAuthInteraction = {
    signal: controller.signal,
    notify(event) {
      events.push(event);
    },
    prompt: async (prompt) => {
      prompts.push(prompt.type);
      if (prompt.type === 'select') return select;
      if (manual !== undefined) return manual;
      return new Promise<string>(() => undefined);
    },
  };
  return { login, events, controller, prompts };
}

function tokenFetch(handler: (url: string, body: URLSearchParams) => unknown) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const loopback = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) return loopback(input, init);
    const body = new URLSearchParams(String(init?.body ?? ''));
    calls.push({ url, body });
    const result = handler(url, body);
    if (result instanceof Response) return result;
    return Response.json(result);
  });
  return calls;
}

test('the authorize URL matches the captured Grok 1.0.50 request byte for byte', () => {
  const captured = new URL(CAPTURE.authorizeUrl);
  const url = authorizeUrl({
    redirectUri: captured.searchParams.get('redirect_uri') ?? '',
    challenge: captured.searchParams.get('code_challenge') ?? '',
    state: captured.searchParams.get('state') ?? '',
    nonce: captured.searchParams.get('nonce') ?? '',
  });
  expect(url).toBe(CAPTURE.authorizeUrl);
  expect(GROK_OAUTH_SCOPE).toContain('conversations:read');
});

test('browser login exchanges the callback code and does not leak the token', async () => {
  tokenFetch((url) => {
    expect(url).toBe('https://auth.x.ai/oauth2/token');
    return TOKEN;
  });
  const { login, events } = interaction('browser');
  const pending = loginGrokBuild(login);
  const url = await waitForUrl(events);
  const authorize = new URL(url);
  const redirect = new URL(authorize.searchParams.get('redirect_uri') ?? '');
  redirect.searchParams.set('code', 'auth-code');
  redirect.searchParams.set('state', authorize.searchParams.get('state') ?? '');
  await fetch(redirect);
  const credential = await pending;
  expect(credential.access).toBe('access-token');
  expect(credential.refresh).toBe('refresh-token');
  expect(credential.expires).toBeGreaterThan(Date.now());
  expect(JSON.stringify(events)).not.toContain('access-token');
});

test('a pasted redirect URL completes browser login', async () => {
  const calls = tokenFetch(() => TOKEN);
  let pasted = '';
  let providePaste: (value: string) => void = () => undefined;
  const paste = new Promise<string>((resolve) => {
    providePaste = resolve;
  });
  const { login, events } = interaction('browser');
  login.prompt = async (prompt) => (prompt.type === 'select' ? 'browser' : paste);
  const pending = loginGrokBuild(login);
  const authorize = new URL(await waitForUrl(events));
  const redirect = new URL(authorize.searchParams.get('redirect_uri') ?? '');
  redirect.searchParams.set('code', 'pasted-code');
  redirect.searchParams.set('state', authorize.searchParams.get('state') ?? '');
  pasted = redirect.href;
  providePaste(pasted);
  const credential = await pending;
  expect(credential.refresh).toBe('refresh-token');
  expect(calls.at(-1)?.body.get('code')).toBe('pasted-code');
});

test('device login polls until the token endpoint completes', async () => {
  let polls = 0;
  const calls = tokenFetch((url) => {
    if (url.endsWith('/device/code')) {
      return { device_code: 'device', user_code: 'CODE-CODE', verification_uri: 'https://accounts.x.ai/oauth2/device', expires_in: 30, interval: 0 };
    }
    polls += 1;
    return polls < 2 ? { error: 'authorization_pending' } : TOKEN;
  });
  const { login, events } = interaction('device');
  const credential = await loginGrokBuild(login);
  expect(credential.access).toBe('access-token');
  expect(events).toContainEqual(expect.objectContaining({ type: 'device_code', verificationUri: 'https://accounts.x.ai/oauth2/device', userCode: 'CODE-CODE' }));
  expect(calls.some((call) => call.body.get('scope') === GROK_OAUTH_SCOPE)).toBe(true);
});

test('a fresh login expires five minutes before the server expiry', async () => {
  vi.useFakeTimers();
  const now = Date.UTC(2026, 9, 12, 12, 0, 0);
  vi.setSystemTime(now);
  tokenFetch((url) => (url.endsWith('/device/code') ? deviceStart() : TOKEN));
  const { login } = interaction('device');
  const credential = await loginGrokBuild(login);
  expect(credential.expires).toBe(now + 21600 * 1000 - 300000);
});

test('a device login without an interval polls immediately', async () => {
  const calls = tokenFetch((url) => (url.endsWith('/device/code') ? deviceStart({ interval: undefined }) : TOKEN));
  const { login, events } = interaction('device');
  const credential = await loginGrokBuild(login);
  expect(credential.access).toBe('access-token');
  expect(events).toContainEqual(expect.objectContaining({ type: 'device_code', intervalSeconds: 0 }));
  expect(calls.filter((call) => call.url.endsWith('/device/code'))).toHaveLength(1);
});

test('a slow_down response waits five more seconds before the next poll', async () => {
  vi.useFakeTimers();
  let polls = 0;
  tokenFetch((url) => {
    if (url.endsWith('/device/code')) return deviceStart();
    polls += 1;
    return polls === 1 ? { error: 'slow_down' } : TOKEN;
  });
  const { login } = interaction('device');
  const pending = loginGrokBuild(login);
  await vi.advanceTimersByTimeAsync(0);
  expect(polls).toBe(1);
  await vi.advanceTimersByTimeAsync(4999);
  expect(polls).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).resolves.toMatchObject({ access: 'access-token' });
});

test.for([
  { name: 'an OAuth error code', body: { error: 'invalid_scope', access_token: 'secret-token' }, message: 'xAI OAuth device authorization failed (HTTP 400): invalid_scope' },
  { name: 'no OAuth error code', body: {}, message: 'xAI OAuth device authorization failed (HTTP 400)' },
])('a rejected device authorization reports $name and keeps the body out', async ({ body, message }) => {
  tokenFetch(() => new Response(JSON.stringify(body), { status: 400 }));
  const { login } = interaction('device');
  const error = await loginGrokBuild(login).catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(message);
});

test('a device denial stops polling', async () => {
  tokenFetch((url) => (url.endsWith('/device/code') ? deviceStart() : new Response(JSON.stringify({ error: 'access_denied' }), { status: 403 })));
  const { login } = interaction('device');
  const error = await loginGrokBuild(login).catch((thrown: unknown) => thrown);
  expect((error as Error).message).toBe('xAI OAuth device token polling failed (HTTP 403): access_denied');
});

test('a network failure before the login starts surfaces', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('network down');
  });
  const { login } = interaction('device');
  await expect(loginGrokBuild(login)).rejects.toThrow('network down');
});

test('a token request aborted in flight reports a cancelled login', async () => {
  const { login, controller } = interaction('device');
  vi.stubGlobal('fetch', async () => {
    controller.abort();
    throw new DOMException('aborted', 'AbortError');
  });
  await expect(loginGrokBuild(login)).rejects.toThrow('Login cancelled');
});

test('a token response that arrives after cancellation reports a cancelled login', async () => {
  const { login, controller } = interaction('device');
  vi.stubGlobal('fetch', async () => {
    controller.abort();
    return Response.json(TOKEN);
  });
  await expect(loginGrokBuild(login)).rejects.toThrow('Login cancelled');
});

test.for([
  { name: 'verification_uri missing', overrides: { verification_uri: undefined }, field: 'verification_uri' },
  { name: 'expires_in not positive', overrides: { expires_in: 0 }, field: 'expires_in' },
])('a device response with $name is rejected', async ({ overrides, field }) => {
  tokenFetch((url) => (url.endsWith('/device/code') ? deviceStart(overrides) : TOKEN));
  const { login } = interaction('device');
  await expect(loginGrokBuild(login)).rejects.toThrow(`Invalid xAI OAuth response field: ${field}`);
});

test('a login method that is neither browser nor device is rejected', async () => {
  const { login } = interaction('browser');
  login.prompt = async () => 'telepathy';
  await expect(loginGrokBuild(login)).rejects.toThrow('Login cancelled');
});

test('a request on another path is not used as the callback', async () => {
  tokenFetch(() => TOKEN);
  const { login, events, controller } = interaction('browser');
  const pending = loginGrokBuild(login);
  const authorize = new URL(await waitForUrl(events));
  const root = new URL(authorize.searchParams.get('redirect_uri') ?? '');
  root.pathname = '/';
  const response = await fetch(root);
  expect(response.status).toBe(404);
  controller.abort();
  await expect(pending).rejects.toThrow('Login cancelled');
});

test('an empty paste is ignored', async () => {
  tokenFetch(() => TOKEN);
  let providePaste: (value: string) => void = () => undefined;
  const paste = new Promise<string>((resolve) => {
    providePaste = resolve;
  });
  const { login, events } = interaction('browser');
  login.prompt = async (prompt) => (prompt.type === 'select' ? 'browser' : paste);
  const pending = loginGrokBuild(login);
  await waitForUrl(events);
  providePaste('   ');
  await expect(pending).rejects.toThrow('Login cancelled');
});

test('a paste that is not a redirect URL is rejected', async () => {
  tokenFetch(() => TOKEN);
  const { login } = interaction('browser', 'not a url');
  await expect(loginGrokBuild(login)).rejects.toThrow('Paste the redirect URL');
});

test('a pasted URL without a code is rejected', async () => {
  tokenFetch(() => TOKEN);
  const { login } = interaction('browser', 'https://example.invalid/callback');
  await expect(loginGrokBuild(login)).rejects.toThrow('xAI OAuth callback was rejected');
});

test('a pasted URL pasted for another login is rejected', async () => {
  tokenFetch(() => TOKEN);
  let providePaste: (value: string) => void = () => undefined;
  const paste = new Promise<string>((resolve) => {
    providePaste = resolve;
  });
  const { login, events } = interaction('browser');
  login.prompt = async (prompt) => (prompt.type === 'select' ? 'browser' : paste);
  const pending = loginGrokBuild(login);
  const authorize = new URL(await waitForUrl(events));
  const redirect = new URL(authorize.searchParams.get('redirect_uri') ?? '');
  redirect.searchParams.set('code', 'pasted-code');
  redirect.searchParams.set('state', 'another-state');
  providePaste(redirect.href);
  await expect(pending).rejects.toThrow('xAI OAuth callback was rejected');
});

test('an http verification URI is rejected', async () => {
  tokenFetch(() => ({ device_code: 'device', user_code: 'CODE-CODE', verification_uri: 'http://accounts.x.ai/oauth2/device', expires_in: 30, interval: 5 }));
  const { login } = interaction('device');
  await expect(loginGrokBuild(login)).rejects.toThrow('Untrusted verification URI');
});

test('a token error does not include the response body', async () => {
  tokenFetch(() => new Response(JSON.stringify({ error: 'invalid_grant', access_token: 'secret-token' }), { status: 400 }));
  const { login, events } = interaction('browser');
  const pending = loginGrokBuild(login);
  const failure = pending.then(
    () => {
      throw new Error('login resolved');
    },
    (error: unknown) => error,
  );
  const authorize = new URL(await waitForUrl(events));
  const redirect = new URL(authorize.searchParams.get('redirect_uri') ?? '');
  redirect.searchParams.set('code', 'auth-code');
  redirect.searchParams.set('state', authorize.searchParams.get('state') ?? '');
  await fetch(redirect);
  const error = await failure;
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain('invalid_grant');
  expect((error as Error).message).not.toContain('secret-token');
});

test('aborting login rejects and stops waiting', async () => {
  tokenFetch(() => new Promise(() => undefined));
  const { login, controller } = interaction('device');
  const pending = loginGrokBuild(login);
  controller.abort();
  await expect(pending).rejects.toThrow('Login cancelled');
});

function waitForUrl(events: AuthEvent[]): Promise<string> {
  return vi.waitFor(() => {
    const found = events.find((event) => event.type === 'auth_url');
    if (found?.type !== 'auth_url') throw new Error('authorize URL was not shown');
    return found.url;
  }, 2000);
}
