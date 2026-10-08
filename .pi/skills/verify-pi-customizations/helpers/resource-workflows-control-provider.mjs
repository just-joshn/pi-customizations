export default async function controlProvider(pi) {
  const { createAssistantMessageEventStream } = await import(process.env.F016_PI_AI);
  pi.registerProvider('f016-control', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    apiKey: 'fixture-only-not-a-credential',
    models: [{ id: 'scripted', name: 'F016 scripted control, not genuine compliance', reasoning: false, input: ['text'], contextWindow: 65536, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
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
      const steps = text.startsWith('F016_CONTROL ') ? JSON.parse(text.slice('F016_CONTROL '.length)) : [];
      const completed = context.messages.slice(userIndex + 1).filter((message) => message.role === 'toolResult').length;
      const step = steps[completed];
      const childResults = context.messages.slice(userIndex + 1).filter((message) => message.role === 'toolResult' && message.toolName === 'Task');
      const args = step?.name === 'TaskOutput' ? { task_id: childResults[step.arguments.childIndex]?.details?.id, block: true } : step?.arguments;
      const content = step ? [{ type: 'toolCall', id: `f016-${completed}`, name: step.name, arguments: args }] : [{ type: 'text', text: 'No cleanup findings. Scripted control only.' }];
      const reason = step ? 'toolUse' : 'stop';
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
      const finish = () => {
        stream.push({ type: 'start', partial: message });
        stream.push({ type: 'done', reason, message });
        stream.end(message);
      };
      if (!text.startsWith('F016_CONTROL ') && text.includes('F016_HOLD')) setTimeout(finish, 500);
      else finish();
      return stream;
    },
  });
}
