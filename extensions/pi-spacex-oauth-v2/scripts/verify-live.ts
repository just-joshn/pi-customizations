// Drives the spacex-cursor provider against the real Cursor SDK the way Pi does: a tool pause with
// parallel calls, the resumed run, a follow-up on the same agent, and an abort.
// Usage: CURSOR_API_KEY=... node scripts/verify-live.ts [model-id]

import { Agent } from '@cursor/sdk';
import { type Api, type AssistantMessage, type Message, type Model, normalizeContext, type SimpleStreamOptions, type Tool } from '@earendil-works/pi-ai';
import { streamCursor } from '../src/cursor/stream.ts';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) throw new Error('Set CURSOR_API_KEY to run the live check.');

const model = { id: process.argv[2] ?? 'composer-2.5', api: 'cursor-sdk', provider: 'spacex-cursor', reasoning: false } as unknown as Model<Api>;
const weather: Tool = { name: 'get_weather', description: 'Get the current weather for a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } };
const forecasts: Record<string, string> = { Paris: 'Sunny, 21C', Tokyo: 'Rain, 14C' };

let agentsCreated = 0;
const create = Agent.create.bind(Agent);
Agent.create = async (options) => {
  agentsCreated += 1;
  return create(options);
};

async function turn(messages: Message[], options: SimpleStreamOptions = { apiKey }): Promise<AssistantMessage> {
  for await (const event of streamCursor(model, normalizeContext({ messages }), options)) {
    if (event.type === 'done') return event.message;
    if (event.type === 'error') return event.error;
  }
  throw new Error('stream ended without done or error');
}

function check(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${detail}`);
  if (!ok) process.exitCode = 1;
}

const toolCalls = (m: AssistantMessage) => m.content.filter((c) => c.type === 'toolCall');
const textOf = (m: AssistantMessage) => m.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

const messages: Message[] = [
  { role: 'system', content: 'You are a terse weather bot. Always call get_weather before answering about weather. Reply in one short sentence.', toolsAdded: [weather], timestamp: 0 },
  { role: 'user', content: 'Weather in Paris and Tokyo?', timestamp: 1 },
];

let reply = await turn(messages);
check('tool pause', reply.stopReason === 'toolUse', `${reply.stopReason}, calls ${JSON.stringify(toolCalls(reply).map((c) => c.arguments))}`);
while (reply.stopReason === 'toolUse') {
  messages.push(reply);
  for (const c of toolCalls(reply)) messages.push({ role: 'toolResult', toolCallId: c.id, toolName: c.name, content: [{ type: 'text', text: forecasts[String(c.arguments.city)] ?? 'Unknown' }], isError: false, timestamp: Date.now() });
  reply = await turn(messages);
}
check('resumed run uses tool results', reply.stopReason === 'stop' && /21/.test(textOf(reply)) && /14/.test(textOf(reply)), textOf(reply));

messages.push(reply, { role: 'user', content: 'Which of those two cities was warmer? Answer from what you already know.', timestamp: Date.now() });
const followUp = await turn(messages);
check('follow-up reuses the agent', followUp.stopReason === 'stop' && agentsCreated === 1 && /Paris/.test(textOf(followUp)), `${agentsCreated} agent(s): ${textOf(followUp)}`);

const controller = new AbortController();
setTimeout(() => controller.abort(), 1500);
const aborted = await turn([{ role: 'user', content: 'Count slowly from 1 to 200, one number per line.', timestamp: 0 }], { apiKey, signal: controller.signal });
check('abort cancels the run', aborted.stopReason === 'aborted', `${aborted.stopReason}: ${aborted.errorMessage ?? ''}`);

process.exit();
