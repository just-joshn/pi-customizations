import { expect, vi } from 'vitest';
import { retryGoogleRequest } from '../src/pi-ai/google-shared.ts';
import { retryProviderRequest } from '../src/pi-ai/provider-retry.ts';
import { test } from './network-guard.ts';

function failure(status: number | undefined, headers?: Headers) {
  return Object.assign(new Error('provider failed'), { status, headers });
}

test('requests return their value without retry configuration', async () => {
  await expect(retryProviderRequest(async () => 'result')).resolves.toBe('result');
  const error = failure(503);
  await expect(
    retryProviderRequest(async () => {
      throw error;
    }),
  ).rejects.toBe(error);
});

test.for([undefined, 408, 409, 429, 500, 503])('transient provider status %s retries', async (status) => {
  vi.useFakeTimers();
  const request = vi
    .fn()
    .mockRejectedValueOnce(failure(status, new Headers({ 'retry-after-ms': '100' })))
    .mockResolvedValue('recovered');
  const result = retryProviderRequest(request, { maxRetries: 1 });
  await vi.advanceTimersByTimeAsync(99);
  expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toBe('recovered');
  expect(request).toHaveBeenCalledTimes(2);
});

test.for([
  new Error('ordinary'),
  'non-error',
  Object.assign(new Error('no headers'), { status: 500 }),
  Object.assign(new Error('bad status'), { status: '500', headers: undefined }),
  Object.assign(new Error('bad headers'), { status: 500, headers: {} }),
  failure(400),
  failure(401),
  failure(503, new Headers({ 'x-should-retry': 'false' })),
])('non-retryable failures preserve the original error', async (error) => {
  const request = vi.fn().mockRejectedValue(error);
  await expect(retryProviderRequest(request, { maxRetries: 2 })).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(1);
});

test('explicit retry header overrides a permanent status', async () => {
  vi.useFakeTimers();
  const request = vi
    .fn()
    .mockRejectedValueOnce(failure(400, new Headers({ 'x-should-retry': 'true', 'retry-after-ms': '0' })))
    .mockResolvedValue('ok');
  const result = retryProviderRequest(request, { maxRetries: 1 });
  await vi.runAllTimersAsync();
  await expect(result).resolves.toBe('ok');
});

test.for([
  { headers: { 'retry-after-ms': '25', 'retry-after': '1' }, delay: 25 },
  { headers: { 'retry-after-ms': 'invalid', 'retry-after': '0.1' }, delay: 100 },
  { headers: { 'retry-after': 'Thu, 01 Jan 1970 00:00:01 GMT' }, delay: 1000 },
  { headers: { 'retry-after': 'invalid' }, delay: 500 },
  { headers: { 'retry-after-ms': 'Infinity' }, delay: 500 },
  { headers: { 'retry-after-ms': '-1' }, delay: 0 },
])('server retry delay controls request timing', async ({ headers, delay }) => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const request = vi
    .fn()
    .mockRejectedValueOnce(failure(429, new Headers(Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))))
    .mockResolvedValue('ok');
  const result = retryProviderRequest(request, { maxRetries: 1 });
  await vi.advanceTimersByTimeAsync(delay);
  await expect(result).resolves.toBe('ok');
  expect(request).toHaveBeenCalledTimes(2);
});

test.for([
  { delay: '60001', limit: undefined, message: 'Server requested 61s retry delay (max: 60s)' },
  { delay: '2001', limit: 2000, message: 'Server requested 3s retry delay (max: 2s)' },
])('excessive server delays fail immediately', async ({ delay, limit, message }) => {
  const request = vi.fn().mockRejectedValue(failure(429, new Headers({ 'retry-after-ms': delay })));
  await expect(retryProviderRequest(request, { maxRetries: 1, ...(limit === undefined ? {} : { maxRetryDelayMs: limit }) })).rejects.toThrow(message);
  expect(request).toHaveBeenCalledTimes(1);
});

test.for([
  { delay: '60000', limit: undefined },
  { delay: '120000', limit: 0 },
])('allowed server delays can complete', async ({ delay, limit }) => {
  vi.useFakeTimers();
  const request = vi
    .fn()
    .mockRejectedValueOnce(failure(429, new Headers({ 'retry-after-ms': delay })))
    .mockResolvedValue('ok');
  const result = retryProviderRequest(request, { maxRetries: 1, ...(limit === undefined ? {} : { maxRetryDelayMs: limit }) });
  await vi.runAllTimersAsync();
  await expect(result).resolves.toBe('ok');
});

test('backoff grows to its cap before exhausting retries', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const error = failure(503);
  const request = vi.fn().mockRejectedValue(error);
  const result = expect(retryProviderRequest(request, { maxRetries: 6 })).rejects.toBe(error);
  for (const delay of [500, 1000, 2000, 4000, 8000, 8000]) await vi.advanceTimersByTimeAsync(delay);
  await result;
  expect(request).toHaveBeenCalledTimes(7);
});

test('cancellation interrupts a pending retry without another request', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const request = vi.fn().mockRejectedValue(failure(429, new Headers({ 'retry-after': '60' })));
  const result = expect(retryProviderRequest(request, { maxRetries: 2, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await result;
  await vi.runAllTimersAsync();
  expect(request).toHaveBeenCalledTimes(1);
});

test('already aborted requests report cancellation on failure', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    retryProviderRequest(
      async () => {
        throw new Error('failed');
      },
      { signal: controller.signal },
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
});

test('Google SDK errors without headers use the shared retry policy', async () => {
  vi.useFakeTimers();
  const request = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 503 }))
    .mockResolvedValue('ok');
  const result = retryGoogleRequest(request, { maxRetries: 1 });
  await vi.runAllTimersAsync();
  await expect(result).resolves.toBe('ok');
  expect(request).toHaveBeenCalledTimes(2);
  const error = new Error('ordinary');
  await expect(
    retryGoogleRequest(async () => {
      throw error;
    }),
  ).rejects.toBe(error);
});
