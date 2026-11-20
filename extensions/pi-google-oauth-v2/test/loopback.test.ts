import { setImmediate } from 'node:timers/promises';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { HTTP_BAD_REQUEST, HTTP_OK } from './constants.ts';
import { AUTH_CODE, startLogin, waitsForAbort } from './login-driver.ts';

const HTTP_NOT_FOUND = 404;
const FAVICON_PATH = '/favicon.ico';
/** True when the promise resolved or rejected before the event loop next turned over. */
async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  const markDone = () => {
    done = true;
  };
  promise.then(markDone, markDone);
  await setImmediate();
  return done;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the browser callback listener', () => {
  test('listens on 127.0.0.1 at an OS-assigned port and thanks the user', async () => {
    const login = await startLogin(waitsForAbort);
    expect(login.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/);
    const answer = await login.browserCallback(`code=${AUTH_CODE}`);
    expect(answer.status).toBe(HTTP_OK);
    expect(await answer.text()).toBe('Signed in. You can close this tab and return to Pi.');
    await expect(login.result).resolves.toMatchObject({ type: 'oauth' });
  });

  test('answers a wrong state with 400 and keeps waiting for the real callback', async () => {
    const login = await startLogin(waitsForAbort);
    const stray = await fetch(`${login.redirectUri}?state=other&code=evil`);
    expect(stray.status).toBe(HTTP_BAD_REQUEST);
    expect(await hasSettled(login.result)).toBe(false);
    await login.browserCallback('code=good');
    await expect(login.result).resolves.toMatchObject({ type: 'oauth' });
    expect(login.google.requests.flatMap((request) => request.form?.get('code') ?? [])).toEqual(['good']);
  });

  test('answers other paths with 404 and keeps waiting', async () => {
    const login = await startLogin(waitsForAbort);
    const favicon = await fetch(new URL(FAVICON_PATH, login.redirectUri));
    expect(favicon.status).toBe(HTTP_NOT_FOUND);
    expect(await hasSettled(login.result)).toBe(false);
    login.controller.abort();
    await expect(login.result).rejects.toThrow('cancelled');
  });

  test('tells the browser sign-in failed and fails the login with the Google error and description', async () => {
    const login = await startLogin(waitsForAbort);
    const answer = await login.browserCallback(new URLSearchParams({ error: 'access_denied', error_description: 'User said no' }).toString());
    expect(answer.status).toBe(HTTP_BAD_REQUEST);
    expect(await answer.text()).toBe('Sign-in failed. Return to Pi.');
    await expect(login.result).rejects.toThrow('Google sign-in failed: access_denied. User said no');
  });

  test('fails the login when the callback carries no code', async () => {
    const login = await startLogin(waitsForAbort);
    await login.browserCallback('');
    await expect(login.result).rejects.toThrow('Google sign-in returned no authorization code');
  });

  test('a login cancelled before it starts fails at once', async () => {
    const login = await startLogin(waitsForAbort, { signal: AbortSignal.abort() });
    await expect(login.result).rejects.toThrow('cancelled');
    await expect(fetch(login.redirectUri)).rejects.toThrow();
  });
});
