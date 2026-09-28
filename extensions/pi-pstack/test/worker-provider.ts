
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream, type AssistantMessage, type ToolCall } from '@earendil-works/pi-ai';
import { getAgentDir, type ExtensionAPI, type ProviderConfig } from '@earendil-works/pi-coding-agent';

import { workerTiming } from './worker-timing.ts';
import { clearPendingWork, registerPendingWork } from './worker-gates.ts';

type StreamArguments = Parameters<NonNullable<ProviderConfig['streamSimple']>>;

function requestedTools(text: string, context: StreamArguments[1]): ToolCall[] {
  const last = context.messages.at(-1);
  const failedChild = text.includes('BROKEN_CHILD_PARENT');
  const nested = text.includes('NEST_ROOT') || text.includes('NEST_STOP');
  const controls = text.includes('CONTROL_BATCH_PARENT');
  if ((nested || failedChild || controls) && last?.role === 'user') {
    return [{ type: 'toolCall', id: 'nested-task', name: 'Task', arguments: {
      prompt: failedChild ? 'FAIL' : controls ? 'WAIT_BLOCKED' : 'WAIT GRANDCHILD',
      model: 'worker-test/deterministic', run_in_background: !failedChild,
    } }];
  }
  if (controls && last?.role === 'toolResult' && last.toolName === 'Task') {
    const content = last.content.find(block => block.type === 'text');
    if (!content || content.type !== 'text') throw new Error('missing text block');
    const { task_id } = JSON.parse(content.text);
    return [
      { type: 'toolCall', id: 'wait-child', name: 'TaskOutput', arguments: { task_id, block: true } },
      { type: 'toolCall', id: 'stop-child', name: 'TaskStop', arguments: { task_id } },
    ];
  }
  return [];
}

function saveRequest(context: StreamArguments[1], dir: string): void {
  const users = context.messages.filter(message => message.role === 'user');
  const system = context.messages.filter(message => message.role === 'system');
  writeFileSync(join(dir, 'child-system.txt'), JSON.stringify(system));
  writeFileSync(join(dir, 'child-input.txt'), JSON.stringify(users));
  writeFileSync(join(dir, 'child-tools.txt'), JSON.stringify(system.flatMap(message => message.toolsAdded?.map(tool => tool.name) ?? [])));
  appendFileSync(join(dir, 'provider-inputs.jsonl'), JSON.stringify(users) + '\n');
}

function streamWorker(model: StreamArguments[0], context: StreamArguments[1], options: StreamArguments[2]) {
  const dir = getAgentDir();
  const stream = createAssistantMessageEventStream();
  const users = context.messages.filter(message => message.role === 'user');
  const text = JSON.stringify(users.at(-1));
  saveRequest(context, dir);
  const calls = requestedTools(text, context);
  const error = text.includes('FAIL');
  const grandchild = text.includes('GRANDCHILD');
  const nested = text.includes('NEST_ROOT') || text.includes('NEST_STOP');
  const log = (event: string) => appendFileSync(join(dir, 'audit.txt'), event + '\n');
  if (grandchild) log('grandchild-start');
  const finish = (aborted = false) => {
    if (grandchild) log(aborted ? 'grandchild-aborted' : 'grandchild-finished');
    if (nested && !calls.length) log(aborted ? 'parent-aborted' : 'parent-finished');
    const message: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: calls.length ? calls : [{ type: 'text', text: 'users=' + users.length }],
      stopReason: aborted ? 'aborted' : error ? 'error' : calls.length ? 'toolUse' : 'stop',
      errorMessage: error ? 'scripted failure' : undefined, timestamp: Date.now(),
      usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    stream.push(aborted || error ? { type: 'error', reason: aborted ? 'aborted' : 'error', error: message }
      : { type: 'done', reason: calls.length ? 'toolUse' : 'stop', message });
    stream.end(message);
  };
  if (options?.signal?.aborted) { finish(true); return stream; }
  if (text.includes('WAIT') || (nested && !calls.length)) {
    if (grandchild) {
      registerPendingWork('grandchild', () => finish());
      options?.signal?.addEventListener('abort', () => { clearPendingWork('grandchild'); finish(true); }, { once: true });
    } else {
      const delay = text.includes('WAIT_BLOCKED') ? workerTiming.blockedRunMs : text.includes('NEST_STOP') ? workerTiming.descendantRunMs : text.includes('NEST_ROOT') ? workerTiming.parentRunMs : workerTiming.delayedRunMs;
      const timer = setTimeout(() => finish(), delay);
      options?.signal?.addEventListener('abort', () => { clearTimeout(timer); finish(true); }, { once: true });
    }
  } else finish();
  return stream;
}

export default function workerProvider(pi: ExtensionAPI): void {
  pi.registerProvider('worker-test', {
    api: 'openai-completions', baseUrl: 'https://unused.invalid', apiKey: 'test-only',
    models: [{ id: 'deterministic', name: 'Deterministic', reasoning: false, input: ['text'], contextWindow: 100000,
      maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: streamWorker,
  });
}
