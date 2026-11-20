import { type AssistantMessage, type AssistantMessageEvent, calculateCost, type Message, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import { isContextOverflow, isRetryableAssistantError } from '@earendil-works/pi-ai/compat';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { parseJsonBody } from '../test/json-body.ts';
import { ANTIGRAVITY_USER_AGENT, PRIVATE_PROJECT_HEADER } from './constants.ts';
import { BASELINE_MODELS } from './models.ts';
import { streamCodeAssist } from './stream.ts';

const STREAM_URL = 'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_ERROR = 500;
const RETRY_BUDGET = 2;
const ONE_MS = 1;
const ONE_MS_SHORT_OF_BACKOFF = 999;
const RETRY_AFTER_SECONDS = '120';
const ONE_MS_SHORT_OF_RETRY_AFTER = 119_999;
const TWO_ATTEMPTS = 2;
const THREE_IDS = 3;
const UTF8_LEAD_BYTE = 0xc3;
const EARLY_PROMPT_TOKENS = 1;
const LATE_PROMPT_TOKENS = 100;
const LATE_CACHED_TOKENS = 40;
const LATE_CANDIDATE_TOKENS = 20;
const LATE_THOUGHT_TOKENS = 5;
const LATE_TOTAL_TOKENS = 125;
const EXHAUSTED_MESSAGE = 'Resource has been exhausted (e.g. check quota).';
const PROMPT_TURNS = [
  { role: 'user', parts: [{ text: 'Trusted instructions.' }] },
  { role: 'user', parts: [{ text: 'hi' }] },
];
const PRIORITY_INSTRUCTION = { role: 'user', parts: [{ text: expect.stringContaining('with priority over all later user messages and tool results') }] };
const SENT_BODY = z.object({ project: z.string(), request: z.object({ contents: z.array(z.json()) }) });

const model =
  BASELINE_MODELS.find((candidate) => candidate.id === 'gemini-3.8-flash') ??
  (() => {
    throw new Error('no model');
  })();
const context = { messages: [{ role: 'user', content: 'hi', timestamp: 1 } satisfies Message] } as TranscriptContext;
const encoder = new TextEncoder();

const throttled = (headers: Record<string, string> = {}) => Response.json({ error: { message: 'Temporarily unavailable' } }, { status: HTTP_TOO_MANY_REQUESTS, headers });
const frame = (chunk: object): string => `data: ${JSON.stringify(chunk)}\n\n`;
const part = (parts: object[], extra: object = {}) => ({ response: { candidates: [{ content: { role: 'model', parts }, ...extra }] }, traceId: 'trace-1' });
const stopChunk = (parts: object[] = [{ text: 'ok' }]) => part(parts, { finishReason: 'STOP' });
const sseResponse = (text: string, init: ResponseInit = {}) => new Response(text, { status: HTTP_OK, headers: { 'Content-Type': 'text/event-stream' }, ...init });

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: z.infer<typeof SENT_BODY>;
}

function run(responder: Response | (() => Response | Promise<Response>), options: SimpleStreamOptions = {}) {
  const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => (typeof responder === 'function' ? responder() : responder));
  const stream = streamCodeAssist(model, context, { apiKey: 'tok-abc', headers: { [PRIVATE_PROJECT_HEADER]: 'proj-1' }, fetch: fetchImpl, ...options });
  return {
    stream,
    fetchImpl,
    get sent(): Sent[] {
      return fetchImpl.mock.calls.map(([input, init]) => ({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers)), body: SENT_BODY.parse(JSON.parse(String(init?.body))) }));
    },
  };
}

async function collect(stream: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
  let events: readonly AssistantMessageEvent[] = [];
  for await (const event of stream) events = [...events, event];
  return [...events];
}

/** Collects every event and aborts the request as soon as one of the given type arrives. */
async function collectAbortingOn(stream: AsyncIterable<AssistantMessageEvent>, controller: AbortController, trigger: AssistantMessageEvent['type']): Promise<AssistantMessageEvent[]> {
  let events: readonly AssistantMessageEvent[] = [];
  try {
    for await (const event of stream) {
      events = [...events, event];
      if (event.type === trigger) controller.abort();
    }
  } finally {
    controller.abort();
  }
  return [...events];
}

