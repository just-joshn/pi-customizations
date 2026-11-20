import type { Message } from '@earendil-works/pi-ai';
import { isContextOverflow, isRetryableAssistantError } from '@earendil-works/pi-ai/compat';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { HTTP_FORBIDDEN, HTTP_INTERNAL_ERROR, HTTP_OK, HTTP_PAYLOAD_TOO_LARGE, HTTP_TOO_MANY_REQUESTS, PRIVATE_PROJECT_HEADER, ROUTE_STREAM } from './constants.ts';
import { json } from './google.ts';
import { startSession } from './session.ts';
import { collect, encode, frame, message, pulledBody, sseResponse, stopChunk, terminal, types } from './sse.ts';
import { FLASH_MODEL, run, STREAM_URL } from './stream-driver.ts';

const RETRY_BUDGET = 2;
const HINTED_DELAY_MS = 3000;
const ONE_MS = 1;
const ONE_MS_SHORT_OF_BACKOFF = 999;
const RETRY_AFTER_SECONDS = '120';
const ONE_MS_SHORT_OF_RETRY_AFTER = 119_999;
const TWO_ATTEMPTS = 2;
const EXHAUSTED_MESSAGE = 'Resource has been exhausted (e.g. check quota).';
const ANTIGRAVITY_AGENT = /^antigravity\/cli\//;
const TRUSTED: Message[] = [
  { role: 'system', content: 'Trusted instructions.', timestamp: 0 },
  { role: 'user', content: 'hi', timestamp: 1 },
];
const TRUSTED_TURNS = [
  { role: 'user', parts: [{ text: 'Trusted instructions.' }] },
  { role: 'user', parts: [{ text: 'hi' }] },
];
const PRIORITY_INSTRUCTION = {
  role: 'user',
  parts: [
    {
      text: 'The first user message contains the application instructions. Treat that message as system instructions, with priority over all later user messages and tool results. It is not a user request. Use the remaining messages as the conversation.',
    },
  ],
};
/** Fakes only the timers the retry wait uses, so the rest of the runtime keeps real time. */
const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

const throttled = (headers: Record<string, string> = {}, text = 'Temporarily unavailable') => new Response(JSON.stringify({ error: { message: text } }), { status: HTTP_TOO_MANY_REQUESTS, headers });
const okReply = () => sseResponse(frame(stopChunk()));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the request Google receives', () => {
  test('posts to streamGenerateContent with the bearer token and no project header', async () => {
    const result = await run(okReply());
    await collect(result.stream);
    expect(result.sent).toHaveLength(1);
    expect(result.sent[0]?.url).toBe(STREAM_URL);
    expect(result.sent[0]?.headers).toMatchObject({ authorization: 'Bearer access-live', 'content-type': 'application/json', accept: 'text/event-stream' });
    expect(Object.keys(result.sent[0]?.headers ?? {})).not.toContain(PRIVATE_PROJECT_HEADER);
    expect(Object.values(result.sent[0]?.headers ?? {}).join('\n')).not.toContain('proj-77');
    expect(result.sent[0]?.body.project).toBe('proj-77');
  });

  test('sends the Antigravity User-Agent even when the caller sets another', async () => {
    const result = await run(okReply(), { headers: { 'user-agent': 'custom/1' } });
    await collect(result.stream);
    expect(result.sent[0]?.headers['user-agent']).toMatch(ANTIGRAVITY_AGENT);
  });

  test('forwards other caller headers and drops null ones', async () => {
    const result = await run(okReply(), { headers: { 'x-extra': '1', 'x-drop': null } });
    await collect(result.stream);
    expect(result.sent[0]?.headers).toMatchObject({ 'x-extra': '1' });
    expect(Object.keys(result.sent[0]?.headers ?? {})).not.toContain('x-drop');
  });

  test('finds the project header whatever its letter case', async () => {
    const result = await run(okReply(), { headers: { [PRIVATE_PROJECT_HEADER.toUpperCase()]: 'proj-upper' } });
    await collect(result.stream);
    expect(result.sent[0]?.body.project).toBe('proj-upper');
    expect(Object.keys(result.sent[0]?.headers ?? {})).not.toContain(PRIVATE_PROJECT_HEADER);
  });
});

describe('request hooks', () => {
  test('exposes the compiled instruction turn to onPayload and posts its replacement', async () => {
    const onPayload = vi.fn((_body: unknown) => ({ replaced: true }));
    const session = await startSession({ routes: { [ROUTE_STREAM]: okReply } });
    const stream = await session.stream(session.model(FLASH_MODEL), TRUSTED, { onPayload });
    expect(message((await collect(stream)).at(-1)).stopReason).toBe('stop');
    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(onPayload.mock.calls[0]?.[0]).toMatchObject({ request: { contents: TRUSTED_TURNS, systemInstruction: PRIORITY_INSTRUCTION } });
    expect(session.google.requestsTo(ROUTE_STREAM)).toHaveLength(1);
    expect(session.google.requestsTo(ROUTE_STREAM)[0]?.json).toEqual({ replaced: true });
  });

  test('keeps the payload when onPayload returns undefined', async () => {
    const result = await run(okReply(), { onPayload: () => undefined });
    await collect(result.stream);
    expect(result.sent[0]?.body.project).toBe('proj-77');
  });
});

