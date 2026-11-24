import { fileURLToPath } from 'node:url';
import type { AssistantMessage, AssistantMessageEvent, Model, Tool, TranscriptContext } from '@earendil-works/pi-ai';
import { isRetryableAssistantError, normalizeContext } from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';
import type { AcpClient } from '../src/acp/client.ts';
import { connectAcp } from '../src/acp/client.ts';
import { ACP_METHODS } from '../src/acp/protocol.ts';
import { API_ID, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, PROCESS_BASE_URL, PROVIDER_ID } from '../src/constants.ts';
import { POLICY_ALLOW_ENV } from '../src/errors.ts';
import { type ConnectAcp, createStream } from '../src/stream.ts';

/** Same values as `SCENARIOS` in `fake-agy.ts`. Importing that module reads stdin and stalls the test runner. */
const SCENARIOS = { ready: 'ready', toolCall: 'tool-call', parallelToolCalls: 'parallel-tool-calls', policy: 'policy', refusal: 'refusal', slow: 'slow', crash: 'crash' } as const;
type Scenario = (typeof SCENARIOS)[keyof typeof SCENARIOS];

const FAKE_AGY = fileURLToPath(new URL('./fake-agy.ts', import.meta.url));
const SCENARIO_ENV = 'FAKE_AGY_SCENARIO';
const bashTool: Tool = { name: 'bash', description: 'Run a command', parameters: { type: 'object' } };

