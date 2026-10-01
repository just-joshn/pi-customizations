import { type Api, type AssistantMessageEventStream, type Context, createAssistantMessageEventStream, lazyStream, type Model, type Provider, type StreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import { assistantTurn } from './context.ts';

function firstUserText(context: TranscriptContext): string {
  const first = context.messages.find((message) => message.role === 'user');
  if (first?.role !== 'user' || typeof first.content !== 'string') throw new Error('probe needs a string user prompt');
  return first.content;
}

export function promptCarrying(payload: unknown): Context {
  return { messages: [{ role: 'user', content: JSON.stringify(payload), timestamp: 1 }] };
}

function probe(model: Model<Api>, context: TranscriptContext, options?: StreamOptions): AssistantMessageEventStream {
  return lazyStream(model, async () => {
    const payload: unknown = JSON.parse(firstUserText(context));
    const sent = (await options?.onPayload?.(payload, model)) ?? payload;
    const message = assistantTurn({ content: [{ type: 'text', text: JSON.stringify(sent) }] });
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: 'stop', message });
    stream.end(message);
    return stream;
  });
}

// Stands in for Pi's Anthropic implementation. It parses the user prompt as JSON,
// hands that value to onPayload as the request payload, and answers with the
// payload onPayload resolved, so a test sees exactly what would be sent.
export const probeStream: Provider['stream'] = probe;
export const probeStreamSimple: Provider['streamSimple'] = probe;
