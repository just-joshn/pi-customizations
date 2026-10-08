export default async function runtimeBatchProvider(pi) {
  const { createAssistantMessageEventStream } = await import(process.env.F016_PI_AI);
  pi.registerProvider('f016-runtime-batch', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    apiKey: 'fixture-only-not-a-credential',
    models: [{ id: 'scripted', name: 'F016 runtime batch control only', reasoning: false, input: ['text'], contextWindow: 65536, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      const userIndex = context.messages.findLastIndex((message) => message.role === 'user');
      const user = context.messages[userIndex];
      const text =
        typeof user?.content === 'string'
          ? user.content
          : (user?.content ?? [])
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n');
      const groups = JSON.parse(text.slice('F016_RUNTIME_BATCH '.length));
      const completed = context.messages.slice(userIndex + 1).filter((message) => message.role === 'toolResult').length;
      let offset = 0;
      const group = groups.find((calls) => {
        const matches = offset === completed;
        offset += calls.length;
        return matches;
      });
      const content = group ? group.map((call, index) => ({ type: 'toolCall', id: `runtime-batch-${completed + index}`, name: call.name, arguments: call.arguments })) : [{ type: 'text', text: 'Scripted batch control only.' }];
      const reason = group ? 'toolUse' : 'stop';
      const message = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        content,
        stopReason: reason,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'start', partial: message });
      stream.push({ type: 'done', reason, message });
      stream.end(message);
      return stream;
    },
  });
}
