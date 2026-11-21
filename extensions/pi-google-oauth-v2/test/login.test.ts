import { createHash } from 'node:crypto';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { ANTIGRAVITY_CLIENT_ID, AUTH_ENDPOINT, EXPIRES_IN_SECONDS, HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_OK, LOOPBACK_TIMEOUT_MS, MANUAL_REDIRECT, MS_PER_SECOND, PROVIDER_ID, ROUTE_LOAD, ROUTE_TOKEN, SCOPE_BASE } from './constants.ts';
import { json } from './google.ts';
import { AUTH_CODE, authUrl, healthyGoogle, signInByPaste, startLogin, stubProjectEnv, tokenRequest, waitsForAbort } from './login-driver.ts';
import { startSession } from './session.ts';

const SCOPES = [`${SCOPE_BASE}/cloud-platform`, `${SCOPE_BASE}/userinfo.email`, `${SCOPE_BASE}/userinfo.profile`, `${SCOPE_BASE}/cclog`, `${SCOPE_BASE}/experimentsandconfigs`, `${SCOPE_BASE}/aicode`, 'openid'];
const LOOPBACK_REDIRECT = /^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/;
const CLIENT_SECRET = /^GOCSPX-/;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the sign-in page', () => {
  test('asks for offline PKCE consent with the Antigravity scopes and a loopback redirect', async () => {
    const login = await startLogin(waitsForAbort);
    const url = authUrl(login.events);
    expect(`${url?.origin}${url?.pathname}`).toBe(AUTH_ENDPOINT);
    const params = Object.fromEntries(url?.searchParams ?? []);
    expect(params['redirect_uri']).toMatch(LOOPBACK_REDIRECT);
    expect(params['state']).toBeTypeOf('string');
    expect(params['code_challenge']).toBeTypeOf('string');
    expect(params).toEqual({
      client_id: ANTIGRAVITY_CLIENT_ID,
      redirect_uri: params['redirect_uri'],
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: params['state'],
      code_challenge: params['code_challenge'],
      code_challenge_method: 'S256',
    });
    login.controller.abort();
    await expect(login.result).rejects.toThrow('cancelled');
  });

  test('offers the code page for machines without a browser', async () => {
    const login = await signInByPaste();
    await login.result;
    const info = login.events.flatMap((event) => (event.type === 'info' ? [event] : []));
    const codePage = info[0]?.links?.[0];
    const codePageUrl = new URL(codePage?.url ?? '');
    expect(codePage?.label).toBe('Code page');
    expect(`${codePageUrl.origin}${codePageUrl.pathname}`).toBe(AUTH_ENDPOINT);
    expect(codePageUrl.searchParams.get('redirect_uri')).toBe(MANUAL_REDIRECT);
    expect(codePageUrl.searchParams.get('state')).toBe(authUrl(login.events)?.searchParams.get('state'));
  });
});

describe('signing in through the browser callback', () => {
  test('stores the tokens and the resolved project', async () => {
    const login = await startLogin(waitsForAbort);
    const before = Date.now();
    const answer = await login.browserCallback(`code=${AUTH_CODE}`);
    const credential = await login.result;
    expect(answer.status).toBe(HTTP_OK);
    expect(credential).toMatchObject({ type: 'oauth', access: 'access-new', refresh: 'refresh-new', projectId: 'proj-server' });
    expect(credential.expires).toBeGreaterThanOrEqual(before + EXPIRES_IN_SECONDS * MS_PER_SECOND);
    expect(credential.expires).toBeLessThanOrEqual(Date.now() + EXPIRES_IN_SECONDS * MS_PER_SECOND);
  });

  test('exchanges the code with the PKCE verifier and the loopback redirect', async () => {
    const login = await startLogin(waitsForAbort);
    await login.browserCallback(`code=${AUTH_CODE}`);
    await login.result;
    const form = tokenRequest(login);
    expect(form?.get('grant_type')).toBe('authorization_code');
    expect(form?.get('code')).toBe(AUTH_CODE);
    expect(form?.get('redirect_uri')).toBe(login.redirectUri);
    expect(form?.get('client_id')).toBe(ANTIGRAVITY_CLIENT_ID);
    expect(form?.get('client_secret')).toMatch(CLIENT_SECRET);
    const verifier = form?.get('code_verifier') ?? '';
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(authUrl(login.events)?.searchParams.get('code_challenge'));
  });

  test('saves the credential when Pi runs the login', async () => {
    stubProjectEnv();
    const session = await startSession({ credential: undefined, routes: healthyGoogle });
    const controller = new AbortController();
    const signIn = session.models.login(PROVIDER_ID, 'oauth', {
      signal: controller.signal,
      notify: () => undefined,
      prompt: async () => 'pasted-code',
    });
    await expect(signIn).resolves.toMatchObject({ type: 'oauth', access: 'access-new', projectId: 'proj-server' });
    await expect(session.credentials.read(PROVIDER_ID)).resolves.toMatchObject({ refresh: 'refresh-new', projectId: 'proj-server' });
  });

  test('stops the manual code prompt without failing the login', async () => {
    const login = await startLogin(waitsForAbort);
    await login.browserCallback(`code=${AUTH_CODE}`);
    await expect(login.result).resolves.toMatchObject({ type: 'oauth' });
    expect(login.prompts[0]).toMatchObject({ type: 'manual_code' });
    expect(login.prompts[0]?.signal?.aborted).toBe(true);
  });

  test('releases the loopback port when the login ends', async () => {
    const login = await startLogin(waitsForAbort);
    await login.browserCallback(`code=${AUTH_CODE}`);
    await login.result;
    await expect(fetch(login.redirectUri)).rejects.toThrow();
  });
});

