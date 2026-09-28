import { randomUUID } from 'node:crypto';
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
import { FAMILY, familyOf } from './models.ts';
import { convertMessages, convertTools, isThinkingPart, mapStopReasonString, mapToolChoice, resolveGoogleThinkingLevel, retainThoughtSignature, toGoogleThinkingLevel } from './pi-ai/google-shared.ts';
import { sanitizeSurrogates } from './pi-ai/sanitize-unicode.ts';
import { adjustMaxTokensForThinking, buildBaseOptions } from './pi-ai/simple-options.ts';

// google-shared is typed for the Gemini and Vertex APIs. It reads only the id,
// provider, api, input, and thinkingLevelMap fields, which Cloud Code models share.
function asGoogleModel(model: Model<Api>): Model<'google-generative-ai'> {
  return model as unknown as Model<'google-generative-ai'>;
}

const MAX_EMPTY_STREAM_RETRIES = 2;
const EMPTY_STREAM_BASE_DELAY_MS = 500;

type Content = ReturnType<typeof convertMessages>[number];

export interface ThinkingConfig {
  includeThoughts?: boolean;
  thinkingLevel?: string;
  thinkingBudget?: number;
}

export interface GeminiRequest {
  contents: Content[];
  systemInstruction?: { role: 'user'; parts: { text: string }[] };
  generationConfig?: { temperature?: number; maxOutputTokens?: number; thinkingConfig?: ThinkingConfig };
  tools?: ReturnType<typeof convertTools>;
  toolConfig?: { functionCallingConfig: { mode: string } };
  sessionId?: string;
}

export interface CloudCodeRequest {
  project: string;
  model: string;
  request: GeminiRequest;
  requestType: 'agent';
  userAgent: 'antigravity';
  requestId: string;
}

export interface RequestOptions {
  temperature?: number;
  maxTokens?: number;
  thinkingConfig?: ThinkingConfig;
  toolChoice?: ToolChoice;
  sessionId?: string;
}

export function resolveThinking(model: Model<Api>, options: SimpleStreamOptions | undefined, maxTokens: number): { maxTokens: number; thinkingConfig?: ThinkingConfig } {
  const { thinking } = FAMILY[familyOf(model.id)];
  if (!model.reasoning || thinking === 'none') return { maxTokens };
  const level = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : 'off';
  if (thinking === 'level') {
    const thinkingLevel = toGoogleThinkingLevel(resolveGoogleThinkingLevel(asGoogleModel(model), level === 'off' ? 'minimal' : level));
    return { maxTokens, thinkingConfig: level === 'off' ? { thinkingLevel } : { includeThoughts: true, thinkingLevel } };
  }
  if (level === 'off') return { maxTokens, thinkingConfig: { thinkingBudget: 0 } };
  const adjusted = adjustMaxTokensForThinking(maxTokens, model.maxTokens, level, options?.thinkingBudgets);
  return {
    maxTokens: adjusted.maxTokens,
    thinkingConfig: { includeThoughts: true, thinkingBudget: adjusted.thinkingBudget },
  };
}

export function buildRequest(model: Model<Api>, context: TranscriptContext, projectId: string, options: RequestOptions = {}): CloudCodeRequest {
  const family = FAMILY[familyOf(model.id)];
  const transcript = collapseSystemMessages(context);
  const system = getInitialSystemMessage(transcript.messages);
  const systemText = system ? getSystemMessageText(system) : '';
  const tools = getCurrentTools(transcript.messages);
  const generationConfig = {
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.maxTokens !== undefined && { maxOutputTokens: options.maxTokens }),
    ...(options.thinkingConfig && { thinkingConfig: options.thinkingConfig }),
  };
  const request: GeminiRequest = {
    contents: convertMessages(asGoogleModel(model), transcript),
    ...(systemText && { systemInstruction: { role: 'user', parts: [{ text: sanitizeSurrogates(systemText) }] } }),
    ...(Object.keys(generationConfig).length > 0 && { generationConfig }),
    ...(tools.length > 0 && { tools: convertTools(tools, family.toolParameters, false) }),
    ...(tools.length > 0 && options.toolChoice && { toolConfig: { functionCallingConfig: { mode: mapToolChoice(options.toolChoice) } } }),
    ...(options.sessionId && { sessionId: options.sessionId }),
  };
  return {
    project: projectId,
    model: model.id,
    request,
    requestType: 'agent',
    userAgent: 'antigravity',
    requestId: `agent-${randomUUID()}`,
  };
}

