#!/usr/bin/env node
/**
 * The scripted provider the F-014 composite drive loads.
 *
 * It answers one turn with a slow bash tool and a closing reply, reports a
 * fixed nonzero usage so the footer renders a deterministic context
 * percentage, and exposes a second model so a model change is observable. It
 * never touches the network: `baseUrl` points at a closed port and every
 * response comes from `streamSimple`.
 */

export const COMPOSITE_USAGE = { input: 2000, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 2030 };
export const COMPOSITE_CONTEXT_WINDOW = 128000;

export const COMPOSITE_PROVIDER_SOURCE = `import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

const SMOKE = { id: 'smoke', name: 'Reference UI Scripted', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: ${COMPOSITE_CONTEXT_WINDOW}, maxTokens: 4096 };
const SMOKE_ALT = { id: 'smoke-alt', name: 'Reference UI Scripted Alt', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: ${COMPOSITE_CONTEXT_WINDOW}, maxTokens: 4096 };

function usage() {
  return { input: ${COMPOSITE_USAGE.input}, output: ${COMPOSITE_USAGE.output}, cacheRead: 0, cacheWrite: 0, totalTokens: ${COMPOSITE_USAGE.totalTokens}, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function textOf(message) {
  if (typeof message.content === 'string') return message.content;
  return message.content.filter((part) => part.type === 'text').map((part) => part.text).join(' ');
}

export default function (pi) {
  pi.registerProvider('upi-composite', {
    name: 'Reference UI Scripted',
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'composite-not-a-real-key',
    api: 'upi-composite',
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      const transcript = context.messages.filter((message) => message.role === 'user').map(textOf).join('\\n');
      const slow = transcript.includes('run slow');
      const toolResults = context.messages.filter((message) => message.role === 'toolResult').length;
      const call = { type: 'toolCall', id: 'composite-slow', name: 'bash', arguments: { command: 'sleep 4 && echo SLOW_MARKER_LATE' } };
      const calls = slow && toolResults === 0 ? [call] : [];
      const text = calls.length > 0 ? undefined : slow ? 'COMPOSITE_SLOW_DONE' : 'COMPOSITE_REPLY_OK';
      (async () => {
        const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: usage(), stopReason: 'pending', timestamp: Date.now() };
        stream.push({ type: 'start', partial: message });
        if (calls.length > 0) {
          for (let index = 0; index < calls.length; index += 1) {
            message.content.push(calls[index]);
            stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
            stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: calls[index], partial: message });
          }
        } else {
          message.content.push({ type: 'text', text });
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: message });
          stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: message });
        }
        message.stopReason = calls.length > 0 ? 'toolUse' : 'stop';
        stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
      })();
      return stream;
    },
    models: [SMOKE, SMOKE_ALT],
  });
}
`;
