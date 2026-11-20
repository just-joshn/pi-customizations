import { calculateCost } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { HTTP_OK, ROUTE_STREAM } from './constants.ts';
import { startSession } from './session.ts';
import { closedBody, collect, collectAbortingOn, encode, frame, message, openBody, part, pulledBody, sseResponse, stopChunk, terminal, types } from './sse.ts';
import { FLASH_MODEL, run } from './stream-driver.ts';

const THREE_IDS = 3;
const UTF8_LEAD_BYTE = 0xc3;
const EARLY_PROMPT_TOKENS = 1;
const LATE_PROMPT_TOKENS = 100;
const LATE_CACHED_TOKENS = 40;
const LATE_CANDIDATE_TOKENS = 20;
const LATE_THOUGHT_TOKENS = 5;
const LATE_TOTAL_TOKENS = 125;

afterEach(() => vi.unstubAllGlobals());

describe('streaming blocks', () => {
  test('streams text blocks and finishes with stop', async () => {
    const { stream } = await run(sseResponse(frame(part([{ text: 'Hel' }])) + frame(stopChunk([{ text: 'lo' }]))));
    const events = await collect(stream);
    expect(types(events)).toEqual(['start', 'text_start', 'text_delta', 'text_delta', 'text_end', 'done']);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', reason: 'stop' });
    expect(message(done)).toMatchObject({ content: [{ type: 'text', text: 'Hello' }], stopReason: 'stop', rawStopReason: 'STOP', responseId: 'trace-1' });
  });

  test('closes the thinking block before the text block opens', async () => {
    const { stream } = await run(sseResponse(frame(part([{ thought: true, text: 'plan', thoughtSignature: 'QUJD' }])) + frame(stopChunk([{ text: 'answer' }]))));
    const events = await collect(stream);
    expect(types(events)).toEqual(['start', 'thinking_start', 'thinking_delta', 'thinking_end', 'text_start', 'text_delta', 'text_end', 'done']);
    expect(message(events.at(-1)).content).toEqual([
      { type: 'thinking', thinking: 'plan', thinkingSignature: 'QUJD' },
      { type: 'text', text: 'answer' },
    ]);
  });

  test('keeps the text signature of the last signed part', async () => {
    const { stream } = await run(sseResponse(frame(part([{ text: 'a', thoughtSignature: 'QUJD' }])) + frame(stopChunk([{ text: '' }]))));
    expect(message((await collect(stream)).at(-1)).content).toEqual([{ type: 'text', text: 'a', textSignature: 'QUJD' }]);
  });

  test('emits a whole tool call and ends with toolUse', async () => {
    const { stream } = await run(sseResponse(frame(part([{ text: 'checking' }])) + frame(stopChunk([{ functionCall: { id: 'c1', name: 'read', args: { path: 'a.ts' } }, thoughtSignature: 'QUJD' }]))));
    const events = await collect(stream);
    expect(types(events)).toEqual(['start', 'text_start', 'text_delta', 'text_end', 'toolcall_start', 'toolcall_delta', 'toolcall_end', 'done']);
    expect(events.find((event) => event.type === 'toolcall_delta')).toMatchObject({ delta: '{"path":"a.ts"}' });
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'toolUse' });
    expect(message(events.at(-1)).content[1]).toEqual({ type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'a.ts' }, thoughtSignature: 'QUJD' });
  });

  test('generates distinct ids for tool calls without one or with a repeated one', async () => {
    const { stream } = await run(sseResponse(frame(stopChunk([{ functionCall: { name: 'read', args: {} } }, { functionCall: { id: 'dup', name: 'read', args: {} } }, { functionCall: { id: 'dup', name: 'read', args: {} } }]))));
    const calls = message((await collect(stream)).at(-1)).content.flatMap((block) => (block.type === 'toolCall' ? [block.id] : []));
    expect(new Set(calls).size).toBe(THREE_IDS);
    expect(calls[0]).toMatch(/^call_/);
  });

  test('ignores parts it does not model', async () => {
    const { stream } = await run(sseResponse(frame(stopChunk([{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: 'ok' }]))));
    expect(message((await collect(stream)).at(-1)).content).toEqual([{ type: 'text', text: 'ok' }]);
  });

  test('reads the whole reply of a tool-calling turn through Pi Models', async () => {
    const reply =
      frame({ ...part([{ thought: true, text: 'Need the file.' }]), traceId: 'trace-9' }) + frame(part([{ text: 'Reading it now.' }])) + frame(stopChunk([{ functionCall: { id: 'call-1', name: 'read', args: { path: 'a.ts' } } }]));
    const session = await startSession({ routes: { [ROUTE_STREAM]: () => sseResponse(reply) } });
    const model = session.model(FLASH_MODEL);
    const result = await session.models.streamSimple(model, { messages: [{ role: 'user', content: 'Read a.ts', timestamp: 1 }] }, { reasoning: 'xhigh', sessionId: 'sess-9' }).result();
    expect(result).toMatchObject({ stopReason: 'toolUse', responseId: 'trace-9' });
    expect(result.content).toEqual([
      { type: 'thinking', thinking: 'Need the file.' },
      { type: 'text', text: 'Reading it now.' },
      { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.ts' } },
    ]);
    expect(session.google.requestsTo(ROUTE_STREAM)[0]?.json).toMatchObject({ project: 'proj-77', model: 'gemini-3.8-flash-high', request: { sessionId: 'sess-9' } });
  });
});

