import { expect, vi } from 'vitest';
import { errorText, extractRetryDelay, parseApiKey, postCloudCode } from '../src/cloudcode.ts';
import { fakeServer, json } from './fake-server.ts';
import { test } from './network-guard.ts';

test('postCloudCode parses a successful JSON body', async () => {
  const server = await fakeServer((_, res) => json(res, 200, { cloudaicompanionProject: 'p1' }));
  try {
    const body = { metadata: { ideType: 'ANTIGRAVITY' } };
    const data = await postCloudCode(server.url, 'loadCodeAssist', 'ya29.t', body);
    expect(data).toEqual({ cloudaicompanionProject: 'p1' });
    expect(server.requests[0]?.path).toBe('/v1internal:loadCodeAssist');
    expect(server.requests[0]?.headers.authorization).toBe('Bearer ya29.t');
    expect(server.requests[0]?.body).toBe(JSON.stringify(body));
  } finally {
    server.close();
  }
});

test('a non-JSON success body rejects with the parse failure', async () => {
  const server = await fakeServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('not json');
  });
  try {
    await expect(postCloudCode(server.url, 'loadCodeAssist', 't', {})).rejects.toBeInstanceOf(SyntaxError);
  } finally {
    server.close();
  }
});

test('a non-JSON error body is surfaced verbatim', async () => {
  const server = await fakeServer((_, res) => {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end('upstream down');
  });
  try {
    await expect(postCloudCode(server.url, 'loadCodeAssist', 't', {})).rejects.toThrow('loadCodeAssist failed (503): upstream down');
  } finally {
    server.close();
  }
});

test('an aborted signal rethrows the fetch failure', async () => {
  const failure = new Error('socket closed');
  vi.stubGlobal('fetch', () => Promise.reject(failure));
  await expect(postCloudCode('http://cloud.example', 'loadCodeAssist', 't', {}, AbortSignal.abort())).rejects.toThrow('socket closed');
});

test('a non-Error fetch failure is wrapped', async () => {
  vi.stubGlobal('fetch', () => Promise.reject('offline'));
  await expect(postCloudCode('http://cloud.example', 'loadCodeAssist', 't', {})).rejects.toThrow('offline');
});

test('a null JSON document asks for a new login', () => {
  expect(() => parseApiKey('null')).toThrow('Google Antigravity credentials lack a token or project. Run /login and choose Google Antigravity.');
});

test('errorText keeps the raw body when the message is absent', () => {
  expect(errorText('{"error":{}}')).toBe('{"error":{}}');
  expect(errorText('plain text')).toBe('plain text');
});

test('extractRetryDelay pads a numeric retry-after', () => {
  expect(extractRetryDelay('', new Headers({ 'retry-after': '2' }))).toBe(3000);
});

test('extractRetryDelay ignores a zero retry-after', () => {
  expect(extractRetryDelay('', new Headers({ 'retry-after': '0' }))).toBe(undefined);
});

test('extractRetryDelay reads an HTTP-date retry-after', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  try {
    expect(extractRetryDelay('', new Headers({ 'retry-after': 'Thu, 01 Jan 2026 00:00:05 GMT' }))).toBe(6000);
  } finally {
    vi.useRealTimers();
  }
});

test('extractRetryDelay reads the x-ratelimit-reset epoch seconds', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  try {
    const resetAt = String(Math.floor(Date.now() / 1000) + 5);
    expect(extractRetryDelay('', new Headers({ 'x-ratelimit-reset': resetAt }))).toBe(6000);
  } finally {
    vi.useRealTimers();
  }
});

test('extractRetryDelay reads x-ratelimit-reset-after seconds', () => {
  expect(extractRetryDelay('', new Headers({ 'x-ratelimit-reset-after': '4' }))).toBe(5000);
});

test('extractRetryDelay reads a reset duration from the body', () => {
  expect(extractRetryDelay('Quota exceeded, reset after 1h2m3s', new Headers())).toBe(3724000);
});

test('extractRetryDelay fills in missing duration units', () => {
  expect(extractRetryDelay('reset after 30s', new Headers())).toBe(31000);
});

test('extractRetryDelay reads the retry hint Google embeds in a message', () => {
  expect(extractRetryDelay('Please retry in 2.5s', new Headers())).toBe(3500);
  expect(extractRetryDelay('Please retry in 500ms', new Headers())).toBe(1500);
  expect(extractRetryDelay('{"retryDelay":"3s"}', new Headers())).toBe(4000);
});

test('extractRetryDelay returns nothing when no hint is present', () => {
  expect(extractRetryDelay('no guidance here', new Headers())).toBe(undefined);
});
