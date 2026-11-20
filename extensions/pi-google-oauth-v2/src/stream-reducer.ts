import { type Api, type AssistantMessage, type AssistantMessageEvent, calculateCost, type Model, type ToolCall, uuidv7 } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { CodeAssistError } from './code-assist.ts';

const RESPONSE_PART = z.looseObject({
  text: z.string().optional(),
  thought: z.boolean().optional(),
  thoughtSignature: z.string().optional(),
  functionCall: z.looseObject({ id: z.string().optional(), name: z.string().optional(), args: z.record(z.string(), z.json()).optional() }).optional(),
});

const CANDIDATE = z.looseObject({
  content: z.looseObject({ parts: z.array(RESPONSE_PART).optional() }).optional(),
  finishReason: z.string().optional(),
  finishMessage: z.string().optional(),
});

const USAGE_METADATA = z.looseObject({
  promptTokenCount: z.number().optional(),
  cachedContentTokenCount: z.number().optional(),
  candidatesTokenCount: z.number().optional(),
  thoughtsTokenCount: z.number().optional(),
  totalTokenCount: z.number().optional(),
});

const RESPONSE = z.looseObject({
  candidates: z.array(CANDIDATE).optional(),
  usageMetadata: USAGE_METADATA.optional(),
  modelVersion: z.string().optional(),
  promptFeedback: z.looseObject({ blockReason: z.string().optional(), blockReasonMessage: z.string().optional() }).optional(),
});

// Loose objects: stream hooks receive each chunk exactly as Google sent it.
export const CODE_ASSIST_CHUNK = z.looseObject({
  response: RESPONSE.optional(),
  traceId: z.string().optional(),
  error: z.looseObject({ message: z.string().optional() }).optional(),
});

export type CodeAssistChunk = z.infer<typeof CODE_ASSIST_CHUNK>;
type ResponsePart = z.infer<typeof RESPONSE_PART>;

/** Everything the stream has learned so far. Each step returns a new state and never edits the old one. */
export interface ReducerState {
  readonly output: AssistantMessage;
  readonly open: 'text' | 'thinking' | undefined;
  readonly finishReason: string | undefined;
  readonly finishMessage: string | undefined;
}

/** `error` is raised by the caller after it has applied `state` and sent `events`. */
export interface ReducerStep {
  readonly state: ReducerState;
  readonly events: readonly AssistantMessageEvent[];
  readonly error?: Error;
}

type Block = AssistantMessage['content'][number];
type ToolCallPart = NonNullable<ResponsePart['functionCall']>;

const withGoogleMessage = (summary: string, message: string | undefined): string => (message ? `${summary}: ${message}` : summary);

export function createReducerState(output: AssistantMessage): ReducerState {
  return { output, open: undefined, finishReason: undefined, finishMessage: undefined };
}

const noEvents = (state: ReducerState): ReducerStep => ({ state, events: [] });

const chain = (first: ReducerStep, next: ReducerStep): ReducerStep => ({ state: next.state, events: [...first.events, ...next.events] });

const withOutput = (state: ReducerState, output: AssistantMessage): ReducerState => ({ ...state, output });

const withLastBlock = (output: AssistantMessage, block: Block): AssistantMessage => ({ ...output, content: [...output.content.slice(0, -1), block] });

export function closeOpenBlock(state: ReducerState): ReducerStep {
  if (!state.open) return noEvents(state);
  const contentIndex = state.output.content.length - 1;
  const block = state.output.content[contentIndex];
  const closed: ReducerState = { ...state, open: undefined };
  if (block?.type === 'thinking') return { state: closed, events: [{ type: 'thinking_end', contentIndex, content: block.thinking, partial: state.output }] };
  if (block?.type === 'text') return { state: closed, events: [{ type: 'text_end', contentIndex, content: block.text, partial: state.output }] };
  return { state: closed, events: [] };
}

function openBlock(state: ReducerState, kind: 'text' | 'thinking'): ReducerStep {
  const closed = closeOpenBlock(state);
  const block: Block = kind === 'thinking' ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' };
  const output: AssistantMessage = { ...closed.state.output, content: [...closed.state.output.content, block] };
  const event: AssistantMessageEvent = { type: kind === 'thinking' ? 'thinking_start' : 'text_start', contentIndex: output.content.length - 1, partial: output };
  return { state: { ...closed.state, output, open: kind }, events: [...closed.events, event] };
}

function appendText(state: ReducerState, text: string, thought: boolean, signature: string | undefined): ReducerStep {
  const kind = thought ? 'thinking' : 'text';
  const opened = state.open === kind ? noEvents(state) : openBlock(state, kind);
  const { output } = opened.state;
  const contentIndex = output.content.length - 1;
  const block = output.content[contentIndex];
  if (block?.type === 'thinking') {
    const partial = withLastBlock(output, { ...block, thinking: block.thinking + text, ...(signature ? { thinkingSignature: signature } : {}) });
    return chain(opened, { state: withOutput(opened.state, partial), events: [{ type: 'thinking_delta', contentIndex, delta: text, partial }] });
  }
  if (block?.type === 'text') {
    const partial = withLastBlock(output, { ...block, text: block.text + text, ...(signature ? { textSignature: signature } : {}) });
    return chain(opened, { state: withOutput(opened.state, partial), events: [{ type: 'text_delta', contentIndex, delta: text, partial }] });
  }
  return opened;
}

