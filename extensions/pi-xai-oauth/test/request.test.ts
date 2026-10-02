import type { Model, SimpleStreamOptions, TranscriptContext } from '@earendil-works/pi-ai';
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import { expect, test } from 'vitest';
import { BASELINE, toPiModel } from '../src/catalog.ts';
import { GROK_CLIENT_VERSION, grokHeaders, withGrokHeaders } from '../src/request.ts';

const FAST = { id: 'grok-4.7-build-fast', contextWindow: 256000 };

test('the client version is the one the contract was measured against', () => {
  expect(GROK_CLIENT_VERSION).toBe('1.0.46');
});

test('a session id yields the five identity headers', () => {
  expect(grokHeaders(FAST, { sessionId: 'session-1' })).toStrictEqual({
    'x-grok-client-version': '1.0.46',
    'X-XAI-Token-Auth': 'xai-grok-cli',
    'x-grok-model-override': 'grok-4.7-build-fast',
    'x-grok-context-window': '256000',
    'x-grok-conv-id': 'session-1',
  });
});

test('no session id means no conversation header', () => {
  expect(Object.keys(grokHeaders(FAST, undefined))).toStrictEqual(['x-grok-client-version', 'X-XAI-Token-Auth', 'x-grok-model-override', 'x-grok-context-window']);
});

test('an empty session id means no conversation header', () => {
  expect('x-grok-conv-id' in grokHeaders(FAST, { sessionId: '' })).toBe(false);
});

test('the context window header follows the model', () => {
  expect(grokHeaders({ ...FAST, contextWindow: 500000 }, undefined)['x-grok-context-window']).toBe('500000');
});

test('a caller client version wins over the default', () => {
  expect(grokHeaders(FAST, { headers: { 'x-grok-client-version': '9.9.9' } })['x-grok-client-version']).toBe('9.9.9');
});

test('a caller header is kept next to the identity headers', () => {
  expect(grokHeaders(FAST, { headers: { 'x-trace': 'keep' } })['x-trace']).toBe('keep');
});

test('the caller headers object is unchanged afterwards', () => {
  const headers = { 'x-trace': 'keep' };
  grokHeaders(FAST, { headers });
  expect(headers).toStrictEqual({ 'x-trace': 'keep' });
});

test('streamSimple hands the inner stream the same model with merged headers', () => {
  const recorded: { model: Model<'openai-responses'>; options: SimpleStreamOptions | undefined }[] = [];
  const unexpected = () => {
    throw new Error('stream is not under test');
  };
  const streams = withGrokHeaders({
    stream: unexpected,
    streamSimple: (model, _context, options) => {
      recorded.push({ model: model as Model<'openai-responses'>, options });
      throw new Error('recorded');
    },
  });
  const model = toPiModel(BASELINE[1] ?? unexpectedBaseline(), new Map());
  const context = normalizeContext({ messages: [] });
  expect(() => streams.streamSimple(model, context, { sessionId: 'session-1', headers: { 'x-trace': 'keep' } })).toThrow('recorded');
  expect(recorded).toHaveLength(1);
  expect(recorded[0]?.model).toBe(model);
  expect(recorded[0]?.options).toStrictEqual({
    sessionId: 'session-1',
    headers: {
      'x-grok-client-version': '1.0.46',
      'X-XAI-Token-Auth': 'xai-grok-cli',
      'x-grok-model-override': 'grok-4.7-build-fast',
      'x-grok-context-window': '256000',
      'x-grok-conv-id': 'session-1',
      'x-trace': 'keep',
    },
  });
});

test('stream hands the inner stream the same context with merged headers', () => {
  const recorded: { context: TranscriptContext; headers: unknown }[] = [];
  const streams = withGrokHeaders({
    stream: (_model, context, options) => {
      recorded.push({ context, headers: options?.headers });
      throw new Error('recorded');
    },
    streamSimple: () => {
      throw new Error('streamSimple is not under test');
    },
  });
  const model = toPiModel(BASELINE[0] ?? unexpectedBaseline(), new Map());
  const context = normalizeContext({ messages: [] });
  expect(() => streams.stream(model, context)).toThrow('recorded');
  expect(recorded[0]?.context).toBe(context);
  expect(recorded[0]?.headers).toStrictEqual({
    'x-grok-client-version': '1.0.46',
    'X-XAI-Token-Auth': 'xai-grok-cli',
    'x-grok-model-override': 'grok-4.7',
    'x-grok-context-window': '256000',
  });
});

function unexpectedBaseline(): never {
  throw new Error('baseline row missing');
}
