import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  calculateCost,
  clampThinkingLevel,
  collapseSystemMessages,
  createAssistantMessageEventStream,
  getCurrentTools,
  getInitialSystemMessage,
  getSystemMessageText,
  type JsonObject,
  type Model,
  type ModelThinkingLevel,
  type ProviderHeaders,
  type ProviderStreams,
  type SimpleStreamOptions,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
  type ToolChoice,
  type TranscriptContext,
  type Usage,
} from '@earendil-works/pi-ai';
import { cloudCodeHeaders, openStream, parseApiKey } from './cloudcode.ts';
import { parseVariant, type Variant } from './models.ts';
import { convertMessages, convertTools, isThinkingPart, mapStopReasonString, mapToolChoice, retainThoughtSignature } from './pi-ai/google-shared.ts';
import { sanitizeSurrogates } from './pi-ai/sanitize-unicode.ts';
import { buildBaseOptions } from './pi-ai/simple-options.ts';

// google-shared is typed for the Gemini and Vertex APIs. It reads only the id,
// provider, api, and input fields, which Cloud Code models share.
function asGoogleModel(model: Model<Api>): Model<'google-generative-ai'> {
  return model as unknown as Model<'google-generative-ai'>;
}

const MAX_EMPTY_STREAM_RETRIES = 2;
const EMPTY_STREAM_BASE_DELAY_MS = 500;

type Content = ReturnType<typeof convertMessages>[number];

export interface ThinkingConfig {
  includeThoughts: true;
  thinkingBudget: number;
  thinkingLevel?: string;
}

export interface GeminiRequest {
  contents: Content[];
  systemInstruction?: { role: 'user'; parts: { text: string }[] };
  tools?: ReturnType<typeof convertTools>;
  toolConfig?: { functionCallingConfig: { mode: string } };
  generationConfig: { temperature?: number; maxOutputTokens?: number; thinkingConfig?: ThinkingConfig };
  sessionId?: string;
}

export interface CloudCodeRequest {
  project: string;
  requestId: string;
  request: GeminiRequest;
  model: string;
  userAgent: 'antigravity';
  requestType: 'agent';
}

export interface RequestOptions {
  variant: Variant;
  temperature?: number;
  maxTokens?: number;
  toolChoice?: ToolChoice;
  sessionId?: string;
}

/** Picks the Cloud Code model id for Pi's thinking level, as `agy --model <id> --effort <level>` does. */
export function resolveVariant(model: Model<Api>, reasoning: SimpleStreamOptions['reasoning']): { level: ModelThinkingLevel; variant: Variant } {
  const level = clampThinkingLevel(model, reasoning ?? 'off');
  const variant = parseVariant(model.thinkingLevelMap?.[level]);
  if (!variant) throw new Error(`${model.id} has no Antigravity model for thinking level ${level}`);
  return { level, variant };
}

// The CLI declares tool parameters as an OpenAPI schema with Google's upper-case type names.
function upperCaseTypes(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(upperCaseTypes);
  if (typeof schema !== 'object' || schema === null) return schema;
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, key === 'type' && typeof value === 'string' ? value.toUpperCase() : upperCaseTypes(value)]));
}

// The CLI sends a Gemini model's tool results in a model turn and every other model's in a user turn.
function toolResultRole(model: Model<Api>, contents: Content[]): Content[] {
  if (!model.id.startsWith('gemini-')) return contents;
  return contents.map((content) => (content.parts?.every((part) => part.functionResponse) ? { ...content, role: 'model' } : content));
}

// The CLI names a request agent/<conversation>/<turn start ms>/<turn id>/<step>, where a turn
// starts at the user's message and each tool round trip adds two steps.
function requestId(messages: TranscriptContext['messages'], conversation: string): string {
  const turn = messages.findLastIndex((message) => message.role === 'user');
  const started = messages[turn]?.timestamp ?? Date.now();
  const steps = messages.slice(turn + 1).filter((message) => message.role === 'assistant').length;
  const hex = createHash('sha256').update(`${conversation}:${started}`).digest('hex');
  const turnId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  return `agent/${conversation}/${started}/${turnId}/${1 + 2 * steps}`;
}

export function buildRequest(model: Model<Api>, context: TranscriptContext, projectId: string, options: RequestOptions): CloudCodeRequest {
  const transcript = collapseSystemMessages(context);
  const system = getInitialSystemMessage(transcript.messages);
  const systemText = system ? getSystemMessageText(system) : '';
  const tools = getCurrentTools(transcript.messages);
  const { variant } = options;
  const request: GeminiRequest = {
    contents: toolResultRole(model, convertMessages(asGoogleModel(model), transcript)),
    ...(systemText && { systemInstruction: { role: 'user', parts: [{ text: sanitizeSurrogates(systemText) }] } }),
    ...(tools.length > 0 && { tools: upperCaseTypes(convertTools(tools, true, false)) as ReturnType<typeof convertTools> }),
    ...(tools.length > 0 && options.toolChoice && { toolConfig: { functionCallingConfig: { mode: mapToolChoice(options.toolChoice) } } }),
    generationConfig: {
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { maxOutputTokens: options.maxTokens }),
      ...(variant.thinkingBudget !== undefined && {
        thinkingConfig: { includeThoughts: true, thinkingBudget: variant.thinkingBudget, ...(variant.thinkingLevel && { thinkingLevel: variant.thinkingLevel }) },
      }),
    },
    ...(options.sessionId && { sessionId: options.sessionId }),
  };
  return {
    project: projectId,
    requestId: requestId(transcript.messages, options.sessionId ?? randomUUID()),
    request,
    model: variant.model,
    userAgent: 'antigravity',
    requestType: 'agent',
  };
}

