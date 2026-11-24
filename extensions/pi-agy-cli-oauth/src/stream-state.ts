import type { AssistantMessage, AssistantMessageEventStream, JsonObject, JsonValue, Model, ModelThinkingLevel, StopReason, ToolCall, Usage } from '@earendil-works/pi-ai';
import { API_ID } from './constants.ts';
import type { ToolBridgeCall } from './types.ts';

/** One reducer input. Content after the turn settles is dropped. */
export type TurnAction =
  | { kind: 'text'; delta: string }
  | { kind: 'thinking'; delta: string }
  | { kind: 'tool'; call: ToolBridgeCall }
  | { kind: 'stop'; reason: 'end_turn' | 'max_tokens' | 'refusal' | 'cancelled' }
  | { kind: 'fail'; message: string }
  | { kind: 'usage'; contextSize: number }
  | { kind: 'tokens'; tokens: TokenUsage };

/** Token counts the CLI reports on the prompt result. Cost stays zero: a plan turn has no per-token price Pi can bill. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  totalTokens: number;
}

export type TurnContent = { type: 'text'; text: string } | { type: 'thinking'; thinking: string } | { type: 'toolCall'; call: ToolBridgeCall };

export interface TurnState {
  /** Committed content blocks, in emission order. */
  blocks: readonly TurnContent[];
  /** Stop reason Pi should report. `pending` until an action settles the turn. */
  stopReason: StopReason;
  errorMessage?: string;
  /** Context size the CLI last reported on `usage_update`. */
  contextSize?: number;
  /** Per-turn tokens from the prompt result. Absent when the turn was cut short at a tool. */
  tokens?: TokenUsage;
}

/** The model named the refusal. Pi must not retry that stop. */
export const REFUSAL_MESSAGE = 'The model refused the request.';

export const EMPTY_TURN: TurnState = { blocks: [], stopReason: 'pending' };

function settled(state: TurnState): boolean {
  return state.stopReason !== 'pending';
}

function hasTool(state: TurnState): boolean {
  return state.blocks.some((block) => block.type === 'toolCall');
}

function append(state: TurnState, block: TurnContent): TurnState {
  return { ...state, blocks: [...state.blocks, block] };
}

function appendText(state: TurnState, delta: string): TurnState {
  const last = state.blocks.at(-1);
  if (last?.type !== 'text') return append(state, { type: 'text', text: delta });
  const blocks = state.blocks.slice(0, -1).concat([{ type: 'text', text: last.text + delta }]);
  return { ...state, blocks };
}

function appendThinking(state: TurnState, delta: string): TurnState {
  const last = state.blocks.at(-1);
  if (last?.type !== 'thinking') return append(state, { type: 'thinking', thinking: delta });
  const blocks = state.blocks.slice(0, -1).concat([{ type: 'thinking', thinking: last.thinking + delta }]);
  return { ...state, blocks };
}

