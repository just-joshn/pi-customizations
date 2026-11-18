import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';
import { type Decoded, decode, EnvelopeReader, encode, frame, msg, num, str } from '../src/cursor/proto.ts';
import { CursorRun, endStreamError, type RunEvent } from '../src/cursor/run.ts';

// Server frames from a live Run: prompt -> get_weather call -> tool result -> answer (scripts/record-cursor-fixture.ts).
const fixture = JSON.parse(readFileSync(new URL('./fixtures/cursor-tool-run.json', import.meta.url), 'utf8')) as {
  frames: { phase: 'before_tool' | 'after_tool'; payload?: string; end?: string }[];
};
const bytesOf = (f: { payload?: string; end?: string }) => {
  if (f.payload) return Buffer.from(f.payload, 'base64');
  const body = Buffer.from(f.end ?? '{}');
  const head = Buffer.alloc(5);
  head[0] = 2;
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
};

function replay() {
  const written: Uint8Array[] = [];
  const events: RunEvent[] = [];
  const run = new CursorRun(
    {
      token: 'test',
      conversationId: 'conv',
      modelId: 'composer-2.5',
      userText: 'weather?',
      systemPrompt: 'SYSTEM PROMPT FROM PI',
      tools: [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } }],
      checkpoint: undefined,
      blobs: new Map(),
    },
    { write: (b) => written.push(b), close: () => {} },
  );
  run.onEvent = (e) => events.push(e);
  return { run, written, events };
}

/** Follows nested message fields, e.g. dig(m, 10, 1, 1) for result.success.request_context. */
const dig = (d: Decoded | undefined, ...path: number[]) => path.reduce<Decoded | undefined>((cur, no) => (cur ? msg(cur, no) : undefined), d);

const clientMessages = (written: Uint8Array[]) => {
  const reader = new EnvelopeReader();
  return written.flatMap((w) => reader.push(w)).flatMap((e) => (e.end ? [] : [decode(e.payload)]));
};

describe('CursorRun replaying a recorded tool-call run', () => {
  test('pauses on the pi tool call with parsed arguments', () => {
    const { run, events } = replay();
    for (const f of fixture.frames.filter((f) => f.phase === 'before_tool')) run.receive(bytesOf(f));
    const calls = events.filter((e) => e.type === 'tool_calls');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: 'tool_calls', calls: [{ name: 'get_weather', args: { city: 'Paris' } }] });
    expect(events.some((e) => e.type === 'end')).toBe(false);
  });

  test("sends pi's system prompt as a rule and pi's tools when Cursor asks for request context", () => {
    const { run, written } = replay();
    for (const f of fixture.frames.filter((f) => f.phase === 'before_tool')) run.receive(bytesOf(f));
    const contextReply = clientMessages(written)
      .map((m) => msg(m, 2))
      .find((exec) => exec?.bytes.has(10));
    const context = dig(contextReply, 10, 1, 1);
    const rule = dig(context, 2);
    const tool = dig(context, 7);
    expect(rule && str(rule, 2)).toBe('SYSTEM PROMPT FROM PI');
    expect(tool && str(tool, 1)).toBe('get_weather');
  });

  test('answers the paused exec with the tool result, then streams the final answer and usage', () => {
    const { run, written, events } = replay();
    for (const f of fixture.frames.filter((f) => f.phase === 'before_tool')) run.receive(bytesOf(f));
    const call = events.find((e) => e.type === 'tool_calls');
    if (call?.type !== 'tool_calls') throw new Error('no tool call recorded');
    const before = written.length;
    run.submitToolResults([{ id: call.calls[0]?.id ?? '', text: 'Sunny, 21C', isError: false }]);
    const mcpReply = clientMessages(written.slice(before))
      .map((m) => msg(m, 2))
      .find((exec) => exec?.bytes.has(11));
    const content = dig(mcpReply, 11, 1, 1, 1);
    expect(content && str(content, 1)).toBe('Sunny, 21C');

    for (const f of fixture.frames.filter((f) => f.phase === 'after_tool')) run.receive(bytesOf(f));
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).toMatch(/21/);
    expect(events.at(-1)).toStrictEqual({ type: 'end' });
  });

  test("reports Cursor's context size from every checkpoint, including the one before the tool pause", () => {
    const { run, events } = replay();
    for (const f of fixture.frames.filter((f) => f.phase === 'before_tool')) run.receive(bytesOf(f));
    const call = events.find((e) => e.type === 'tool_calls');
    run.submitToolResults(call?.type === 'tool_calls' ? call.calls.map((c) => ({ id: c.id, text: 'Sunny, 21C', isError: false })) : []);
    for (const f of fixture.frames.filter((f) => f.phase === 'after_tool')) run.receive(bytesOf(f));
    const sizes = events.flatMap((e): (number | string)[] => (e.type === 'checkpoint' ? [e.contextTokens] : e.type === 'tool_calls' ? ['pause'] : []));
    expect(sizes).toStrictEqual([4824, 4824, 'pause', 4920, 4920, 4971, 4971]);
  });

  test("reports the turn's usage in pi's shape: input without cache reads, plus reasoning", () => {
    const { run, events } = replay();
    for (const f of fixture.frames.filter((f) => f.phase === 'before_tool')) run.receive(bytesOf(f));
    run.submitToolResults([]);
    for (const f of fixture.frames.filter((f) => f.phase === 'after_tool')) run.receive(bytesOf(f));
    // Recorded TurnEndedUpdate: input_tokens 14524 counts the 10048 cache reads too.
    expect(events.find((e) => e.type === 'turn_ended')).toStrictEqual({ type: 'turn_ended', usage: { input: 4476, output: 191, cacheRead: 10048, cacheWrite: 0, reasoning: 0 } });

    const reasoning = replay();
    reasoning.run.receive(
      frame(
        encode([
          [
            1,
            [
              [
                14,
                [
                  [1, 100],
                  [2, 20],
                  [3, 60],
                  [4, 5],
                  [5, 7],
                ],
              ],
            ],
          ],
        ]),
      ),
    );
    expect(reasoning.events).toStrictEqual([{ type: 'turn_ended', usage: { input: 40, output: 20, cacheRead: 60, cacheWrite: 5, reasoning: 7 } }]);
  });

  test('acknowledges server blob writes with the same id', () => {
    const { run, written } = replay();
    run.receive(
      frame(
        encode([
          [
            4,
            [
              [1, 5],
              [
                3,
                [
                  [1, Uint8Array.of(1)],
                  [2, Uint8Array.of(2)],
                ],
              ],
            ],
          ],
        ]),
      ),
    );
    const kv = clientMessages(written)
      .map((m) => msg(m, 3))
      .find(Boolean);
    expect(kv && num(kv, 1)).toBe(5);
    expect(kv?.bytes.has(3)).toBe(true);
  });
});

