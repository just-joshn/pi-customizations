import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { type AssistantMessage, type Context, createAssistantMessageEventStream, type Model } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const WHOLEFILE = 'hello.txt\n```\nafter-print\n```\n';
const COMMIT = 'feat: journey edit';
const EDITBLOCK = `hello.txt
<<<<<<< SEARCH
before-rpc
=======
after-rpc
>>>>>>> REPLACE
`;

/** Aider's commit prompt is the only request with `commit_system` text. */
function isCommitMessageRequest(context: Context): boolean {
  return context.messages.some((message) => message.role === 'system' && (typeof message.content === 'string' ? message.content : message.content.map((block) => block.text).join('')).includes('one-line Git commit messages'));
}

function lastUserText(context: Context): string {
  for (const message of context.messages.toReversed()) {
    if (message.role !== 'user') continue;
    const text = typeof message.content === 'string' ? message.content : message.content.find((block) => block.type === 'text')?.text;
    if (text) return text;
  }
  return '';
}

function replyFor(requested: string): string {
  if (requested.includes('JOURNEY:editblock')) return EDITBLOCK;
  if (requested.includes('JOURNEY:wholefile')) return WHOLEFILE;
  return WHOLEFILE;
}

function scriptedReply(model: Model<string>, context: Context) {
  const logDirectory = process.env['PI_MAINTAINER_JOURNEY_LOG'];
  if (logDirectory) {
    appendFileSync(
      join(logDirectory, `requests-${process.pid}.jsonl`),
      `${JSON.stringify({
        model: model.id,
        provider: model.provider,
        tools: context.tools?.map((tool) => tool.name) ?? [],
        user: lastUserText(context),
      })}\n`,
    );
  }

  const text = isCommitMessageRequest(context) ? COMMIT : replyFor(lastUserText(context).trim());
  const message: AssistantMessage = {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [{ type: 'text', text }],
    stopReason: 'stop',
    timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'done', reason: 'stop', message });
  stream.end(message);
  return stream;
}

export default function journeyProvider(pi: ExtensionAPI): void {
  pi.registerProvider('maintainer-journey', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    apiKey: 'unused',
    models: [
      {
        id: 'recorder',
        name: 'Maintainer journey recorder',
        reasoning: false,
        input: ['text'],
        contextWindow: 1000000,
        maxTokens: 4096,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    streamSimple: (model, context) => scriptedReply(model, context),
  });
}
