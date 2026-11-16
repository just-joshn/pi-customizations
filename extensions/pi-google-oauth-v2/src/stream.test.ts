import { type AssistantMessage, type AssistantMessageEvent, calculateCost, type Message, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import { isContextOverflow, isRetryableAssistantError } from '@earendil-works/pi-ai/compat';
import { describe, expect, test, vi } from 'vitest';
import { ANTIGRAVITY_USER_AGENT, PRIVATE_PROJECT_HEADER } from './constants.ts';
import { BASELINE_MODELS } from './models.ts';
import { streamCodeAssist } from './stream.ts';

const model =
  BASELINE_MODELS.find((candidate) => candidate.id === 'gemini-3.8-flash') ??
  (() => {
    throw new Error('no model');
  })();
const context = { messages: [{ role: 'user', content: 'hi', timestamp: 1 } satisfies Message] } as TranscriptContext;
const encoder = new TextEncoder();

const frame = (chunk: object): string => `data: ${JSON.stringify(chunk)}\n\n`;
const part = (parts: object[], extra: object = {}) => ({ response: { candidates: [{ content: { role: 'model', parts }, ...extra }] }, traceId: 'trace-1' });
const stopChunk = (parts: object[] = [{ text: 'ok' }]) => part(parts, { finishReason: 'STOP' });
const sseResponse = (text: string, init: ResponseInit = {}) => new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' }, ...init });

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: { project: string; request: { contents: unknown[] } };
}

function run(responder: Response | (() => Response | Promise<Response>), options: SimpleStreamOptions = {}) {
  const sent: Sent[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers)), body: JSON.parse(String(init?.body)) });
    return typeof responder === 'function' ? responder() : responder;
  });
  const stream = streamCodeAssist(model, context, { apiKey: 'tok-abc', headers: { [PRIVATE_PROJECT_HEADER]: 'proj-1' }, fetch: fetchImpl, ...options });
  return { stream, sent, fetchImpl };
}