function model(): Model<typeof API_ID> {
  return {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet',
    api: API_ID,
    provider: PROVIDER_ID,
    baseUrl: PROCESS_BASE_URL,
    input: ['text'],
    reasoning: true,
    thinkingLevelMap: { high: 'high' },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

function context(): TranscriptContext {
  return normalizeContext({ messages: [{ role: 'user', content: 'Say hello', timestamp: 1 }], tools: [bashTool] });
}

function childEnv(scenario: Scenario): Record<string, string> {
  const entries = Object.entries(process.env).flatMap(([key, value]): [string, string][] => (value === undefined ? [] : [[key, value]]));
  return { ...Object.fromEntries(entries), [SCENARIO_ENV]: scenario };
}

function tracing(client: AcpClient, onPermission: (result: unknown) => void): AcpClient {
  return {
    request: (method, params, options) => (options === undefined ? client.request(method, params) : client.request(method, params, options)),
    notify: (method, params) => {
      client.notify(method, params);
    },
    setServerRequestHandler(handler) {
      if (handler === undefined) {
        client.setServerRequestHandler(undefined);
        return;
      }
      client.setServerRequestHandler(async (method, params) => {
        const result = await handler(method, params);
        if (method === ACP_METHODS.requestPermission) onPermission(result);
        return result;
      });
    },
    onNotification: (handler) => client.onNotification(handler),
    get stderrTail() {
      return client.stderrTail;
    },
    get alive() {
      return client.alive;
    },
    close() {
      client.close();
    },
  };
}

function connectScenario(scenario: Scenario, onPermission?: (result: unknown) => void): ConnectAcp {
  return async () => {
    const client = await connectAcp({ command: process.execPath, args: ['--experimental-strip-types', FAKE_AGY], env: childEnv(scenario), cwd: process.cwd() });
    return onPermission === undefined ? client : tracing(client, onPermission);
  };
}

async function collect(scenario: Scenario, options?: { controller?: AbortController; allowPolicy?: boolean }): Promise<{ events: readonly AssistantMessageEvent[]; permission: unknown }> {
  if (options?.allowPolicy === true) vi.stubEnv(POLICY_ALLOW_ENV, '1');
  let permission: unknown;
  const signal = options?.controller?.signal;
  const stream = createStream(
    connectScenario(scenario, (result) => {
      permission = result;
    }),
  )(model(), context(), { reasoning: 'high', ...(signal === undefined ? {} : { signal }) });
  let events: readonly AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events = events.concat([event]);
    if (event.type === 'start') options?.controller?.abort();
  }
  return { events, permission };
}

function finalMessage(events: readonly AssistantMessageEvent[]): AssistantMessage {
  const last = events.at(-1);
  if (last?.type === 'done') return last.message;
  if (last?.type === 'error') return last.error;
  throw new Error(`turn did not settle: ${last?.type ?? 'none'}`);
}

it("sends Pi's instructions on session/new when the CLI accepts them", async () => {
  // The fake refuses the session unless the appended system prompt arrived, so a
  // completed turn is proof the instructions travelled.
  vi.stubEnv('FAKE_AGY_REQUIRE_INSTRUCTIONS', '1');
  const { events } = await collect(SCENARIOS.ready);
  expect(finalMessage(events).stopReason).toBe('stop');
});

it('streams a plain text turn and reports the tokens the CLI measured', async () => {
  const { events } = await collect(SCENARIOS.ready);
  expect(events.map((event) => event.type)).toEqual(['start', 'thinking_start', 'thinking_delta', 'thinking_end', 'text_start', 'text_delta', 'text_delta', 'text_end', 'done']);
  const message = finalMessage(events);
  expect(message.stopReason).toBe('stop');
  expect(message.content).toEqual([
    { type: 'thinking', thinking: 'Considering the request.' },
    { type: 'text', text: 'hello world' },
  ]);
  expect(message.usage).toEqual({ input: 11, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 2, totalTokens: 16, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  expect(message.diagnostics).toEqual([{ type: 'antigravity-context', timestamp: message.timestamp, details: { contextSize: DEFAULT_CONTEXT_WINDOW } }]);
  expect(message.thinkingLevel).toBe('high');
  expect(message.providerThinkingLevel).toBeUndefined();
});

it('bridges one run_command call to bash and rejects the CLI permission', async () => {
  const { events, permission } = await collect(SCENARIOS.toolCall);
  const tool = events.find((event) => event.type === 'toolcall_end');
  expect(tool?.type === 'toolcall_end' ? tool.toolCall : undefined).toMatchObject({ id: 'call-1', name: 'bash', arguments: { command: 'ls -la' } });
  expect(events.filter((event) => event.type === 'toolcall_end')).toHaveLength(1);
  // A turn cut short at a tool still reports the tokens the CLI measured for it.
  expect(finalMessage(events).usage).toMatchObject({ input: 21, output: 7, reasoning: 3, totalTokens: 28 });
  expect(finalMessage(events).stopReason).toBe('toolUse');
  expect(permission).toEqual({ outcome: { outcome: 'selected', optionId: 'reject-once' } });
});

it('keeps one tool call when a read arrives before the permission request', async () => {
  const { events, permission } = await collect(SCENARIOS.parallelToolCalls);
  expect(events.filter((event) => event.type === 'toolcall_end')).toHaveLength(1);
  expect(finalMessage(events).stopReason).toBe('toolUse');
  expect(permission).toEqual({ outcome: { outcome: 'selected', optionId: 'reject-once' } });
});

it('turns an account-policy notice into a non-retryable error', async () => {
  const { events } = await collect(SCENARIOS.policy);
  const message = finalMessage(events);
  expect(events.at(-1)?.type).toBe('error');
  expect(events.some((event) => event.type === 'done')).toBe(false);
  expect(message.errorMessage).toContain('policy');
  expect(isRetryableAssistantError(message)).toBe(false);
});

it('leaves the policy notice as text when the operator allows it', async () => {
  const { events } = await collect(SCENARIOS.policy, { allowPolicy: true });
  expect(finalMessage(events).stopReason).toBe('stop');
});

it('reports a model refusal as an error', async () => {
  const { events } = await collect(SCENARIOS.refusal);
  const message = finalMessage(events);
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toMatch(/refus/i);
});

it('reports a crashed CLI as a process exit', async () => {
  const { events } = await collect(SCENARIOS.crash);
  expect(finalMessage(events).errorMessage).toMatch(/exit/i);
  expect(events.some((event) => event.type === 'done')).toBe(false);
});

it('aborts an in-flight turn without a done event', async () => {
  const { events } = await collect(SCENARIOS.slow, { controller: new AbortController() });
  expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
  expect(finalMessage(events).stopReason).toBe('aborted');
  expect(events.some((event) => event.type === 'done')).toBe(false);
});
