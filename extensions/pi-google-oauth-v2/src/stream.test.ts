import { type AssistantMessage, type AssistantMessageEvent, calculateCost, type Message, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import { describe, expect, test, vi } from 'vitest';
import { PROJECT_HEADER } from './constants.ts';
import { createCodeAssistModels } from './models.ts';
import { streamCodeAssist } from './stream.ts';

const model =
  createCodeAssistModels().find((candidate) => candidate.id === 'gemini-3.5-flash') ??
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
  const stream = streamCodeAssist(model, context, { apiKey: 'tok-abc', headers: { [PROJECT_HEADER]: 'proj-1' }, fetch: fetchImpl, ...options });
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
    expect(sent[0]?.url).toBe('https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse');
    expect(sent[0]?.headers).toMatchObject({ authorization: 'Bearer tok-abc', 'content-type': 'application/json', accept: 'text/event-stream' });
    expect(Object.keys(sent[0]?.headers ?? {})).not.toContain(PROJECT_HEADER);
    expect(sent[0]?.body.project).toBe('proj-1');
  });

  test('forwards other caller headers and drops null ones', async () => {
    const { stream, sent } = run(sseResponse(frame(stopChunk())), { headers: { [PROJECT_HEADER.toUpperCase()]: 'proj-1', 'x-extra': '1', 'x-drop': null } });
    await collect(stream);
    expect(sent[0]?.headers).toMatchObject({ 'x-extra': '1' });
    expect(Object.keys(sent[0]?.headers ?? {})).not.toContain('x-drop');
    expect(Object.keys(sent[0]?.headers ?? {})).not.toContain(PROJECT_HEADER);
  });

  test('posts the payload that onPayload returns', async () => {
    const { stream, sent } = run(sseResponse(frame(stopChunk())), { onPayload: () => ({ replaced: true }) });
    await collect(stream);
    expect(sent[0]?.body).toEqual({ replaced: true });
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
    expect(message(events[0]).errorMessage).toBe('Google Code Assist error (403): Account validation required.');
    expect(message(events[0]).stopReason).toBe('error');
  });

  test('an HTTP error does not echo an unparseable body', async () => {
    const { stream } = run(new Response('secret-ish body', { status: 500, statusText: 'Server Error' }));
    const events = await collect(stream);
    expect(message(events[0]).errorMessage).toBe('Google Code Assist error (500): Server Error');
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
  test('maps usageMetadata, the last chunk winning, and prices it', async () => {
    const early = { response: { usageMetadata: { promptTokenCount: 1, totalTokenCount: 1 } } };
    const late = { response: { usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 125 }, modelVersion: 'gemini-3.5-flash-001' } };
    const { stream } = run(sseResponse(frame(early) + frame(stopChunk()) + frame(late)));
    const final = message((await collect(stream)).at(-1));
    expect(final.usage).toMatchObject({ input: 60, output: 25, cacheRead: 40, cacheWrite: 0, reasoning: 5, totalTokens: 125 });
    expect(final.usage.cost.total).toBe(calculateCost(model, { ...final.usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }).total);
    expect(final.usage.cost.total).toBeGreaterThan(0.00001);
    expect(final.responseModel).toBe('gemini-3.5-flash-001');
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

  test('flushes a final event that has no trailing blank line', async () => {
    const { stream } = run(sseResponse(`data: ${JSON.stringify(stopChunk())}`));
    expect(message((await collect(stream)).at(-1)).stopReason).toBe('stop');
  });
});

describe('abort', () => {
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
