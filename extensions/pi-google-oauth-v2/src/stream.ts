import type { ReadableStream } from 'node:stream/web';

import { type Api, type AssistantMessage, type AssistantMessageEvent, type AssistantMessageEventStream, createAssistantMessageEventStream, type Model, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import { googleErrorMessage } from './code-assist.ts';
import { ANTIGRAVITY_USER_AGENT, PRIVATE_PROJECT_HEADER } from './constants.ts';
import { buildCodeAssistRequest } from './request.ts';
import { CODE_ASSIST_CHUNK, type CodeAssistChunk, closeOpenBlock, createReducerState, finishStream, type ReducerState, type ReducerStep, reduceChunk } from './stream-reducer.ts';

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const HTTP_UNAVAILABLE = 503;
const HTTP_GATEWAY_TIMEOUT = 504;
const RETRYABLE_STATUS = new Set([HTTP_TOO_MANY_REQUESTS, HTTP_INTERNAL_ERROR, HTTP_BAD_GATEWAY, HTTP_UNAVAILABLE, HTTP_GATEWAY_TIMEOUT]);
const MS_PER_SECOND = 1000;
const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;
const BACKOFF_BASE = 2;
const SSE_DATA_PREFIX = 'data:';
const SSE_LINE_BREAK = /\r\n|\n|\r/;

function retryDelayMs(body: string, headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * MS_PER_SECOND;
    const when = Date.parse(retryAfter);
    if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  }
  const hinted = body.match(/"retryDelay":\s*"([0-9.]+)s"/i) ?? body.match(/retry in ([0-9.]+)\s*s/i);
  return hinted?.[1] ? Number(hinted[1]) * MS_PER_SECOND : undefined;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Request was aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Request was aborted'));
      },
      { once: true },
    );
  });
}

function takePrivateProjectHeader(headers: SimpleStreamOptions['headers']): { project: string | undefined; headers: Record<string, string> } {
  const entries = Object.entries(headers ?? {});
  const project = entries
    .filter(([name]) => name.toLowerCase() === PRIVATE_PROJECT_HEADER)
    .map(([, value]) => value ?? undefined)
    .at(-1);
  const forwarded = entries.flatMap(([name, value]): [string, string][] => (name.toLowerCase() !== PRIVATE_PROJECT_HEADER && value !== null && name.toLowerCase() !== 'user-agent' ? [[name, value]] : []));
  return { project, headers: Object.fromEntries(forwarded) };
}

function requestInit(options: SimpleStreamOptions, headers: Record<string, string>, body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers, 'User-Agent': ANTIGRAVITY_USER_AGENT },
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

async function describeFailure(response: Response): Promise<{ text: string; failure: string; quotaExhausted: boolean }> {
  const text = await response.text().catch(() => '');
  const message = googleErrorMessage(text) ?? (response.statusText || 'request failed');
  const quotaExhausted = /QUOTA_EXHAUSTED|Individual quota reached/i.test(text);
  const failure = `Google Code Assist API error (${response.status}): ${message}${quotaExhausted ? ' (quota exceeded)' : ''}`;
  return { text, failure, quotaExhausted };
}

async function fetchWithRetry(model: Model<Api>, options: SimpleStreamOptions, url: string, init: RequestInit): Promise<Response> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseRetries = options.maxRetries ?? 0;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  for (let attempt = 0; ; attempt++) {
    const response = await doFetch(url, init);
    await options.onResponse?.({ status: response.status, headers: Object.fromEntries(response.headers) }, model);
    if (response.ok) return response;
    const { text, failure, quotaExhausted } = await describeFailure(response);
    if (!RETRYABLE_STATUS.has(response.status) || quotaExhausted || attempt >= baseRetries) throw new Error(failure);
    const serverDelay = retryDelayMs(text, response.headers);
    if (serverDelay !== undefined && maxRetryDelayMs > 0 && serverDelay > maxRetryDelayMs) {
      throw new Error(`Server requested ${serverDelay}ms retry delay, exceeding configured cap ${maxRetryDelayMs}ms. ${failure}`);
    }
    await sleep(serverDelay ?? MS_PER_SECOND * BACKOFF_BASE ** attempt, options.signal);
  }
}

async function openResponse(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions): Promise<Response> {
  const { project, headers } = takePrivateProjectHeader(options.headers);
  if (!options.apiKey || !project) throw new Error('Google AI login is incomplete; run /login again');
  const built: unknown = buildCodeAssistRequest({ model, context, project, options });
  const body = (await options.onPayload?.(built, model)) ?? built;
  return fetchWithRetry(model, options, `${model.baseUrl}:streamGenerateContent?alt=sse`, requestInit(options, headers, body));
}