function requestHeaders(model: Model<Api>, token: string, overrides: ProviderHeaders | undefined): Headers {
  const headers = new Headers({ ...cloudCodeHeaders(token), ...model.headers });
  for (const [name, value] of Object.entries(overrides ?? {})) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return headers;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name?: string; args?: JsonObject };
}

interface CloudCodeChunk {
  response?: {
    responseId?: string;
    candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
    usageMetadata?: Record<string, number | undefined>;
  };
}

let toolCallCounter = 0;

type CloudCodeResponse = NonNullable<CloudCodeChunk['response']>;

function lastBlock(output: AssistantMessage): TextContent | ThinkingContent | undefined {
  const block = output.content[output.content.length - 1];
  return block?.type === 'text' || block?.type === 'thinking' ? block : undefined;
}

function openBlock(stream: AssistantMessageEventStream, output: AssistantMessage, block: TextContent | ThinkingContent | ToolCall): void {
  if (output.content.length === 0) stream.push({ type: 'start', partial: output });
  output.content.push(block);
}

function endBlock(stream: AssistantMessageEventStream, output: AssistantMessage): void {
  const block = lastBlock(output);
  const contentIndex = output.content.length - 1;
  if (block?.type === 'text') stream.push({ type: 'text_end', contentIndex, content: block.text, partial: output });
  else if (block?.type === 'thinking') stream.push({ type: 'thinking_end', contentIndex, content: block.thinking, partial: output });
}

function applyTextPart(stream: AssistantMessageEventStream, output: AssistantMessage, part: GeminiPart & { text: string }): void {
  const thinking = isThinkingPart(part);
  const active = lastBlock(output);
  if (thinking && active?.type !== 'thinking') {
    endBlock(stream, output);
    openBlock(stream, output, { type: 'thinking', thinking: '' });
    stream.push({ type: 'thinking_start', contentIndex: output.content.length - 1, partial: output });
  } else if (!thinking && active?.type !== 'text') {
    endBlock(stream, output);
    openBlock(stream, output, { type: 'text', text: '' });
    stream.push({ type: 'text_start', contentIndex: output.content.length - 1, partial: output });
  }
  const block = lastBlock(output);
  if (block?.type === 'thinking') {
    block.thinking += part.text;
    const signature = retainThoughtSignature(block.thinkingSignature, part.thoughtSignature);
    if (signature !== undefined) block.thinkingSignature = signature;
    stream.push({ type: 'thinking_delta', contentIndex: output.content.length - 1, delta: part.text, partial: output });
  } else if (block?.type === 'text') {
    block.text += part.text;
    const signature = retainThoughtSignature(block.textSignature, part.thoughtSignature);
    if (signature !== undefined) block.textSignature = signature;
    stream.push({ type: 'text_delta', contentIndex: output.content.length - 1, delta: part.text, partial: output });
  }
}

function emitToolCall(stream: AssistantMessageEventStream, output: AssistantMessage, call: NonNullable<GeminiPart['functionCall']>, thoughtSignature: string | undefined): void {
  endBlock(stream, output);
  const duplicate = output.content.some((block) => block.type === 'toolCall' && block.id === call.id);
  const toolCall: ToolCall = {
    type: 'toolCall',
    id: call.id && !duplicate ? call.id : `${call.name}_${Date.now()}_${++toolCallCounter}`,
    name: call.name ?? '',
    arguments: call.args ?? {},
    ...(thoughtSignature && { thoughtSignature }),
  };
  openBlock(stream, output, toolCall);
  const contentIndex = output.content.length - 1;
  stream.push({ type: 'toolcall_start', contentIndex, partial: output });
  stream.push({ type: 'toolcall_delta', contentIndex, delta: JSON.stringify(toolCall.arguments), partial: output });
  stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial: output });
}

function resolveStopReason(finishReason: string, content: AssistantMessage['content']): AssistantMessage['stopReason'] {
  const stopReason = mapStopReasonString(finishReason);
  return stopReason === 'stop' && content.some((block) => block.type === 'toolCall') ? 'toolUse' : stopReason;
}

