import { type AssistantMessage, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const PLAN: { name: string; arguments: Record<string, string | number> }[] = [
  { name: 'SubscribeTimer', arguments: { name: 'cloud-tick', prompt: 'TIMER:cloud-tick', delaySeconds: 1 } },
  { name: 'SubscribeGithubCI', arguments: { name: 'cloud-ci', pr: 12, repo: 'o/r', pollSeconds: 1, prompt: 'Act on the guest CI result.' } },
];

export default function ciProvider(pi: ExtensionAPI): void {
  pi.registerProvider('ci-test', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    apiKey: 'fixture-only-not-a-credential',
    models: [{ id: 'recorder', name: 'CI recorder', reasoning: false, input: ['text'], contextWindow: 1000000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      const lastUser = context.messages.findLastIndex((item) => item.role === 'user');
      const user = context.messages[lastUser];
      const text = typeof user?.content === 'string' ? user.content : user?.content.find((item) => item.type === 'text')?.text;
      const done = context.messages.slice(lastUser + 1).filter((item) => item.role === 'toolResult').length;
      const next = text === 'ARM_ALL' ? PLAN[done] : undefined;
      const message: AssistantMessage = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: next ? [{ type: 'toolCall', id: `arm-${done}`, name: next.name, arguments: next.arguments }] : [{ type: 'text', text: `Recorded ${text}` }],
        stopReason: next ? 'toolUse' : 'stop',
        timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: next ? 'toolUse' : 'stop', message });
      stream.end(message);
      return stream;
    },
  });
}