function addToolCall(state: ReducerState, call: ToolCallPart, signature: string | undefined): ReducerStep {
  const closed = closeOpenBlock(state);
  const duplicate = call.id !== undefined && closed.state.output.content.some((block) => block.type === 'toolCall' && block.id === call.id);
  const toolCall: ToolCall = { type: 'toolCall', id: call.id && !duplicate ? call.id : `call_${uuidv7()}`, name: call.name ?? '', arguments: call.args ?? {}, ...(signature ? { thoughtSignature: signature } : {}) };
  const output: AssistantMessage = { ...closed.state.output, content: [...closed.state.output.content, toolCall] };
  const contentIndex = output.content.length - 1;
  const events: AssistantMessageEvent[] = [
    { type: 'toolcall_start', contentIndex, partial: output },
    { type: 'toolcall_delta', contentIndex, delta: JSON.stringify(toolCall.arguments), partial: output },
    { type: 'toolcall_end', contentIndex, toolCall, partial: output },
  ];
  return chain(closed, { state: withOutput(closed.state, output), events });
}

function applyPart(step: ReducerStep, part: ResponsePart): ReducerStep {
  if (typeof part.text === 'string') return chain(step, appendText(step.state, part.text, part.thought === true, part.thoughtSignature));
  if (part.functionCall) return chain(step, addToolCall(step.state, part.functionCall, part.thoughtSignature));
  return step;
}

function usageFrom(model: Model<Api>, usage: NonNullable<NonNullable<CodeAssistChunk['response']>['usageMetadata']>): AssistantMessage['usage'] {
  const cached = usage.cachedContentTokenCount ?? 0;
  const thoughts = usage.thoughtsTokenCount ?? 0;
  const counted = {
    input: (usage.promptTokenCount ?? 0) - cached,
    output: (usage.candidatesTokenCount ?? 0) + thoughts,
    cacheRead: cached,
    cacheWrite: 0,
    reasoning: thoughts,
    totalTokens: usage.totalTokenCount ?? 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  return { ...counted, cost: calculateCost(model, counted) };
}

function withMetadata(state: ReducerState, chunk: CodeAssistChunk): ReducerState {
  const responseId = chunk.traceId && !state.output.responseId ? { responseId: chunk.traceId } : {};
  const responseModel = chunk.response?.modelVersion ? { responseModel: chunk.response.modelVersion } : {};
  return withOutput(state, { ...state.output, ...responseId, ...responseModel });
}

/** Applies one chunk. Throws only when the chunk itself is an error, before any state changes. */
export function reduceChunk(state: ReducerState, chunk: CodeAssistChunk, model: Model<Api>): ReducerStep {
  if (chunk.error) throw new CodeAssistError(chunk.error.message ?? 'Google Code Assist returned an error');
  const stamped = withMetadata(state, chunk);
  const { response } = chunk;
  if (!response) return noEvents(stamped);
  const feedback = response.promptFeedback;
  if (feedback?.blockReason) return { ...noEvents(stamped), error: new Error(withGoogleMessage(`Google blocked the prompt: ${feedback.blockReason}`, feedback.blockReasonMessage)) };

  const candidate = response.candidates?.[0];
  const parted = (candidate?.content?.parts ?? []).reduce<ReducerStep>(applyPart, noEvents(stamped));
  const usage = response.usageMetadata;
  const finished: ReducerState = {
    ...parted.state,
    finishReason: candidate?.finishReason ? candidate.finishReason : parted.state.finishReason,
    finishMessage: candidate?.finishMessage ? candidate.finishMessage : parted.state.finishMessage,
  };
  return { state: usage ? withOutput(finished, { ...finished.output, usage: usageFrom(model, usage) }) : finished, events: parted.events };
}

function stopOutput(output: AssistantMessage, reason: string): AssistantMessage {
  if (reason === 'MAX_TOKENS') return { ...output, stopReason: 'length' };
  if (reason === 'STOP') return { ...output, stopReason: output.content.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop' };
  return output;
}

/** Closes any open block and settles the stop reason. The step carries an error when Google did not stop cleanly. */
export function finishStream(state: ReducerState): ReducerStep {
  const closed = closeOpenBlock(state);
  const reason = closed.state.finishReason;
  if (!reason) return { ...closed, error: new Error('Google stream ended without a finish reason') };
  const output = stopOutput({ ...closed.state.output, rawStopReason: reason }, reason);
  const settled: ReducerStep = { state: withOutput(closed.state, output), events: closed.events };
  if (reason === 'MAX_TOKENS' || reason === 'STOP') return settled;
  return { ...settled, error: new Error(withGoogleMessage(`Google stopped with ${reason}`, closed.state.finishMessage)) };
}
