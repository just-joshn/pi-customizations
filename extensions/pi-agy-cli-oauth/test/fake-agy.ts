/* eslint-disable max-lines-per-function -- A fixture: one linear request table reads better than indirection. */
/**
 * A scripted stand-in for `agy acp --stdio`.
 *
 * It speaks the same NDJSON JSON-RPC the real CLI serves, so the client and stream
 * tests drive the production code path without a model call. The scenario is read
 * from `FAKE_AGY_SCENARIO`; the module exports the same scenario names so a test
 * never has to hard-code a string in two places.
 */
import { createInterface } from 'node:readline';

export const SCENARIOS = {
  ready: 'ready',
  signedOut: 'signed-out',
  toolCall: 'tool-call',
  parallelToolCalls: 'parallel-tool-calls',
  policy: 'policy',
  refusal: 'refusal',
  malformed: 'malformed',
  slow: 'slow',
  crash: 'crash',
} as const;

export type Scenario = (typeof SCENARIOS)[keyof typeof SCENARIOS];

const MODELS = [
  { modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
  { modelId: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
  { modelId: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
  { modelId: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
  { modelId: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
];

const EFFORTS_BY_MODEL: Record<string, string[]> = {
  'gemini-3.8-flash': ['low', 'medium', 'high'],
  'gpt-oss-120b': ['medium'],
};

function configOptions(model: string): readonly unknown[] {
  const efforts = EFFORTS_BY_MODEL[model] ?? [];
  const modelOption = {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: model,
    options: [
      { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
      { value: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
      { value: 'gpt-oss-120b', name: 'GPT-OSS 120B' },
    ],
  };
  const thoughtLevel = {
    id: 'thought_level',
    name: 'Thinking Level',
    category: 'thought_level',
    type: 'select',
    currentValue: efforts.at(-1),
    options: efforts.map((value) => ({ value, name: value })),
  };
  return efforts.length > 0 ? [modelOption, thoughtLevel] : [modelOption];
}

const scenario = (process.env['FAKE_AGY_SCENARIO'] ?? SCENARIOS.ready) as Scenario;
let model = 'gemini-3.8-flash';
let promptCount = 0;

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function notify(update: unknown): void {
  write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'fake-session', update } });
}

function sessionNew(id: number | string): void {
  write({
    jsonrpc: '2.0',
    id,
    result: {
      sessionId: 'fake-session',
      models: { availableModels: MODELS, currentModelId: 'gemini-3.8-flash-high' },
      modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }] },
      configOptions: configOptions(model),
      _meta: { antigravity: { tier: { name: 'Antigravity Starter Quota', id: 'free-tier' } } },
    },
  });
}

function setConfigOption(id: number | string, params: Record<string, unknown>): void {
  const configId = params['configId'];
  const value = params['value'];
  if (configId === 'model' && typeof value === 'string') {
    model = value;
    write({ jsonrpc: '2.0', id, result: { configOptions: configOptions(value) } });
    return;
  }
  if (configId === 'thought_level') {
    const offered = EFFORTS_BY_MODEL[model] ?? [];
    if (typeof value === 'string' && offered.includes(value)) {
      write({ jsonrpc: '2.0', id, result: { configOptions: configOptions(model) } });
      return;
    }
    write({
      jsonrpc: '2.0',
      id,
      error: { code: -32_602, message: `Thinking level "${String(value)}" is not offered for model "${model}"` },
    });
    return;
  }
  write({ jsonrpc: '2.0', id, error: { code: -32_602, message: `unknown config option ${String(configId)}` } });
}

let pendingPrompt: number | string | undefined;

/** The CLI answers the prompt with the turn's usage once a permission request is refused. */
function answerPrompt(stopReason: string): void {
  if (pendingPrompt === undefined) return;
  const id = pendingPrompt;
  pendingPrompt = undefined;
  write({ jsonrpc: '2.0', id, result: { stopReason, usage: { inputTokens: 21, outputTokens: 7, cachedReadTokens: 0, cachedWriteTokens: 0, thoughtTokens: 3, totalTokens: 28 } } });
}

function promptToolCall(): void {
  write({
    jsonrpc: '2.0',
    id: 'perm-1',
    method: 'session/request_permission',
    params: {
      sessionId: 'fake-session',
      toolCall: {
        toolCallId: 'call-1',
        name: 'run_command',
        title: 'Run `ls`',
        kind: 'execute',
        rawInput: { CommandLine: 'ls -la', Cwd: '/tmp' },
      },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    },
  });
}

function promptReadToolCall(): void {
  notify({
    sessionUpdate: 'tool_call',
    toolCallId: 'call-2',
    name: 'view_file',
    title: 'Read src/index.ts',
    kind: 'read',
    rawInput: { AbsolutePath: '/tmp/src/index.ts', StartLine: 1, EndLine: 40 },
  });
}

function plainAnswer(id: number | string): void {
  notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } });
  notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' world' } });
  write({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn', usage: { inputTokens: 11, outputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, thoughtTokens: 2, totalTokens: 16 } } });
}

function runPrompt(id: number | string): void {
  promptCount += 1;
  pendingPrompt = id;
  if (promptCount === 1) {
    notify({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'goal' }] });
  }
  notify({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Considering the request.' } });
  notify({ sessionUpdate: 'usage_update', used: 0, size: 1_048_576 });
  switch (scenario) {
    case SCENARIOS.policy: {
      notify({
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: '\n\u26a0 This service has been disabled in this account for violation of Terms of Service. ' + 'Please submit an appeal to continue using this product.\n',
        },
      });
      write({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      return;
    }
    case SCENARIOS.refusal: {
      write({ jsonrpc: '2.0', id, result: { stopReason: 'refusal' } });
      return;
    }
    case SCENARIOS.toolCall: {
      notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Let me look.' } });
      promptToolCall();
      return;
    }
    case SCENARIOS.parallelToolCalls: {
      promptReadToolCall();
      promptToolCall();
      return;
    }
    case SCENARIOS.malformed: {
      process.stdout.write('this is not json\n');
      notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Recovered.' } });
      write({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      return;
    }
    case SCENARIOS.slow: {
      return;
    }
    case SCENARIOS.ready: {
      plainAnswer(id);
      return;
    }
    case SCENARIOS.signedOut: {
      plainAnswer(id);
      return;
    }
    case SCENARIOS.crash: {
      process.exit(1);
    }
  }
}

function handle(message: Record<string, unknown>): void {
  const id = message['id'] as number | string;
  const method = message['method'];
  // A reply to our own request. The real CLI answers the prompt once the turn is
  // cancelled, not when the permission decision arrives, so this is a no-op.
  if (typeof method !== 'string') return;
  const params = (message['params'] ?? {}) as Record<string, unknown>;
  switch (method) {
    case 'initialize': {
      if (scenario === SCENARIOS.signedOut) {
        write({ jsonrpc: '2.0', id, error: { code: -32_000, message: 'Authentication required' } });
        return;
      }
      write({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { promptCapabilities: { image: true, audio: false, embeddedContext: true }, _meta: { antigravity: { systemPrompt: { append: true } } } },
          agentInfo: { name: 'Antigravity ACP Server', version: '1.5.15' },
          authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }],
        },
      });
      return;
    }
    case 'session/new': {
      if (process.env['FAKE_AGY_REQUIRE_INSTRUCTIONS'] === '1') {
        const append = (params['_meta'] as { antigravity?: { systemPrompt?: { append?: unknown } } } | undefined)?.antigravity?.systemPrompt?.append;
        if (typeof append !== 'string' || append === '') {
          write({ jsonrpc: '2.0', id, error: { code: -32_602, message: 'session/new carried no appended system prompt' } });
          return;
        }
      }
      if (scenario === SCENARIOS.signedOut) {
        write({ jsonrpc: '2.0', id, error: { code: -32_000, message: 'Authentication required' } });
        return;
      }
      sessionNew(id);
      return;
    }
    case 'session/set_config_option': {
      setConfigOption(id, params);
      return;
    }
    case 'session/set_mode':
    case 'session/set_model': {
      write({ jsonrpc: '2.0', id, result: {} });
      return;
    }
    case 'session/prompt': {
      runPrompt(id);
      return;
    }
    case 'session/cancel': {
      write({ jsonrpc: '2.0', id, result: {} });
      answerPrompt('cancelled');
      return;
    }
    case 'session/close':
    case 'session/load': {
      write({ jsonrpc: '2.0', id, result: {} });
      return;
    }
    default: {
      write({ jsonrpc: '2.0', id, error: { code: -32_601, message: `unknown method ${method}` } });
    }
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const trimmed = line.trim();
  if (trimmed === '') continue;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    continue;
  }
  handle(parsed as Record<string, unknown>);
}
