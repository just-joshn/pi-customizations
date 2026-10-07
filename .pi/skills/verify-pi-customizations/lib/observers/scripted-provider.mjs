// biome-ignore lint/correctness/noUndeclaredDependencies: Pi loads this fixture and provides @earendil-works/pi-ai at runtime
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

const probeActions = [
  {
    pattern: /^LAUNCH_TASK:([A-Za-z0-9-]+)$/,
    call: (agent) => ({ name: 'task', arguments: { agent_type: agent, name: `probe-${agent}`, description: 'verification probe', prompt: 'reply with the fixture text', mode: 'sync' } }),
  },
  {
    pattern: /^LAUNCH_TASK_BACKGROUND:([A-Za-z0-9-]+)$/,
    call: (agent) => ({ name: 'task', arguments: { agent_type: agent, name: `probe-bg-${agent}`, description: 'verification probe', prompt: 'reply with the fixture text', mode: 'background' } }),
  },
  {
    pattern: /^LAUNCH_PERSONA:([A-Za-z0-9-]+)$/,
    call: (persona) => ({ name: 'Task', arguments: { subagent_type: persona, description: 'verification probe', prompt: 'reply with the fixture text', readonly: true, run_in_background: false } }),
  },
  {
    pattern: /^BOARD_WRITE:([A-Za-z0-9_-]+)=(.*)$/,
    call: (key, value) => ({ name: 'context_board', arguments: { action: 'write', key, value } }),
  },
  {
    pattern: /^ASK_QUESTION_PROBE$/,
    call: () => ({
      name: 'AskQuestion',
      arguments: {
        questions: [
          {
            id: 'headless-probe',
            prompt: 'Headless suppression probe?',
            options: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' },
            ],
          },
        ],
      },
    }),
  },
];

function assistant(model, message, reason) {
  return {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: Date.now(),
    content: message,
    stopReason: reason,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

function streamOf(model, content, reason) {
  const message = assistant(model, content, reason);
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'done', reason, message });
  stream.end(message);
  return stream;
}

function lastText(context) {
  const last = context.messages.at(-1);
  const content = last?.content;
  if (typeof content === 'string') return content;
  return (content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ');
}

export default function scriptedProvider(pi) {
  pi.registerProvider('pstack-verify', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    apiKey: 'fixture-only-not-a-credential',
    models: [{ id: 'scripted', name: 'Scripted fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: (model, context) => {
      const last = context.messages.at(-1);
      if (last?.role === 'user') {
        const text = lastText(context);
        for (const action of probeActions) {
          const match = text.match(action.pattern);
          if (match) {
            const call = action.call(...match.slice(1));
            return streamOf(model, [{ type: 'toolCall', id: `probe-${call.name}`, ...call }], 'toolUse');
          }
        }
      }
      return streamOf(model, [{ type: 'text', text: 'scripted fixture reply' }], 'stop');
    },
  });
}
