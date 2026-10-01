import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { type AssistantMessage, createAssistantMessageEventStream, type ToolCall } from '@earendil-works/pi-ai';
import { type ExtensionAPI, getAgentDir, type ProviderConfig } from '@earendil-works/pi-coding-agent';

type StreamArguments = Parameters<NonNullable<ProviderConfig['streamSimple']>>;

const model = 'worker-test/deterministic';

function nextCall(text: string): ToolCall[] {
  const level = Number(text.match(/LEVEL (\d)/)?.[1]);
  const spawn = (id: string, args: Record<string, unknown>): ToolCall[] => [{ type: 'toolCall', id, name: 'Task', arguments: { model, run_in_background: false, ...args } }];
  if (text.includes('CLOUD_AT_LEVEL') && level === 2) return spawn('cloud-task', { prompt: 'cloud work', environment: 'cloud' });
  return level < 3 ? spawn(`level-${level + 1}`, { prompt: `LEVEL ${level + 1}${text.includes('CLOUD_AT_LEVEL') ? ' CLOUD_AT_LEVEL' : ''}` }) : [];
}

function streamNested(provider: StreamArguments[0], context: StreamArguments[1]) {
  const audit = (line: string) => appendFileSync(join(getAgentDir(), 'nesting.txt'), `${line}\n`);
  const last = context.messages.at(-1);
  const users = context.messages.filter((message) => message.role === 'user');
  const text = JSON.stringify(users.at(-1));
  let calls: ToolCall[] = [];
  let reply = 'idle';
  if (last?.role === 'user') {
    audit(`started ${text.match(/LEVEL \d/)?.[0] ?? 'none'}`);
    calls = nextCall(text);
    reply = 'level reached';
  } else if (last?.role === 'toolResult') {
    const result = last.content.find((block) => block.type === 'text');
    audit(`${last.isError ? 'error' : 'result'} ${last.toolCallId}: ${result?.type === 'text' ? result.text.slice(0, 400) : ''}`);
    reply = last.isError ? 'spawn rejected' : 'descendants settled';
  }
  const message: AssistantMessage = {
    role: 'assistant',
    api: provider.api,
    provider: provider.provider,
    model: provider.id,
    content: calls.length ? calls : [{ type: 'text', text: reply }],
    stopReason: calls.length ? 'toolUse' : 'stop',
    timestamp: Date.now(),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'done', reason: calls.length ? 'toolUse' : 'stop', message });
  stream.end(message);
  return stream;
}

export default function nestingProvider(pi: ExtensionAPI): void {
  pi.registerProvider('worker-test', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    apiKey: 'test-only',
    models: [{ id: 'deterministic', name: 'Deterministic', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: streamNested,
  });
}
