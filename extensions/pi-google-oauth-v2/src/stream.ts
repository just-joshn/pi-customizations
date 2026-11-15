import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  calculateCost,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
  type TranscriptContext,
  uuidv7,
} from '@earendil-works/pi-ai';
import { CodeAssistError, googleErrorMessage } from './code-assist.ts';
import { PRIVATE_PROJECT_HEADER } from './constants.ts';
import { buildCodeAssistRequest } from './request.ts';

interface CodeAssistChunk {
  response?: {
    candidates?: { content?: { parts?: ResponsePart[] }; finishReason?: string; finishMessage?: string }[];
    usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
    modelVersion?: string;
    promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  };
  traceId?: string;
  error?: { message?: string };
}

interface ResponsePart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name?: string; args?: ToolCall['arguments'] };
}

/**
 * Serves both stream and streamSimple. Never throws: every failure, including a missing token or
 * project, ends the stream with an `error` event.
 */
export function streamCodeAssist(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions = {}): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const output: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'pending',
    timestamp: Date.now(),
  };

  (async () => {
    try {
      const { project, headers } = takePrivateProjectHeader(options.headers);
      if (!options.apiKey || !project) throw new Error('Google AI login is incomplete; run /login again');

      let body: unknown = buildCodeAssistRequest({ model, context, project, options });
      body = (await options.onPayload?.(body, model)) ?? body;

      const response = await (options.fetch ?? globalThis.fetch)(`${model.baseUrl}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers },
        body: JSON.stringify(body),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      await options.onResponse?.({ status: response.status, headers: Object.fromEntries(response.headers) }, model);
      if (!response.ok) {
        const message = googleErrorMessage(await response.text().catch(() => ''));
        throw new Error(`Google Code Assist error (${response.status}): ${message ?? (response.statusText || 'request failed')}`);
      }

      stream.push({ type: 'start', partial: output });
      const reducer = new ResponseReducer(stream, output, model);
      for await (const chunk of parseSse(response.body, options.signal)) {
        await options.onProviderStreamEvent?.(chunk, model);
        reducer.push(chunk);
      }
      if (options.signal?.aborted) throw new Error('Request was aborted');
      reducer.finish();
      stream.push({ type: 'done', reason: output.stopReason === 'toolUse' || output.stopReason === 'length' ? output.stopReason : 'stop', message: output });
    } catch (error) {
      output.stopReason = options.signal?.aborted ? 'aborted' : 'error';
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: 'error', reason: output.stopReason, error: output });
    } finally {
      stream.end();
    }
  })();

  return stream;
}

function takePrivateProjectHeader(headers: SimpleStreamOptions['headers']): { project: string | undefined; headers: Record<string, string> } {
  let project: string | undefined;
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() === PRIVATE_PROJECT_HEADER) project = value ?? undefined;
    else if (value !== null) forwarded[name] = value;
  }
  return { project, headers: forwarded };
}

async function* parseSse(body: ReadableStream<Uint8Array> | null, signal: AbortSignal | undefined): AsyncGenerator<CodeAssistChunk> {
  if (!body) throw new Error('Google Code Assist returned an empty response');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  let buffered = '';
  let dataLines: string[] = [];

  const flush = (): CodeAssistChunk | undefined => {
    if (dataLines.length === 0) return undefined;
    const data = dataLines.join('\n');
    dataLines = [];
    try {
      return JSON.parse(data) as CodeAssistChunk;
    } catch {
      throw new Error('Google Code Assist sent a malformed event');
    }
  };
  const readLine = (line: string): CodeAssistChunk | undefined => {
    if (line === '') return flush();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    return undefined;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      const lines = buffered.split(/\r\n|\n|\r/);
      buffered = done ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        const chunk = readLine(line);
        if (chunk) yield chunk;
      }
      if (done) break;
    }
    const last = flush();
    if (last) yield last;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

const withGoogleMessage = (summary: string, message: string | undefined): string => (message ? `${summary}: ${message}` : summary);

class ResponseReducer {
  private readonly stream: AssistantMessageEventStream;
  private readonly output: AssistantMessage;
  private readonly model: Model<Api>;
  private open: 'text' | 'thinking' | undefined;
  private finishReason: string | undefined;
  private finishMessage: string | undefined;

  constructor(stream: AssistantMessageEventStream, output: AssistantMessage, model: Model<Api>) {
    this.stream = stream;
    this.output = output;
    this.model = model;
  }

  push(chunk: CodeAssistChunk): void {
    if (chunk.error) throw new CodeAssistError(chunk.error.message ?? 'Google Code Assist returned an error');
    if (chunk.traceId) this.output.responseId ||= chunk.traceId;
    const response = chunk.response;
    if (!response) return;
    if (response.modelVersion) this.output.responseModel = response.modelVersion;
    const feedback = response.promptFeedback;
    if (feedback?.blockReason) throw new Error(withGoogleMessage(`Google blocked the prompt: ${feedback.blockReason}`, feedback.blockReasonMessage));

    const candidate = response.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part.text === 'string') this.appendText(part.text, part.thought === true, part.thoughtSignature);
      else if (part.functionCall) this.pushToolCall(part.functionCall, part.thoughtSignature);
    }
    if (candidate?.finishReason) this.finishReason = candidate.finishReason;
    if (candidate?.finishMessage) this.finishMessage = candidate.finishMessage;

    const usage = response.usageMetadata;
    if (usage) {
      const cached = usage.cachedContentTokenCount ?? 0;
      const thoughts = usage.thoughtsTokenCount ?? 0;
      this.output.usage = {
        input: (usage.promptTokenCount ?? 0) - cached,
        output: (usage.candidatesTokenCount ?? 0) + thoughts,
        cacheRead: cached,
        cacheWrite: 0,
        reasoning: thoughts,
        totalTokens: usage.totalTokenCount ?? 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      };
      calculateCost(this.model, this.output.usage);
    }
  }

  finish(): void {
    this.closeOpen();
    const reason = this.finishReason;
    if (!reason) throw new Error('Google stream ended without a finish reason');
    this.output.rawStopReason = reason;
    if (reason === 'MAX_TOKENS') this.output.stopReason = 'length';
    else if (reason === 'STOP') this.output.stopReason = this.output.content.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop';
    else throw new Error(withGoogleMessage(`Google stopped with ${reason}`, this.finishMessage));
  }

  private appendText(text: string, thought: boolean, signature: string | undefined): void {
    const kind = thought ? 'thinking' : 'text';
    if (this.open !== kind) {
      this.closeOpen();
      this.output.content.push(thought ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' });
      this.open = kind;
      this.stream.push({ type: thought ? 'thinking_start' : 'text_start', contentIndex: this.output.content.length - 1, partial: this.output });
    }
    const contentIndex = this.output.content.length - 1;
    const block = this.output.content[contentIndex];
    if (block?.type === 'thinking') {
      block.thinking += text;
      if (signature) block.thinkingSignature = signature;
      this.stream.push({ type: 'thinking_delta', contentIndex, delta: text, partial: this.output });
    } else if (block?.type === 'text') {
      block.text += text;
      if (signature) block.textSignature = signature;
      this.stream.push({ type: 'text_delta', contentIndex, delta: text, partial: this.output });
    }
  }

  private pushToolCall(call: NonNullable<ResponsePart['functionCall']>, signature: string | undefined): void {
    this.closeOpen();
    const duplicate = call.id !== undefined && this.output.content.some((block) => block.type === 'toolCall' && block.id === call.id);
    const toolCall: ToolCall = { type: 'toolCall', id: call.id && !duplicate ? call.id : `call_${uuidv7()}`, name: call.name ?? '', arguments: call.args ?? {}, ...(signature ? { thoughtSignature: signature } : {}) };
    this.output.content.push(toolCall);
    const contentIndex = this.output.content.length - 1;
    this.stream.push({ type: 'toolcall_start', contentIndex, partial: this.output });
    this.stream.push({ type: 'toolcall_delta', contentIndex, delta: JSON.stringify(toolCall.arguments), partial: this.output });
    this.stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial: this.output });
  }

  private closeOpen(): void {
    if (!this.open) return;
    const contentIndex = this.output.content.length - 1;
    const block = this.output.content[contentIndex];
    if (block?.type === 'thinking') this.stream.push({ type: 'thinking_end', contentIndex, content: block.thinking, partial: this.output });
    else if (block?.type === 'text') this.stream.push({ type: 'text_end', contentIndex, content: block.text, partial: this.output });
    this.open = undefined;
  }
}
