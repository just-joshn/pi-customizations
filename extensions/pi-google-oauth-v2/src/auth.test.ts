import { createHash } from 'node:crypto';

import type { AuthEvent, AuthPrompt, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildAuthUrl, createGoogleOAuth, parseStoredCredential } from './auth.ts';
import { IneligibleTierError } from './code-assist.ts';
import { PRIVATE_PROJECT_HEADER } from './constants.ts';
import { LOOPBACK_TIMEOUT_MS } from './loopback.ts';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const stored: OAuthCredential = { type: 'oauth', access: 'access-1', refresh: 'refresh-1', expires: 1_000, projectId: 'proj-1' };

interface Exchange {
  url: string;
  form: URLSearchParams | undefined;
  json: Record<string, unknown> | undefined;
}

function googleBackend(handlers: { token?: () => Response; load?: () => Response } = {}) {
  const exchanges: Exchange[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    exchanges.push({
      url,
      form: init?.body instanceof URLSearchParams ? init.body : undefined,
      json: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    if (url === TOKEN_URL) return handlers.token?.() ?? Response.json({ access_token: 'access-new', expires_in: 3600, refresh_token: 'refresh-new' });
    if (url.endsWith(':loadCodeAssist')) return handlers.load?.() ?? Response.json({ currentTier: { id: 'g1-pro-tier', name: 'Google AI Pro' }, cloudaicompanionProject: 'proj-server' });
    throw new Error(`unexpected url ${url}`);
  });
  return { exchanges, fetchImpl };
}

function interaction(promptImpl: (prompt: AuthPrompt) => Promise<string>) {
  const events: AuthEvent[] = [];
  const prompts: AuthPrompt[] = [];
  const controller = new AbortController();
  const value: ProviderAuthInteraction = {
    signal: controller.signal,
    prompt: (prompt) => {
      prompts.push(prompt);
      return promptImpl(prompt);
    },
    notify: (event) => events.push(event),
  };
  return { value, events, prompts, controller };
}

const waitsForAbort = (prompt: AuthPrompt) =>
  new Promise<string>((_resolve, reject) => {
    prompt.signal?.addEventListener('abort', () => reject(new Error('prompt aborted')), { once: true });
  });

const authUrl = (events: AuthEvent[]): URL | undefined => {
  const event = events.find((candidate) => candidate.type === 'auth_url');
  return event?.type === 'auth_url' ? new URL(event.url) : undefined;
};

async function startLogin(promptImpl: (prompt: AuthPrompt) => Promise<string>, backend = googleBackend(), env: NodeJS.ProcessEnv = {}) {
  const session = interaction(promptImpl);
  const oauth = createGoogleOAuth({ fetch: backend.fetchImpl, env });
  const result = oauth.login(session.value);
  result.catch(() => undefined);
  await vi.waitFor(() => expect(authUrl(session.events)).toBeInstanceOf(URL));
  return { ...session, backend, result };
}

describe('buildAuthUrl', () => {
  test('requests offline PKCE consent with the five Antigravity scopes', () => {
    const url = new URL(buildAuthUrl({ redirectUri: 'http://127.0.0.1:1/oauth2callback', state: 's', codeChallenge: 'c' }));
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
      redirect_uri: 'http://127.0.0.1:1/oauth2callback',
      response_type: 'code',
      scope: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/cclog',
        'https://www.googleapis.com/auth/experimentsandconfigs',
      ].join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: 's',
      code_challenge: 'c',
      code_challenge_method: 'S256',
    });
  });
});

