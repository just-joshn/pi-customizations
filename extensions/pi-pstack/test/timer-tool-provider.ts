import { type AssistantMessage, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function timerProvider(pi: ExtensionAPI): void {
  pi.registerProvider('timer-test', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    apiKey: 'fixture-only-not-a-credential',
    models: [{ id: 'recorder', name: 'Timer recorder', reasoning: false, input: ['text'], contextWindow: 1000000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      const user = context.messages.findLast((item) => item.role === 'user');
      const text = typeof user?.content === 'string' ? user.content : user?.content.find((item) => item.type === 'text')?.text;
      const call = text === 'START_TIMER' && context.messages.at(-1)?.role !== 'toolResult';
      const hold = text?.startsWith('TIMER:HOLD') && context.messages.at(-1)?.role !== 'toolResult';
      const message: AssistantMessage = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: hold
          ? [{ type: 'toolCall', id: 'timer-hold', name: 'bash', arguments: { command: 'sleep 30' } }]
          : call
            ? [{ type: 'toolCall', id: 'timer-start', name: 'SubscribeTimer', arguments: { name: 'tool-timer', prompt: 'TIMER:via-tool', delaySeconds: 1 } }]
            : [{ type: 'text', text: `Recorded ${text}` }],
        stopReason: call || hold ? 'toolUse' : 'stop',
        timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: call || hold ? 'toolUse' : 'stop', message });
      stream.end(message);
      return stream;
    },
  });
}
