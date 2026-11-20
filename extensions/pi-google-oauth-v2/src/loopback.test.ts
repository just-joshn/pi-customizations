import { afterEach, describe, expect, test, vi } from 'vitest';
import { LOOPBACK_TIMEOUT_MS, type LoopbackCallback, startLoopbackCallback } from './loopback.ts';

const STATE = 'state-123';
const FAVICON_PATH = '/favicon.ico';
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
let open: readonly LoopbackCallback[] = [];

async function start(signal: AbortSignal = new AbortController().signal): Promise<LoopbackCallback> {
  const loopback = await startLoopbackCallback({ state: STATE, signal });
  open = [...open, loopback];
  return loopback;
}

const PENDING = Symbol('pending');
const settled = (promise: Promise<string>) => Promise.race([promise, Promise.resolve(PENDING)]);

afterEach(() => {
  vi.useRealTimers();
  const toClose = open;
  open = [];
  for (const loopback of toClose) loopback.close();
});

describe('startLoopbackCallback binding', () => {
  test('binds 127.0.0.1 on an OS-assigned port', async () => {
    const loopback = await start();
    expect(loopback.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/);
  });

  test('resolves with the code when the state matches', async () => {
    const loopback = await start();
    const response = await fetch(`${loopback.redirectUri}?state=${STATE}&code=abc`);
    expect(response.status).toBe(HTTP_OK);
    await expect(loopback.code).resolves.toBe('abc');
  });

  test('releases the port once the callback is answered', async () => {
    const loopback = await start();
    await (await fetch(`${loopback.redirectUri}?state=${STATE}&code=abc`)).text();
    await vi.waitFor(async () => {
      await expect(fetch(loopback.redirectUri)).rejects.toThrow();
    });
  });
});

describe('startLoopbackCallback answers', () => {
  test('answers a wrong state with 400 and keeps waiting', async () => {
    const loopback = await start();
    const stray = await fetch(`${loopback.redirectUri}?state=other&code=evil`);
    expect(stray.status).toBe(HTTP_BAD_REQUEST);
    expect(await settled(loopback.code)).toBe(PENDING);
    await fetch(`${loopback.redirectUri}?state=${STATE}&code=good`);
    await expect(loopback.code).resolves.toBe('good');
  });

  test('answers other paths with 404 and keeps waiting', async () => {
    const loopback = await start();
    const favicon = await fetch(new URL(FAVICON_PATH, loopback.redirectUri));
    expect(favicon.status).toBe(HTTP_NOT_FOUND);
    expect(await settled(loopback.code)).toBe(PENDING);
  });

  test('rejects with the Google error code and description', async () => {
    const loopback = await start();
    const response = await fetch(`${loopback.redirectUri}?state=${STATE}&error=access_denied&error_description=User%20said%20no`);
    expect(response.status).toBe(HTTP_BAD_REQUEST);
    await expect(loopback.code).rejects.toThrow('Google sign-in failed: access_denied. User said no');
  });

  test('rejects when the callback carries no code', async () => {
    const loopback = await start();
    await fetch(`${loopback.redirectUri}?state=${STATE}`);
    await expect(loopback.code).rejects.toThrow('no authorization code');
  });
});

describe('startLoopbackCallback shutdown', () => {
  test('rejects after the timeout and frees the port', async () => {
    vi.useFakeTimers();
    const loopback = await start();
    vi.advanceTimersByTime(LOOPBACK_TIMEOUT_MS);
    await expect(loopback.code).rejects.toThrow('timed out');
    vi.useRealTimers();
    await expect(fetch(loopback.redirectUri)).rejects.toThrow();
  });

  test('rejects on abort and frees the port', async () => {
    const controller = new AbortController();
    const loopback = await start(controller.signal);
    controller.abort();
    await expect(loopback.code).rejects.toThrow('cancelled');
    await expect(fetch(loopback.redirectUri)).rejects.toThrow();
  });

  test('rejects at once when the signal is already aborted', async () => {
    const loopback = await start(AbortSignal.abort());
    await expect(loopback.code).rejects.toThrow('cancelled');
  });

  test('close() is idempotent and leaves no unhandled rejection', async () => {
    const loopback = await start();
    loopback.close();
    loopback.close();
    await expect(loopback.code).rejects.toThrow('listener closed');
  });
});