describe('login through the loopback callback', () => {
  test('stores tokens and the resolved project', async () => {
    const login = await startLogin(waitsForAbort);
    const url = authUrl(login.events);
    const before = Date.now();
    await fetch(`${url?.searchParams.get('redirect_uri')}?state=${url?.searchParams.get('state')}&code=auth-code`);
    const credential = await login.result;
    expect(credential).toMatchObject({ type: 'oauth', access: 'access-new', refresh: 'refresh-new', projectId: 'proj-server' });
    expect(credential.expires).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(credential.expires).toBeLessThanOrEqual(Date.now() + 3600 * 1000);
  });

  test('exchanges the code with the PKCE verifier and the loopback redirect', async () => {
    const login = await startLogin(waitsForAbort);
    const url = authUrl(login.events);
    const redirectUri = url?.searchParams.get('redirect_uri') ?? '';
    await fetch(`${redirectUri}?state=${url?.searchParams.get('state')}&code=auth-code`);
    await login.result;
    const form = login.backend.exchanges.find((exchange) => exchange.url === TOKEN_URL)?.form;
    expect(form?.get('grant_type')).toBe('authorization_code');
    expect(form?.get('code')).toBe('auth-code');
    expect(form?.get('redirect_uri')).toBe(redirectUri);
    expect(form?.get('client_id')).toBe('1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com');
    expect(form?.get('client_secret')).toMatch(/^GOCSPX-/);
    expect(
      createHash('sha256')
        .update(form?.get('code_verifier') ?? '')
        .digest('base64url'),
    ).toBe(url?.searchParams.get('code_challenge'));
  });

  test('aborts the manual code prompt without failing the login', async () => {
    const login = await startLogin(waitsForAbort);
    const url = authUrl(login.events);
    await fetch(`${url?.searchParams.get('redirect_uri')}?state=${url?.searchParams.get('state')}&code=auth-code`);
    await expect(login.result).resolves.toMatchObject({ type: 'oauth' });
    expect(login.prompts[0]).toMatchObject({ type: 'manual_code' });
    expect(login.prompts[0]?.signal?.aborted).toBe(true);
  });

  test('offers the code page and reports the plan tier and project', async () => {
    const login = await startLogin(waitsForAbort);
    const url = authUrl(login.events);
    await fetch(`${url?.searchParams.get('redirect_uri')}?state=${url?.searchParams.get('state')}&code=auth-code`);
    await login.result;
    const info = login.events.filter((event) => event.type === 'info');
    const codePage = info[0]?.type === 'info' ? info[0].links?.[0] : undefined;
    expect(codePage?.label).toBe('Code page');
    expect(new URL(codePage?.url ?? '').searchParams.get('redirect_uri')).toBe('https://antigravity.google/oauth-callback');
    expect(info.at(-1)).toMatchObject({ message: 'Google AI plan: Google AI Pro. Code Assist project: proj-server.' });
  });

  test('sends the env project to Code Assist', async () => {
    const login = await startLogin(waitsForAbort, googleBackend(), { GOOGLE_CLOUD_PROJECT: 'proj-env' });
    const url = authUrl(login.events);
    await fetch(`${url?.searchParams.get('redirect_uri')}?state=${url?.searchParams.get('state')}&code=auth-code`);
    await login.result;
    expect(login.backend.exchanges.find((exchange) => exchange.url.endsWith(':loadCodeAssist'))?.json).toMatchObject({ cloudaicompanionProject: 'proj-env' });
  });

  test('releases the loopback port when the login ends', async () => {
    const login = await startLogin(waitsForAbort);
    const url = authUrl(login.events);
    const redirectUri = url?.searchParams.get('redirect_uri') ?? '';
    await fetch(`${redirectUri}?state=${url?.searchParams.get('state')}&code=auth-code`);
    await login.result;
    await expect(fetch(redirectUri)).rejects.toThrow();
  });
});

describe('login through a pasted code', () => {
  test('exchanges the trimmed code against the code page redirect', async () => {
    const login = await startLogin(async () => '  pasted-code \n');
    await expect(login.result).resolves.toMatchObject({ access: 'access-new' });
    const form = login.backend.exchanges.find((exchange) => exchange.url === TOKEN_URL)?.form;
    expect(form?.get('code')).toBe('pasted-code');
    expect(form?.get('redirect_uri')).toBe('https://antigravity.google/oauth-callback');
  });

  test('closes the loopback listener when the pasted code wins', async () => {
    const login = await startLogin(async () => 'pasted-code');
    await login.result;
    const redirectUri = authUrl(login.events)?.searchParams.get('redirect_uri') ?? '';
    await expect(fetch(redirectUri)).rejects.toThrow();
  });

  test('keeps the paste prompt open after the loopback times out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let paste!: (code: string) => void;
    const login = await startLogin(() => new Promise<string>((resolve) => (paste = resolve)));
    await vi.advanceTimersByTimeAsync(LOOPBACK_TIMEOUT_MS);
    const redirectUri = authUrl(login.events)?.searchParams.get('redirect_uri') ?? '';
    vi.useRealTimers();
    await expect(fetch(redirectUri)).rejects.toThrow();
    paste('late-code');
    await expect(login.result).resolves.toMatchObject({ access: 'access-new' });
  });

  test('fails when an empty code is entered', async () => {
    const login = await startLogin(async () => '   ');
    await expect(login.result).rejects.toThrow('No authorization code entered');
  });
});

