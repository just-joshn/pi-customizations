import { type Api, type AssistantMessageEventStream, type Context, createAssistantMessageEventStream, lazyStream, type Model, type Provider, type StreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import { assistantTurn } from './context.ts';

function payloadText(context: TranscriptContext): string {
  const message = context.messages.at(-1);
  if (message?.role !== 'user' || typeof message.content !== 'string') throw new Error('probe needs a string user prompt');
  return message.content;
}

export function promptCarrying(payload: unknown): Context {
  return {
    messages: [
      { role: 'user', content: 'hi', timestamp: 1 },
      { role: 'user', content: JSON.stringify(payload), timestamp: 2 },
    ],
  };
}

function probe(model: Model<Api>, context: TranscriptContext, options?: StreamOptions): AssistantMessageEventStream {
  return lazyStream(model, async () => {
    const payload: unknown = JSON.parse(payloadText(context));
    const sent = (await options?.onPayload?.(payload, model)) ?? payload;
    const message = assistantTurn({ content: [{ type: 'text', text: JSON.stringify(sent) }] });
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: 'stop', message });
    stream.end(message);
    return stream;
  });
}

export const probeStream: Provider['stream'] = probe;
export const probeStreamSimple: Provider['streamSimple'] = probe;
