// Drives the spacex-cursor provider against the real Cursor SDK the way Pi does: a tool pause with
// parallel calls, the resumed run, a follow-up on the same agent, and an abort.
// Usage: CURSOR_API_KEY=... node scripts/verify-live.ts [model-id]

import { Agent } from '@cursor/sdk';
import { type Api, type AssistantMessage, type Message, type Model, normalizeContext, type SimpleStreamOptions, type Tool, type ToolCall } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { streamCursor } from '../src/cursor/stream.ts';

const MISSING_KEY_MESSAGE = 'Set CURSOR_API_KEY to run the live check.';
const ABORT_AFTER_MS = 1500;
const USER_ARGS_START = 2;
const DEFAULT_MODEL_ID = 'composer-2.5';
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 64_000;

const LiveEnvironment = z.object({ CURSOR_API_KEY: z.string({ error: MISSING_KEY_MESSAGE }).min(1, MISSING_KEY_MESSAGE) });
const Argv = z.array(z.string());

const weather: Tool = { name: 'get_weather', description: 'Get the current weather for a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } };
const forecasts: Record<string, string> = { Paris: 'Sunny, 21C', Tokyo: 'Rain, 14C' };

const modelFor = (id: string): Model<Api> => ({
  id,
  name: id,
  api: 'cursor-sdk',
  provider: 'spacex-cursor',
  baseUrl: '',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  maxTokens: DEFAULT_MAX_TOKENS,
});

const answerCall = (call: ToolCall): Message => {
  const { city } = call.arguments;
  return {
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: 'text', text: (typeof city === 'string' ? forecasts[city] : undefined) ?? 'Unknown' }],
    isError: false,
    timestamp: Date.now(),
  };
};
const toolCalls = (m: AssistantMessage) => m.content.filter((c) => c.type === 'toolCall');
const textOf = (m: AssistantMessage) => m.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

/** One live check run. Counts agents created and records whether any check failed. */
function createLiveRun(apiKey: string, model: Model<Api>) {
  let agentsCreated = 0;
  let failed = false;
  const create = Agent.create.bind(Agent);
  Agent.create = async (options) => {
    agentsCreated += 1;
    return create(options);
  };

  async function turn(messages: Message[], options?: SimpleStreamOptions): Promise<AssistantMessage> {
    for await (const event of streamCursor(model, normalizeContext({ messages }), options ?? { apiKey })) {
      if (event.type === 'done') return event.message;
      if (event.type === 'error') return event.error;
    }
    throw new Error('stream ended without done or error');
  }

  function check(label: string, ok: boolean, detail: string): void {
    console.info(`${ok ? 'PASS' : 'FAIL'} ${label}: ${detail}`);
    if (!ok) failed = true;
  }

  return { turn, check, agentsCreated: () => agentsCreated, failed: () => failed };
}

async function main(): Promise<void> {
  const { CURSOR_API_KEY: apiKey } = LiveEnvironment.parse(process.env);
  const [modelArg] = Argv.parse(process.argv).slice(USER_ARGS_START);
  const live = createLiveRun(apiKey, modelFor(modelArg ?? DEFAULT_MODEL_ID));
  const { turn, check } = live;

  let messages: Message[] = [
    { role: 'system', content: 'You are a terse weather bot. Always call get_weather before answering about weather. Reply in one short sentence.', toolsAdded: [weather], timestamp: 0 },
    { role: 'user', content: 'Weather in Paris and Tokyo?', timestamp: 1 },
  ];

  let reply = await turn(messages);
  check('tool pause', reply.stopReason === 'toolUse', `${reply.stopReason}, calls ${JSON.stringify(toolCalls(reply).map((c) => c.arguments))}`);
  while (reply.stopReason === 'toolUse') {
    messages = [...messages, reply, ...toolCalls(reply).map(answerCall)];
    reply = await turn(messages);
  }
  check('resumed run uses tool results', reply.stopReason === 'stop' && /21/.test(textOf(reply)) && /14/.test(textOf(reply)), textOf(reply));

  messages = [...messages, reply, { role: 'user', content: 'Which of those two cities was warmer? Answer from what you already know.', timestamp: Date.now() }];
  const followUp = await turn(messages);
  const agents = live.agentsCreated();
  check('follow-up reuses the agent', followUp.stopReason === 'stop' && agents === 1 && /Paris/.test(textOf(followUp)), `${agents} agent(s): ${textOf(followUp)}`);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), ABORT_AFTER_MS);
  const aborted = await turn([{ role: 'user', content: 'Count slowly from 1 to 200, one number per line.', timestamp: 0 }], { apiKey, signal: controller.signal });
  check('abort cancels the run', aborted.stopReason === 'aborted', `${aborted.stopReason}: ${aborted.errorMessage ?? ''}`);

  if (live.failed()) throw new Error('One or more live checks failed.');
}

await main();