function parseEvent(data: string): CodeAssistChunk {
  try {
    return CODE_ASSIST_CHUNK.parse(JSON.parse(data));
  } catch {
    throw new Error('Google Code Assist sent a malformed event');
  }
}

interface SseState {
  readonly buffered: string;
  readonly endedWithCR: boolean;
  readonly dataLines: readonly string[];
}

interface SseLines {
  readonly dataLines: readonly string[];
  readonly events: readonly string[];
}

const readSseLine = (acc: SseLines, line: string): SseLines => {
  if (line === '') return acc.dataLines.length > 0 ? { dataLines: [], events: [...acc.events, acc.dataLines.join('\n')] } : acc;
  if (line.startsWith(SSE_DATA_PREFIX)) return { ...acc, dataLines: [...acc.dataLines, line.slice(SSE_DATA_PREFIX.length).replace(/^ /, '')] };
  return acc;
};

/** Splits decoded text into complete SSE lines. The tail stays buffered until its line break arrives. */
function feedSse(state: SseState, decoded: string, done: boolean): { state: SseState; events: readonly string[] } {
  const received = decoded.length > 0;
  const text = received ? state.buffered + (state.endedWithCR && decoded.startsWith('\n') ? decoded.slice(1) : decoded) : state.buffered;
  const lines = text.split(SSE_LINE_BREAK);
  const complete = done ? lines : lines.slice(0, -1);
  const read = complete.reduce<SseLines>(readSseLine, { dataLines: state.dataLines, events: [] });
  const next: SseState = { buffered: done ? '' : (lines.at(-1) ?? ''), endedWithCR: received ? decoded.endsWith('\r') : state.endedWithCR, dataLines: read.dataLines };
  return { state: next, events: read.events };
}

async function* parseSse(body: ReadableStream<Uint8Array> | null, signal: AbortSignal | undefined): AsyncGenerator<CodeAssistChunk> {
  if (!body) throw new Error('Google Code Assist returned an empty response');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  let state: SseState = { buffered: '', endedWithCR: false, dataLines: [] };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      const fed = feedSse(state, decoder.decode(value, { stream: !done }), done);
      state = fed.state;
      for (const data of fed.events) yield parseEvent(data);
      if (done) break;
    }
    if (state.dataLines.length > 0) yield parseEvent(state.dataLines.join('\n'));
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

function initialOutput(model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'pending',
    timestamp: Date.now(),
  };
}

function doneEvent(output: AssistantMessage): AssistantMessageEvent {
  return { type: 'done', reason: output.stopReason === 'toolUse' || output.stopReason === 'length' ? output.stopReason : 'stop', message: output };
}

function errorEvent(output: AssistantMessage, error: unknown, signal: AbortSignal | undefined): AssistantMessageEvent {
  const failed: AssistantMessage = { ...output, stopReason: signal?.aborted ? 'aborted' : 'error', errorMessage: error instanceof Error ? error.message : String(error) };
  return { type: 'error', reason: failed.stopReason === 'aborted' ? 'aborted' : 'error', error: failed };
}

/** Runs the whole exchange and reports every outcome, including failures, through `emit`. It never rejects. */
async function runStream(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions, emit: (event: AssistantMessageEvent) => void): Promise<void> {
  let current: ReducerState = createReducerState(initialOutput(model));
  const apply = (step: ReducerStep): void => {
    current = step.state;
    for (const event of step.events) emit(event);
    if (step.error) throw step.error;
  };
  try {
    const response = await openResponse(model, context, options);
    emit({ type: 'start', partial: current.output });
    for await (const chunk of parseSse(response.body, options.signal)) {
      await options.onProviderStreamEvent?.(chunk, model);
      apply(reduceChunk(current, chunk, model));
    }
    if (options.signal?.aborted) throw new Error('Request was aborted');
    apply(finishStream(current));
    emit(doneEvent(current.output));
  } catch (error) {
    apply(closeOpenBlock(current));
    emit(errorEvent(current.output, error, options.signal));
  }
}

/**
 * Serves both stream and streamSimple. Never throws: every failure, including a missing token or
 * project, ends the stream with an `error` event.
 */
export function streamCodeAssist(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions = {}): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const emit = (event: AssistantMessageEvent): void => stream.push(event);
  void runStream(model, context, options, emit).finally(() => stream.end());
  return stream;
}