describe('usage and finish reasons', () => {
  test('maps usageMetadata, the last chunk winning, at zero plan cost', async () => {
    const early = { response: { usageMetadata: { promptTokenCount: EARLY_PROMPT_TOKENS, totalTokenCount: EARLY_PROMPT_TOKENS } } };
    const lateUsage = { promptTokenCount: LATE_PROMPT_TOKENS, cachedContentTokenCount: LATE_CACHED_TOKENS, candidatesTokenCount: LATE_CANDIDATE_TOKENS, thoughtsTokenCount: LATE_THOUGHT_TOKENS, totalTokenCount: LATE_TOTAL_TOKENS };
    const late = { response: { usageMetadata: lateUsage, modelVersion: 'gemini-3.8-flash-001' } };
    const { session, stream } = await run(sseResponse(frame(early) + frame(stopChunk()) + frame(late)));
    const final = message((await collect(stream)).at(-1));
    const expectedUsage = { input: LATE_PROMPT_TOKENS - LATE_CACHED_TOKENS, output: LATE_CANDIDATE_TOKENS + LATE_THOUGHT_TOKENS, cacheRead: LATE_CACHED_TOKENS, cacheWrite: 0, reasoning: LATE_THOUGHT_TOKENS };
    expect(final.usage).toMatchObject({ ...expectedUsage, totalTokens: LATE_TOTAL_TOKENS });
    expect(final.usage.cost.total).toBe(calculateCost(session.model(FLASH_MODEL), { ...final.usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }).total);
    expect(final.usage.cost.total).toBe(0);
    expect(final.responseModel).toBe('gemini-3.8-flash-001');
  });

  test('MAX_TOKENS finishes with length', async () => {
    const { stream } = await run(sseResponse(frame(part([{ text: 'cut' }], { finishReason: 'MAX_TOKENS' }))));
    expect(message((await collect(stream)).at(-1))).toMatchObject({ stopReason: 'length', rawStopReason: 'MAX_TOKENS' });
  });

  test('another finish reason ends in error naming it', async () => {
    const { stream } = await run(sseResponse(frame(part([{ text: 'x' }], { finishReason: 'SAFETY' }))));
    const events = await collect(stream);
    expect(types(terminal(events))).toEqual(['error']);
    expect(message(events.at(-1)).errorMessage).toBe('Google stopped with SAFETY');
  });

  test('a finish message from Google is kept in the error', async () => {
    const { stream } = await run(sseResponse(frame(part([{ text: 'x' }], { finishReason: 'SAFETY', finishMessage: 'Response blocked for safety.' }))));
    expect(message((await collect(stream)).at(-1)).errorMessage).toBe('Google stopped with SAFETY: Response blocked for safety.');
  });
});

describe('blocked and truncated streams', () => {
  test('a block reason message from Google is kept in the error', async () => {
    const { stream } = await run(sseResponse(frame({ response: { promptFeedback: { blockReason: 'SAFETY', blockReasonMessage: 'Prompt violates policy.' } } })));
    expect(message((await collect(stream)).at(-1)).errorMessage).toBe('Google blocked the prompt: SAFETY: Prompt violates policy.');
  });

  test('a blocked prompt ends in error with no done event', async () => {
    const { stream } = await run(sseResponse(frame({ response: { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } } })));
    const events = await collect(stream);
    expect(types(events)).toEqual(['start', 'error']);
    expect(message(events.at(-1)).errorMessage).toBe('Google blocked the prompt: PROHIBITED_CONTENT');
  });

  test('a stream with no finish reason is reported as truncated', async () => {
    const { stream } = await run(sseResponse(frame(part([{ text: 'partial' }]))));
    const events = await collect(stream);
    expect(types(events)).toEqual(['start', 'text_start', 'text_delta', 'text_end', 'error']);
    expect(message(events.at(-1)).errorMessage).toBe('Google stream ended without a finish reason');
  });
});

describe('error chunks and empty bodies', () => {
  test('an error object in a chunk ends in error with its message', async () => {
    const { stream } = await run(sseResponse(frame({ error: { message: 'Resource exhausted' } })));
    expect(message((await collect(stream)).at(-1)).errorMessage).toBe('Resource exhausted');
  });

  test('an error object without a message gets a default one', async () => {
    const { stream } = await run(sseResponse(frame({ error: {} })));
    expect(message((await collect(stream)).at(-1)).errorMessage).toBe('Google Code Assist returned an error');
  });

  test('an empty response body ends in error', async () => {
    const { stream } = await run(new Response(null, { status: HTTP_OK }));
    expect(message((await collect(stream)).at(-1)).errorMessage).toBe('Google Code Assist returned an empty response');
  });
});

