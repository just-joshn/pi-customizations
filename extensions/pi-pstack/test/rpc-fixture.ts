import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ProviderConfig } from '@earendil-works/pi-coding-agent';

type StreamArguments = Parameters<NonNullable<ProviderConfig['streamSimple']>>;

function scriptedReply(model: StreamArguments[0], context: StreamArguments[1]) {
  const answered = context.messages.some(message => message.role === 'toolResult' && message.toolName === 'AskQuestion');
  const message: AssistantMessage = {
    role: 'assistant', api: model.api, provider: model.provider, model: model.id,
    content: answered ? [{ type: 'text', text: 'RPC dialog completed.' }] : [{
      type: 'toolCall', id: 'rpc-question', name: 'AskQuestion', arguments: {
        questions: [{ id: 'approval', prompt: 'Approve the example?', options: [
          { id: 'approve', label: 'Approve' }, { id: 'decline', label: 'Decline' },
        ] }],
      },
    }],
    stopReason: answered ? 'stop' : 'toolUse', timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'done', reason: answered ? 'stop' : 'toolUse', message });
  stream.end(message);
  return stream;
}

export default function rpcFixture(pi: ExtensionAPI): void {
  pi.registerProvider('rpc-test', {
    api: 'openai-completions', baseUrl: 'https://unused.invalid', apiKey: 'fixture-only-not-a-credential',
    models: [{ id: 'scripted', name: 'Scripted RPC dialogs', reasoning: false, input: ['text'],
      contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: scriptedReply,
  });
}
