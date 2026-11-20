import { randomUUID } from 'node:crypto';

import type { Run, RunResult, SDKCustomTool, SDKCustomToolResult, SDKJsonValue, SDKMessage } from '@cursor/sdk';
import type { JsonObject, Message, Tool, ToolResultMessage } from '@earendil-works/pi-ai';
import { type Cell, createCell, patchCell, withEntry, withoutKeys } from '../cell.ts';
import { CURSOR_CONFIG } from './config.ts';
import { describeCursorError, describeRunError } from './errors.ts';
import type { PiToolCall, PiTurn } from './turn.ts';

interface ParkedCall extends PiToolCall {
  resolve: (result: SDKCustomToolResult) => void;
}

/** Where a finished run reports, so the caller can keep or drop its agent. */
export interface RunOutcome {
  /** `messages` is the newest Pi transcript the run answered; with `turn.message` it is what Cursor now holds. */
  finished: (turn: PiTurn, messages: Message[]) => void;
  failed: () => void;
}

/**
 * One Cursor run bridged onto Pi turns. Cursor owns the agent loop, so when the model calls a Pi tool,
 * execute() parks the call: the current Pi turn ends with toolUse, and the run waits until Pi sends the
 * tool results in its next request, which resumes the run into a new turn.
 */
export interface CursorRun {
  /** Pi's tools as SDK custom tools whose execute() parks the call for Pi to run. */
  customTools(tools: Tool[]): Record<string, SDKCustomTool>;
  start(run: Run, signal: AbortSignal | undefined): void;
  resume(turn: PiTurn, messages: Message[], results: ToolResultMessage[], signal: AbortSignal | undefined): void;
}

interface RunState {
  turn: PiTurn | undefined;
  backlog: SDKMessage[];
  parked: ParkedCall[];
  batchTimer: NodeJS.Timeout | undefined;
  waitTimer: NodeJS.Timeout | undefined;
  run: Run | undefined;
  messages: Message[];
}

interface RunContext {
  readonly state: Cell<RunState>;
  readonly outcome: RunOutcome;
  readonly bridge: CursorRun;
}

/** Runs waiting on Pi tool results, by Pi tool call id. */
const parkedRuns = createCell(new Map<string, CursorRun>());

export const findParkedRun = (toolCallIds: string[]): CursorRun | undefined => {
  const runs = new Set(toolCallIds.map((id) => parkedRuns.read().get(id)));
  const [run] = runs;
  return runs.size === 1 ? run : undefined;
};

const forget = (calls: ParkedCall[]): void =>
  parkedRuns.write(
    withoutKeys(
      parkedRuns.read(),
      calls.map((call) => call.id),
    ),
  );

function toToolResult(result: ToolResultMessage | undefined): SDKCustomToolResult {
  if (!result) return { content: [{ type: 'text', text: 'Pi returned no result for this tool call.' }], isError: true };
  const content = result.content.map((c) => (c.type === 'text' ? { type: 'text' as const, text: c.text } : { type: 'image' as const, data: c.data, mimeType: c.mimeType }));
  return { content: content.length > 0 ? content : [{ type: 'text', text: '' }], isError: result.isError };
}

export function createCursorRun(turn: PiTurn, messages: Message[], outcome: RunOutcome): CursorRun {
  const state = createCell<RunState>({ turn, backlog: [], parked: [], batchTimer: undefined, waitTimer: undefined, run: undefined, messages });
  const bridge: CursorRun = {
    customTools: (tools) => customTools(context, tools),
    start: (run, signal) => start(context, run, signal),
    resume: (nextTurn, nextMessages, results, signal) => resume(context, nextTurn, nextMessages, results, signal),
  };
  const context: RunContext = { state, outcome, bridge };
  return bridge;
}

function customTools(context: RunContext, tools: Tool[]): Record<string, SDKCustomTool> {
  const entries = tools.map((tool): [string, SDKCustomTool] => [
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.parameters as Record<string, SDKJsonValue>,
      execute: (args) => new Promise((resolve) => park(context, { id: `call_${randomUUID()}`, name: tool.name, arguments: args as JsonObject, resolve })),
    },
  ]);
  return Object.fromEntries(entries);
}