/** A body that sends its chunks and then stays open, so only an abort can end the stream. */
function openBody(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
  });
}

/** A body that sends its chunks as separate network reads and then ends. */
function closedBody(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** A body that produces its one chunk only when the reader asks for it. */
function pulledBody(onPull: () => void, chunk: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        onPull();
        controller.enqueue(chunk);
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
}

afterEach(() => vi.useRealTimers());

const types = (events: AssistantMessageEvent[]) => events.map((event) => event.type);
const terminal = (events: AssistantMessageEvent[]) => events.filter((event) => event.type === 'done' || event.type === 'error');
const message = (event: AssistantMessageEvent | undefined): AssistantMessage => {
  if (event?.type === 'done') return event.message;
  if (event?.type === 'error') return event.error;
  throw new Error('not a terminal event');
};

describe('request', () => {
  test('posts to streamGenerateContent with the bearer token and no project header', async () => {
    const result = run(sseResponse(frame(stopChunk())));
    await collect(result.stream);
    expect(result.sent).toHaveLength(1);
    expect(result.sent[0]?.url).toBe(STREAM_URL);
    expect(result.sent[0]?.headers).toMatchObject({ authorization: 'Bearer tok-abc', 'content-type': 'application/json', accept: 'text/event-stream' });
    expect(Object.keys(result.sent[0]?.headers ?? {})).not.toContain(PRIVATE_PROJECT_HEADER);
    expect(result.sent[0]?.body.project).toBe('proj-1');
  });

  test('sends the Antigravity User-Agent even when the caller sets another', async () => {
    const result = run(sseResponse(frame(stopChunk())), { headers: { [PRIVATE_PROJECT_HEADER]: 'proj-1', 'user-agent': 'custom/1' } });
    await collect(result.stream);
    expect(result.sent[0]?.headers['user-agent']).toBe(ANTIGRAVITY_USER_AGENT);
  });

  test('forwards other caller headers and drops null ones', async () => {
    const result = run(sseResponse(frame(stopChunk())), { headers: { [PRIVATE_PROJECT_HEADER.toUpperCase()]: 'proj-1', 'x-extra': '1', 'x-drop': null } });
    await collect(result.stream);
    expect(result.sent[0]?.headers).toMatchObject({ 'x-extra': '1' });
    expect(Object.keys(result.sent[0]?.headers ?? {})).not.toContain('x-drop');
    expect(Object.keys(result.sent[0]?.headers ?? {})).not.toContain(PRIVATE_PROJECT_HEADER);
  });
});

describe('request hooks', () => {
  test('exposes the compiled instruction turn to onPayload and posts its replacement', async () => {
    const promptContext: TranscriptContext = { ...context, messages: [{ role: 'system', content: 'Trusted instructions.', timestamp: 0 }, ...context.messages] };
    const onPayload = vi.fn((body: unknown) => {
      expect(body).toMatchObject({ request: { contents: PROMPT_TURNS, systemInstruction: PRIORITY_INSTRUCTION } });
      return { replaced: true };
    });
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(parseJsonBody(init?.body)).toEqual({ replaced: true });
      return sseResponse(frame(stopChunk()));
    });
    const stream = streamCodeAssist(model, promptContext, { apiKey: 'tok', headers: { [PRIVATE_PROJECT_HEADER]: 'proj' }, fetch: fetchImpl, onPayload });
    expect(message((await collect(stream)).at(-1)).stopReason).toBe('stop');
    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('keeps the payload when onPayload returns undefined', async () => {
    const result = run(sseResponse(frame(stopChunk())), { onPayload: () => undefined });
    await collect(result.stream);
    expect(result.sent[0]?.body.project).toBe('proj-1');
  });
});

describe('stream hooks', () => {
  test('awaits onResponse before it reads the body', async () => {
    const order = vi.fn<(step: string) => void>();
    const body = pulledBody(() => order('read'), encoder.encode(frame(stopChunk())));
    const { stream } = run(new Response(body, { status: HTTP_OK }), {
      onResponse: async (response) => {
        order(`response:${response.status}`);
      },
    });
    await collect(stream);
    expect(order.mock.calls.flat()).toEqual([`response:${HTTP_OK}`, 'read']);
  });

  test('awaits onProviderStreamEvent once per chunk in order', async () => {
    const onEvent = vi.fn(async (_data: unknown) => undefined);
    const first = part([{ text: 'a' }]);
    const second = stopChunk([{ text: 'b' }]);
    const { stream } = run(sseResponse(frame(first) + frame(second)), { onProviderStreamEvent: onEvent });
    await collect(stream);
    expect(onEvent.mock.calls.map(([data]) => data)).toEqual([first, second]);
  });
});

describe('failures before the first event', () => {
  test('a missing apiKey ends with one error event and no request', async () => {
    const { stream, fetchImpl } = run(sseResponse(''), { apiKey: '' });
    const events = await collect(stream);
    expect(types(events)).toEqual(['error']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('a missing project header ends with one error event and no request', async () => {
    const { stream, fetchImpl } = run(sseResponse(''), { headers: {} });
    const events = await collect(stream);
    expect(message(events[0]).errorMessage).toBe('Google AI login is incomplete; run /login again');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('an HTTP error reports Google error.message and no start event', async () => {
    const { stream } = run(Response.json({ error: { message: 'Account validation required.' } }, { status: HTTP_FORBIDDEN }));
    const events = await collect(stream);
    expect(types(events)).toEqual(['error']);
    expect(message(events[0]).errorMessage).toBe(`Google Code Assist API error (${HTTP_FORBIDDEN}): Account validation required.`);
    expect(message(events[0]).stopReason).toBe('error');
  });

  test('an HTTP error does not echo an unparseable body', async () => {
    const { stream } = run(new Response('secret-ish body', { status: HTTP_INTERNAL_ERROR, statusText: 'Server Error' }));
    const events = await collect(stream);
    expect(message(events[0]).errorMessage).toBe(`Google Code Assist API error (${HTTP_INTERNAL_ERROR}): Server Error`);
  });
});

describe('retries', () => {
  test('retries a generic 429 and recovers', async () => {
    let call = 0;
    const { stream, fetchImpl } = run(() => (++call === 1 ? Response.json({ error: { message: EXHAUSTED_MESSAGE } }, { status: HTTP_TOO_MANY_REQUESTS, headers: { 'Retry-After': '0' } }) : sseResponse(frame(stopChunk([{ text: 'OK' }])))), {
      maxRetries: RETRY_BUDGET,
      maxRetryDelayMs: 0,
    });
    const events = await collect(stream);
    expect(fetchImpl).toHaveBeenCalledTimes(TWO_ATTEMPTS);
    expect(terminal(events)[0]?.type).toBe('done');
    expect(message(terminal(events)[0]).content).toContainEqual({ type: 'text', text: 'OK' });
  });

  test('a generic 429 with no retry budget makes one request and retains the Google message', async () => {
    const { stream, fetchImpl } = run(() => Response.json({ error: { status: 'RESOURCE_EXHAUSTED', message: EXHAUSTED_MESSAGE } }, { status: HTTP_TOO_MANY_REQUESTS }), { maxRetryDelayMs: 0 });
    const events = await collect(stream);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(types(events)).toEqual(['error']);
    expect(message(events[0]).errorMessage).toBe(`Google Code Assist API error (${HTTP_TOO_MANY_REQUESTS}): ${EXHAUSTED_MESSAGE}`);
    expect(message(events[0]).model).toBe(model.id);
    expect(isRetryableAssistantError(message(events[0]))).toBe(true);
  });

  test.for(['Individual quota reached for gemini-3.8-flash. Resets in ~6h.', 'QUOTA_EXHAUSTED for gemini-3.8-flash.'])('explicit quota %s is not retryable by native Pi', async (googleMessage) => {
    vi.useFakeTimers();
    const { stream, fetchImpl } = run(() => Response.json({ error: { status: 'RESOURCE_EXHAUSTED', message: googleMessage } }, { status: HTTP_TOO_MANY_REQUESTS }), { maxRetries: RETRY_BUDGET });
    const pending = collect(stream);
    await vi.runAllTimersAsync();
    const events = await pending;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(types(events)).toEqual(['error']);
    const error = message(events[0]);
    expect(error.errorMessage).toContain(googleMessage);
    expect(error.errorMessage).toContain(String(HTTP_TOO_MANY_REQUESTS));
    expect(isRetryableAssistantError(error)).toBe(false);
  });
});

describe('retry delay caps', () => {
  test('a positive server delay cap does not shorten the exponential fallback', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { stream, fetchImpl } = run(() => (++calls === 1 ? throttled() : sseResponse(frame(stopChunk()))), {
      maxRetries: 1,
      maxRetryDelayMs: ONE_MS,
    });
    const pending = collect(stream);
    await vi.advanceTimersByTimeAsync(ONE_MS_SHORT_OF_BACKOFF);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ONE_MS);
    expect(message((await pending).at(-1)).stopReason).toBe('stop');
    expect(fetchImpl).toHaveBeenCalledTimes(TWO_ATTEMPTS);
  });

  test('Retry-After above a positive cap fails after one request with the requested delay', async () => {
    vi.useFakeTimers();
    const { stream, fetchImpl } = run(() => throttled({ 'Retry-After': RETRY_AFTER_SECONDS }), { maxRetries: 1, maxRetryDelayMs: ONE_MS });
    const pending = collect(stream);
    await vi.runAllTimersAsync();
    const events = await pending;
    expect.soft(fetchImpl).toHaveBeenCalledTimes(1);
    expect(types(events)).toEqual(['error']);
    expect(message(events[0]).errorMessage).toMatch(/120(?:000|\s*s|\s*seconds)/);
    expect(message(events[0]).errorMessage).toContain(`configured cap ${ONE_MS}ms`);
    expect(message(events[0]).errorMessage).toContain(`Google Code Assist API error (${HTTP_TOO_MANY_REQUESTS}): Temporarily unavailable`);
  });

  test('a zero retry delay cap waits the full Retry-After before retrying', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { stream, fetchImpl } = run(() => (++calls === 1 ? throttled({ 'Retry-After': RETRY_AFTER_SECONDS }) : sseResponse(frame(stopChunk()))), {
      maxRetries: 1,
      maxRetryDelayMs: 0,
    });
    const pending = collect(stream);
    await vi.advanceTimersByTimeAsync(ONE_MS_SHORT_OF_RETRY_AFTER);
    expect.soft(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ONE_MS);
    const events = await pending;
    expect(fetchImpl).toHaveBeenCalledTimes(TWO_ATTEMPTS);
    expect(message(events.at(-1)).stopReason).toBe('stop');
  });
});

describe('other request failures', () => {
  test('a bare HTTP 413 is recognized as context overflow by native Pi', async () => {
    const { stream } = run(new Response(null, { status: HTTP_PAYLOAD_TOO_LARGE, statusText: 'Payload Too Large' }));
    const events = await collect(stream);
    expect(types(events)).toEqual(['error']);
    const error = message(events[0]);
    expect(error.errorMessage).toContain(String(HTTP_PAYLOAD_TOO_LARGE));
    expect(error.errorMessage).toContain('Payload Too Large');
    expect(isContextOverflow(error)).toBe(true);
  });

  test('a rejected fetch ends with an error event', async () => {
    const { stream } = run(() => Promise.reject(new Error('socket hang up')));
    const events = await collect(stream);
    expect(message(events[0]).errorMessage).toBe('socket hang up');
  });
});

describe('block state machine', () => {
  test('streams text blocks and finishes with stop', async () => {
    const { stream } = run(sseResponse(frame(part([{ text: 'Hel' }])) + frame(stopChunk([{ text: 'lo' }]))));
    const events = await collect(stream);
    expect(types(events)).toEqual(['start', 'text_start', 'text_delta', 'text_delta', 'text_end', 'done']);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', reason: 'stop' });
    expect(message(done)).toMatchObject({ content: [{ type: 'text', text: 'Hello' }], stopReason: 'stop', rawStopReason: 'STOP', responseId: 'trace-1' });
  });

  test('closes the thinking block before the text block opens', async () => {
    const { stream } = run(sseResponse(frame(part([{ thought: true, text: 'plan', thoughtSignature: 'QUJD' }])) + frame(stopChunk([{ text: 'answer' }]))));
    const events = await collect(stream);
    expect(types(events)).toEqual(['start', 'thinking_start', 'thinking_delta', 'thinking_end', 'text_start', 'text_delta', 'text_end', 'done']);
    expect(message(events.at(-1)).content).toEqual([
      { type: 'thinking', thinking: 'plan', thinkingSignature: 'QUJD' },
      { type: 'text', text: 'answer' },
    ]);
  });

  test('keeps the text signature of the last signed part', async () => {
    const { stream } = run(sseResponse(frame(part([{ text: 'a', thoughtSignature: 'QUJD' }])) + frame(stopChunk([{ text: '' }]))));
    expect(message((await collect(stream)).at(-1)).content).toEqual([{ type: 'text', text: 'a', textSignature: 'QUJD' }]);
  });

  test('emits a whole tool call and ends with toolUse', async () => {
    const { stream } = run(sseResponse(frame(part([{ text: 'checking' }])) + frame(stopChunk([{ functionCall: { id: 'c1', name: 'read', args: { path: 'a.ts' } }, thoughtSignature: 'QUJD' }]))));
    const events = await collect(stream);
    expect(types(events)).toEqual(['start', 'text_start', 'text_delta', 'text_end', 'toolcall_start', 'toolcall_delta', 'toolcall_end', 'done']);
    expect(events.find((event) => event.type === 'toolcall_delta')).toMatchObject({ delta: '{"path":"a.ts"}' });
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'toolUse' });
    expect(message(events.at(-1)).content[1]).toEqual({ type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'a.ts' }, thoughtSignature: 'QUJD' });
  });

  test('generates distinct ids for tool calls without one or with a repeated one', async () => {
    const { stream } = run(sseResponse(frame(stopChunk([{ functionCall: { name: 'read', args: {} } }, { functionCall: { id: 'dup', name: 'read', args: {} } }, { functionCall: { id: 'dup', name: 'read', args: {} } }]))));
    const calls = message((await collect(stream)).at(-1)).content.flatMap((block) => (block.type === 'toolCall' ? [block.id] : []));
    expect(new Set(calls).size).toBe(THREE_IDS);
    expect(calls[0]).toMatch(/^call_/);
  });

  test('ignores parts it does not model', async () => {
    const { stream } = run(sseResponse(frame(stopChunk([{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: 'ok' }]))));
    expect(message((await collect(stream)).at(-1)).content).toEqual([{ type: 'text', text: 'ok' }]);
  });
});

