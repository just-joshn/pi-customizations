import { type AssistantMessage, type Context, createAssistantMessageEventStream, type Model } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

function respond(model: Model<string>, context: Context) {
  const last = context.messages.at(-1);
  const user = context.messages.filter((message) => message.role === 'user').at(-1);
  const prompt = typeof user?.content === 'string' ? user.content : (user?.content.find((block) => block.type === 'text')?.text ?? '');
  const command = prompt.startsWith('VM:hold') ? 'sleep 8' : prompt.startsWith('VM:probe ') ? JSON.parse(prompt.slice(9)).command : undefined;
  const content =
    command && last?.role !== 'toolResult'
      ? [{ type: 'toolCall' as const, id: `vm-${context.messages.length}`, name: 'bash', arguments: { command } }]
      : [{ type: 'text' as const, text: JSON.stringify({ prompt, result: last?.role === 'toolResult' ? last.content : undefined }) }];
  const message: AssistantMessage = {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content,
    stopReason: command && last?.role !== 'toolResult' ? 'toolUse' : 'stop',
    timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'done', reason: message.stopReason === 'stop' ? 'stop' : 'toolUse', message });
  stream.end(message);
  return stream;
}

export default function provider(pi: ExtensionAPI): void {
  pi.registerProvider('remote-vm-test', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    apiKey: 'fixture-only-not-a-credential',
    models: [{ id: 'recorder', name: 'Remote VM recorder', reasoning: false, input: ['text'], contextWindow: 1000000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: respond,
  });
}
