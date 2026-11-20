import type { OAuthCredential, TranscriptContext } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { HTTP_BAD_REQUEST, MS_PER_SECOND, NEAR_EXPIRY_MS, PRIVATE_PROJECT_HEADER, PROVIDER_ID, PROVIDER_NAME, ROUTE_STREAM, ROUTE_TOKEN, TOKEN_URL } from './constants.ts';
import { installGoogle, json, type Routes } from './google.ts';
import { stubProjectEnv } from './login-driver.ts';
import { liveCredential, loadProvider, oauthOf, startSession } from './session.ts';
import { sse } from './sse.ts';

const STORED_EXPIRES = 1_000;
const SHORT_EXPIRES_IN_SECONDS = 100;
const NOT_A_STRING = 5;
const INCOMPLETE = 'Google AI login is incomplete; run /login again';
const stored: OAuthCredential = { type: 'oauth', access: 'access-1', refresh: 'refresh-1', expires: STORED_EXPIRES, projectId: 'proj-1' };
const rotating: Routes = { [ROUTE_TOKEN]: () => json({ access_token: 'access-2', expires_in: SHORT_EXPIRES_IN_SECONDS, refresh_token: 'refresh-2' }) };
const keepingRefresh: Routes = { [ROUTE_TOKEN]: () => json({ access_token: 'access-2', expires_in: SHORT_EXPIRES_IN_SECONDS }) };
const context = { messages: [{ role: 'user' as const, content: 'hi', timestamp: 1 }] };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function refresh(routes: Routes, credential: OAuthCredential = stored) {
  const google = installGoogle(routes);
  return { google, result: oauthOf(loadProvider()).refresh(credential, new AbortController().signal) };
}

describe('refreshing a stored login', () => {
  test('replaces access and expiry and keeps the project', async () => {
    const before = Date.now();
    const { google, result } = refresh(keepingRefresh);
    const refreshed = await result;
    expect(refreshed).toMatchObject({ type: 'oauth', access: 'access-2', projectId: 'proj-1' });
    expect(refreshed.expires).toBeGreaterThanOrEqual(before + SHORT_EXPIRES_IN_SECONDS * MS_PER_SECOND);
    expect(refreshed.expires).toBeLessThanOrEqual(Date.now() + SHORT_EXPIRES_IN_SECONDS * MS_PER_SECOND);
    const request = google.requestsTo(ROUTE_TOKEN)[0];
    expect(request?.url).toBe(TOKEN_URL);
    expect(request?.form?.get('grant_type')).toBe('refresh_token');
    expect(request?.form?.get('refresh_token')).toBe('refresh-1');
  });

  test('keeps the old refresh token when Google sends none', async () => {
    await expect(refresh(keepingRefresh).result).resolves.toMatchObject({ refresh: 'refresh-1' });
  });

  test('takes a rotated refresh token when Google sends one', async () => {
    await expect(refresh(rotating).result).resolves.toMatchObject({ refresh: 'refresh-2', projectId: 'proj-1' });
  });

  test('turns invalid_grant into a re-login message without token text', async () => {
    const routes = { [ROUTE_TOKEN]: () => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, HTTP_BAD_REQUEST) };
    await expect(refresh(routes).result).rejects.toThrow(new Error('Google refused the refresh token; run /login again'));
  });

  test('shows other Google token errors by code and description', async () => {
    const routes = { [ROUTE_TOKEN]: () => json({ error: 'invalid_client', error_description: 'Unauthorized' }, HTTP_BAD_REQUEST) };
    await expect(refresh(routes).result).rejects.toThrow(new Error('Google token request failed: invalid_client. Unauthorized'));
  });

  test('refuses a credential that has no project', async () => {
    const { projectId: _projectId, ...withoutProject } = stored;
    await expect(refresh(rotating, withoutProject as OAuthCredential).result).rejects.toThrow(INCOMPLETE);
  });
});

describe('turning a stored login into request auth', () => {
  const oauth = () => oauthOf(loadProvider());

  test('hands Pi the access token and the private project header', async () => {
    await expect(oauth().toAuth(stored)).resolves.toEqual({ apiKey: 'access-1', headers: { [PRIVATE_PROJECT_HEADER]: 'proj-1' } });
  });

  test('ignores the project env var in favor of the stored project', async () => {
    stubProjectEnv({ GOOGLE_CLOUD_PROJECT: 'proj-env' });
    await expect(oauth().toAuth(stored)).resolves.toMatchObject({ headers: { [PRIVATE_PROJECT_HEADER]: 'proj-1' } });
  });

  test('declares a subscription login', () => {
    expect(oauth()).toMatchObject({ name: PROVIDER_NAME, isSubscription: true, loginLabel: 'Sign in with your Google AI plan' });
  });

  test.for([
    ['project missing', { ...stored, projectId: undefined }],
    ['project empty', { ...stored, projectId: '' }],
    ['access not a string', { ...stored, access: NOT_A_STRING }],
    ['refresh not a string', { ...stored, refresh: undefined }],
    ['expiry missing', { ...stored, expires: undefined }],
    ['expiry not finite', { ...stored, expires: Number.NaN }],
  ])('rejects a stored login with %s', async ([, credential]) => {
    await expect(oauth().toAuth(credential as OAuthCredential)).rejects.toThrow(INCOMPLETE);
  });
});

describe('a stored login that is about to expire', () => {
  const reply = sse({ response: { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] } });

  test('is refreshed before the request and the new login is saved with its project', async () => {
    const session = await startSession({ credential: liveCredential({ access: 'access-old', expires: Date.now() + NEAR_EXPIRY_MS }), routes: { ...keepingRefresh, [ROUTE_STREAM]: () => reply } });

    const message = await session.models.streamSimple(session.model('gemini-3.8-flash'), context as TranscriptContext, {}).result();

    expect(session.google.requestsTo(ROUTE_TOKEN)).toHaveLength(1);
    expect(session.google.requestsTo(ROUTE_TOKEN)[0]?.form?.get('refresh_token')).toBe('refresh-live');
    expect(session.google.requestsTo(ROUTE_STREAM)[0]?.headers['authorization']).toBe('Bearer access-2');
    expect(session.google.requestsTo(ROUTE_STREAM)[0]?.json?.['project']).toBe('proj-77');
    expect(message.stopReason).toBe('stop');
    expect(await session.credentials.read(PROVIDER_ID)).toMatchObject({ type: 'oauth', access: 'access-2', refresh: 'refresh-live', projectId: 'proj-77' });
  });

  test('ends the request in an error and keeps the stored login when the refresh fails', async () => {
    const failing = { [ROUTE_TOKEN]: () => json({ error: 'invalid_grant' }, HTTP_BAD_REQUEST), [ROUTE_STREAM]: () => reply };
    const session = await startSession({ credential: liveCredential({ access: 'access-old', expires: Date.now() + NEAR_EXPIRY_MS }), routes: failing });

    const message = await session.models.streamSimple(session.model('gemini-3.8-flash'), context as TranscriptContext, {}).result();

    expect(message.stopReason).toBe('error');
    expect(session.google.requestsTo(ROUTE_STREAM)).toHaveLength(0);
    expect(await session.credentials.read(PROVIDER_ID)).toMatchObject({ access: 'access-old', projectId: 'proj-77' });
  });
});