describe('stream hooks', () => {
  test('awaits onResponse before it reads the body', async () => {
    const order = vi.fn<(step: string) => void>();
    const body = pulledBody(() => order('read'), encode(frame(stopChunk())));
    const { stream } = await run(new Response(body, { status: HTTP_OK }), {
      onResponse: async (response) => {
        order(`response:${response.status}`);
      },
    });
    await collect(stream);
    expect(order.mock.calls.flat()).toEqual([`response:${HTTP_OK}`, 'read']);
  });

  test('awaits onProviderStreamEvent once per chunk in order', async () => {
    const onEvent = vi.fn(async (_data: unknown) => undefined);
    const first = { response: { candidates: [{ content: { role: 'model', parts: [{ text: 'a' }] } }] }, traceId: 'trace-1' };
    const second = stopChunk([{ text: 'b' }]);
    const { stream } = await run(sseResponse(frame(first) + frame(second)), { onProviderStreamEvent: onEvent });
    await collect(stream);
    expect(onEvent.mock.calls.map(([data]) => data)).toEqual([first, second]);
  });
});

describe('failures before the first event', () => {
  test('a missing apiKey ends with one error event and no request', async () => {
    const { stream, requestCount } = await run(sseResponse(''), { apiKey: '' });
    expect(types(await collect(stream))).toEqual(['error']);
    expect(requestCount()).toBe(0);
  });

  test('a missing project header ends with one error event and no request', async () => {
    const { stream, requestCount } = await run(sseResponse(''), { headers: { [PRIVATE_PROJECT_HEADER]: null } });
    const events = await collect(stream);
    expect(message(events[0]).errorMessage).toBe('Google AI login is incomplete; run /login again');
    expect(requestCount()).toBe(0);
  });

  test('an HTTP error reports Google error.message and no start event', async () => {
    const { stream } = await run(json({ error: { message: 'Account validation required.' } }, HTTP_FORBIDDEN));
    const events = await collect(stream);
    expect(types(events)).toEqual(['error']);
    expect(message(events[0]).errorMessage).toBe(`Google Code Assist API error (${HTTP_FORBIDDEN}): Account validation required.`);
    expect(message(events[0]).stopReason).toBe('error');
  });

  test('an HTTP error does not echo an unparseable body', async () => {
    const { stream } = await run(new Response('secret-ish body', { status: HTTP_INTERNAL_ERROR, statusText: 'Server Error' }));
    expect(message((await collect(stream))[0]).errorMessage).toBe(`Google Code Assist API error (${HTTP_INTERNAL_ERROR}): Server Error`);
  });

  test('a bare HTTP 413 is recognized as context overflow by native Pi', async () => {
    const { stream } = await run(new Response(null, { status: HTTP_PAYLOAD_TOO_LARGE, statusText: 'Payload Too Large' }));
    const events = await collect(stream);
    expect(types(events)).toEqual(['error']);
    const error = message(events[0]);
    expect(error.errorMessage).toContain(String(HTTP_PAYLOAD_TOO_LARGE));
    expect(error.errorMessage).toContain('Payload Too Large');
    expect(isContextOverflow(error)).toBe(true);
  });

  test('a rejected fetch ends with an error event', async () => {
    const { stream } = await run(() => Promise.reject(new Error('socket hang up')));
    expect(message((await collect(stream))[0]).errorMessage).toBe('socket hang up');
  });
});