async function collect(stream: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const types = (events: AssistantMessageEvent[]) => events.map((event) => event.type);
const terminal = (events: AssistantMessageEvent[]) => events.filter((event) => event.type === 'done' || event.type === 'error');
const message = (event: AssistantMessageEvent | undefined): AssistantMessage => {
  if (event?.type === 'done') return event.message;
  if (event?.type === 'error') return event.error;
  throw new Error('not a terminal event');
};

describe('request', () => {
  test('posts to streamGenerateContent with the bearer token and no project header', async () => {
    const { stream, sent } = run(sseResponse(frame(stopChunk())));
    await collect(stream);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse');
    expect(sent[0]?.headers).toMatchObject({ authorization: 'Bearer tok-abc', 'content-type': 'application/json', accept: 'text/event-stream' });
    expect(Object.keys(sent[0]?.headers ?? {})).not.toContain(PRIVATE_PROJECT_HEADER);
    expect(sent[0]?.body.project).toBe('proj-1');
  });

  test('sends the Antigravity User-Agent even when the caller sets another', async () => {
    const { stream, sent } = run(sseResponse(frame(stopChunk())), { headers: { [PRIVATE_PROJECT_HEADER]: 'proj-1', 'user-agent': 'custom/1' } });
    await collect(stream);
    expect(sent[0]?.headers['user-agent']).toBe(ANTIGRAVITY_USER_AGENT);
  });

  test('forwards other caller headers and drops null ones', async () => {
    const { stream, sent } = run(sseResponse(frame(stopChunk())), { headers: { [PRIVATE_PROJECT_HEADER.toUpperCase()]: 'proj-1', 'x-extra': '1', 'x-drop': null } });
    await collect(stream);
    expect(sent[0]?.headers).toMatchObject({ 'x-extra': '1' });
    expect(Object.keys(sent[0]?.headers ?? {})).not.toContain('x-drop');
    expect(Object.keys(sent[0]?.headers ?? {})).not.toContain(PRIVATE_PROJECT_HEADER);
  });

  test('exposes the compiled instruction turn to onPayload and posts its replacement', async () => {
    const promptContext: TranscriptContext = { ...context, messages: [{ role: 'system', content: 'Trusted instructions.', timestamp: 0 }, ...context.messages] };
    const onPayload = vi.fn((body: unknown) => {
      expect(body).toMatchObject({
        request: {
          contents: [
            { role: 'user', parts: [{ text: 'Trusted instructions.' }] },
            { role: 'user', parts: [{ text: 'hi' }] },
          ],
          systemInstruction: { role: 'user', parts: [{ text: expect.stringContaining('with priority over all later user messages and tool results') }] },
        },
      });
      return { replaced: true };
    });
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ replaced: true });
      return sseResponse(frame(stopChunk()));
    });
    const stream = streamCodeAssist(model, promptContext, { apiKey: 'tok', headers: { [PRIVATE_PROJECT_HEADER]: 'proj' }, fetch: fetchImpl, onPayload });
    expect(message((await collect(stream)).at(-1)).stopReason).toBe('stop');
    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('keeps the payload when onPayload returns undefined', async () => {
    const { stream, sent } = run(sseResponse(frame(stopChunk())), { onPayload: () => undefined });
    await collect(stream);
    expect(sent[0]?.body.project).toBe('proj-1');
  });

  test('awaits onResponse before it reads the body', async () => {
    const order: string[] = [];
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          order.push('read');
          controller.enqueue(encoder.encode(frame(stopChunk())));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const { stream } = run(new Response(body, { status: 200 }), {
      onResponse: async (response) => {
        order.push(`response:${response.status}`);
      },
    });
    await collect(stream);
    expect(order).toEqual(['response:200', 'read']);
  });

  test('awaits onProviderStreamEvent once per chunk in order', async () => {
    const seen: unknown[] = [];
    const first = part([{ text: 'a' }]);
    const second = stopChunk([{ text: 'b' }]);
    const { stream } = run(sseResponse(frame(first) + frame(second)), {
      onProviderStreamEvent: async (data) => {
        seen.push(data);
      },
    });
    await collect(stream);
    expect(seen).toEqual([first, second]);
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
    const { stream } = run(Response.json({ error: { message: 'Account validation required.' } }, { status: 403 }));
    const events = await collect(stream);
    expect(types(events)).toEqual(['error']);
    expect(message(events[0]).errorMessage).toBe('Google Code Assist API error (403): Account validation required.');
    expect(message(events[0]).stopReason).toBe('error');
  });

  test('an HTTP error does not echo an unparseable body', async () => {
    const { stream } = run(new Response('secret-ish body', { status: 500, statusText: 'Server Error' }));
    const events = await collect(stream);
    expect(message(events[0]).errorMessage).toBe('Google Code Assist API error (500): Server Error');
  });

  test('retries a generic 429 and recovers', async () => {
    let call = 0;
    const { stream, fetchImpl } = run(
      () => (++call === 1 ? Response.json({ error: { message: 'Resource has been exhausted (e.g. check quota).' } }, { status: 429, headers: { 'Retry-After': '0' } }) : sseResponse(frame(stopChunk([{ text: 'OK' }])))),
      {
        maxRetries: 2,
        maxRetryDelayMs: 0,
      },
    );
    const events = await collect(stream);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(terminal(events)[0]?.type).toBe('done');
    expect(message(terminal(events)[0]).content).toContainEqual({ type: 'text', text: 'OK' });
  });

  test('a generic 429 with no retry budget makes one request and retains the Google message', async () => {
    const { stream, fetchImpl } = run(() => Response.json({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Resource has been exhausted (e.g. check quota).' } }, { status: 429 }), { maxRetryDelayMs: 0 });
    const events = await collect(stream);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(types(events)).toEqual(['error']);
    expect(message(events[0]).errorMessage).toBe('Google Code Assist API error (429): Resource has been exhausted (e.g. check quota).');
    expect(message(events[0]).model).toBe(model.id);
    expect(isRetryableAssistantError(message(events[0]))).toBe(true);
  });

  test.for(['Individual quota reached for gemini-3.8-flash. Resets in ~6h.', 'QUOTA_EXHAUSTED for gemini-3.8-flash.'])('explicit quota %s is not retryable by native Pi', async (googleMessage) => {
    vi.useFakeTimers();
    try {
      const { stream, fetchImpl } = run(() => Response.json({ error: { status: 'RESOURCE_EXHAUSTED', message: googleMessage } }, { status: 429 }), { maxRetries: 2 });
      const pending = collect(stream);
      await vi.runAllTimersAsync();
      const events = await pending;
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(types(events)).toEqual(['error']);
      const error = message(events[0]);
      expect(error.errorMessage).toContain(googleMessage);
      expect(error.errorMessage).toContain('429');
      expect(isRetryableAssistantError(error)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a positive server delay cap does not shorten the exponential fallback', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const { stream, fetchImpl } = run(() => (++calls === 1 ? Response.json({ error: { message: 'Temporarily unavailable' } }, { status: 429 }) : sseResponse(frame(stopChunk()))), {
        maxRetries: 1,
        maxRetryDelayMs: 1,
      });
      const pending = collect(stream);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(message((await pending).at(-1)).stopReason).toBe('stop');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('Retry-After above a positive cap fails after one request with the requested delay', async () => {
    vi.useFakeTimers();
    try {
      const { stream, fetchImpl } = run(() => Response.json({ error: { message: 'Temporarily unavailable' } }, { status: 429, headers: { 'Retry-After': '120' } }), { maxRetries: 1, maxRetryDelayMs: 1 });
      const pending = collect(stream);
      await vi.runAllTimersAsync();
      const events = await pending;
      expect.soft(fetchImpl).toHaveBeenCalledTimes(1);
      expect(types(events)).toEqual(['error']);
      expect(message(events[0]).errorMessage).toMatch(/120(?:000|\s*s|\s*seconds)/);
      expect(message(events[0]).errorMessage).toContain('configured cap 1ms');
      expect(message(events[0]).errorMessage).toContain('Google Code Assist API error (429): Temporarily unavailable');
    } finally {
      vi.useRealTimers();
    }
  });

  test('a zero retry delay cap waits the full Retry-After before retrying', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const { stream, fetchImpl } = run(() => (++calls === 1 ? Response.json({ error: { message: 'Temporarily unavailable' } }, { status: 429, headers: { 'Retry-After': '120' } }) : sseResponse(frame(stopChunk()))), {
        maxRetries: 1,
        maxRetryDelayMs: 0,
      });
      const pending = collect(stream);
      await vi.advanceTimersByTimeAsync(119_999);
      expect.soft(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      const events = await pending;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(message(events.at(-1)).stopReason).toBe('stop');
    } finally {
      vi.useRealTimers();
    }
  });

  test('a bare HTTP 413 is recognized as context overflow by native Pi', async () => {
    const { stream } = run(new Response(null, { status: 413, statusText: 'Payload Too Large' }));
    const events = await collect(stream);
    expect(types(events)).toEqual(['error']);
    const error = message(events[0]);
    expect(error.errorMessage).toContain('413');
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
    expect(new Set(calls).size).toBe(3);
    expect(calls[0]).toMatch(/^call_/);
  });

  test('ignores parts it does not model', async () => {
    const { stream } = run(sseResponse(frame(stopChunk([{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: 'ok' }]))));
    expect(message((await collect(stream)).at(-1)).content).toEqual([{ type: 'text', text: 'ok' }]);
  });
});

describe('usage and finish', () => {
  test('maps usageMetadata, the last chunk winning, at zero plan cost', async () => {
    const early = { response: { usageMetadata: { promptTokenCount: 1, totalTokenCount: 1 } } };
    const late = { response: { usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 125 }, modelVersion: 'gemini-3.8-flash-001' } };
    const { stream } = run(sseResponse(frame(early) + frame(stopChunk()) + frame(late)));
    const final = message((await collect(stream)).at(-1));
    expect(final.usage).toMatchObject({ input: 60, output: 25, cacheRead: 40, cacheWrite: 0, reasoning: 5, totalTokens: 125 });
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
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoder.encode(`data: ${JSON.stringify(part([{ text: 'immediate' }]))}`));
        for (const ending of endings) streamController.enqueue(encoder.encode(ending));
      },
    });
    const { stream } = run(new Response(body, { status: 200 }), { signal: controller.signal });
    const events: AssistantMessageEvent[] = [];
    try {
      for await (const event of stream) {
        events.push(event);
        if (event.type === 'text_delta') controller.abort();
      }
      expect(events.find((event) => event.type === 'text_delta')).toMatchObject({ delta: 'immediate' });
      expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
    } finally {
      controller.abort();
    }
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

  test('reads events split across network chunks, including mid character', async () => {
    const bytes = encoder.encode(frame(stopChunk([{ text: 'héllo' }])));
    const cut = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    const { stream } = run(new Response(body, { status: 200 }));
    expect(message((await collect(stream)).at(-1)).content).toEqual([{ type: 'text', text: 'héllo' }]);
  });

  test('joins multiline SSE data when CRLF is split across network chunks', async () => {
    const lines = JSON.stringify(stopChunk([{ text: 'split CRLF' }]), null, 1).split('\n');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(`data: ${line}\r`));
          controller.enqueue(new Uint8Array());
          controller.enqueue(encoder.encode('\n'));
        }
        controller.enqueue(encoder.encode('\r\n'));
        controller.close();
      },
    });
    const { stream } = run(new Response(body, { status: 200 }));
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
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoder.encode(frame(part([{ text: 'partial', thought: kind === 'thinking' }]))));
      },
    });
    const { stream } = run(new Response(body, { status: 200 }), { signal: controller.signal });
    const events: AssistantMessageEvent[] = [];
    try {
      for await (const event of stream) {
        events.push(event);
        if (event.type === `${kind}_delta`) controller.abort();
      }
    } finally {
      controller.abort();
    }
    expect.soft(types(events)).toEqual(['start', `${kind}_start`, `${kind}_delta`, `${kind}_end`, 'error']);
    expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
    expect(message(events.at(-1)).content).toEqual([kind === 'thinking' ? { type: 'thinking', thinking: 'partial' } : { type: 'text', text: 'partial' }]);
  });

  test('aborting mid-stream ends with one aborted error event', async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoder.encode(frame(part([{ text: 'a' }]))));
      },
    });
    const { stream } = run(new Response(body, { status: 200 }), { signal: controller.signal });
    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
      if (event.type === 'text_delta') controller.abort();
    }
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
