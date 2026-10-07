import { type Api, type AssistantMessage, type Context, isContextOverflow, isRetryableAssistantError, type Model, normalizeContext, type SimpleStreamOptions, Type } from '@earendil-works/pi-ai';
import { expect } from 'vitest';
import { userAgent } from '../src/cloudcode.ts';
import { createAntigravityProvider } from '../src/index.ts';
import { GOOGLE_OAUTH } from '../src/oauth.ts';
import type { CloudCodeRequest } from '../src/stream.ts';
import { type FakeServer, fakeServer, json, type Recorded, sse, stream } from './fake-server.ts';
import { test } from './network-guard.ts';

const API_KEY = JSON.stringify({ token: 'ya29.test', projectId: 'proj-123' });

const readTool = {
  name: 'read',
  description: 'Read a file',
  parameters: { type: 'object' as const, properties: { path: { type: 'string' as const } }, required: ['path'] },
};

const hello: Context = { systemPrompt: 'Be brief.', messages: [{ role: 'user', content: 'hi', timestamp: 1 }] };

const textAndThinking = sse([
  { response: { responseId: 'r1', candidates: [{ content: { parts: [{ text: 'Let me think', thought: true, thoughtSignature: 'sig1' }] } }] } },
  { response: { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] } },
  {
    response: {
      candidates: [{ content: { parts: [{ text: 'lo' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 15 },
    },
  },
]);

function toolCallStream(id: string): string {
  return sse([
    {
      response: {
        candidates: [{ content: { parts: [{ functionCall: { id, name: 'read', args: { path: 'a.txt' } } }] }, finishReason: 'STOP' }],
      },
    },
  ]);
}

interface Run {
  server: FakeServer;
  message: AssistantMessage;
  events: string[];
}

async function run(
  reply: (request: Recorded, res: import('node:http').ServerResponse) => void,
  options: {
    modelId?: string;
    model?: (model: Model<Api>) => Model<Api>;
    context?: Context;
    stream?: SimpleStreamOptions;
  } = {},
): Promise<Run> {
  const server = await fakeServer(reply);
  try {
    const provider = createAntigravityProvider({ ...GOOGLE_OAUTH, cloudCode: server.url });
    const base = provider.getModels().find((item) => item.id === (options.modelId ?? 'gemini-3.1-pro'));
    if (!base) throw new Error('missing base model');
    const model = options.model?.(base) ?? base;
    const result = provider.streamSimple(model, normalizeContext(options.context ?? hello), {
      apiKey: API_KEY,
      ...options.stream,
    });
    const events: string[] = [];
    for await (const event of result) events.push(event.type);
    return { server, message: await result.result(), events };
  } finally {
    server.close();
  }
}

function body(request: Recorded | undefined): CloudCodeRequest {
  return JSON.parse(request?.body ?? '{}') as CloudCodeRequest;
}

test('unsigned text omits the optional SDK signature field', async () => {
  expect.hasAssertions();
  const { message } = await run((_, res) => stream(res, textAndThinking));
  for (const block of message.content) {
    if (block.type === 'text') expect(block).not.toHaveProperty('textSignature');
  }
});

test('text and thinking stream into balanced Pi events with usage', async () => {
  const { message, events } = await run((_, res) => stream(res, textAndThinking), { stream: { reasoning: 'high' } });
  expect(events).toEqual(['start', 'thinking_start', 'thinking_delta', 'thinking_end', 'text_start', 'text_delta', 'text_delta', 'text_end', 'done']);
  expect(message.content).toEqual([
    { type: 'thinking', thinking: 'Let me think', thinkingSignature: 'sig1' },
    { type: 'text', text: 'Hello', textSignature: undefined },
  ]);
  expect(message.thinkingLevel).toBe('high');
  expect(message.stopReason).toBe('stop');
  expect(message.responseId).toBe('r1');
  expect(message.usage.input).toBe(10);
  expect(message.usage.output).toBe(5);
  expect(message.usage.totalTokens).toBe(15);
});

test('the envelope matches the Antigravity CLI agent request for the selected effort', async () => {
  const { server } = await run((_, res) => stream(res, textAndThinking), { stream: { reasoning: 'high' } });
  const sent = body(server.requests[0]);
  expect(server.requests[0]?.path).toBe('/v1internal:streamGenerateContent?alt=sse');
  expect(Object.keys(sent)).toEqual(['project', 'requestId', 'request', 'model', 'userAgent', 'requestType']);
  expect(sent.project).toBe('proj-123');
  expect(sent.model).toBe('gemini-pro-agent');
  expect(sent.requestType).toBe('agent');
  expect(sent.userAgent).toBe('antigravity');
  expect(sent.requestId).toMatch(/^agent\/[0-9a-f-]{36}\/1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/1$/);
  expect(sent.request.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  expect(sent.request.systemInstruction).toEqual({ role: 'user', parts: [{ text: 'Be brief.' }] });
  expect(sent.request.generationConfig).toEqual({ maxOutputTokens: 65535, thinkingConfig: { includeThoughts: true, thinkingBudget: 10001 } });
});

test('a lower effort selects the low Cloud Code model and its thinking budget', async () => {
  const { server, message } = await run((_, res) => stream(res, textAndThinking), { stream: { reasoning: 'low' } });
  expect(body(server.requests[0]).model).toBe('gemini-3.1-pro-low');
  expect(body(server.requests[0]).request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 1001 });
  expect(message.thinkingLevel).toBe('low');
});

test('OpenAI sampling metadata does not enter the Cloud Code request', async () => {
  const { server, message } = await run((_, res) => stream(res, textAndThinking), {
    model: (model) => ({ ...model, samplingParams: { temperature: 0.7 }, samplingParamsByThinkingLevel: { high: { top_p: 0.8 } } }),
    stream: { reasoning: 'high', temperature: 0.3, maxTokens: 4000, samplingParams: { top_k: 20 } },
  });
  expect(body(server.requests[0]).request.generationConfig).toEqual({
    temperature: 0.3,
    maxOutputTokens: 4000,
    thinkingConfig: { includeThoughts: true, thinkingBudget: 10001 },
  });
  expect(message.stopReason).toBe('stop');
});

test('the request carries only the headers the Antigravity CLI sends', async () => {
  const { server } = await run((_, res) => stream(res, textAndThinking));
  const headers = server.requests[0]?.headers ?? {};
  expect(headers.authorization).toBe('Bearer ya29.test');
  expect(headers['content-type']).toBe('application/json');
  expect(headers['user-agent']).toBe(userAgent());
  expect(headers.accept).not.toBe('text/event-stream');
  expect(headers['anthropic-beta']).toBeUndefined();
});

test("the user agent names the host in Go's os and arch spelling", () => {
  expect(userAgent('darwin', 'arm64')).toBe('antigravity/cli/1.3.1 (aidev_client; os_type=darwin; arch=arm64; cl=994719654; auth_method=consumer)');
  expect(userAgent('win32', 'x64')).toBe('antigravity/cli/1.3.1 (aidev_client; os_type=windows; arch=amd64; cl=994719654; auth_method=consumer)');
});

test('a Claude effort is sent as a thinking level with a zero budget and no beta header', async () => {
  const { server } = await run((_, res) => stream(res, textAndThinking), { modelId: 'claude-sonnet-5-5', stream: { reasoning: 'low' } });
  expect(server.requests[0]?.headers['anthropic-beta']).toBeUndefined();
  expect(body(server.requests[0]).model).toBe('claude-sonnet-5-5-low');
  expect(body(server.requests[0]).request.generationConfig).toEqual({
    maxOutputTokens: 128000,
    thinkingConfig: { includeThoughts: true, thinkingBudget: 0, thinkingLevel: 'LOW' },
  });
});

test('thinking off selects the lowest effort, because every CLI model thinks', async () => {
  const { server, message } = await run((_, res) => stream(res, textAndThinking), { modelId: 'claude-opus-5-5' });
  expect(body(server.requests[0]).model).toBe('claude-opus-5-5-low');
  expect(message.thinkingLevel).toBe('low');
});

test('a model with one effort uses it for every thinking level', async () => {
  const { server } = await run((_, res) => stream(res, textAndThinking), { modelId: 'gpt-oss-120b', stream: { reasoning: 'high' } });
  expect(body(server.requests[0]).model).toBe('gpt-oss-120b-medium');
  expect(body(server.requests[0]).request.generationConfig).toEqual({ maxOutputTokens: 32768, thinkingConfig: { includeThoughts: true, thinkingBudget: 8192 } });
});

async function toolRoundTrip(modelId: string) {
  const first = await run((_, res) => stream(res, toolCallStream('call_1')), {
    modelId,
    stream: { sessionId: 'session-1' },
    context: { tools: [readTool], messages: [{ role: 'user', content: 'read a', timestamp: 1 }] },
  });
  const followUp: Context = {
    tools: [readTool],
    messages: [
      { role: 'user', content: 'read a', timestamp: 1 },
      first.message,
      {
        role: 'toolResult',
        toolCallId: 'call_1',
        toolName: 'read',
        content: [{ type: 'text', text: 'hello' }],
        isError: false,
        timestamp: 2,
      },
    ],
  };
  const second = await run((_, res) => stream(res, textAndThinking), { modelId, stream: { sessionId: 'session-1' }, context: followUp });
  return { first, sentTools: body(first.server.requests[0]).request.tools, followUp: body(second.server.requests[0]) };
}

const cliParameters = { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] };

test('a Gemini tool call round trip declares OpenAPI parameters and returns the result in a model turn', async () => {
  const { first, sentTools, followUp } = await toolRoundTrip('gemini-3.1-pro');
  expect(first.message.stopReason).toBe('toolUse');
  expect(first.message.content).toEqual([{ type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'a.txt' } }]);
  expect(sentTools).toEqual([{ functionDeclarations: [{ name: 'read', description: 'Read a file', parameters: cliParameters }] }]);
  expect(followUp.request.contents.at(-1)).toEqual({
    role: 'model',
    parts: [{ functionResponse: { name: 'read', response: { output: 'hello' }, id: 'call_1' } }],
  });
});

test('Cloud Code receives OpenAPI literal alternatives without unsupported uniqueness keywords', async () => {
  const constrainedTool = {
    name: 'launch',
    description: 'Launch a task',
    parameters: Type.Object({
      environment: Type.Union([Type.Literal('local'), Type.Literal('cloud')]),
      agent_ids: Type.Array(Type.String(), { uniqueItems: true }),
      const: Type.String(),
      uniqueItems: Type.String(),
    }),
  };
  const original = structuredClone(constrainedTool.parameters);
  const { server } = await run((_, res) => stream(res, textAndThinking), { context: { tools: [constrainedTool], messages: [{ role: 'user', content: 'launch', timestamp: 1 }] } });
  expect(body(server.requests[0]).request.tools).toEqual([
    {
      functionDeclarations: [
        {
          name: 'launch',
          description: 'Launch a task',
          parameters: {
            type: 'OBJECT',
            properties: {
              environment: {
                anyOf: [
                  { type: 'STRING', enum: ['local'] },
                  { type: 'STRING', enum: ['cloud'] },
                ],
              },
              agent_ids: { type: 'ARRAY', items: { type: 'STRING' } },
              const: { type: 'STRING' },
              uniqueItems: { type: 'STRING' },
            },
            required: ['environment', 'agent_ids', 'const', 'uniqueItems'],
          },
        },
      ],
    },
  ]);
  expect(constrainedTool.parameters).toEqual(original);
});

test('a Claude tool call round trip keeps the tool call id and returns the result in a user turn', async () => {
  const { first, sentTools, followUp } = await toolRoundTrip('claude-sonnet-5-5');
  expect(first.message.stopReason).toBe('toolUse');
  expect(sentTools).toEqual([{ functionDeclarations: [{ name: 'read', description: 'Read a file', parameters: cliParameters }] }]);
  expect(followUp.request.contents.at(-2)).toEqual({
    role: 'model',
    parts: [{ functionCall: { name: 'read', args: { path: 'a.txt' }, id: 'call_1' } }],
  });
  expect(followUp.request.contents.at(-1)).toEqual({
    role: 'user',
    parts: [{ functionResponse: { name: 'read', response: { output: 'hello' }, id: 'call_1' } }],
  });
});

test("a 429 reaches Pi's own retry without a provider retry by default", async () => {
  const { server, message } = await run((_, res) => json(res, 429, { error: { message: 'Resource has been exhausted' } }));
  expect(server.requests.length).toBe(1);
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toBe('Cloud Code Assist API error (429): Resource has been exhausted');
  expect(isRetryableAssistantError(message)).toBe(true);
});

test('with retry.provider.maxRetries set, a 429 waits for retry-after and then succeeds', async () => {
  let calls = 0;
  const started = Date.now();
  const { server, message } = await run((_, res) => (calls++ === 0 ? json(res, 429, { error: { message: 'Resource has been exhausted' } }, { 'retry-after': '0.01' }) : stream(res, textAndThinking)), { stream: { maxRetries: 1 } });
  expect(server.requests.length).toBe(2);
  expect(message.stopReason).toBe('stop');
  expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
});

test('a retry-after above maxRetryDelayMs fails instead of waiting', async () => {
  const { server, message } = await run((_, res) => json(res, 429, { error: { message: 'Resource has been exhausted' } }, { 'retry-after': '3600' }), { stream: { maxRetries: 1, maxRetryDelayMs: 1000 } });
  expect(server.requests.length).toBe(1);
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toBe('Server requested 3601s retry delay (max: 1s). Resource has been exhausted');
});

test('a non-retryable error surfaces the Cloud Code message and stays recognizable as overflow', async () => {
  const { message } = await run((_, res) =>
    json(res, 400, {
      error: { message: 'The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)' },
    }),
  );
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toBe('Cloud Code Assist API error (400): The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)');
  expect(isContextOverflow(message, 1048576)).toBe(true);
});

test('an aborted request ends as aborted', async () => {
  const { message, events } = await run((_, res) => stream(res, textAndThinking), {
    stream: { signal: AbortSignal.abort() },
  });
  expect(message.stopReason).toBe('aborted');
  expect(events).toEqual(['error']);
});

test('a stream that closes before a finish reason is an error Pi retries', async () => {
  const { message } = await run((_, res) => stream(res, sse([{ response: { candidates: [{ content: { parts: [{ text: 'cut off' }] } }] } }])));
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toBe('Cloud Code Assist stream ended without a finish reason');
  expect(isRetryableAssistantError(message)).toBe(true);
});

test('a safety finish reason surfaces the raw provider reason', async () => {
  const blocked = sse([{ response: { candidates: [{ content: { parts: [{ text: 'blocked' }] }, finishReason: 'SAFETY' }] } }]);
  const { message } = await run((_, res) => stream(res, blocked));
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toBe('Provider stopped with: SAFETY');
});

test('a supplied fetch implementation carries the request', async () => {
  const urls: string[] = [];
  const { message } = await run((_, res) => stream(res, textAndThinking), {
    stream: {
      fetch: Object.assign((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        urls.push(String(input));
        return fetch(input, init);
      }, fetch),
    },
  });
  expect(message.stopReason).toBe('stop');
  expect(urls.length).toBe(1);
  expect(urls[0]).toMatch(/\/v1internal:streamGenerateContent\?alt=sse$/);
});

test('a malformed SSE line is skipped', async () => {
  const { message } = await run((_, res) => stream(res, `data: {not json\n\n${sse([{ response: { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] } }])}`));
  expect(message.content).toEqual([{ type: 'text', text: 'ok', textSignature: undefined }]);
  expect(message.stopReason).toBe('stop');
});

test('onPayload sees the envelope and its replacement is what gets sent', async () => {
  let seenProject: unknown;
  const { server } = await run((_, res) => stream(res, textAndThinking), {
    stream: {
      onPayload: (payload) => {
        seenProject = (payload as CloudCodeRequest).project;
        return { ...(payload as CloudCodeRequest), project: 'replaced' };
      },
    },
  });
  expect(seenProject).toBe('proj-123');
  expect(body(server.requests[0]).project).toBe('replaced');
});

test('onResponse sees the response status', async () => {
  const statuses: number[] = [];
  await run((_, res) => stream(res, textAndThinking), {
    stream: { onResponse: (response) => void statuses.push(response.status) },
  });
  expect(statuses).toEqual([200]);
});

test('a missing credential asks the user to log in without calling Cloud Code', async () => {
  const { server, message } = await run((_, res) => stream(res, textAndThinking), { stream: { apiKey: '' } });
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toBe('No Google Antigravity credentials. Run /login and choose Google Antigravity.');
  expect(server.requests.length).toBe(0);
});

test('a context without a system prompt omits the system instruction', async () => {
  const { server } = await run((_, res) => stream(res, textAndThinking), { context: { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] } });
  expect(body(server.requests[0]).request.systemInstruction).toBe(undefined);
  expect(body(server.requests[0]).request.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
});

test('a tool choice only reaches the wire when tools are present', async () => {
  const withTools = await run((_, res) => stream(res, textAndThinking), {
    context: { tools: [readTool], messages: [{ role: 'user', content: 'read a', timestamp: 1 }] },
    stream: { toolChoice: 'auto' },
  });
  expect(body(withTools.server.requests[0]).request.toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
  const withoutTools = await run((_, res) => stream(res, textAndThinking), { stream: { toolChoice: 'auto' } });
  expect(body(withoutTools.server.requests[0]).request.toolConfig).toBe(undefined);
});

test('a session id is forwarded in the request envelope', async () => {
  const { server } = await run((_, res) => stream(res, textAndThinking), { stream: { sessionId: 'sess-1' } });
  expect(body(server.requests[0]).request.sessionId).toBe('sess-1');
});

test('a tool round trip keeps the turn in the request id and advances the step by two', async () => {
  const { first, followUp } = await toolRoundTrip('claude-sonnet-5-5');
  const opening = body(first.server.requests[0]).requestId.split('/');
  const next = followUp.requestId.split('/');
  expect(next.slice(0, 4)).toEqual(opening.slice(0, 4));
  expect([opening[2], opening[4], next[4]]).toEqual(['1', '1', '3']);
});

test('a null header override removes the base header', async () => {
  const { server } = await run((_, res) => stream(res, textAndThinking), { stream: { headers: { 'User-Agent': null } } });
  expect(server.requests[0]?.headers['user-agent']).not.toBe(userAgent());
  expect(server.requests[0]?.headers.authorization).toBe('Bearer ya29.test');
});

test('a function call without id, name, or args still streams', async () => {
  const incomplete = sse([{ response: { candidates: [{ content: { parts: [{ functionCall: {} }] }, finishReason: 'STOP' }] } }]);
  const { message } = await run((_, res) => stream(res, incomplete));
  expect(message.stopReason).toBe('toolUse');
  expect(message.content).toEqual([{ type: 'toolCall', id: expect.stringMatching(/^undefined_\d+_\d+$/), name: '', arguments: {} }]);
});

test('a repeated tool call id gets a generated id', async () => {
  const repeated = sse([
    { response: { candidates: [{ content: { parts: [{ functionCall: { id: 'call_1', name: 'read', args: { path: 'a' } } }] }, finishReason: 'STOP' }] } },
    { response: { candidates: [{ content: { parts: [{ functionCall: { id: 'call_1', name: 'read', args: { path: 'b' } } }] } }] } },
  ]);
  const { message } = await run((_, res) => stream(res, repeated));
  expect(message.content).toEqual([
    { type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'a' } },
    { type: 'toolCall', id: expect.stringMatching(/^read_\d+_\d+$/), name: 'read', arguments: { path: 'b' } },
  ]);
});

test('a usage report with only some fields fills the rest with zero', async () => {
  const partialUsage = sse([{ response: { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 7 } } }]);
  const { message } = await run((_, res) => stream(res, partialUsage));
  expect(message.usage.input).toBe(7);
  expect(message.usage.output).toBe(0);
  expect(message.usage.cacheRead).toBe(0);
  expect(message.usage.cacheWrite).toBe(0);
  expect(message.usage.reasoning).toBe(0);
  expect(message.usage.totalTokens).toBe(0);
});