function usageFor(model: Model<Api>, metadata: Record<string, number | undefined>): Usage {
  const cacheRead = metadata['cachedContentTokenCount'] ?? 0;
  const usage: Usage = {
    input: (metadata['promptTokenCount'] ?? 0) - cacheRead,
    output: (metadata['candidatesTokenCount'] ?? 0) + (metadata['thoughtsTokenCount'] ?? 0),
    cacheRead,
    cacheWrite: 0,
    reasoning: metadata['thoughtsTokenCount'] ?? 0,
    totalTokens: metadata['totalTokenCount'] ?? 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  calculateCost(model, usage);
  return usage;
}

// agents-compliance-ignore parameter-mutation: the pi-ai contract carries this message as the shared live partial, so its fields update in place
function applyChunkState(output: AssistantMessage, model: Model<Api>, response: CloudCodeResponse): void {
  const candidate = response.candidates?.[0];
  if (candidate?.finishReason) {
    output.rawStopReason = candidate.finishReason;
    output.stopReason = resolveStopReason(candidate.finishReason, output.content);
  }
  if (response.usageMetadata) output.usage = usageFor(model, response.usageMetadata);
}

function createReducer(output: AssistantMessage, stream: AssistantMessageEventStream) {
  return {
    get hasContent() {
      return output.content.length > 0;
    },
    finish: () => endBlock(stream, output),
    chunk(model: Model<Api>, chunk: CloudCodeChunk) {
      const response = chunk.response;
      if (!response) return;
      // agents-compliance-ignore parameter-mutation: pi-ai consumers share this live partial, including its first known response ID
      if (!output.responseId && response.responseId !== undefined) output.responseId = response.responseId;
      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.text !== undefined) applyTextPart(stream, output, part as GeminiPart & { text: string });
        if (part.functionCall) emitToolCall(stream, output, part.functionCall, part.thoughtSignature);
      }
      applyChunkState(output, model, response);
    },
  };
}

function parseLine(line: string): CloudCodeChunk | undefined {
  if (!line.startsWith('data:')) return undefined;
  try {
    return JSON.parse(line.slice(5).trim()) as CloudCodeChunk;
  } catch {
    return undefined;
  }
}

async function readChunks(response: Response, onChunk: (chunk: CloudCodeChunk) => Promise<void>): Promise<void> {
  if (!response.body) throw new Error('Cloud Code Assist returned no response body');
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = async (lines: string[]) => {
    for (const line of lines) {
      const chunk = parseLine(line);
      if (chunk) await onChunk(chunk);
    }
  };
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    await flush(lines);
  }
  await flush([buffer + decoder.decode()]);
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

async function buildRequestInit(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions | undefined, variant: Variant): Promise<RequestInit> {
  const { token, projectId } = parseApiKey(options?.apiKey);
  const base = buildBaseOptions(model, context, options);
  const request = buildRequest(model, context, projectId, {
    variant,
    ...(base.temperature !== undefined && { temperature: base.temperature }),
    maxTokens: base.maxTokens ?? model.maxTokens,
    ...(options?.toolChoice !== undefined && { toolChoice: options.toolChoice }),
    ...(options?.sessionId !== undefined && { sessionId: options.sessionId }),
  });
  const payload = (await options?.onPayload?.(request, model)) ?? request;
  return {
    method: 'POST',
    headers: requestHeaders(model, token, options?.headers),
    body: JSON.stringify(payload),
    ...(options?.signal !== undefined && { signal: options.signal }),
  };
}

async function run(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions | undefined, endpoint: string, stream: AssistantMessageEventStream): Promise<void> {
  const output: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: 'pending',
    timestamp: Date.now(),
  };
  try {
    const { level, variant } = resolveVariant(model, options?.reasoning);
    output.thinkingLevel = level;
    const init = await buildRequestInit(model, context, options, variant);
    for (let empty = 0; ; empty++) {
      const response = await openStream(endpoint, init, model, options);
      const reducer = createReducer(output, stream);
      await readChunks(response, async (chunk) => {
        await options?.onProviderStreamEvent?.(chunk, model);
        reducer.chunk(model, chunk);
      });
      reducer.finish();
      if (reducer.hasContent) break;
      if (empty >= MAX_EMPTY_STREAM_RETRIES) throw new Error('Cloud Code Assist API returned an empty response');
      Object.assign(output, { content: [], usage: emptyUsage(), stopReason: 'pending', timestamp: Date.now() });
      await delay(EMPTY_STREAM_BASE_DELAY_MS * 2 ** empty, undefined, { signal: options?.signal });
    }
    if (options?.signal?.aborted) throw new Error('Request was aborted');
    if (output.stopReason === 'pending') throw new Error('Cloud Code Assist stream ended without a finish reason');
    if (output.stopReason === 'error' || output.stopReason === 'aborted') {
      throw new Error(`Provider stopped with: ${output.rawStopReason ?? 'an unknown reason'}`);
    }
    stream.push({ type: 'done', reason: output.stopReason, message: output });
  } catch (error) {
    output.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
    output.errorMessage = error instanceof Error ? error.message : String(error);
    stream.push({ type: 'error', reason: output.stopReason, error: output });
  }
  stream.end();
}

export function createCloudCodeStream(endpoint: string): ProviderStreams {
  const streamSimple = (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream();
    void run(model, context, options, model.baseUrl || endpoint, stream);
    return stream;
  };
  return { stream: streamSimple, streamSimple };
}