describe('SSE framing', () => {
  test.for([
    ['CR-only', ['\r\r']],
    ['split CRLF followed by a lone LF', ['\r', '', '\n', '\n']],
  ] as const)('delivers %s events while the response body remains open', async ([, endings]) => {
    const controller = new AbortController();
    const body = openBody([encode(`data: ${JSON.stringify(part([{ text: 'immediate' }]))}`), ...endings.map(encode)]);
    const { stream } = await run(new Response(body, { status: HTTP_OK }), { signal: controller.signal });
    const events = await collectAbortingOn(stream, controller, 'text_delta');
    expect(events.find((event) => event.type === 'text_delta')).toMatchObject({ delta: 'immediate' });
    expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
  });

  test('rejects malformed JSON instead of skipping the chunk', async () => {
    const { stream } = await run(sseResponse(`${frame(part([{ text: 'a' }]))}data: {not json}\n\n`));
    const events = await collect(stream);
    expect(message(events.at(-1)).errorMessage).toBe('Google Code Assist sent a malformed event');
    expect(types(terminal(events))).toEqual(['error']);
  });

  test('joins multi-line data, ignores comments, and reads CRLF', async () => {
    const lines = JSON.stringify(stopChunk([{ text: 'ok' }]), null, 1).split('\n');
    const text = `: ping\r\n${lines.map((line) => `data: ${line}\r\n`).join('')}\r\n`;
    const { stream } = await run(sseResponse(text));
    expect(message((await collect(stream)).at(-1)).content).toEqual([{ type: 'text', text: 'ok' }]);
  });
});

describe('SSE chunking', () => {
  test('reads events split across network chunks, including mid character', async () => {
    const bytes = encode(frame(stopChunk([{ text: 'héllo' }])));
    const cut = bytes.indexOf(UTF8_LEAD_BYTE) + 1;
    const { stream } = await run(new Response(closedBody([bytes.slice(0, cut), bytes.slice(cut)]), { status: HTTP_OK }));
    expect(message((await collect(stream)).at(-1)).content).toEqual([{ type: 'text', text: 'héllo' }]);
  });

  test('joins multiline SSE data when CRLF is split across network chunks', async () => {
    const lines = JSON.stringify(stopChunk([{ text: 'split CRLF' }]), null, 1).split('\n');
    const chunks = [...lines.flatMap((line) => [encode(`data: ${line}\r`), new Uint8Array(), encode('\n')]), encode('\r\n')];
    const { stream } = await run(new Response(closedBody(chunks), { status: HTTP_OK }));
    const events = await collect(stream);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'stop' });
    expect(message(events.at(-1)).content).toEqual([{ type: 'text', text: 'split CRLF' }]);
  });

  test('flushes a final event that has no trailing blank line', async () => {
    const { stream } = await run(sseResponse(`data: ${JSON.stringify(stopChunk())}`));
    expect(message((await collect(stream)).at(-1)).stopReason).toBe('stop');
  });

  test('ignores a body that streams nothing but a blank line', async () => {
    const { stream } = await run(
      new Response(
        pulledBody(() => undefined, encode('\n')),
        { status: HTTP_OK },
      ),
    );
    expect(message((await collect(stream)).at(-1)).errorMessage).toBe('Google stream ended without a finish reason');
  });
});

describe('aborting a stream', () => {
  test.for(['text', 'thinking'] as const)('aborting an open %s block emits its end before error and retains partial content', async (kind) => {
    const controller = new AbortController();
    const body = openBody([encode(frame(part([{ text: 'partial', thought: kind === 'thinking' }])))]);
    const { stream } = await run(new Response(body, { status: HTTP_OK }), { signal: controller.signal });
    const events = await collectAbortingOn(stream, controller, `${kind}_delta`);
    expect.soft(types(events)).toEqual(['start', `${kind}_start`, `${kind}_delta`, `${kind}_end`, 'error']);
    expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
    expect(message(events.at(-1)).content).toEqual([kind === 'thinking' ? { type: 'thinking', thinking: 'partial' } : { type: 'text', text: 'partial' }]);
  });

  test('aborting mid-stream ends with one aborted error event', async () => {
    const controller = new AbortController();
    const { stream } = await run(new Response(openBody([encode(frame(part([{ text: 'a' }])))]), { status: HTTP_OK }), { signal: controller.signal });
    const events = await collectAbortingOn(stream, controller, 'text_delta');
    expect(types(terminal(events))).toEqual(['error']);
    expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
    expect(message(events.at(-1)).stopReason).toBe('aborted');
  });

  test('every run ends with exactly one terminal event', async () => {
    const { stream } = await run(sseResponse(frame(stopChunk())));
    const events = await collect(stream);
    expect(terminal(events)).toHaveLength(1);
    expect(events[0]?.type).toBe('start');
    await expect(stream.result()).resolves.toMatchObject({ stopReason: 'stop' });
  });
});
