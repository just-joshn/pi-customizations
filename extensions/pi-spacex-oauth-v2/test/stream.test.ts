import type { Api, AssistantMessageEvent, AssistantMessageEventStream, Message, Model, TranscriptContext } from '@earendil-works/pi-ai';
import { calculateContextTokens } from '@earendil-works/pi-coding-agent';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RunEvent, RunRequest } from '../src/cursor/run.ts';

interface FakeRun {
  req: RunRequest;
  onEvent: (e: RunEvent) => void;
  closed: boolean;
  submitted: { id: string; text: string; isError: boolean }[];
  submitToolResults(r: FakeRun['submitted']): void;
  close(): void;
}
const runs: FakeRun[] = [];

vi.mock(import('../src/cursor/run.ts'), async (original) => ({
  ...(await original()),
  openCursorRun: (req: RunRequest) => {
    const run: FakeRun = {
      req,
      onEvent: () => {},
      closed: false,
      submitted: [],
      submitToolResults(r) {
        this.submitted.push(...r);
      },
      close() {
        this.closed = true;
      },
    };
    runs.push(run);
    return run as never;
  },
}));

const { flattenTranscript, streamCursor } = await import('../src/cursor/stream.ts');

const model = { id: 'composer-2.5', api: 'cursor-agent', provider: 'cursor' } as Model<Api>;
const user = (text: string): Message => ({ role: 'user', content: text, timestamp: 0 });
const assistant = (text: string): Message => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'cursor-agent',
  provider: 'cursor',
  model: 'composer-2.5',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'stop',
  timestamp: 0,
});
const ctx = (...messages: Message[]): TranscriptContext => ({ messages: [{ role: 'system', content: 'be terse', timestamp: 0 }, ...messages] }) as TranscriptContext;

async function collect(stream: AssistantMessageEventStream) {
  const events: AssistantMessageEvent[] = [];
  for await (const e of stream) events.push(e);
  return events;
}
const lastRun = () => {
  const run = runs.at(-1);
  if (!run) throw new Error('no run opened');
  return run;
};
const runOpened = (count: number) => vi.waitFor(() => expect(runs).toHaveLength(count));

beforeEach(() => {
  runs.length = 0;
});