describe('signing in with a pasted code', () => {
  test('exchanges the trimmed code against the code page redirect', async () => {
    const login = await startLogin(async () => '  pasted-code \n');
    await expect(login.result).resolves.toMatchObject({ access: 'access-new' });
    expect(tokenRequest(login)?.get('code')).toBe('pasted-code');
    expect(tokenRequest(login)?.get('redirect_uri')).toBe(MANUAL_REDIRECT);
  });

  test('closes the loopback listener once the pasted code wins', async () => {
    const login = await signInByPaste();
    await login.result;
    await expect(fetch(login.redirectUri)).rejects.toThrow();
  });

  test('keeps the paste prompt open after the browser listener times out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const paste = Promise.withResolvers<string>();
    const login = await startLogin(() => paste.promise);
    await vi.advanceTimersByTimeAsync(LOOPBACK_TIMEOUT_MS);
    vi.useRealTimers();
    await expect(fetch(login.redirectUri)).rejects.toThrow();
    paste.resolve('late-code');
    await expect(login.result).resolves.toMatchObject({ access: 'access-new' });
  });

  test('fails when an empty code is entered', async () => {
    const login = await startLogin(async () => '   ');
    await expect(login.result).rejects.toThrow('No authorization code entered');
  });
});

describe('sign-in failures', () => {
  test('a Google error on the callback fails the login while a paste is pending', async () => {
    const login = await startLogin(waitsForAbort);
    await login.browserCallback('error=access_denied');
    await expect(login.result).rejects.toThrow('Google sign-in failed: access_denied');
  });

  test('cancelling the login fails it and releases the port', async () => {
    const login = await startLogin(waitsForAbort);
    login.controller.abort();
    await expect(login.result).rejects.toThrow('cancelled');
    await expect(fetch(login.redirectUri)).rejects.toThrow();
  });

  test('requires a refresh token and stores nothing', async () => {
    const routes = { [ROUTE_TOKEN]: () => json({ access_token: 'access-new', expires_in: EXPIRES_IN_SECONDS }) };
    stubProjectEnv();
    const session = await startSession({ credential: undefined, routes: { ...healthyGoogle, ...routes } });
    const signIn = session.models.login(PROVIDER_ID, 'oauth', { signal: new AbortController().signal, notify: () => undefined, prompt: async () => 'pasted-code' });
    await expect(signIn).rejects.toThrow('Google returned no refresh token; run /login again');
    await expect(session.credentials.read(PROVIDER_ID)).resolves.toBeUndefined();
  });

  test('reports Google token errors by code and description only', async () => {
    const routes = { [ROUTE_TOKEN]: () => json({ error: 'invalid_grant', error_description: 'Bad Request' }, HTTP_BAD_REQUEST) };
    const login = await signInByPaste({ routes }, 'secret-pasted-code');
    await expect(login.result).rejects.toThrow(new Error('Google token request failed: invalid_grant. Bad Request'));
  });

  test('names the HTTP status when the token error has no code', async () => {
    const routes = { [ROUTE_TOKEN]: () => new Response('<html>oops</html>', { status: HTTP_FORBIDDEN }) };
    const login = await signInByPaste({ routes });
    await expect(login.result).rejects.toThrow(new Error('Google token request failed: HTTP 403'));
  });

  test('rejects a token answer that lacks an access token', async () => {
    const routes = { [ROUTE_TOKEN]: () => json({ refresh_token: 'refresh-new' }) };
    const login = await signInByPaste({ routes });
    await expect(login.result).rejects.toThrow('Google token response was incomplete');
  });

  test('keeps tokens and codes out of every failure message', async () => {
    const routes = { [ROUTE_LOAD]: () => json({ error: { message: 'Permission denied' } }, HTTP_FORBIDDEN) };
    const login = await signInByPaste({ routes }, 'secret-pasted-code');
    const failure = String(await login.result.catch((error: unknown) => error));
    expect(failure).toContain('Permission denied');
    for (const secret of ['access-new', 'refresh-new', 'secret-pasted-code', 'GOCSPX']) expect(failure).not.toContain(secret);
  });
});