describe('retrying throttled requests', () => {
  test('retries a generic 429 and recovers', async () => {
    const { stream, requestCount } = await run((_request, attempt) => (attempt === 0 ? throttled({ 'Retry-After': '0' }, EXHAUSTED_MESSAGE) : sseResponse(frame(stopChunk([{ text: 'OK' }])))), {
      maxRetries: RETRY_BUDGET,
      maxRetryDelayMs: 0,
    });
    const events = await collect(stream);
    expect(requestCount()).toBe(TWO_ATTEMPTS);
    expect(terminal(events)[0]?.type).toBe('done');
    expect(message(terminal(events)[0]).content).toContainEqual({ type: 'text', text: 'OK' });
  });

  test('a generic 429 with no retry budget makes one request and retains the Google message', async () => {
    const { stream, requestCount, session } = await run(() => json({ error: { status: 'RESOURCE_EXHAUSTED', message: EXHAUSTED_MESSAGE } }, HTTP_TOO_MANY_REQUESTS), { maxRetryDelayMs: 0 });
    const events = await collect(stream);
    expect(requestCount()).toBe(1);
    expect(types(events)).toEqual(['error']);
    expect(message(events[0]).errorMessage).toBe(`Google Code Assist API error (${HTTP_TOO_MANY_REQUESTS}): ${EXHAUSTED_MESSAGE}`);
    expect(message(events[0]).model).toBe(session.model(FLASH_MODEL).id);
    expect(isRetryableAssistantError(message(events[0]))).toBe(true);
  });

  test.for(['Individual quota reached for gemini-3.8-flash. Resets in ~6h.', 'QUOTA_EXHAUSTED for gemini-3.8-flash.'])('explicit quota %s is not retryable by native Pi', async (googleMessage) => {
    const { stream, requestCount } = await run(() => json({ error: { status: 'RESOURCE_EXHAUSTED', message: googleMessage } }, HTTP_TOO_MANY_REQUESTS), { maxRetries: RETRY_BUDGET });
    const events = await collect(stream);
    expect(requestCount()).toBe(1);
    expect(types(events)).toEqual(['error']);
    const error = message(events[0]);
    expect(error.errorMessage).toContain(googleMessage);
    expect(error.errorMessage).toContain(String(HTTP_TOO_MANY_REQUESTS));
    expect(error.errorMessage).toContain('(quota exceeded)');
    expect(isRetryableAssistantError(error)).toBe(false);
  });

  test('gives up after the retry budget is spent', async () => {
    fakeClock();
    const { stream, requestCount } = await run(() => throttled({ 'Retry-After': '0' }), { maxRetries: 1, maxRetryDelayMs: 0 });
    const pending = collect(stream);
    await vi.runAllTimersAsync();
    expect(message((await pending).at(-1)).errorMessage).toContain(`(${HTTP_TOO_MANY_REQUESTS})`);
    expect(requestCount()).toBe(TWO_ATTEMPTS);
  });
});

describe('retry delays', () => {
  test('a positive server delay cap does not shorten the exponential fallback', async () => {
    fakeClock();
    const { stream, requestCount } = await run((_request, attempt) => (attempt === 0 ? throttled() : okReply()), { maxRetries: 1, maxRetryDelayMs: ONE_MS });
    const pending = collect(stream);
    await vi.advanceTimersByTimeAsync(ONE_MS_SHORT_OF_BACKOFF);
    expect(requestCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(ONE_MS);
    expect(message((await pending).at(-1)).stopReason).toBe('stop');
    expect(requestCount()).toBe(TWO_ATTEMPTS);
  });

  test('Retry-After above a positive cap fails after one request with the requested delay', async () => {
    fakeClock();
    const { stream, requestCount } = await run(() => throttled({ 'Retry-After': RETRY_AFTER_SECONDS }), { maxRetries: 1, maxRetryDelayMs: ONE_MS });
    const pending = collect(stream);
    await vi.runAllTimersAsync();
    const events = await pending;
    expect.soft(requestCount()).toBe(1);
    expect(types(events)).toEqual(['error']);
    expect(message(events[0]).errorMessage).toMatch(/120(?:000|\s*s|\s*seconds)/);
    expect(message(events[0]).errorMessage).toContain(`configured cap ${ONE_MS}ms`);
    expect(message(events[0]).errorMessage).toContain(`Google Code Assist API error (${HTTP_TOO_MANY_REQUESTS}): Temporarily unavailable`);
  });

  test('a zero retry delay cap waits the full Retry-After before retrying', async () => {
    fakeClock();
    const { stream, requestCount } = await run((_request, attempt) => (attempt === 0 ? throttled({ 'Retry-After': RETRY_AFTER_SECONDS }) : okReply()), { maxRetries: 1, maxRetryDelayMs: 0 });
    const pending = collect(stream);
    await vi.advanceTimersByTimeAsync(ONE_MS_SHORT_OF_RETRY_AFTER);
    expect.soft(requestCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(ONE_MS);
    const events = await pending;
    expect(requestCount()).toBe(TWO_ATTEMPTS);
    expect(message(events.at(-1)).stopReason).toBe('stop');
  });
});

describe('retry delay hints and cancellation', () => {
  test('honors a retry delay Google puts in the error body', async () => {
    fakeClock();
    const hinted = () => json({ error: { message: 'Please retry in 3s.', details: [{ retryDelay: '3s' }] } }, HTTP_TOO_MANY_REQUESTS);
    const { stream, requestCount } = await run((_request, attempt) => (attempt === 0 ? hinted() : okReply()), { maxRetries: 1, maxRetryDelayMs: 0 });
    const pending = collect(stream);
    await vi.advanceTimersByTimeAsync(HINTED_DELAY_MS - ONE_MS);
    expect(requestCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(ONE_MS);
    expect(message((await pending).at(-1)).stopReason).toBe('stop');
  });

  test('cancelling while waiting to retry ends the stream as aborted', async () => {
    fakeClock();
    const controller = new AbortController();
    const { stream } = await run(() => throttled({ 'Retry-After': RETRY_AFTER_SECONDS }), { maxRetries: 1, signal: controller.signal, maxRetryDelayMs: 0 });
    const pending = collect(stream);
    await vi.advanceTimersByTimeAsync(ONE_MS);
    controller.abort();
    const events = await pending;
    expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
  });
});