describe('streamCursor', () => {
  test('streams text and usage into pi events', async () => {
    const stream = streamCursor(model, ctx(user('hi')), { apiKey: 'tok', sessionId: 's-text' });
    await runOpened(1);
    const run = lastRun();
    expect(run.req).toMatchObject({ userText: 'hi', systemPrompt: 'be terse', modelId: 'composer-2.5', checkpoint: undefined });
    run.onEvent({ type: 'text', delta: 'hel' });
    run.onEvent({ type: 'text', delta: 'lo' });
    run.onEvent({ type: 'turn_ended', usage: { input: 10, output: 2, cacheRead: 3, cacheWrite: 0, reasoning: 0 } });
    run.onEvent({ type: 'end' });
    const events = await collect(stream);
    expect(events.map((e) => e.type)).toStrictEqual(['start', 'text_start', 'text_delta', 'text_delta', 'text_end', 'done']);
    const done = events.at(-1);
    expect(done?.type === 'done' && done.message.content).toStrictEqual([{ type: 'text', text: 'hello' }]);
    expect(done?.type === 'done' && done.message.usage.totalTokens).toBe(15);
  });

  test("continues a conversation from Cursor's checkpoint instead of replaying it", async () => {
    const first = streamCursor(model, ctx(user('My name is Zed')), { apiKey: 'tok', sessionId: 's-memory' });
    await runOpened(1);
    const checkpoint = Uint8Array.of(9, 9, 9);
    lastRun().onEvent({ type: 'checkpoint', state: checkpoint, contextTokens: 0 });
    lastRun().onEvent({ type: 'text', delta: 'noted' });
    lastRun().onEvent({ type: 'end' });
    await collect(first);

    const second = streamCursor(model, ctx(user('My name is Zed'), assistant('noted'), user('What is my name?')), { apiKey: 'tok', sessionId: 's-memory' });
    await runOpened(2);
    expect(lastRun().req.checkpoint).toBe(checkpoint);
    expect(lastRun().req.userText).toBe('What is my name?');
    lastRun().onEvent({ type: 'end' });
    await collect(second);
  });

  test('pauses on a tool call and feeds the tool result into the same Cursor run', async () => {
    const first = streamCursor(model, ctx(user('weather?')), { apiKey: 'tok', sessionId: 's-tool' });
    await runOpened(1);
    const run = lastRun();
    run.onEvent({ type: 'tool_calls', calls: [{ id: 'call-1', name: 'get_weather', args: { city: 'Paris' } }] });
    const events = await collect(first);
    const done = events.at(-1);
    expect(done?.type === 'done' && done.reason).toBe('toolUse');
    expect(done?.type === 'done' && done.message.content).toStrictEqual([{ type: 'toolCall', id: 'call-1', name: 'get_weather', arguments: { city: 'Paris' } }]);

    const toolUse = done?.type === 'done' ? done.message : assistant('');
    const second = streamCursor(model, ctx(user('weather?'), toolUse, { role: 'toolResult', toolCallId: 'call-1', toolName: 'get_weather', content: [{ type: 'text', text: 'Sunny' }], isError: false, timestamp: 0 }), {
      apiKey: 'tok',
      sessionId: 's-tool',
    });
    await vi.waitFor(() => expect(run.submitted).toHaveLength(1));
    expect(runs).toHaveLength(1);
    expect(run.submitted).toStrictEqual([{ id: 'call-1', text: 'Sunny', isError: false }]);
    run.onEvent({ type: 'text', delta: 'It is sunny.' });
    run.onEvent({ type: 'end' });
    const after = await collect(second);
    expect(after.at(-1)?.type).toBe('done');
  });

  test("every reply carries Cursor's context size, so pi can show context use after a tool pause", async () => {
    const first = streamCursor(model, ctx(user('weather?')), { apiKey: 'tok', sessionId: 's-context' });
    await runOpened(1);
    const run = lastRun();
    run.onEvent({ type: 'checkpoint', state: Uint8Array.of(1), contextTokens: 4824 });
    run.onEvent({ type: 'tool_calls', calls: [{ id: 'call-1', name: 'get_weather', args: { city: 'Paris' } }] });
    const paused = (await collect(first)).at(-1);
    if (paused?.type !== 'done') throw new Error('tool pause did not finish');
    expect(calculateContextTokens(paused.message.usage)).toBe(4824);

    const second = streamCursor(model, ctx(user('weather?'), paused.message, { role: 'toolResult', toolCallId: 'call-1', toolName: 'get_weather', content: [{ type: 'text', text: 'Sunny' }], isError: false, timestamp: 0 }), {
      apiKey: 'tok',
      sessionId: 's-context',
    });
    await vi.waitFor(() => expect(run.submitted).toHaveLength(1));
    run.onEvent({ type: 'checkpoint', state: Uint8Array.of(2), contextTokens: 4971 });
    run.onEvent({ type: 'text', delta: 'Sunny.' });
    // The turn's usage sums every model call in Cursor's agent loop, so it is far above the context size.
    run.onEvent({ type: 'turn_ended', usage: { input: 4476, output: 191, cacheRead: 10048, cacheWrite: 0, reasoning: 12 } });
    run.onEvent({ type: 'end' });
    const done = (await collect(second)).at(-1);
    if (done?.type !== 'done') throw new Error('reply did not finish');
    expect(calculateContextTokens(done.message.usage)).toBe(4971);
    expect(done.message.usage).toMatchObject({ input: 4476, output: 191, cacheRead: 10048, cacheWrite: 0, reasoning: 12 });
  });

  test('a continued turn that pauses before Cursor sends a new checkpoint keeps the last context size', async () => {
    const first = streamCursor(model, ctx(user('weather?')), { apiKey: 'tok', sessionId: 's-continued' });
    await runOpened(1);
    lastRun().onEvent({ type: 'checkpoint', state: Uint8Array.of(1), contextTokens: 6143 });
    lastRun().onEvent({ type: 'text', delta: 'Sunny.' });
    lastRun().onEvent({ type: 'end' });
    await collect(first);

    // Measured: a Run resumed from a checkpoint pauses on its first tool call before sending a checkpoint.
    const second = streamCursor(model, ctx(user('weather?'), assistant('Sunny.'), user('and Rome?')), { apiKey: 'tok', sessionId: 's-continued' });
    await runOpened(2);
    lastRun().onEvent({ type: 'tool_calls', calls: [{ id: 'call-2', name: 'get_weather', args: { city: 'Rome' } }] });
    const paused = (await collect(second)).at(-1);
    expect(paused?.type === 'done' && calculateContextTokens(paused.message.usage)).toBe(6143);
  });

  test('starts fresh when the history was edited after the checkpoint', async () => {
    const first = streamCursor(model, ctx(user('hi')), { apiKey: 'tok', sessionId: 's-branch' });
    await runOpened(1);
    lastRun().onEvent({ type: 'checkpoint', state: Uint8Array.of(1), contextTokens: 0 });
    lastRun().onEvent({ type: 'text', delta: 'hello' });
    lastRun().onEvent({ type: 'turn_ended', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 } });
    lastRun().onEvent({ type: 'end' });
    await collect(first);

    const second = streamCursor(model, ctx(user('hi'), assistant('an edited reply'), user('next')), { apiKey: 'tok', sessionId: 's-branch' });
    await runOpened(2);
    expect(lastRun().req.checkpoint).toBeUndefined();
    expect(lastRun().req.userText).toContain('<conversation_so_far>');
    lastRun().onEvent({ type: 'end' });
    await collect(second);
  });

  test('an already-aborted request closes its Run', async () => {
    const abort = new AbortController();
    abort.abort();
    const stream = streamCursor(model, ctx(user('hi')), { apiKey: 'tok', sessionId: 's-pre-abort', signal: abort.signal });
    const last = (await collect(stream)).at(-1);
    expect(last?.type === 'error' && last.reason).toBe('aborted');
    expect(lastRun().closed).toBe(true);
  });

  test('a resumed reply is not closed by the next request on the same session', async () => {
    const first = streamCursor(model, ctx(user('weather?')), { apiKey: 'tok', sessionId: 's-resumed' });
    await runOpened(1);
    const run = lastRun();
    run.onEvent({ type: 'tool_calls', calls: [{ id: 'call-1', name: 'get_weather', args: {} }] });
    const done = (await collect(first)).at(-1);
    const toolUse = done?.type === 'done' ? done.message : assistant('');
    streamCursor(model, ctx(user('weather?'), toolUse, { role: 'toolResult', toolCallId: 'call-1', toolName: 'get_weather', content: [{ type: 'text', text: 'Sunny' }], isError: false, timestamp: 0 }), {
      apiKey: 'tok',
      sessionId: 's-resumed',
    });
    await vi.waitFor(() => expect(run.submitted).toHaveLength(1));
    const other = streamCursor(model, ctx(user('something else')), { apiKey: 'tok', sessionId: 's-resumed' });
    await runOpened(2);
    expect(run.closed).toBe(false);
    lastRun().onEvent({ type: 'end' });
    await collect(other);
  });

  test('replays an unknown history as text in a fresh Cursor conversation', async () => {
    const stream = streamCursor(model, ctx(user('first'), assistant('answer'), user('second')), { apiKey: 'tok', sessionId: 's-unknown' });
    await runOpened(1);
    expect(lastRun().req.checkpoint).toBeUndefined();
    expect(lastRun().req.userText).toBe('<conversation_so_far>\nUser: first\nAssistant: answer\n</conversation_so_far>\n\nsecond');
    lastRun().onEvent({ type: 'end' });
    await collect(stream);
  });

  test("reports Cursor's error message as a pi error", async () => {
    const stream = streamCursor(model, ctx(user('hi')), { apiKey: 'tok', sessionId: 's-error' });
    await runOpened(1);
    lastRun().onEvent({ type: 'end', error: 'Claude Opus 5.5 is not included in your weekly usage' });
    const events = await collect(stream);
    const last = events.at(-1);
    expect(last?.type === 'error' && last.error.errorMessage).toBe('Claude Opus 5.5 is not included in your weekly usage');
  });

  test('asks for /login without a start event when there is no Cursor token', async () => {
    const events = await collect(streamCursor(model, ctx(user('hi')), {}));
    expect(events.map((e) => e.type)).toStrictEqual(['error']);
    const last = events.at(-1);
    expect(last?.type === 'error' && last.error.errorMessage).toMatch(/\/login/);
  });

  test('conversations without a pi session id never share Cursor state', async () => {
    const finish = async (stream: AssistantMessageEventStream, reply: string) => {
      lastRun().onEvent({ type: 'checkpoint', state: Uint8Array.of(runs.length), contextTokens: 0 });
      lastRun().onEvent({ type: 'text', delta: reply });
      lastRun().onEvent({ type: 'turn_ended', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 } });
      lastRun().onEvent({ type: 'end' });
      await collect(stream);
    };
    const a = streamCursor(model, ctx(user('topic A')), { apiKey: 'tok' });
    await runOpened(1);
    await finish(a, 'ok A');
    const b = streamCursor(model, ctx(user('topic B')), { apiKey: 'tok' });
    await runOpened(2);
    await finish(b, 'ok A');

    const followUp = streamCursor(model, ctx(user('topic A'), assistant('ok A'), user('more on A')), { apiKey: 'tok' });
    await runOpened(3);
    expect(lastRun().req.checkpoint).toStrictEqual(Uint8Array.of(1));
    expect(lastRun().req.userText).toBe('more on A');
    lastRun().onEvent({ type: 'end' });
    await collect(followUp);
  });

  test('evicting an old session closes the Cursor run it left waiting on tools', async () => {
    const abandoned = streamCursor(model, ctx(user('weather?')), { apiKey: 'tok', sessionId: 's-evict-0' });
    await runOpened(1);
    const waiting = lastRun();
    waiting.onEvent({ type: 'tool_calls', calls: [{ id: 'c', name: 'get_weather', args: {} }] });
    await collect(abandoned);
    for (let i = 1; i <= 32; i++) {
      const s = streamCursor(model, ctx(user(`q${i}`)), { apiKey: 'tok', sessionId: `s-evict-${i}` });
      await runOpened(i + 1);
      lastRun().onEvent({ type: 'end', error: 'stop here' });
      await collect(s);
    }
    expect(waiting.closed).toBe(true);
  });

  test('reports raw Cursor run events to onProviderStreamEvent', async () => {
    const seen: unknown[] = [];
    const stream = streamCursor(model, ctx(user('hi')), { apiKey: 'tok', sessionId: 's-events', onProviderStreamEvent: (e) => void seen.push(e) });
    await runOpened(1);
    lastRun().onEvent({ type: 'text', delta: 'x' });
    lastRun().onEvent({ type: 'end', error: 'done' });
    await collect(stream);
    expect(seen).toStrictEqual([
      { type: 'text', delta: 'x' },
      { type: 'end', error: 'done' },
    ]);
  });

  test('aborting closes the Cursor run', async () => {
    const abort = new AbortController();
    const stream = streamCursor(model, ctx(user('hi')), { apiKey: 'tok', sessionId: 's-abort', signal: abort.signal });
    await runOpened(1);
    abort.abort();
    const last = (await collect(stream)).at(-1);
    expect(last?.type === 'error' && last.reason).toBe('aborted');
    expect(lastRun().closed).toBe(true);
  });
});

test('flattenTranscript asks Cursor to continue after trailing tool results', () => {
  const text = flattenTranscript([user('run it'), { role: 'toolResult', toolCallId: 'c', toolName: 'bash', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 0 }]);
  expect(text).toBe('<conversation_so_far>\nUser: run it\n[tool result bash] ok\n</conversation_so_far>\n\nContinue from the tool results above.');
});
