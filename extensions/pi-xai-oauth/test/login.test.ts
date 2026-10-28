import type { AuthEvent, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { expect, vi } from 'vitest';
import { GROK_OAUTH_SCOPE, authorizeUrl, loginGrokBuild } from '../src/login.ts';
import { test } from './network-guard.ts';

const TOKEN = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_in: 21600,
};

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

test('the authorize URL carries the captured Grok scope and PKCE fields', () => {
  const url = new URL(authorizeUrl({ redirectUri: 'http://127.0.0.1:9/callback', challenge: 'challenge', state: 'state', nonce: 'nonce' }));
  expect(url.origin + url.pathname).toBe('https://auth.x.ai/oauth2/authorize');
  expect(url.searchParams.get('scope')).toBe(GROK_OAUTH_SCOPE);
  expect(GROK_OAUTH_SCOPE).toContain('conversations:read');
  expect(GROK_OAUTH_SCOPE).toContain('workspaces:write');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.get('client_id')).toBe('b1a00492-073a-47ea-816f-4c329264a828');
  expect(url.searchParams.has('referrer')).toBe(false);
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

test('a paste that is not a redirect URL is rejected', async () => {
  tokenFetch(() => TOKEN);
  const { login } = interaction('browser', 'not a url');
  await expect(loginGrokBuild(login)).rejects.toThrow('Paste the redirect URL');
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