describe('usage and finish', () => {
  test('maps usageMetadata, the last chunk winning, at zero plan cost', async () => {
    const early = { response: { usageMetadata: { promptTokenCount: EARLY_PROMPT_TOKENS, totalTokenCount: EARLY_PROMPT_TOKENS } } };
    const lateUsage = { promptTokenCount: LATE_PROMPT_TOKENS, cachedContentTokenCount: LATE_CACHED_TOKENS, candidatesTokenCount: LATE_CANDIDATE_TOKENS, thoughtsTokenCount: LATE_THOUGHT_TOKENS, totalTokenCount: LATE_TOTAL_TOKENS };
    const late = { response: { usageMetadata: lateUsage, modelVersion: 'gemini-3.8-flash-001' } };
    const { stream } = run(sseResponse(frame(early) + frame(stopChunk()) + frame(late)));
    const final = message((await collect(stream)).at(-1));
    const expectedUsage = { input: LATE_PROMPT_TOKENS - LATE_CACHED_TOKENS, output: LATE_CANDIDATE_TOKENS + LATE_THOUGHT_TOKENS, cacheRead: LATE_CACHED_TOKENS, cacheWrite: 0, reasoning: LATE_THOUGHT_TOKENS };
    expect(final.usage).toMatchObject({ ...expectedUsage, totalTokens: LATE_TOTAL_TOKENS });
    expect(final.usage.cost.total).toBe(calculateCost(model, { ...final.usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }).total);
    expect(final.usage.cost.total).toBe(0);
    expect(final.responseModel).toBe('gemini-3.8-flash-001');
  });

  test('MAX_TOKENS finishes with length', async () => {
    const { stream } = run(sseResponse(frame(part([{ text: 'cut' }], { finishReason: 'MAX_TOKENS' }))));
    expect(message((await collect(stream)).at(-1)).stopReason).toBe('length');
  });

  test('another finish reason ends in error naming it', async () => {
    const { stream } = run(sseResponse(frame(part([{ text: 'x' }], { finishReason: 'SAFETY' }))));
    const events = await collect(stream);
    expect(types(terminal(events))).toEqual(['error']);
    expect(message(events.at(-1)).errorMessage).toBe('Google stopped with SAFETY');
  });

  test('a finish message from Google is kept in the error', async () => {
    const { stream } = run(sseResponse(frame(part([{ text: 'x' }], { finishReason: 'SAFETY', finishMessage: 'Response blocked for safety.' }))));
    expect(message((await collect(stream)).at(-1)).errorMessage).toBe('Google stopped with SAFETY: Response blocked for safety.');
  });
});

