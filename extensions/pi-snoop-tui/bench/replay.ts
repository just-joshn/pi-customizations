import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { type Cell, cell } from '../src/cell.ts';

const CHARS_PER_TOKEN = 4;
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

export interface Turn {
  readonly text: string;
  readonly toolCalls: readonly Omit<ToolCall, 'type'>[];
}
export interface ReplayConfig {
  readonly script: readonly Turn[];
  readonly deltaChars: number;
  readonly deltaIntervalMs: number;
  /** Pause between the start event and the first block. */
  readonly leadDelayMs: number;
  /** Bench runs emit an empty text block for tool-only turns. The demo skips it. */
  readonly emitEmptyText: boolean;
  /** Bench runs report payload, response, and stream-event hooks to Pi. The demo does not. */
  readonly notifyHost: boolean;
  readonly usage: (assistantCount: number, turn: Turn) => { readonly input: number; readonly output: number };
}
type Block = AssistantMessage['content'][number];
interface Run {
  readonly model: Model<Api>;
  readonly options: SimpleStreamOptions | undefined;
  readonly config: ReplayConfig;
  readonly timestamp: number;
  readonly progress: Cell<readonly Block[]>;
  readonly emit: (event: AssistantMessageEvent) => void;
}

export function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

function message(run: Run, content: readonly Block[], extra: Partial<AssistantMessage> = {}): AssistantMessage {
  run.progress.write(content);
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: ZERO_COST };
  return { role: 'assistant', content: [...content], api: run.model.api, provider: run.model.provider, model: run.model.id, usage, stopReason: 'pending', timestamp: run.timestamp, ...extra };
}

async function emitText(run: Run, before: readonly Block[], text: string): Promise<readonly Block[]> {
  const contentIndex = before.length;
  const { deltaChars, deltaIntervalMs, notifyHost } = run.config;
  run.emit({ type: 'text_start', contentIndex, partial: message(run, [...before, { type: 'text', text: '' }]) });
  let streamed = '';
  for (let offset = 0; offset < text.length; offset += deltaChars) {
    await sleep(deltaIntervalMs, run.options?.signal);
    const delta = text.slice(offset, offset + deltaChars);
    if (notifyHost) await run.options?.onProviderStreamEvent?.({ delta }, run.model);
    streamed += delta;
    run.emit({ type: 'text_delta', contentIndex, delta, partial: message(run, [...before, { type: 'text', text: streamed }]) });
  }
  const after: readonly Block[] = [...before, { type: 'text', text: streamed }];
  run.emit({ type: 'text_end', contentIndex, content: streamed, partial: message(run, after) });
  return after;
}

function emitToolCalls(run: Run, before: readonly Block[], calls: Turn['toolCalls']): readonly Block[] {
  let blocks = before;
  for (const call of calls) {
    const contentIndex = blocks.length;
    const toolCall: ToolCall = { type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments };
    const after: readonly Block[] = blocks.concat(toolCall);
    run.emit({ type: 'toolcall_start', contentIndex, partial: message(run, blocks.concat({ ...toolCall, arguments: {} })) });
    run.emit({ type: 'toolcall_delta', contentIndex, delta: JSON.stringify(call.arguments), partial: message(run, after) });
    run.emit({ type: 'toolcall_end', contentIndex, toolCall, partial: message(run, after) });
    blocks = after;
  }
  return blocks;
}

async function playTurn(run: Run, turn: Turn, assistantCount: number): Promise<void> {
  const { config, options, model } = run;
  if (config.notifyHost) {
    await options?.onPayload?.({ assistantCount }, model);
    await options?.onResponse?.({ status: 200, headers: {} }, model);
  }
  run.emit({ type: 'start', partial: message(run, []) });
  await sleep(config.leadDelayMs, options?.signal);
  const texted = turn.text || config.emitEmptyText ? await emitText(run, [], turn.text) : [];
  const content = emitToolCalls(run, texted, turn.toolCalls);
  const { input, output } = config.usage(assistantCount, turn);
  const stopReason = turn.toolCalls.length > 0 ? 'toolUse' : 'stop';
  const usage = { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output, cost: ZERO_COST };
  run.emit({ type: 'done', reason: stopReason, message: message(run, content, { usage, stopReason }) });
}

/** Token estimate shared by the bench and demo providers. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function replayStream(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions | undefined, config: ReplayConfig): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const emit = (event: AssistantMessageEvent): void => {
    stream.push(event);
  };
  const lastUser = context.messages.findLastIndex((entry) => entry.role === 'user');
  const assistantCount = context.messages.slice(lastUser + 1).filter((entry) => entry.role === 'assistant').length;
  const turn = config.script[Math.min(assistantCount, config.script.length - 1)] ?? { text: '', toolCalls: [] };
  const run: Run = { model, options, config, timestamp: Date.now(), progress: cell<readonly Block[]>([]), emit };
  const fail = (error: unknown): void => {
    const stopReason = options?.signal?.aborted ? 'aborted' : 'error';
    const errorMessage = error instanceof Error ? error.message : String(error);
    emit({ type: 'error', reason: stopReason, error: message(run, run.progress.read(), { stopReason, errorMessage }) });
  };
  void playTurn(run, turn, assistantCount)
    .catch(fail)
    .finally(() => stream.end());
  return stream;
}
