import { createHash } from 'node:crypto';

import { type AssistantMessageEvent, type Context, type Message, normalizeContext, type Tool } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ClientCall = { readonly options: Record<string, unknown>; readonly params: Record<string, unknown>; readonly signal: unknown };

const sdk = vi.hoisted(() => ({ calls: [] as ClientCall[], events: [] as unknown[] }));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic {
    static readonly APIError = actual.APIError;
    readonly options: Record<string, unknown>;
    readonly beta = {
      messages: {
        create: async (params: Record<string, unknown>, request: { signal?: unknown }) => {
          sdk.calls.push({ options: this.options, params, signal: request.signal });
          return (async function* () {
            yield* sdk.events;
          })();
        },
      },
    };
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }
  return { ...actual, default: FakeAnthropic };
});

const { default: extension } = await import('../src/index.ts');

type ProviderConfig = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly api: string;
  readonly models: readonly Record<string, unknown>[];
  readonly oauth: {
    readonly name: string;
    readonly login: (callbacks: unknown) => Promise<{ refresh: string; access: string; expires: number }>;
    readonly refreshToken: (credentials: unknown, signal: AbortSignal) => Promise<{ refresh: string; access: string; expires: number }>;
    readonly getApiKey: (credentials: { access: string }) => string;
  };
  readonly streamSimple: (model: unknown, context: unknown, options?: unknown) => AsyncIterable<AssistantMessageEvent>;
};

const register = () => {
  const registered: { name: string; config: ProviderConfig }[] = [];
  extension({ registerProvider: (name: string, config: ProviderConfig) => registered.push({ name, config }) } as never);
  const [entry] = registered;
  if (!entry) throw new Error('provider not registered');
  return entry;
};

const model = (id = 'claude-sonnet-4-5') => {
  const { config } = register();
  return { ...config.models.find((entry) => entry['id'] === id), api: config.api, provider: 'custom-anthropic', baseUrl: config.baseUrl };
};

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

const readTool: Tool = { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } as never };
const customTool: Tool = { name: 'my_tool', description: 'Custom', parameters: { type: 'object' } as never };

const transcript = (): Message[] => [
  { role: 'user', content: 'hello', timestamp: 1 },
  { role: 'user', content: '   ', timestamp: 1 },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'look \uD800' },
      { type: 'image', data: 'AAA', mimeType: 'image/png' },
    ],
    timestamp: 1,
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'ok' },
      { type: 'text', text: '  ' },
      { type: 'thinking', thinking: 'signed', thinkingSignature: 'sig' },
      { type: 'thinking', thinking: 'unsigned' },
      { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'a' } },
      { type: 'toolCall', id: 't2', name: 'my_tool', arguments: {} },
    ],
    api: 'custom-anthropic-api',
    provider: 'custom-anthropic',
    model: 'claude-sonnet-4-5',
    usage,
    stopReason: 'toolUse',
    timestamp: 1,
  },
  { role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [{ type: 'text', text: 'file' }], isError: false, timestamp: 1 },
  { role: 'toolResult', toolCallId: 't2', toolName: 'my_tool', content: [{ type: 'image', data: 'BBB', mimeType: 'image/jpeg' }], isError: true, timestamp: 1 },
];

const context = (overrides: Partial<Context> = {}) => normalizeContext({ systemPrompt: 'Be brief.', messages: transcript(), tools: [readTool, customTool], ...overrides });

const streamEvents = [
  { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'abc' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hi ' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'there' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'call1', name: 'Read', input: {} } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"b.txt"}' } },
  { type: 'content_block_stop', index: 2 },
  { type: 'content_block_delta', index: 9, delta: { type: 'text_delta', text: 'ignored' } },
  { type: 'content_block_stop', index: 9 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 } },
];

const collect = async (iterable: AsyncIterable<AssistantMessageEvent>) => {
  const events: AssistantMessageEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
};

const run = async (options: Record<string, unknown>, ctx = context(), modelId = 'claude-sonnet-4-5') => {
  const { config } = register();
  const events = await collect(config.streamSimple(model(modelId), ctx, options));
  const call = sdk.calls.at(-1);
  return { events, call };
};

const terminal = (events: readonly AssistantMessageEvent[]) => {
  const last = events.at(-1);
  if (last?.type === 'done') return last.message;
  if (last?.type === 'error') return last.error;
  throw new Error('stream did not terminate');
};

