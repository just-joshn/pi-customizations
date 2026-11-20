import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_READ_TOKENS, CACHE_WRITE_TOKENS, COST_CACHE_READ, COST_CACHE_WRITE, COST_INPUT, COST_OUTPUT, COST_PRECISION, COST_TOTAL, INPUT_TOKENS, OUTPUT_TOKENS_FINAL, STATUS_RATE_LIMITED, TOTAL_TOKENS } from './support/constants.ts';
import { streamEvents } from './support/fixtures.ts';
import { run, terminal } from './support/provider.ts';
import { lastCall, resetSdk, setSdkEvents } from './support/sdk-state.ts';

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const { createSdkMock } = await import('./support/sdk-mock.ts');
  return createSdkMock(await importOriginal<typeof import('@anthropic-ai/sdk')>());
});

const EXPECTED_EVENT_TYPES = ['start', 'thinking_start', 'thinking_delta', 'thinking_end', 'text_start', 'text_delta', 'text_delta', 'text_end', 'toolcall_start', 'toolcall_delta', 'toolcall_delta', 'toolcall_end', 'done'];

const EXPECTED_USAGE = {
  input: INPUT_TOKENS,
  output: OUTPUT_TOKENS_FINAL,
  cacheRead: CACHE_READ_TOKENS,
  cacheWrite: CACHE_WRITE_TOKENS,
  totalTokens: TOTAL_TOKENS,
  cost: {
    input: expect.closeTo(COST_INPUT, COST_PRECISION),
    output: expect.closeTo(COST_OUTPUT, COST_PRECISION),
    cacheRead: expect.closeTo(COST_CACHE_READ, COST_PRECISION),
    cacheWrite: expect.closeTo(COST_CACHE_WRITE, COST_PRECISION),
    total: expect.closeTo(COST_TOTAL, COST_PRECISION),
    totalFromProvider: false,
  },
};

const EXPECTED_CONTENT = [
  { type: 'thinking', thinking: 'hmm', thinkingSignature: 'abc' },
  { type: 'text', text: 'Hi there' },
  { type: 'toolCall', id: 'call1', name: 'read', arguments: { path: 'b.txt' } },
];

const stopDelta = (reason: string, details?: Record<string, unknown>) => ({ type: 'message_delta', delta: { stop_reason: reason, ...details }, usage: { output_tokens: 1 } });

const failingEvent = (failure: unknown) => ({
  get type(): never {
    throw failure;
  },
});

beforeEach(() => {
  resetSdk();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('response stream events', () => {
  it('turns Anthropic events into Pi events', async () => {
    setSdkEvents(streamEvents);
    const { events } = await run({ apiKey: 'sk-ant-oat01-x' });
    expect(events.map((event) => event.type)).toEqual(EXPECTED_EVENT_TYPES);
    const deltas = events.flatMap((event) => ('delta' in event ? [event.delta] : []));
    expect(deltas).toEqual(['hmm', 'Hi ', 'there', '{"path":', '"b.txt"}']);
    const ends = events.flatMap((event) => (event.type === 'text_end' || event.type === 'thinking_end' ? [event.content] : []));
    expect(ends).toEqual(['hmm', 'Hi there']);
  });

  it('builds the final message with content, usage, and identity', async () => {
    setSdkEvents(streamEvents);
    const { events } = await run({ apiKey: 'sk-ant-oat01-x' });
    const message = terminal(events);
    expect(message.content).toEqual(EXPECTED_CONTENT);
    expect(message.stopReason).toBe('toolUse');
    expect(message.usage).toEqual(EXPECTED_USAGE);
    expect({ api: message.api, provider: message.provider, model: message.model, role: message.role }).toEqual({
      api: 'custom-anthropic-api',
      provider: 'custom-anthropic',
      model: 'claude-sonnet-4-5',
      role: 'assistant',
    });
  });
});

describe('response stop reasons', () => {
  it.each([
    ['end_turn', 'stop'],
    ['pause_turn', 'stop'],
    ['stop_sequence', 'stop'],
    ['max_tokens', 'length'],
    ['model_context_window_exceeded', 'length'],
  ])('maps stop reason %s to %s', async (reason, expected) => {
    setSdkEvents([stopDelta(reason)]);
    const { events } = await run({ apiKey: 'k' });
    expect(terminal(events).stopReason).toBe(expected);
  });

  it('reports a refusal with its explanation', async () => {
    setSdkEvents([stopDelta('refusal', { stop_details: { type: 'refusal', explanation: 'Not allowed.' } })]);
    const { events } = await run({ apiKey: 'k' });
    expect(terminal(events)).toMatchObject({ stopReason: 'error', errorMessage: 'Not allowed.' });
  });

  it('reports an unknown stop reason as an error', async () => {
    setSdkEvents([stopDelta('refusal')]);
    const { events } = await run({ apiKey: 'k' });
    expect(events.at(-1)?.type).toBe('error');
    expect(terminal(events)).toMatchObject({ stopReason: 'error', errorMessage: 'An unknown error occurred' });
  });
});

describe('response stream failures', () => {
  it('reports an API error with its status and request id', async () => {
    const { APIError } = await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk');
    const failure = APIError.generate(STATUS_RATE_LIMITED, { type: 'error', error: { type: 'rate_limit_error', message: 'Slow down' } }, undefined, new Headers({ 'request-id': 'req_123' }));
    setSdkEvents([failingEvent(failure)]);
    const { events } = await run({ apiKey: 'k' });
    expect(terminal(events)).toMatchObject({ stopReason: 'error', errorMessage: 'RateLimitError 429 (request req_123): Slow down' });
  });

  it('reports a stream that ends without a stop reason', async () => {
    const { events } = await run({ apiKey: 'k' });
    expect(events.map((event) => event.type)).toEqual(['start', 'error']);
    expect(terminal(events)).toMatchObject({ stopReason: 'error', errorMessage: 'Anthropic stream ended without a stop reason' });
  });

  it('reports an aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    setSdkEvents([stopDelta('end_turn')]);
    const { events } = await run({ apiKey: 'k', signal: controller.signal });
    expect(lastCall()?.signal).toBe(controller.signal);
    expect(terminal(events)).toMatchObject({ stopReason: 'aborted', errorMessage: 'Request was aborted' });
  });

  it('reports an SDK failure', async () => {
    setSdkEvents([failingEvent(new Error('network down'))]);
    const { events } = await run({ apiKey: 'k' });
    expect(terminal(events)).toMatchObject({ stopReason: 'error', errorMessage: 'network down' });
  });
});