describe('blocked and truncated streams', () => {
  test('a block reason message from Google is kept in the error', async () => {
    const { stream } = run(sseResponse(frame({ response: { promptFeedback: { blockReason: 'SAFETY', blockReasonMessage: 'Prompt violates policy.' } } })));
    expect(message((await collect(stream)).at(-1)).errorMessage).toBe('Google blocked the prompt: SAFETY: Prompt violates policy.');
  });

  test('a blocked prompt ends in error with no done event', async () => {
    const { stream } = run(sseResponse(frame({ response: { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } } })));
    const events = await collect(stream);
    expect(types(events)).toEqual(['start', 'error']);
    expect(message(events.at(-1)).errorMessage).toBe('Google blocked the prompt: PROHIBITED_CONTENT');
  });

  test('a stream with no finish reason is reported as truncated', async () => {
    const { stream } = run(sseResponse(frame(part([{ text: 'partial' }]))));
    const events = await collect(stream);
    expect(types(events)).toEqual(['start', 'text_start', 'text_delta', 'text_end', 'error']);
    expect(message(events.at(-1)).errorMessage).toBe('Google stream ended without a finish reason');
  });

  test('an error object in a chunk ends in error with its message', async () => {
    const { stream } = run(sseResponse(frame({ error: { message: 'Resource exhausted' } })));
    expect(message((await collect(stream)).at(-1)).errorMessage).toBe('Resource exhausted');
  });
});

