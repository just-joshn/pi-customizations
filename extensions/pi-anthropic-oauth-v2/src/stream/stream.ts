import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import {
  type Api,
  type AssistantMessageEventStream,
  collapseSystemMessages,
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { REQUEST_CONFIG } from '../request/config.ts';
import { buildParams } from '../request/params.ts';
import type { StreamRequest } from '../request/types.ts';
import { createNameCodec } from '../tools/names.ts';
import { toDoneEvent, toErrorEvent } from './outcome.ts';
import { reduceEvent } from './reduce.ts';
import { createStreamState } from './state.ts';

const isOAuthToken = (apiKey: string): boolean => apiKey.includes(REQUEST_CONFIG.oauthTokenMarker);

function clientOptions({ model, apiKey, isOAuth }: StreamRequest): ClientOptions {
  if (isOAuth) return { baseURL: model.baseUrl, authToken: apiKey, defaultHeaders: { ...REQUEST_CONFIG.oauthHeaders } };
  return { baseURL: model.baseUrl, apiKey };
}

function toStreamRequest(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions | undefined): StreamRequest {
  // The transcript carries the prompt and tools in its system messages. This provider sends
  // one top-level system prompt, so fold later system messages into the leading one first.
  const { messages } = collapseSystemMessages(context);
  const tools = getCurrentTools(messages);
  const apiKey = options?.apiKey ?? '';
  const isOAuth = isOAuthToken(apiKey);
  return { model, messages, systemPrompt: getCurrentSystemPrompt(messages), tools, options, apiKey, isOAuth, names: createNameCodec(isOAuth, tools) };
}

/** Streams one Anthropic reply into `stream`. A failure reaches Pi as the stream's error event and is then rethrown for the caller to absorb. */
async function runStream(stream: AssistantMessageEventStream, model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions | undefined): Promise<void> {
  const emit = stream.push.bind(stream);
  let latest = createStreamState(model);
  try {
    const request = toStreamRequest(model, context, options);
    const events = await new Anthropic(clientOptions(request)).beta.messages.create(buildParams(request), { signal: options?.signal });
    emit({ type: 'start', partial: latest.output });
    for await (const event of events) {
      const step = reduceEvent(latest, event, request);
      latest = step.state;
      for (const streamEvent of step.events) emit(streamEvent);
    }
    emit(toDoneEvent(latest.output, options?.signal));
  } catch (error) {
    console.error('Anthropic stream failed:', error);
    emit(toErrorEvent(latest.output, error, options?.signal));
    throw new Error('Anthropic stream failed.', { cause: error });
  } finally {
    stream.end();
  }
}

export function streamCustomAnthropic(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  // runStream already logged the failure and delivered it to Pi through the stream.
  runStream(stream, model, context, options).catch(() => undefined);
  return stream;
}