describe('login failures', () => {
  test('a Google error on the callback fails the login while a paste is pending', async () => {
    const login = await startLogin(waitsForAbort);
    const url = authUrl(login.events);
    await fetch(`${url?.searchParams.get('redirect_uri')}?state=${url?.searchParams.get('state')}&error=access_denied`);
    await expect(login.result).rejects.toThrow('Google sign-in failed: access_denied');
  });

  test('aborting the interaction fails the login and releases the port', async () => {
    const login = await startLogin(waitsForAbort);
    const redirectUri = authUrl(login.events)?.searchParams.get('redirect_uri') ?? '';
    login.controller.abort();
    await expect(login.result).rejects.toThrow('cancelled');
    await expect(fetch(redirectUri)).rejects.toThrow();
  });

  test('requires a refresh token and stores nothing', async () => {
    const backend = googleBackend({ token: () => Response.json({ access_token: 'access-new', expires_in: 3600 }) });
    const login = await startLogin(async () => 'pasted-code', backend);
    await expect(login.result).rejects.toThrow('Google returned no refresh token; run /login again');
  });

  test('reports Google token errors by code and description only', async () => {
    const backend = googleBackend({ token: () => Response.json({ error: 'invalid_grant', error_description: 'Bad Request' }, { status: 400 }) });
    const login = await startLogin(async () => 'secret-pasted-code', backend);
    const failure = await login.result.catch((error: unknown) => error);
    expect(failure).toHaveProperty('message', 'Google token request failed: invalid_grant. Bad Request');
  });

  test('passes Google ineligibility text through unchanged', async () => {
    const backend = googleBackend({ load: () => Response.json({ currentTier: { id: 'free-tier' }, ineligibleTiers: [{ reasonMessage: 'Google AI Plus is not supported.' }] }) });
    const login = await startLogin(async () => 'pasted-code', backend);
    const failure = await login.result.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(IneligibleTierError);
    expect(failure).toHaveProperty('message', 'Google AI Plus is not supported.');
  });

  test('keeps tokens and codes out of every failure message', async () => {
    const backend = googleBackend({ load: () => Response.json({ error: { message: 'Permission denied' } }, { status: 403 }) });
    const login = await startLogin(async () => 'secret-pasted-code', backend);
    const failure = String(await login.result.catch((error: unknown) => error));
    for (const secret of ['access-new', 'refresh-new', 'secret-pasted-code', 'GOCSPX']) expect(failure).not.toContain(secret);
  });

  test('rejects a numeric env project before any browser step', async () => {
    const session = interaction(waitsForAbort);
    const oauth = createGoogleOAuth({ fetch: googleBackend().fetchImpl, env: { GOOGLE_CLOUD_PROJECT: '123' } });
    await expect(oauth.login(session.value)).rejects.toThrow('project ID string');
    expect(session.events).toEqual([]);
  });

  test('stops when the login is cancelled', async () => {
    const login = await startLogin(waitsForAbort);
    login.controller.abort();
    await expect(login.result).rejects.toThrow('cancelled');
  });
});

describe('refresh', () => {
  const refresh = (backend = googleBackend(), credential: OAuthCredential = stored) => createGoogleOAuth({ fetch: backend.fetchImpl }).refresh(credential, new AbortController().signal);

  test('replaces access and expiry and keeps projectId', async () => {
    const backend = googleBackend({ token: () => Response.json({ access_token: 'access-2', expires_in: 100 }) });
    const before = Date.now();
    const refreshed = await refresh(backend);
    expect(refreshed).toMatchObject({ type: 'oauth', access: 'access-2', projectId: 'proj-1' });
    expect(refreshed.expires).toBeGreaterThanOrEqual(before + 100_000);
    const form = backend.exchanges[0]?.form;
    expect(form?.get('grant_type')).toBe('refresh_token');
    expect(form?.get('refresh_token')).toBe('refresh-1');
  });

  test('keeps the old refresh token when Google sends none', async () => {
    const backend = googleBackend({ token: () => Response.json({ access_token: 'access-2', expires_in: 100 }) });
    await expect(refresh(backend)).resolves.toMatchObject({ refresh: 'refresh-1' });
  });

  test('takes a rotated refresh token when Google sends one', async () => {
    await expect(refresh()).resolves.toMatchObject({ refresh: 'refresh-new', projectId: 'proj-1' });
  });

  test('turns invalid_grant into a re-login message without token text', async () => {
    const backend = googleBackend({ token: () => Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 }) });
    const failure = await refresh(backend).catch((error: unknown) => error);
    expect(failure).toHaveProperty('message', 'Google refused the refresh token; run /login again');
  });

  test('refuses a credential that has no projectId', async () => {
    const { projectId: _projectId, ...withoutProject } = stored;
    await expect(refresh(googleBackend(), withoutProject as OAuthCredential)).rejects.toThrow('run /login again');
  });
});

describe('toAuth', () => {
  const oauth = createGoogleOAuth();
  afterEach(() => vi.unstubAllEnvs());

  test('returns the access token and the project header', async () => {
    await expect(oauth.toAuth(stored)).resolves.toEqual({ apiKey: 'access-1', headers: { [PRIVATE_PROJECT_HEADER]: 'proj-1' } });
  });

  test('ignores the environment', async () => {
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'proj-env');
    await expect(oauth.toAuth(stored)).resolves.toMatchObject({ headers: { [PRIVATE_PROJECT_HEADER]: 'proj-1' } });
  });

  test('declares a subscription login', () => {
    expect(oauth).toMatchObject({ isSubscription: true, loginLabel: 'Sign in with your Google AI plan' });
  });
});

describe('parseStoredCredential', () => {
  test('returns a complete credential', () => {
    expect(parseStoredCredential(stored)).toEqual(stored);
  });

  test.for([
    ['projectId missing', { ...stored, projectId: undefined }],
    ['projectId empty', { ...stored, projectId: '' }],
    ['access not a string', { ...stored, access: 5 }],
    ['refresh not a string', { ...stored, refresh: undefined }],
    ['expires missing', { ...stored, expires: undefined }],
    ['expires not finite', { ...stored, expires: Number.NaN }],
  ])('rejects a credential with %s', ([, credential]) => {
    expect(() => parseStoredCredential(credential as OAuthCredential)).toThrow('Google AI login is incomplete; run /login again');
  });
});
