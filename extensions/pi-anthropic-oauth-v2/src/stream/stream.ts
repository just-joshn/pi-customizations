import Anthropic from '@anthropic-ai/sdk';
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
import { buildClientOptions, isOAuthToken } from '../request/client.ts';
import { buildParams } from '../request/params.ts';
import type { StreamRequest } from '../request/types.ts';
import { toDoneEvent, toErrorEvent } from './finish.ts';
import { reduceEvent } from './reduce.ts';
import { createStreamState } from './state.ts';

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

async function runStream(stream: AssistantMessageEventStream, model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions | undefined): Promise<void> {
  let state = createStreamState(model);
  try {
    const request = toStreamRequest(model, context, options);
    const events = await openAnthropicStream(request);
    stream.push({ type: 'start', partial: state.output });
    for await (const event of events) {
      const step = reduceEvent(state, event, request);
      state = step.state;
      for (const streamEvent of step.events) stream.push(streamEvent);
    }
    stream.push(toDoneEvent(state.output, options?.signal));
  } catch (error) {
    console.error('Anthropic stream failed:', error);
    stream.push(toErrorEvent(state.output, error, options?.signal));
  }
  stream.end();
}

export function streamCustomAnthropic(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void runStream(stream, model, context, options);
  return stream;
}