beforeEach(() => {
  sdk.calls.length = 0;
  sdk.events.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider registration', () => {
  it('registers custom-anthropic with the current Anthropic catalog and OAuth', () => {
    const { name, config } = register();
    const catalog = builtinProviders()
      .find((provider) => provider.id === 'anthropic')
      ?.getModels()
      .filter((entry) => entry.api === 'anthropic-messages');
    expect(name).toBe('custom-anthropic');
    expect(config.baseUrl).toBe('https://api.anthropic.com');
    expect(config.apiKey).toBe('$CUSTOM_ANTHROPIC_API_KEY');
    expect(config.api).toBe('custom-anthropic-api');
    expect(config.models.map((entry) => entry['id'])).toEqual(catalog?.map((entry) => entry.id));
    expect(config.models.find((entry) => entry['id'] === 'claude-sonnet-4-5')).toEqual({
      id: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5 (latest) (Custom)',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200000,
      maxTokens: 64000,
    });
    expect(config.models.find((entry) => entry['id'] === 'claude-sonnet-5-5')).toMatchObject({
      compat: { forceAdaptiveThinking: true },
      thinkingLevelMap: { xhigh: 'xhigh', max: 'max' },
    });
    expect(config.oauth.name).toBe('Custom Anthropic (Claude Pro/Max)');
    expect(config.oauth.getApiKey({ access: 'tok' })).toBe('tok');
  });
});

describe('oauth', () => {
  const tokenResponse = (body: unknown, ok = true) => ({ ok, json: async () => body, text: async () => JSON.stringify(body) });

  it('logs in with PKCE and exchanges the pasted code', async () => {
    const fetchMock = vi.fn(async () => tokenResponse({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);
    const urls: string[] = [];
    const before = Date.now();
    const credentials = await register().config.oauth.login({
      onAuth: ({ url }: { url: string }) => urls.push(url),
      onPrompt: async () => 'the-code#the-state',
    });
    const url = new URL(urls[0] ?? '');
    expect(`${url.origin}${url.pathname}`).toBe('https://claude.ai/oauth/authorize');
    const verifier = url.searchParams.get('state') ?? '';
    expect(Object.fromEntries(url.searchParams)).toEqual({
      code: 'true',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      response_type: 'code',
      redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
      scope: 'org:create_api_key user:profile user:inference',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: verifier,
    });
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fetchMock).toHaveBeenCalledWith('https://console.anthropic.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
        code: 'the-code',
        state: 'the-state',
        redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
        code_verifier: verifier,
      }),
    });
    expect(credentials.access).toBe('acc');
    expect(credentials.refresh).toBe('ref');
    expect(credentials.expires).toBeGreaterThanOrEqual(before + 3600_000 - 300_000);
    expect(credentials.expires).toBeLessThanOrEqual(Date.now() + 3600_000 - 300_000);
  });

  it('rejects a failed token exchange', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => tokenResponse('bad code', false)),
    );
    await expect(register().config.oauth.login({ onAuth: () => undefined, onPrompt: async () => 'c#s' })).rejects.toThrow(/Token exchange failed/);
  });

  it('refreshes the token', async () => {
    const fetchMock = vi.fn(async () => tokenResponse({ access_token: 'acc2', refresh_token: 'ref2', expires_in: 60 }));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    const credentials = await register().config.oauth.refreshToken({ refresh: 'ref1', access: 'old', expires: 0 }, signal);
    expect(fetchMock).toHaveBeenCalledWith('https://console.anthropic.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', refresh_token: 'ref1' }),
      signal,
    });
    expect({ access: credentials.access, refresh: credentials.refresh }).toEqual({ access: 'acc2', refresh: 'ref2' });
  });

  it('rejects a failed refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => tokenResponse('expired', false)),
    );
    await expect(register().config.oauth.refreshToken({ refresh: 'r', access: 'a', expires: 0 }, new AbortController().signal)).rejects.toThrow(/Token refresh failed/);
  });
});

