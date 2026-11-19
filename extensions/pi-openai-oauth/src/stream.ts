import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  collapseSystemMessages,
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { type CodexClient, type CodexThread, type CreateCodex, THREAD_SOURCE } from './codex.ts';
import { type CodexRequest, planRequest } from './plan.ts';
import { fingerprint, toTurns } from './transcript.ts';

function emptyMessage(model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'pending',
    timestamp: Date.now(),
  };
}

function isCodexRequest(value: unknown): value is CodexRequest {
  if (typeof value !== 'object' || value === null) return false;
  const { threadId, prompt } = value as Record<string, unknown>;
  return typeof prompt === 'string' && (threadId === null || typeof threadId === 'string');
}

/** Reject once the signal aborts, so a Codex turn that ignores it cannot hold the Pi request open. */
function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new Error('Request was aborted'));
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Request was aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([work, aborted]).finally(() => signal.removeEventListener('abort', onAbort));
}

function openThread(codex: CodexClient, request: CodexRequest): CodexThread {
  return request.threadId === null ? codex.startThread({ threadSource: THREAD_SOURCE }) : codex.resumeThread(request.threadId);
}

function pushText(stream: AssistantMessageEventStream, output: AssistantMessage, text: string): void {
  if (text.length === 0) return;
  output.content.push({ type: 'text', text });
  const contentIndex = output.content.length - 1;
  stream.push({ type: 'text_start', contentIndex, partial: output });
  stream.push({ type: 'text_delta', contentIndex, delta: text, partial: output });
  stream.push({ type: 'text_end', contentIndex, content: text, partial: output });
}

/**
 * Pi stream for Codex. Each request runs one Codex turn and reports its final response as one text block.
 * Codex runs its own tools during the turn, so the reply never contains Pi tool calls.
 */
export function createStreamCodex(createCodex: CreateCodex) {
  const threads = new Map<string, string>();

  return function streamCodex(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream();
    const transcript = collapseSystemMessages(context);
    const systemPrompt = getCurrentSystemPrompt(transcript.messages);
    const turns = toTurns(transcript.messages);
    const scope = `${model.id}\n${systemPrompt ?? ''}`;
    const output = emptyMessage(model);

    const run = async () => {
      try {
        const planned = planRequest(threads, scope, systemPrompt, turns);
        const replaced = await options?.onPayload?.(planned, model);
        const request = isCodexRequest(replaced) ? replaced : planned;
        const thread = openThread(createCodex(model.id), request);
        stream.push({ type: 'start', partial: output });

        const result = await abortable(thread.run(request.prompt), options?.signal);
        pushText(stream, output, result.finalResponse);
        output.stopReason = 'stop';
        if (thread.id !== null) {
          threads.set(fingerprint(scope, [...turns, ...toTurns([output])]), thread.id);
        }
        stream.push({ type: 'done', reason: 'stop', message: output });
      } catch (error) {
        output.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
        output.errorMessage = error instanceof Error ? error.message : String(error);
        stream.push({ type: 'error', reason: output.stopReason, error: output });
      }
      stream.end();
    };
    void run();
    return stream;
  };
}
