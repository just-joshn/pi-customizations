import { type AssistantMessage, type AssistantMessageEvent, type Message, type Model, normalizeContext, type ThinkingLevel } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-responses';
import { type Mock, describe, expect, test, vi } from 'vitest';
import type { ChatModelConfig } from '../src/stored-models.ts';
import { GROK_ID, loadExtension } from './host.ts';

const GROK_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
const GROK_MODEL_ID = 'grok-4.7';
const GROK_MAX_OUTPUT_TOKENS = 64_000;
const CLIENT_VERSION = '1.0.77';
const CLIENT_USER_AGENT = 'grok-cli/1.0.77';
const OUTPUT_INDEX = 0;

type Fetch = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;
type FetchMock = Mock<Fetch>;

interface RequestBody {
  model: string;
  stream: boolean;
  max_output_tokens: number;
  reasoning?: { effort: string };
}

const textItem = (text: string) => ({ id: 'msg-1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
const reasoningItem = (text: string) => ({ id: 'rs-1', type: 'reasoning', summary: [{ type: 'summary_text', text }] });
const completed = (output: unknown[]) => ({ type: 'response.completed', response: { id: 'resp-1', status: 'completed', output } });

/** A Grok Build model composed the way Pi composes it from the registered provider. */
const grokModel = (): Model<'openai-responses'> => {
  const provider = loadExtension().provider(GROK_ID);
  const builtIn = provider.config.models?.find((model): model is ChatModelConfig => model.id === GROK_MODEL_ID && 'reasoning' in model);
  if (!builtIn) throw new Error(`the provider lists no built-in ${GROK_MODEL_ID}`);
  return {
    id: builtIn.id,
    name: builtIn.name,
    reasoning: builtIn.reasoning,
    input: builtIn.input,
    cost: builtIn.cost,
    contextWindow: builtIn.contextWindow,
    maxTokens: builtIn.maxTokens,
    provider: GROK_ID,
    api: 'openai-responses',
    baseUrl: provider.config.baseUrl ?? GROK_BASE_URL,
    ...(builtIn.thinkingLevelMap ? { thinkingLevelMap: builtIn.thinkingLevelMap } : {}),
  };
};

const grokHeaders = (): Record<string, string> => loadExtension().provider(GROK_ID).config.headers ?? {};

const requestFor = (events: readonly object[]): FetchMock => {
  const body = events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  return vi.fn<Fetch>(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
};

const reply = (text: string): object[] => [
  { type: 'response.created', response: { id: 'resp-1', status: 'completed', output: [] } },
  { type: 'response.output_item.added', output_index: OUTPUT_INDEX, item: { ...textItem(''), content: [] } },
  { type: 'response.output_text.delta', output_index: OUTPUT_INDEX, delta: text },
  { type: 'response.output_item.done', output_index: OUTPUT_INDEX, item: textItem(text) },
  completed([]),
];

/** Sends one turn through the OpenAI Responses implementation, with the provider's own headers. */
async function askGrok(fetch: FetchMock, reasoning?: ThinkingLevel): Promise<AssistantMessage> {
  const messages: Message[] = [
    { role: 'system', content: 'You are Grok Build.', timestamp: 0 },
    { role: 'user', content: 'hi', timestamp: 1 },
  ];
  const stream = streamSimple(grokModel(), normalizeContext({ messages }), { apiKey: 'tok', ...(reasoning ? { reasoning } : {}), headers: grokHeaders(), fetch });
  let last: AssistantMessageEvent | undefined;
  for await (const event of stream) last = event;
  if (last?.type === 'done') return last.message;
  throw new Error(last?.type === 'error' ? last.error.errorMessage : 'the stream ended without a result');
}

const bodyOf = (fetch: FetchMock): RequestBody => {
  const body = fetch.mock.calls[0]?.[1]?.body;
  if (typeof body !== 'string') throw new Error('the request body was not a string');
  return JSON.parse(body) as RequestBody;
};
const headersOf = (fetch: FetchMock): Headers => new Headers(fetch.mock.calls[0]?.[1]?.headers);

describe('Grok Build inference', () => {
  test('sends the model, the client headers, and the effort Pi selected', async () => {
    const fetch = requestFor(reply('hello'));
    const message = await askGrok(fetch, 'high');
    expect(fetch.mock.calls[0]?.[0]).toBe(`${GROK_BASE_URL}/responses`);
    const headers = headersOf(fetch);
    expect(headers.get('authorization')).toBe('Bearer tok');
    expect(headers.get('x-grok-client-version')).toBe(CLIENT_VERSION);
    expect(headers.get('user-agent')).toBe(CLIENT_USER_AGENT);
    expect(bodyOf(fetch)).toMatchObject({ model: GROK_MODEL_ID, stream: true, max_output_tokens: GROK_MAX_OUTPUT_TOKENS, reasoning: { effort: 'high' } });
    expect(message).toMatchObject({ provider: GROK_ID, model: GROK_MODEL_ID, stopReason: 'stop', content: [{ type: 'text', text: 'hello' }] });
  });

  test('sends no reasoning effort when Pi selects no level', async () => {
    const fetch = requestFor(reply('hello'));
    await askGrok(fetch);
    expect(bodyOf(fetch)).not.toHaveProperty('reasoning');
  });

  test('turns a reasoning summary and text deltas into thinking and text blocks', async () => {
    const fetch = requestFor([
      { type: 'response.created', response: { id: 'resp-1', status: 'completed', output: [] } },
      { type: 'response.output_item.added', output_index: OUTPUT_INDEX, item: { ...reasoningItem(''), summary: [] } },
      { type: 'response.reasoning_summary_text.delta', output_index: OUTPUT_INDEX, delta: 'Check ' },
      { type: 'response.reasoning_summary_text.delta', output_index: OUTPUT_INDEX, delta: 'the plan.' },
      { type: 'response.output_item.done', output_index: OUTPUT_INDEX, item: reasoningItem('Check the plan.') },
      { type: 'response.output_item.added', output_index: OUTPUT_INDEX + 1, item: { ...textItem(''), content: [] } },
      { type: 'response.output_text.delta', output_index: OUTPUT_INDEX + 1, delta: 'Done' },
      { type: 'response.output_text.delta', output_index: OUTPUT_INDEX + 1, delta: ' now.' },
      { type: 'response.output_item.done', output_index: OUTPUT_INDEX + 1, item: textItem('Done now.') },
      completed([]),
    ]);
    const message = await askGrok(fetch, 'high');
    expect(message.content).toMatchObject([
      { type: 'thinking', thinking: 'Check the plan.' },
      { type: 'text', text: 'Done now.' },
    ]);
  });
});