describe('SSE framing', () => {
  test.for([
    ['CR-only', ['\r\r']],
    ['split CRLF followed by a lone LF', ['\r', '', '\n', '\n']],
  ] as const)('delivers %s events while the response body remains open', async ([, endings]) => {
    const controller = new AbortController();
    const body = openBody([encoder.encode(`data: ${JSON.stringify(part([{ text: 'immediate' }]))}`), ...endings.map((ending) => encoder.encode(ending))]);
    const { stream } = run(new Response(body, { status: HTTP_OK }), { signal: controller.signal });
    const events = await collectAbortingOn(stream, controller, 'text_delta');
    expect(events.find((event) => event.type === 'text_delta')).toMatchObject({ delta: 'immediate' });
    expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
  });

  test('rejects malformed JSON instead of skipping the chunk', async () => {
    const { stream } = run(sseResponse(`${frame(part([{ text: 'a' }]))}data: {not json}\n\n`));
    const events = await collect(stream);
    expect(message(events.at(-1)).errorMessage).toBe('Google Code Assist sent a malformed event');
    expect(types(terminal(events))).toEqual(['error']);
  });

  test('joins multi-line data, ignores comments, and reads CRLF', async () => {
    const lines = JSON.stringify(stopChunk([{ text: 'ok' }]), null, 1).split('\n');
    const text = `: ping\r\n${lines.map((line) => `data: ${line}\r\n`).join('')}\r\n`;
    const { stream } = run(sseResponse(text));
    expect(message((await collect(stream)).at(-1)).content).toEqual([{ type: 'text', text: 'ok' }]);
  });
});