function start(context: RunContext, run: Run, signal: AbortSignal | undefined): void {
  patchCell(context.state, { run });
  watch(context, signal, context.state.read().turn);
  void pump(context, run);
}

function resume(context: RunContext, turn: PiTurn, messages: Message[], results: ToolResultMessage[], signal: AbortSignal | undefined): void {
  const { waitTimer, parked, backlog } = context.state.read();
  clearTimeout(waitTimer);
  patchCell(context.state, { turn, messages, parked: [], backlog: [] });
  watch(context, signal, turn);
  forget(parked);
  for (const call of parked) call.resolve(toToolResult(results.find((r) => r.toolCallId === call.id)));
  for (const event of backlog) handleEvent(context, event);
}

/** Pi aborts one request at a time, so only the turn that request is streaming cancels the run. */
function watch(context: RunContext, signal: AbortSignal | undefined, turn: PiTurn | undefined): void {
  signal?.addEventListener('abort', () => context.state.read().turn === turn && void cancel(context), { once: true });
}

function park(context: RunContext, call: ParkedCall): void {
  const { parked, batchTimer } = context.state.read();
  clearTimeout(batchTimer);
  patchCell(context.state, { parked: [...parked, call], batchTimer: setTimeout(() => pause(context), CURSOR_CONFIG.toolBatchMs) });
}

function pause(context: RunContext): void {
  const { turn, parked } = context.state.read();
  if (!turn) return;
  patchCell(context.state, { turn: undefined });
  parkedRuns.write(parked.reduce((runs, call) => withEntry(runs, call.id, context.bridge), parkedRuns.read()));
  turn.toolUse(parked.map(({ id, name, arguments: args }) => ({ id, name, arguments: args })));
  patchCell(context.state, { waitTimer: setTimeout(() => void cancel(context), CURSOR_CONFIG.toolWaitMs) });
}

function handleEvent(context: RunContext, event: SDKMessage): void {
  const { turn, backlog } = context.state.read();
  if (!turn) {
    patchCell(context.state, { backlog: [...backlog, event] });
    return;
  }
  if (event.type === 'assistant') {
    for (const block of event.message.content) if (block.type === 'text' && block.text) turn.text(block.text);
  } else if (event.type === 'thinking') {
    if (event.text) turn.thinking(event.text);
    if (event.thinking_duration_ms !== undefined) turn.closeBlock();
  }
}

async function consume(context: RunContext, run: Run): Promise<void> {
  for await (const event of run.stream()) handleEvent(context, event);
  settle(context, await run.wait());
}

async function pump(context: RunContext, run: Run): Promise<void> {
  await consume(context, run).catch((error: unknown) => {
    console.error('Cursor run stream failed:', error);
    end(context, describeCursorError(error), false);
  });
}

function settle(context: RunContext, result: RunResult): void {
  const { turn, messages } = context.state.read();
  if (result.status === 'finished' && turn) {
    cleanup(context);
    turn.finish('stop');
    context.outcome.finished(turn, messages);
    return;
  }
  end(context, result.status === 'cancelled' ? 'Cursor run was cancelled' : describeRunError(result.error, result.requestId), result.status === 'cancelled');
}

function end(context: RunContext, message: string, aborted: boolean): void {
  cleanup(context);
  context.state.read().turn?.fail(message, aborted);
  patchCell(context.state, { turn: undefined });
  context.outcome.failed();
}

async function cancel(context: RunContext): Promise<void> {
  const { run } = context.state.read();
  if (run?.status !== 'running') return;
  await run.cancel().catch((error: unknown) => console.error('Cursor run cancel failed:', error));
  cleanup(context);
}

function cleanup(context: RunContext): void {
  const { batchTimer, waitTimer, parked } = context.state.read();
  clearTimeout(batchTimer);
  clearTimeout(waitTimer);
  patchCell(context.state, { parked: [] });
  forget(parked);
  for (const call of parked) call.resolve({ content: [{ type: 'text', text: 'The run ended before Pi answered this tool call.' }], isError: true });
}
