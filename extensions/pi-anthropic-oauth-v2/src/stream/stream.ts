import Anthropic from '@anthropic-ai/sdk';
import {
  type Api,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  collapseSystemMessages,
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { buildClientOptions, isOAuthToken } from '../request/client.ts';
import { buildParams } from '../request/params.ts';
import type { StreamRequest } from '../request/types.ts';
import { toDoneEvent, toErrorEvent } from './finish.ts';
import { reduceEvent } from './reduce.ts';
import { createStreamState, type StreamState } from './state.ts';

function toStreamRequest(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions | undefined): StreamRequest {
  // The transcript carries the prompt and tools in its system messages. This provider sends
  // one top-level system prompt, so fold later system messages into the leading one first.
  const { messages } = collapseSystemMessages(context);
  const apiKey = options?.apiKey ?? '';
  return { model, messages, systemPrompt: getCurrentSystemPrompt(messages), tools: getCurrentTools(messages), options, apiKey, isOAuth: isOAuthToken(apiKey) };
}

function openAnthropicStream(request: StreamRequest) {
  const client = new Anthropic(buildClientOptions(request.model, request.apiKey, request.isOAuth));
  return client.beta.messages.create(buildParams(request), { signal: request.options?.signal });
}

async function consumeStream(emit: (event: AssistantMessageEvent) => void, request: StreamRequest, onState: (state: StreamState) => void, state: StreamState): Promise<void> {
  const events = await openAnthropicStream(request);
  emit({ type: 'start', partial: state.output });
  let current = state;
  for await (const event of events) {
    const step = reduceEvent(current, event, request);
    current = step.state;
    onState(current);
    for (const streamEvent of step.events) emit(streamEvent);
  }
  emit(toDoneEvent(current.output, request.options?.signal));
}

function runStream(stream: AssistantMessageEventStream, model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions | undefined): Promise<void> {
  const emit = stream.push.bind(stream);
  let latest = createStreamState(model);
  const remember = (next: StreamState): void => {
    latest = next;
  };
  const failed = (error: unknown): void => {
    console.error('Anthropic stream failed:', error);
    emit(toErrorEvent(latest.output, error, options?.signal));
  };
  return Promise.resolve()
    .then(() => consumeStream(emit, toStreamRequest(model, context, options), remember, latest))
    .catch(failed)
    .finally(() => stream.end());
}

export function streamCustomAnthropic(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void runStream(stream, model, context, options);
  return stream;
}