function applyStop(state: TurnState, reason: 'end_turn' | 'max_tokens' | 'refusal' | 'cancelled'): TurnState {
  switch (reason) {
    case 'end_turn':
      return { ...state, stopReason: hasTool(state) ? 'toolUse' : 'stop' };
    case 'max_tokens':
      return { ...state, stopReason: 'length' };
    case 'refusal':
      return { ...state, stopReason: 'error', errorMessage: REFUSAL_MESSAGE };
    case 'cancelled':
      return { ...state, stopReason: 'aborted' };
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export function reduceTurn(state: TurnState, action: TurnAction): TurnState {
  switch (action.kind) {
    case 'text':
      return settled(state) ? state : appendText(state, action.delta);
    case 'thinking':
      return settled(state) ? state : appendThinking(state, action.delta);
    case 'tool':
      return settled(state) ? state : append(state, { type: 'toolCall', call: action.call });
    case 'usage':
      return { ...state, contextSize: action.contextSize };
    case 'tokens':
      return { ...state, tokens: action.tokens };
    case 'stop':
      return settled(state) ? state : applyStop(state, action.reason);
    case 'fail':
      return settled(state) ? state : { ...state, stopReason: 'error', errorMessage: action.message };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

const CONTEXT_DIAGNOSTIC = 'antigravity-context';
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface TurnMeta {
  model: Model<typeof API_ID>;
  timestamp: number;
  thinkingLevel?: ModelThinkingLevel;
  providerThinkingLevel?: string;
}
export interface OpenBlock {
  kind: 'text' | 'thinking';
  index: number;
}
interface Emission {
  state: TurnState;
  open: OpenBlock | undefined;
}
const ZERO_COST: Usage['cost'] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

function usageFor(state: TurnState): Usage {
  const tokens = state.tokens;
  if (tokens === undefined) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: ZERO_COST };
  return { ...tokens, cost: ZERO_COST };
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === 'object' && Object.entries(value).every(([, entry]) => isJsonValue(entry));
}

function asJsonObject(value: Record<string, unknown>): JsonObject {
  const entries = Object.entries(value).flatMap(([key, entry]): [string, JsonValue][] => (DANGEROUS_KEYS.has(key) || !isJsonValue(entry) ? [] : [[key, entry]]));
  return Object.fromEntries(entries);
}

function toContent(block: TurnContent): AssistantMessage['content'][number] {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'thinking') return { type: 'thinking', thinking: block.thinking };
  return toToolCall(block.call);
}

function toToolCall(call: ToolBridgeCall): ToolCall {
  return { type: 'toolCall', id: call.callId, name: call.piTool, arguments: asJsonObject(call.arguments) };
}

export function messageFor(meta: TurnMeta, state: TurnState): AssistantMessage {
  const diagnostic = state.contextSize === undefined ? undefined : { type: CONTEXT_DIAGNOSTIC, timestamp: meta.timestamp, details: { contextSize: state.contextSize } };
  return {
    role: 'assistant',
    content: state.blocks.map(toContent),
    api: meta.model.api,
    provider: meta.model.provider,
    model: meta.model.id,
    usage: usageFor(state),
    stopReason: state.stopReason,
    timestamp: meta.timestamp,
    ...(state.errorMessage === undefined ? {} : { errorMessage: state.errorMessage }),
    ...(meta.thinkingLevel === undefined ? {} : { thinkingLevel: meta.thinkingLevel }),
    ...(meta.providerThinkingLevel === undefined ? {} : { providerThinkingLevel: meta.providerThinkingLevel }),
    ...(diagnostic === undefined ? {} : { diagnostics: [diagnostic] }),
  };
}

function closeOpen(stream: AssistantMessageEventStream, meta: TurnMeta, state: TurnState, open: OpenBlock | undefined): void {
  if (open === undefined) return;
  const block = state.blocks[open.index];
  const partial = messageFor(meta, state);
  if (open.kind === 'text' && block?.type === 'text') stream.push({ type: 'text_end', contentIndex: open.index, content: block.text, partial });
  if (open.kind === 'thinking' && block?.type === 'thinking') stream.push({ type: 'thinking_end', contentIndex: open.index, content: block.thinking, partial });
}

function emptyTail(state: TurnState): TurnState {
  const last = state.blocks.at(-1);
  if (last?.type === 'text') return { ...state, blocks: state.blocks.slice(0, -1).concat([{ type: 'text', text: '' }]) };
  if (last?.type === 'thinking') return { ...state, blocks: state.blocks.slice(0, -1).concat([{ type: 'thinking', thinking: '' }]) };
  return state;
}

function emitProse(stream: AssistantMessageEventStream, meta: TurnMeta, previous: TurnState, next: TurnState, open: OpenBlock | undefined, action: { kind: 'text' | 'thinking'; delta: string }): Emission {
  const index = next.blocks.length - 1;
  const extended = next.blocks.length === previous.blocks.length;
  if (!extended) closeOpen(stream, meta, previous, open);
  const partial = messageFor(meta, next);
  if (!extended && action.kind === 'text') stream.push({ type: 'text_start', contentIndex: index, partial: messageFor(meta, emptyTail(next)) });
  if (!extended && action.kind === 'thinking') stream.push({ type: 'thinking_start', contentIndex: index, partial: messageFor(meta, emptyTail(next)) });
  if (action.kind === 'text') stream.push({ type: 'text_delta', contentIndex: index, delta: action.delta, partial });
  else stream.push({ type: 'thinking_delta', contentIndex: index, delta: action.delta, partial });
  return { state: next, open: { kind: action.kind, index } };
}

function emitTool(stream: AssistantMessageEventStream, meta: TurnMeta, previous: TurnState, next: TurnState, open: OpenBlock | undefined): Emission {
  closeOpen(stream, meta, previous, open);
  const index = next.blocks.length - 1;
  const block = next.blocks[index];
  if (block?.type !== 'toolCall') return { state: next, open: undefined };
  const toolCall = toToolCall(block.call);
  const partial = messageFor(meta, next);
  stream.push({ type: 'toolcall_start', contentIndex: index, partial });
  stream.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(toolCall.arguments), partial });
  stream.push({ type: 'toolcall_end', contentIndex: index, toolCall, partial });
  return { state: next, open: undefined };
}

export function emitAction(stream: AssistantMessageEventStream, meta: TurnMeta, state: TurnState, open: OpenBlock | undefined, action: TurnAction): Emission {
  const next = reduceTurn(state, action);
  if (next === state) return { state, open };
  if (action.kind === 'text' || action.kind === 'thinking') return emitProse(stream, meta, state, next, open, action);
  if (action.kind === 'tool') return emitTool(stream, meta, state, next, open);
  return { state: next, open };
}

export function emitTerminal(stream: AssistantMessageEventStream, meta: TurnMeta, state: TurnState, open: OpenBlock | undefined): void {
  closeOpen(stream, meta, state, open);
  const message = messageFor(meta, state);
  if (state.stopReason === 'error' || state.stopReason === 'aborted') {
    stream.push({ type: 'error', reason: state.stopReason, error: message });
    stream.end(message);
    return;
  }
  if (state.stopReason === 'stop' || state.stopReason === 'length' || state.stopReason === 'toolUse') {
    stream.push({ type: 'done', reason: state.stopReason, message });
    stream.end(message);
    return;
  }
  const failed = messageFor(meta, { ...state, stopReason: 'error', errorMessage: 'The Antigravity turn ended before it settled.' });
  stream.push({ type: 'error', reason: 'error', error: failed });
  stream.end(failed);
}