describe('endStreamError', () => {
  test("prefers Cursor's human title and detail", () => {
    const json = JSON.stringify({
      error: {
        code: 'resource_exhausted',
        message: 'Error',
        details: [
          { type: 'aiserver.v1.ErrorDetails', debug: { error: 'ERROR_USAGE_PRICING_REQUIRED', details: { title: 'Claude Opus 5.5 is not included in your weekly usage', detail: 'Buy credits or switch to a Grok model to continue.' } } },
        ],
      },
    });
    expect(endStreamError(json)).toBe('Claude Opus 5.5 is not included in your weekly usage. Buy credits or switch to a Grok model to continue.');
  });

  test('treats an empty end-stream as success', () => {
    expect(endStreamError('{}')).toBeUndefined();
  });

  test('falls back to the Connect message', () => {
    expect(endStreamError(JSON.stringify({ error: { code: 'invalid_argument', message: 'Custom system prompt is not enabled for this account.' } }))).toBe('Custom system prompt is not enabled for this account.');
  });
});

describe('CursorRun failure paths', () => {
  const fresh = () => replay();

  test('a dropped connection ends the Run with an error', () => {
    const { run, events } = fresh();
    run.fail('Cursor closed the connection before the turn finished');
    expect(events.at(-1)).toStrictEqual({ type: 'end', error: 'Cursor closed the connection before the turn finished' });
  });

  test('an end-stream before turn_ended is an error, not a normal stop', () => {
    const { run, events } = fresh();
    run.receive(Buffer.concat([Buffer.from([2, 0, 0, 0, 2]), Buffer.from('{}')]));
    expect(events.at(-1)).toStrictEqual({ type: 'end', error: 'Cursor ended the turn before it finished' });
  });

  test('a connection closing after the turn ended is a normal finish', () => {
    const { run, events } = fresh();
    run.receive(frame(encode([[1, [[14, [[1, 5]]]]]])));
    run.peerClosed();
    expect(events.at(-1)).toStrictEqual({ type: 'end' });
  });

  test('a connection closing mid-turn is an error', () => {
    const { run, events } = fresh();
    run.peerClosed();
    expect(events.at(-1)).toStrictEqual({ type: 'end', error: 'Cursor closed the connection before the turn finished' });
  });

  test('a malformed frame ends the Run instead of throwing', () => {
    const { run, events } = fresh();
    expect(() => run.receive(frame(Uint8Array.of(0x0b, 0x01)))).not.toThrow();
    expect(events.at(-1)).toMatchObject({ type: 'end', error: expect.stringContaining("Could not read Cursor's response") });
  });

  test('a paused call pi did not answer still gets an error reply', () => {
    const { run, written, events } = fresh();
    for (const f of fixture.frames.filter((f) => f.phase === 'before_tool')) run.receive(bytesOf(f));
    expect(events.some((e) => e.type === 'tool_calls')).toBe(true);
    const before = written.length;
    run.submitToolResults([]);
    const reply = clientMessages(written.slice(before))
      .map((m) => msg(m, 2))
      .find((exec) => exec?.bytes.has(11));
    const error = dig(reply, 11, 2);
    expect(error && str(error, 1)).toBe('pi returned no result for this tool call.');
  });
});