test('a chunk without a response or candidates is ignored', async () => {
  const envelope = sse([{}, { response: {} }, { response: { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] } }]);
  const { message } = await run((_, res) => stream(res, envelope));
  expect(message.content).toEqual([{ type: 'text', text: 'ok', textSignature: undefined }]);
  expect(message.stopReason).toBe('stop');
});

test('a 204 response without a body is an error', async () => {
  const { message } = await run((_, res) => {
    res.writeHead(204).end();
  });
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toBe('Cloud Code Assist returned no response body');
});

test('a non-Error payload failure is reported as text', async () => {
  const { message } = await run((_, res) => stream(res, textAndThinking), {
    stream: { onPayload: () => Promise.reject('payload rejected') },
  });
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toBe('payload rejected');
});

test('a model base URL replaces the configured endpoint', async () => {
  const server = await fakeServer((_, res) => stream(res, textAndThinking));
  try {
    const provider = createAntigravityProvider({ ...GOOGLE_OAUTH, cloudCode: 'https://ignored.example' });
    const base = provider.getModels()[0];
    if (!base) throw new Error('missing base model');
    const message = await provider.streamSimple({ ...base, baseUrl: server.url }, normalizeContext(hello), { apiKey: API_KEY }).result();
    expect(server.requests[0]?.path).toBe('/v1internal:streamGenerateContent?alt=sse');
    expect(message.stopReason).toBe('stop');
  } finally {
    server.close();
  }
});

test('onProviderStreamEvent observes each raw chunk before normalization', async () => {
  const observed: { chunk: unknown; modelId: string }[] = [];
  const { message } = await run((_, res) => stream(res, textAndThinking), {
    stream: {
      onProviderStreamEvent: (chunk, model) => {
        observed.push({ chunk, modelId: model.id });
      },
    },
  });
  expect(observed.length).toBe(3);
  expect(message.stopReason).toBe('stop');
  expect(observed[0]?.modelId).toBe('gemini-3.1-pro');
});
