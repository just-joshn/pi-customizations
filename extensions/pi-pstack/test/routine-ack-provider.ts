import { access, watch, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type AssistantMessage, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function released(directory: string, file: string, signal?: AbortSignal): Promise<void> {
  const changes = watch(directory, { signal });
  try {
    if (await exists(join(directory, file))) return;
    for await (const _change of changes) {
      if (await exists(join(directory, file))) return;
    }
  } finally {
    await changes.return?.();
  }
}

function actionOf(text: string): string {
  const envelope = text.split('<webhook_event>\n')[1]?.split('\n</webhook_event>')[0];
  return envelope ? JSON.parse(JSON.parse(envelope).body).action : 'unknown';
}

export default async function routineAckProvider(pi: ExtensionAPI): Promise<void> {
  const directory = process.cwd();
  pi.on('input', async (event) => {
    const action = actionOf(event.text);
    await writeFile(join(directory, `ack-input-${action}`), 'input');
    if (action === 'hold-input') await released(directory, 'ack-release-input');
    return { action: action === 'handled' ? 'handled' : 'continue' };
  });
  pi.registerProvider('routine-ack-test', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    ...((await exists(join(directory, 'ack-no-auth'))) ? {} : { apiKey: 'fixture-only-not-a-credential' }),
    models: [{ id: 'recorder', name: 'Routine acknowledgement fixture', reasoning: false, input: ['text'], contextWindow: 1000000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const user = context.messages.findLast((message) => message.role === 'user');
      const text = user?.role === 'user' ? (typeof user.content === 'string' ? user.content : (user.content.find((block) => block.type === 'text')?.text ?? '')) : '';
      const action = actionOf(text);
      const message: AssistantMessage = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: 'text', text: 'ack complete' }],
        stopReason: 'stop',
        timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      void (async () => {
        await writeFile(join(directory, `ack-stream-${action}`), 'stream');
        try {
          await released(directory, 'ack-release-model', options?.signal);
          stream.push({ type: 'done', reason: 'stop', message });
          stream.end(message);
        } catch {
          const aborted: AssistantMessage = { ...message, content: [], stopReason: 'aborted' };
          stream.push({ type: 'error', reason: 'aborted', error: aborted });
          stream.end(aborted);
        }
      })();
      return stream;
    },
  });
}
