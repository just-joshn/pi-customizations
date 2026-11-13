// Deterministic model for verify-pi-maintainer drives. Provider `scripted`, model `coder`.
// - A commit-message request (Aider's commit prompt) gets COMMIT_SUBJECT.
// - Otherwise, if any user message holds a line `@@reply <JSON string>`, the newest such line is the reply text,
//   verbatim (so it can carry SEARCH/REPLACE blocks or whole-file fences).
// - Otherwise the reply is `ok`.
// Every request is appended to $VERIFY_MAINTAINER_LOG/requests.jsonl with the full system and message text,
// so a drive can prove what pi-maintainer put in the model's context (chat files, repo map, test output).
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { type AssistantMessage, type Context, createAssistantMessageEventStream, type Model } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export const COMMIT_SUBJECT = 'feat: scripted edit';
const REPLY = /^@@reply (.+)$/m;

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : '')).join('') : '';

function reply(context: Context): { kind: string; text: string } {
  const system = context.messages.filter((message) => message.role === 'system').map((message) => textOf(message.content)).join('\n') + (context.systemPrompt ?? '');
  if (system.includes('one-line Git commit messages')) return { kind: 'commit', text: COMMIT_SUBJECT };
  for (const message of context.messages.toReversed()) {
    if (message.role !== 'user') continue;
    const match = REPLY.exec(textOf(message.content));
    if (match) return { kind: 'scripted', text: JSON.parse(match[1]) as string };
  }
  return { kind: 'default', text: 'ok' };
}

function respond(model: Model<string>, context: Context) {
  const answer = reply(context);
  const log = process.env['VERIFY_MAINTAINER_LOG'];
  if (log)
    appendFileSync(
      join(log, 'requests.jsonl'),
      `${JSON.stringify({ model: `${model.provider}/${model.id}`, kind: answer.kind, tools: context.tools?.map((tool) => tool.name) ?? [], systemPrompt: context.systemPrompt ?? '', messages: context.messages.map((message) => ({ role: message.role, text: textOf(message.content) })), reply: answer.text })}\n`,
    );
  const message: AssistantMessage = {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [{ type: 'text', text: answer.text }],
    stopReason: 'stop',
    timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'done', reason: 'stop', message });
  stream.end(message);
  return stream;
}

export default function scriptedCoder(pi: ExtensionAPI): void {
  pi.registerProvider('scripted', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    apiKey: 'unused',
    models: [{ id: 'coder', name: 'Scripted coder', reasoning: false, input: ['text'], contextWindow: 1_000_000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: (model, context) => respond(model, context),
  });
}