describe('request', () => {
  it('keeps emoji and other surrogate pairs and replaces only unpaired surrogates', async () => {
    sdk.events.push(...streamEvents);
    const messages: Message[] = [{ role: 'user', content: 'ship it \u{1F680} \uD800 then \uDC00 end', timestamp: 1 }];
    const { call } = await run({ apiKey: 'k' }, normalizeContext({ systemPrompt: 'Use \u{1F44D}.', messages }));
    expect(call?.params['messages']).toEqual([{ role: 'user', content: 'ship it \u{1F680} \uFFFD then \uFFFD end' }]);
    expect(call?.params['system']).toEqual([{ type: 'text', text: 'Use \u{1F44D}.', cache_control: { type: 'ephemeral' } }]);
  });

  it('sends Claude Code identity, renamed tools, and converted messages for OAuth tokens', async () => {
    sdk.events.push(...streamEvents);
    const { call } = await run({ apiKey: 'sk-ant-oat01-x', reasoning: 'high' });
    expect(call?.options).toEqual({
      baseURL: 'https://api.anthropic.com',
      authToken: 'sk-ant-oat01-x',
      defaultHeaders: {
        'anthropic-dangerous-direct-browser-access': 'true',
        'user-agent': 'claude-cli/2.1.322 (external, cli)',
        'x-app': 'cli',
      },
    });
    expect(call?.params).toEqual({
      model: 'claude-sonnet-4-5',
      max_tokens: 21333,
      stream: true,
      system: [
        { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude.", cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Be brief.', cache_control: { type: 'ephemeral' } },
      ],
      betas: ['claude-code-20250219', 'oauth-2025-04-20', 'interleaved-thinking-2025-05-14'],
      tools: [
        { name: 'Read', description: 'Read a file', eager_input_streaming: true, input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
        { name: 'my_tool', description: 'Custom', eager_input_streaming: true, input_schema: { type: 'object', properties: {}, required: [] } },
      ],
      thinking: { type: 'enabled', budget_tokens: 20480, display: 'summarized' },
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look \uFFFD' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'ok' },
            { type: 'thinking', thinking: 'signed', signature: 'sig' },
            { type: 'text', text: 'unsigned' },
            { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a' } },
            { type: 'tool_use', id: 't2', name: 'my_tool', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'file', is_error: false },
            {
              type: 'tool_result',
              tool_use_id: 't2',
              content: [
                { type: 'text', text: '(see attached image)' },
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBB' } },
              ],
              is_error: true,
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
      ],
    });
  });

  it('sends an API key without Claude Code identity and honors maxTokens and custom budgets', async () => {
    sdk.events.push(...streamEvents);
    const { call } = await run({ apiKey: 'sk-ant-api-x', maxTokens: 100, reasoning: 'low', thinkingBudgets: { low: 7 } });
    expect(call?.options).toEqual({ baseURL: 'https://api.anthropic.com', apiKey: 'sk-ant-api-x' });
    expect(call?.params['betas']).toEqual(['interleaved-thinking-2025-05-14']);
    expect(call?.params['max_tokens']).toBe(100);
    expect(call?.params['system']).toEqual([{ type: 'text', text: 'Be brief.', cache_control: { type: 'ephemeral' } }]);
    expect(call?.params['thinking']).toEqual({ type: 'enabled', budget_tokens: 7, display: 'summarized' });
    expect(call?.params['tools']).toMatchObject([{ name: 'read' }, { name: 'my_tool' }]);
  });

  it('omits system, tools, and thinking when absent and falls back to the default budget', async () => {
    sdk.events.push(...streamEvents);
    const plain = await run({ apiKey: 'sk-ant-api-x' }, normalizeContext({ messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }));
    expect(Object.keys(plain.call?.params ?? {}).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream']);
    const xhigh = await run({ apiKey: 'sk-ant-oat-x', reasoning: 'xhigh' }, normalizeContext({ messages: [] }));
    expect(xhigh.call?.params['system']).toEqual([{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude.", cache_control: { type: 'ephemeral' } }]);
    expect(xhigh.call?.params['thinking']).toEqual({ type: 'enabled', budget_tokens: 10240, display: 'summarized' });
    expect(xhigh.call?.params['betas']).toEqual(['claude-code-20250219', 'oauth-2025-04-20', 'interleaved-thinking-2025-05-14']);
  });

  it.each([
    ['high', 'high'],
    ['xhigh', 'xhigh'],
    ['max', 'max'],
    ['minimal', 'low'],
  ])('uses adaptive thinking with effort for %s on adaptive models', async (reasoning, effort) => {
    sdk.events.push(...streamEvents);
    const { call } = await run({ apiKey: 'sk-ant-api-x', reasoning }, context(), 'claude-sonnet-5-5');
    expect(call?.params['thinking']).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(call?.params['output_config']).toEqual({ effort });
    expect(call?.params['betas']).toBeUndefined();
    expect(call?.params['max_tokens']).toBe(42666);
  });
});

describe('response stream', () => {
  it('turns Anthropic events into Pi events and a final message', async () => {
    sdk.events.push(...streamEvents);
    const { events } = await run({ apiKey: 'sk-ant-oat01-x' });
    expect(events.map((event) => event.type)).toEqual([
      'start',
      'thinking_start',
      'thinking_delta',
      'thinking_end',
      'text_start',
      'text_delta',
      'text_delta',
      'text_end',
      'toolcall_start',
      'toolcall_delta',
      'toolcall_delta',
      'toolcall_end',
      'done',
    ]);
    const deltas = events.flatMap((event) => ('delta' in event ? [event.delta] : []));
    expect(deltas).toEqual(['hmm', 'Hi ', 'there', '{"path":', '"b.txt"}']);
    const message = terminal(events);
    expect(message.content).toEqual([
      { type: 'thinking', thinking: 'hmm', thinkingSignature: 'abc' },
      { type: 'text', text: 'Hi there' },
      { type: 'toolCall', id: 'call1', name: 'read', arguments: { path: 'b.txt' } },
    ]);
    expect(message.stopReason).toBe('toolUse');
    expect(message.usage).toEqual({
      input: 10,
      output: 20,
      cacheRead: 2,
      cacheWrite: 3,
      totalTokens: 35,
      cost: {
        input: expect.closeTo(0.00003, 12),
        output: expect.closeTo(0.0003, 12),
        cacheRead: expect.closeTo(6e-7, 12),
        cacheWrite: expect.closeTo(0.00001125, 12),
        total: expect.closeTo(0.00034185, 12),
        totalFromProvider: false,
      },
    });
    expect({ api: message.api, provider: message.provider, model: message.model, role: message.role }).toEqual({
      api: 'custom-anthropic-api',
      provider: 'custom-anthropic',
      model: 'claude-sonnet-4-5',
      role: 'assistant',
    });
    const ends = events.flatMap((event) => (event.type === 'text_end' || event.type === 'thinking_end' ? [event.content] : []));
    expect(ends).toEqual(['hmm', 'Hi there']);
  });

  it.each([
    ['end_turn', 'stop'],
    ['pause_turn', 'stop'],
    ['stop_sequence', 'stop'],
    ['max_tokens', 'length'],
  ])('maps stop reason %s to %s', async (reason, expected) => {
    sdk.events.push({ type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 1 } });
    const { events } = await run({ apiKey: 'k' });
    expect(terminal(events).stopReason).toBe(expected);
  });

  it('maps a context window overflow to length', async () => {
    sdk.events.push({ type: 'message_delta', delta: { stop_reason: 'model_context_window_exceeded' }, usage: { output_tokens: 1 } });
    const { events } = await run({ apiKey: 'k' });
    expect(terminal(events).stopReason).toBe('length');
  });

  it('reports a refusal with its explanation', async () => {
    sdk.events.push({ type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { type: 'refusal', explanation: 'Not allowed.' } }, usage: { output_tokens: 1 } });
    const { events } = await run({ apiKey: 'k' });
    expect(terminal(events)).toMatchObject({ stopReason: 'error', errorMessage: 'Not allowed.' });
  });

  it('reports an API error with its status and request id', async () => {
    const { APIError } = await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk');
    const failure = APIError.generate(429, { type: 'error', error: { type: 'rate_limit_error', message: 'Slow down' } }, undefined, new Headers({ 'request-id': 'req_123' }));
    sdk.events.push({
      get type() {
        throw failure;
      },
    });
    const { events } = await run({ apiKey: 'k' });
    expect(terminal(events)).toMatchObject({ stopReason: 'error', errorMessage: 'RateLimitError 429 (request req_123): Slow down' });
  });

  it('reports an unknown stop reason as an error', async () => {
    sdk.events.push({ type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 1 } });
    const { events } = await run({ apiKey: 'k' });
    expect(events.at(-1)?.type).toBe('error');
    expect(terminal(events)).toMatchObject({ stopReason: 'error', errorMessage: 'An unknown error occurred' });
  });

  it('reports a stream that ends without a stop reason', async () => {
    const { events } = await run({ apiKey: 'k' });
    expect(events.map((event) => event.type)).toEqual(['start', 'error']);
    expect(terminal(events)).toMatchObject({ stopReason: 'error', errorMessage: 'Anthropic stream ended without a stop reason' });
  });

  it('reports an aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    sdk.events.push({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } });
    const { events, call } = await run({ apiKey: 'k', signal: controller.signal });
    expect(call?.signal).toBe(controller.signal);
    expect(terminal(events)).toMatchObject({ stopReason: 'aborted', errorMessage: 'Request was aborted' });
  });

  it('reports an SDK failure', async () => {
    sdk.events.push({
      get type() {
        throw new Error('network down');
      },
    });
    const { events } = await run({ apiKey: 'k' });
    expect(terminal(events)).toMatchObject({ stopReason: 'error', errorMessage: 'network down' });
  });
});