function requestHeaders(model: Model<Api>, token: string, overrides: ProviderHeaders | undefined): Headers {
  const { extraHeaders } = FAMILY[familyOf(model.id)];
  const headers = new Headers({
    ...cloudCodeHeaders(token),
    Accept: 'text/event-stream',
    ...(model.reasoning && extraHeaders),
    ...model.headers,
  });
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

function createReducer(output: AssistantMessage, stream: AssistantMessageEventStream) {
  let current: TextContent | ThinkingContent | undefined;
  let started = false;
  const index = () => output.content.length - 1;
  const open = (block: TextContent | ThinkingContent | ToolCall) => {
    if (!started) stream.push({ type: 'start', partial: output });
    started = true;
    output.content.push(block);
  };
  const close = () => {
    if (current?.type === 'text') {
      stream.push({ type: 'text_end', contentIndex: index(), content: current.text, partial: output });
    } else if (current?.type === 'thinking') {
      stream.push({ type: 'thinking_end', contentIndex: index(), content: current.thinking, partial: output });
    }
    current = undefined;
  };
  const text = (part: GeminiPart & { text: string }) => {
    const thinking = isThinkingPart(part);
    if (thinking && current?.type !== 'thinking') {
      close();
      current = { type: 'thinking', thinking: '' };
      open(current);
      stream.push({ type: 'thinking_start', contentIndex: index(), partial: output });
    } else if (!thinking && current?.type !== 'text') {
      close();
      current = { type: 'text', text: '' };
      open(current);
      stream.push({ type: 'text_start', contentIndex: index(), partial: output });
    }
    if (current?.type === 'thinking') {
      current.thinking += part.text;
      current.thinkingSignature = retainThoughtSignature(current.thinkingSignature, part.thoughtSignature);
      stream.push({ type: 'thinking_delta', contentIndex: index(), delta: part.text, partial: output });
    } else if (current?.type === 'text') {
      current.text += part.text;
      current.textSignature = retainThoughtSignature(current.textSignature, part.thoughtSignature);
      stream.push({ type: 'text_delta', contentIndex: index(), delta: part.text, partial: output });
    }
  };
  const functionCall = (call: NonNullable<GeminiPart['functionCall']>, thoughtSignature: string | undefined) => {
    close();
    const duplicate = output.content.some((block) => block.type === 'toolCall' && block.id === call.id);
    const toolCall: ToolCall = {
      type: 'toolCall',
      id: call.id && !duplicate ? call.id : `${call.name}_${Date.now()}_${++toolCallCounter}`,
      name: call.name ?? '',
      arguments: call.args ?? {},
      ...(thoughtSignature && { thoughtSignature }),
    };
    open(toolCall);
    stream.push({ type: 'toolcall_start', contentIndex: index(), partial: output });
    stream.push({ type: 'toolcall_delta', contentIndex: index(), delta: JSON.stringify(toolCall.arguments), partial: output });
    stream.push({ type: 'toolcall_end', contentIndex: index(), toolCall, partial: output });
  };
  return {
    get hasContent() {
      return started;
    },
    finish: close,
    chunk(model: Model<Api>, chunk: CloudCodeChunk) {
      const response = chunk.response;
      if (!response) return;
      output.responseId ||= response.responseId;
      const candidate = response.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        if (part.text !== undefined) text(part as GeminiPart & { text: string });
        if (part.functionCall) functionCall(part.functionCall, part.thoughtSignature);
      }
      if (candidate?.finishReason) {
        output.rawStopReason = candidate.finishReason;
        output.stopReason = mapStopReasonString(candidate.finishReason);
        if (output.stopReason === 'stop' && output.content.some((block) => block.type === 'toolCall')) {
          output.stopReason = 'toolUse';
        }
      }
      const usage = response.usageMetadata;
      if (usage) {
        const cacheRead = usage.cachedContentTokenCount ?? 0;
        output.usage = {
          input: (usage.promptTokenCount ?? 0) - cacheRead,
          output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
          cacheRead,
          cacheWrite: 0,
          reasoning: usage.thoughtsTokenCount ?? 0,
          totalTokens: usage.totalTokenCount ?? 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        };
        calculateCost(model, output.usage);
      }
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

async function readChunks(response: Response, onChunk: (chunk: CloudCodeChunk) => void): Promise<void> {
  if (!response.body) throw new Error('Cloud Code Assist returned no response body');
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = (lines: string[]) => {
    for (const line of lines) {
      const chunk = parseLine(line);
      if (chunk) onChunk(chunk);
    }
  };
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    flush(lines);
  }
  flush([buffer + decoder.decode()]);
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

async function run(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions | undefined, endpoints: readonly string[], stream: AssistantMessageEventStream): Promise<void> {
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
    const { token, projectId } = parseApiKey(options?.apiKey);
    const base = buildBaseOptions(model, context, options);
    const thinking = resolveThinking(model, options, base.maxTokens ?? model.maxTokens);
    const request = buildRequest(model, context, projectId, {
      temperature: base.temperature,
      maxTokens: thinking.maxTokens,
      thinkingConfig: thinking.thinkingConfig,
      toolChoice: options?.toolChoice,
      sessionId: options?.sessionId,
    });
    const payload = (await options?.onPayload?.(request, model)) ?? request;
    const init: RequestInit = {
      method: 'POST',
      headers: requestHeaders(model, token, options?.headers),
      body: JSON.stringify(payload),
      signal: options?.signal,
    };
    for (let empty = 0; ; empty++) {
      const response = await openStream(endpoints, init, model, options);
      const reducer = createReducer(output, stream);
      await readChunks(response, (chunk) => reducer.chunk(model, chunk));
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

function endpointsFor(model: Model<Api>, configured: readonly string[]): readonly string[] {
  return model.baseUrl && !configured.includes(model.baseUrl) ? [model.baseUrl] : configured;
}

export function createCloudCodeStream(endpoints: readonly string[]): ProviderStreams {
  const streamSimple = (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream();
    void run(model, context, options, endpointsFor(model, endpoints), stream);
    return stream;
  };
  return { stream: streamSimple, streamSimple };
}
