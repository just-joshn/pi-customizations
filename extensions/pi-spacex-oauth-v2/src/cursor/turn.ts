import { type Api, type AssistantMessage, type AssistantMessageEvent, type AssistantMessageEventStream, createAssistantMessageEventStream, type JsonObject, type Model, type ToolCall } from '@earendil-works/pi-ai';
import { type Cell, createCell, patchCell } from '../cell.ts';

export interface PiToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

type BlockKind = 'text' | 'thinking';
type Block = AssistantMessage['content'][number];

interface TurnState {
  message: AssistantMessage;
  open: { kind: BlockKind; index: number } | undefined;
  ended: boolean;
}

type State = Cell<TurnState>;

/**
 * One Pi assistant message. A Cursor run can span several of these: each tool pause ends one with
 * toolUse, and the run continues into the next. Usage stays zero, because the SDK reports usage per run
 * (summed across model calls), which is not the context size Pi tracks; Pi estimates context instead.
 */
export interface PiTurn {
  readonly stream: AssistantMessageEventStream;
  /** The newest snapshot of the message; every change builds a new one. */
  readonly message: AssistantMessage;
  text(delta: string): void;
  thinking(delta: string): void;
  closeBlock(): void;
  toolUse(calls: PiToolCall[]): void;
  finish(reason: 'stop' | 'toolUse'): void;
  fail(errorMessage: string, aborted: boolean): void;
}

const emptyMessage = (model: Model<Api>): AssistantMessage => ({
  role: 'assistant',
  content: [],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'pending',
  timestamp: Date.now(),
});

/** The only place events enter Pi's stream, whose push() is its one way to deliver them. */
const emit = (stream: AssistantMessageEventStream, event: AssistantMessageEvent): void => stream.push(event);

const setMessage = (state: State, message: AssistantMessage): void => patchCell(state, { message });

const withBlock = (message: AssistantMessage, index: number, block: Block): AssistantMessage => ({ ...message, content: message.content.map((existing, i) => (i === index ? block : existing)) });

export function createPiTurn(model: Model<Api>): PiTurn {
  const stream = createAssistantMessageEventStream();
  const state = createCell<TurnState>({ message: emptyMessage(model), open: undefined, ended: false });
  emit(stream, { type: 'start', partial: state.read().message });
  return {
    stream,
    get message() {
      return state.read().message;
    },
    text: (delta) => append(stream, state, 'text', delta),
    thinking: (delta) => append(stream, state, 'thinking', delta),
    closeBlock: () => closeBlock(stream, state),
    toolUse: (calls) => toolUse(stream, state, calls),
    finish: (reason) => finish(stream, state, reason),
    fail: (errorMessage, aborted) => fail(stream, state, errorMessage, aborted),
  };
}

/** The block with `delta` added, and the stream event that reports it. */
function grow(block: Block | undefined, delta: string) {
  if (block?.type === 'text') return { block: { ...block, text: block.text + delta }, event: 'text_delta' as const };
  if (block?.type === 'thinking') return { block: { ...block, thinking: block.thinking + delta }, event: 'thinking_delta' as const };
  return undefined;
}

function append(stream: AssistantMessageEventStream, state: State, kind: BlockKind, delta: string): void {
  const contentIndex = openBlock(stream, state, kind);
  const { message } = state.read();
  const grown = grow(message.content[contentIndex], delta);
  if (!grown) return;
  const partial = withBlock(message, contentIndex, grown.block);
  setMessage(state, partial);
  emit(stream, { type: grown.event, contentIndex, delta, partial });
}

function closeBlock(stream: AssistantMessageEventStream, state: State): void {
  const { open, message } = state.read();
  if (!open) return;
  patchCell(state, { open: undefined });
  const block = message.content[open.index];
  if (block?.type === 'text') emit(stream, { type: 'text_end', contentIndex: open.index, content: block.text, partial: message });
  if (block?.type === 'thinking') emit(stream, { type: 'thinking_end', contentIndex: open.index, content: block.thinking, partial: message });
}

function openBlock(stream: AssistantMessageEventStream, state: State, kind: BlockKind): number {
  const { open } = state.read();
  if (open?.kind === kind) return open.index;
  closeBlock(stream, state);
  const { message } = state.read();
  const index = message.content.length;
  const block: Block = kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' };
  const partial = { ...message, content: [...message.content, block] };
  patchCell(state, { message: partial, open: { kind, index } });
  emit(stream, { type: kind === 'text' ? 'text_start' : 'thinking_start', contentIndex: index, partial });
  return index;
}

function emitToolCall(stream: AssistantMessageEventStream, state: State, call: PiToolCall): void {
  const block: ToolCall = { type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments };
  const { message } = state.read();
  const contentIndex = message.content.length;
  const partial = { ...message, content: [...message.content, block] };
  setMessage(state, partial);
  emit(stream, { type: 'toolcall_start', contentIndex, partial });
  emit(stream, { type: 'toolcall_delta', contentIndex, delta: JSON.stringify(call.arguments), partial });
  emit(stream, { type: 'toolcall_end', contentIndex, toolCall: block, partial });
}

function toolUse(stream: AssistantMessageEventStream, state: State, calls: PiToolCall[]): void {
  closeBlock(stream, state);
  for (const call of calls) emitToolCall(stream, state, call);
  finish(stream, state, 'toolUse');
}

/** Ends the turn once: closes any open block, records how it ended, and sends the closing event. */
function conclude(stream: AssistantMessageEventStream, state: State, ending: Pick<AssistantMessage, 'stopReason' | 'errorMessage'>, closing: (message: AssistantMessage) => AssistantMessageEvent): void {
  if (state.read().ended) return;
  closeBlock(stream, state);
  const message: AssistantMessage = { ...state.read().message, ...ending };
  patchCell(state, { message, ended: true });
  emit(stream, closing(message));
  stream.end();
}

function finish(stream: AssistantMessageEventStream, state: State, reason: 'stop' | 'toolUse'): void {
  conclude(stream, state, { stopReason: reason }, (message) => ({ type: 'done', reason, message }));
}

function fail(stream: AssistantMessageEventStream, state: State, errorMessage: string, aborted: boolean): void {
  const reason = aborted ? 'aborted' : 'error';
  conclude(stream, state, { stopReason: reason, errorMessage }, (message) => ({ type: 'error', reason, error: message }));
}
