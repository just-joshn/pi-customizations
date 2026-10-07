import { appendFileSync } from 'node:fs';

// biome-ignore lint/correctness/noUndeclaredDependencies: Pi loads this fixture and provides @earendil-works/pi-ai at runtime
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

function usage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  return (content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

// Pi delivers the system prompt as a system-role message whose `sections` values concatenate, and
// leaves `context.systemPrompt` empty on this path. Both are read so the recorded text is the whole
// system prompt the model actually received.
function systemTextOf(context) {
  let text = typeof context.systemPrompt === 'string' ? context.systemPrompt : '';
  for (const message of context.messages ?? []) {
    if (message.role !== 'system') continue;
    if (message.sections) {
      for (const value of Object.values(message.sections)) if (typeof value === 'string') text += `\n${value}`;
    } else {
      text += `\n${textOf(message)}`;
    }
  }
  return text;
}

function assistantMessage(model, content, stopReason) {
  return { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content, stopReason, usage: usage() };
}

function streamOf(model, content, stopReason) {
  const stream = createAssistantMessageEventStream();
  const message = assistantMessage(model, content, stopReason);
  stream.push({ type: 'done', reason: stopReason, message });
  stream.end(message);
  return stream;
}

const LAUNCH_TASK = /^LAUNCH_TASK:([A-Za-z0-9-]+)$/;
const LAUNCH_PERSONA = /^LAUNCH_PERSONA:([A-Za-z0-9-]+)$/;
const CREW_CALL = /^CAVEMAN_CALL_CAVECREW_(\d+) ROLE=(investigator|builder|reviewer)$/;

export default function resourceRecorderProvider(pi) {
  pi.registerProvider('resource-recorder', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    apiKey: 'fixture-only-not-a-credential',
    models: [{ id: 'recorder', name: 'Resource recorder', reasoning: false, input: ['text'], contextWindow: 1000000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: (model, context) => {
      const last = context.messages?.at(-1);
      const isUser = last?.role === 'user';
      const userText = isUser ? textOf(last) : null;
      appendFileSync(process.env.RESOURCE_RECORDER_PATH, `${JSON.stringify({ pid: process.pid, systemText: systemTextOf(context), userText })}\n`);
      if (isUser && userText !== null) {
        const task = userText.match(LAUNCH_TASK);
        if (task)
          return streamOf(
            model,
            [{ type: 'toolCall', id: `resource-task-${task[1]}`, name: 'task', arguments: { agent_type: task[1], name: `probe-${task[1]}`, description: 'resource recorder probe', prompt: 'reply with the fixture text', mode: 'sync' } }],
            'toolUse',
          );
        const persona = userText.match(LAUNCH_PERSONA);
        if (persona)
          return streamOf(
            model,
            [
              {
                type: 'toolCall',
                id: `resource-persona-${persona[1]}`,
                name: 'Task',
                arguments: { subagent_type: persona[1], description: 'resource recorder probe', prompt: 'reply with the fixture text', readonly: false, run_in_background: false },
              },
            ],
            'toolUse',
          );
        const crew = userText.match(CREW_CALL);
        if (crew) return streamOf(model, [{ type: 'toolCall', id: `resource-crew-${crew[1]}`, name: 'cavecrew', arguments: { agent: crew[2], task: 'report the role prompt this child received' } }], 'toolUse');
      }
      return streamOf(model, [{ type: 'text', text: 'RESOURCE_RECORDER_INERT_TEXT' }], 'stop');
    },
  });
}
