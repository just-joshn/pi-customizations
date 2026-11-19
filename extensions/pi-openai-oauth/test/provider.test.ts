import type { Api, AssistantMessage, AssistantMessageEvent, Message, Model, SimpleStreamOptions, TranscriptContext } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import type { CodexClient, CodexThread, CreateCodex } from '../src/codex.ts';
import extension, { PROVIDER_ID } from '../src/index.ts';
import { createStreamCodex } from '../src/stream.ts';

const model = {
  id: 'gpt-6.1-sol',
  name: 'GPT-6.1 Sol (Codex)',
  api: 'openai-codex-sdk',
  provider: PROVIDER_ID,
  baseUrl: 'codex://local',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 400_000,
  maxTokens: 128_000,
} as unknown as Model<Api>;

interface Call {
  readonly modelId: string;
  readonly kind: 'start' | 'resume';
  readonly threadId: string;
  readonly threadSource?: string;
  readonly prompt: string;
}

/** Fake Codex that records each turn and answers with `reply(prompt)`. */
function fakeCodex(reply: (prompt: string) => Promise<string> | string = (prompt) => `echo: ${prompt}`) {
  const calls: Call[] = [];
  let nextThread = 0;
  const thread = (base: Omit<Call, 'prompt'>): CodexThread => ({
    id: base.threadId,
    run: async (prompt) => {
      calls.push({ ...base, prompt });
      return { finalResponse: await reply(prompt) };
    },
  });
  const create: CreateCodex = (modelId): CodexClient => ({
    startThread: ({ threadSource }) => thread({ modelId, kind: 'start', threadId: `thread-${++nextThread}`, threadSource }),
    resumeThread: (threadId) => thread({ modelId, kind: 'resume', threadId }),
  });
  return { calls, create };
}

const user = (text: string): Message => ({ role: 'user', content: text, timestamp: 0 }) as Message;

function context(messages: Message[], systemPrompt?: string): TranscriptContext {
  const system = systemPrompt === undefined ? [] : [{ role: 'system', content: systemPrompt, timestamp: 0 }];
  return { messages: [...system, ...messages] } as unknown as TranscriptContext;
}

async function collect(stream: AsyncIterable<AssistantMessageEvent>) {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  const last = events.at(-1);
  const message = (last?.type === 'done' ? last.message : last?.type === 'error' ? last.error : undefined) as AssistantMessage | undefined;
  return { types: events.map((event) => event.type), message };
}

describe('streamCodex', () => {
  it('starts a labelled thread and reports the final response as text', async () => {
    const codex = fakeCodex();
    const stream = createStreamCodex(codex.create);

    const { types, message } = await collect(stream(model, context([user('Fix CI')])));

    expect(codex.calls).toEqual([{ modelId: 'gpt-6.1-sol', kind: 'start', threadId: 'thread-1', threadSource: 'pi', prompt: 'Fix CI' }]);
    expect(types).toEqual(['start', 'text_start', 'text_delta', 'text_end', 'done']);
    expect(message?.stopReason).toBe('stop');
    expect(message?.content).toEqual([{ type: 'text', text: 'echo: Fix CI' }]);
  });

  it('resumes the thread for a follow-up and sends only the new message', async () => {
    const codex = fakeCodex();
    const stream = createStreamCodex(codex.create);
    const first = await collect(stream(model, context([user('Make a plan')], 'Be brief')));
    const reply = first.message as Message;

    await collect(stream(model, context([user('Make a plan'), reply, user('Implement the plan')], 'Be brief')));

    expect(codex.calls[1]).toMatchObject({ kind: 'resume', threadId: 'thread-1', prompt: 'Implement the plan' });
  });

  it('starts a new thread with the whole conversation when earlier history changed', async () => {
    const codex = fakeCodex();
    const stream = createStreamCodex(codex.create);
    const first = await collect(stream(model, context([user('Make a plan')])));
    const edited = { ...(first.message as AssistantMessage), content: [{ type: 'text', text: 'edited' }] };

    await collect(stream(model, context([user('Make a plan'), edited as Message, user('Go')], 'Be brief')));

    expect(codex.calls[1]).toMatchObject({ kind: 'start', threadId: 'thread-2' });
    expect(codex.calls[1]?.prompt).toBe(['Instructions from Pi:\nBe brief', 'Conversation so far:\n\nUser:\nMake a plan\n\nAssistant:\nedited\n\nUser:\nGo', 'Reply to the last message.'].join('\n\n'));
  });

  it('does not resume a thread from another model', async () => {
    const codex = fakeCodex();
    const stream = createStreamCodex(codex.create);
    const first = await collect(stream(model, context([user('hi')])));
    const other = { ...model, id: 'codex-default' } as Model<Api>;

    await collect(stream(other, context([user('hi'), first.message as Message, user('again')])));

    expect(codex.calls[1]).toMatchObject({ modelId: 'codex-default', kind: 'start' });
  });

  it('reports a Codex failure as an error', async () => {
    const codex = fakeCodex(() => Promise.reject(new Error('Not signed in')));
    const { types, message } = await collect(createStreamCodex(codex.create)(model, context([user('hi')])));

    expect(types).toEqual(['start', 'error']);
    expect(message).toMatchObject({ stopReason: 'error', errorMessage: 'Not signed in' });
  });

  it('ends as aborted when the signal fires during a turn', async () => {
    const controller = new AbortController();
    const codex = fakeCodex(() => {
      controller.abort();
      return new Promise<string>(() => {});
    });
    const options: SimpleStreamOptions = { signal: controller.signal };

    const { message } = await collect(createStreamCodex(codex.create)(model, context([user('hi')]), options));

    expect(message).toMatchObject({ stopReason: 'aborted', errorMessage: 'Request was aborted' });
  });

  it('sends the payload that onPayload returns', async () => {
    const codex = fakeCodex();
    const onPayload = vi.fn(() => ({ threadId: null, prompt: 'replaced' }));

    await collect(createStreamCodex(codex.create)(model, context([user('hi')]), { onPayload }));

    expect(onPayload).toHaveBeenCalledWith({ threadId: null, prompt: 'hi' }, model);
    expect(codex.calls[0]?.prompt).toBe('replaced');
  });

  it('finishes with no content when Codex returns an empty response', async () => {
    const codex = fakeCodex(() => '');
    const { types, message } = await collect(createStreamCodex(codex.create)(model, context([user('hi')])));

    expect(types).toEqual(['start', 'done']);
    expect(message?.content).toEqual([]);
  });
});

describe('extension', () => {
  it('registers the provider with its models and stream', () => {
    const registerProvider = vi.fn();
    extension({ registerProvider } as unknown as ExtensionAPI);

    const [id, config] = registerProvider.mock.calls[0] ?? [];
    expect(id).toBe('openai-oauth');
    expect(config.models.map((m: { id: string }) => m.id)).toEqual(['codex-default', 'gpt-6.1-sol']);
    expect(typeof config.streamSimple).toBe('function');
  });
});