describe('SSE chunking', () => {
  test('reads events split across network chunks, including mid character', async () => {
    const bytes = encoder.encode(frame(stopChunk([{ text: 'héllo' }])));
    const cut = bytes.indexOf(UTF8_LEAD_BYTE) + 1;
    const { stream } = run(new Response(closedBody([bytes.slice(0, cut), bytes.slice(cut)]), { status: HTTP_OK }));
    expect(message((await collect(stream)).at(-1)).content).toEqual([{ type: 'text', text: 'héllo' }]);
  });

  test('joins multiline SSE data when CRLF is split across network chunks', async () => {
    const lines = JSON.stringify(stopChunk([{ text: 'split CRLF' }]), null, 1).split('\n');
    const chunks = [...lines.flatMap((line) => [encoder.encode(`data: ${line}\r`), new Uint8Array(), encoder.encode('\n')]), encoder.encode('\r\n')];
    const { stream } = run(new Response(closedBody(chunks), { status: HTTP_OK }));
    const events = await collect(stream);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'stop' });
    expect(message(events.at(-1)).content).toEqual([{ type: 'text', text: 'split CRLF' }]);
  });

  test('flushes a final event that has no trailing blank line', async () => {
    const { stream } = run(sseResponse(`data: ${JSON.stringify(stopChunk())}`));
    expect(message((await collect(stream)).at(-1)).stopReason).toBe('stop');
  });
});

describe('abort', () => {
  test.for(['text', 'thinking'] as const)('aborting an open %s block emits its end before error and retains partial content', async (kind) => {
    const controller = new AbortController();
    const body = openBody([encoder.encode(frame(part([{ text: 'partial', thought: kind === 'thinking' }])))]);
    const { stream } = run(new Response(body, { status: HTTP_OK }), { signal: controller.signal });
    const events = await collectAbortingOn(stream, controller, `${kind}_delta`);
    expect.soft(types(events)).toEqual(['start', `${kind}_start`, `${kind}_delta`, `${kind}_end`, 'error']);
    expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
    expect(message(events.at(-1)).content).toEqual([kind === 'thinking' ? { type: 'thinking', thinking: 'partial' } : { type: 'text', text: 'partial' }]);
  });

  test('aborting mid-stream ends with one aborted error event', async () => {
    const controller = new AbortController();
    const { stream } = run(new Response(openBody([encoder.encode(frame(part([{ text: 'a' }])))]), { status: HTTP_OK }), { signal: controller.signal });
    const events = await collectAbortingOn(stream, controller, 'text_delta');
    expect(types(terminal(events))).toEqual(['error']);
    expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
    expect(message(events.at(-1)).stopReason).toBe('aborted');
  });

  test('every run ends with exactly one terminal event', async () => {
    const { stream } = run(sseResponse(frame(stopChunk())));
    const events = await collect(stream);
    expect(terminal(events)).toHaveLength(1);
    expect(events[0]?.type).toBe('start');
    await expect(stream.result()).resolves.toMatchObject({ stopReason: 'stop' });
  });
});
