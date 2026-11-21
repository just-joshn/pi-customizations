import { randomUUID } from 'node:crypto';

import type { Run, RunResult, SDKCustomTool, SDKCustomToolResult, SDKMessage } from '@cursor/sdk';
import type { JsonObject, Message, Tool, ToolResultMessage } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { type Cell, createCell, patchCell, withEntry, withoutKeys } from '../cell.ts';
import { CURSOR_CONFIG } from './config.ts';
import { describeCursorError, describeRunError } from './errors.ts';
import type { PiToolCall, PiTurn } from './turn.ts';

const InputSchema = z.record(z.string(), z.json());

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

/**
 * Where the run is, and what only that place holds. `streaming` feeds the live Pi turn. `batching` has gathered
 * calls and waits toolBatchMs for parallel siblings. `paused` has ended the turn with toolUse and waits for Pi's
 * results; calls that arrive meanwhile are `late`, and events are kept in `backlog`. `done` has released everything.
 */
type Phase =
  | { kind: 'streaming'; turn: PiTurn }
  | { kind: 'batching'; turn: PiTurn; calls: ParkedCall[]; timer: NodeJS.Timeout }
  | { kind: 'paused'; calls: ParkedCall[]; late: ParkedCall[]; backlog: SDKMessage[]; timer: NodeJS.Timeout }
  | { kind: 'done' };

interface RunState {
  phase: Phase;
  run: Run | undefined;
  messages: Message[];
}

interface RunContext {
  readonly state: Cell<RunState>;
  readonly outcome: RunOutcome;
  readonly bridge: CursorRun;
}

const ENDED_RESULT: SDKCustomToolResult = { content: [{ type: 'text', text: 'The run ended before Pi answered this tool call.' }], isError: true };

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
  const state = createCell<RunState>({ phase: { kind: 'streaming', turn }, run: undefined, messages });
  const bridge: CursorRun = {
    customTools: (tools) => customTools(context, tools),
    start: (run, signal) => start(context, run, signal),
    resume: (nextTurn, nextMessages, results, signal) => resume(context, nextTurn, nextMessages, results, signal),
  };
  const context: RunContext = { state, outcome, bridge };
  return bridge;
}

const turnOf = (phase: Phase): PiTurn | undefined => (phase.kind === 'streaming' || phase.kind === 'batching' ? phase.turn : undefined);

function customTools(context: RunContext, tools: Tool[]): Record<string, SDKCustomTool> {
  const entries = tools.map((tool): [string, SDKCustomTool] => [
    tool.name,
    {
      description: tool.description,
      inputSchema: InputSchema.parse(tool.parameters),
      execute: parkedExecute(context, tool.name),
    },
  ]);
  return Object.fromEntries(entries);
}

function parkedExecute(context: RunContext, name: string): SDKCustomTool['execute'] {
  return (args) =>
    new Promise((resolve) => {
      park(context, { id: `call_${randomUUID()}`, name, arguments: args as JsonObject, resolve });
    });
}

function start(context: RunContext, run: Run, signal: AbortSignal | undefined): void {
  patchCell(context.state, { run });
  watch(context, signal, turnOf(context.state.read().phase));
  void pump(context, run);
}

/** Pi answered the calls of the paused turn. Calls that arrived late become the next turn's batch. */
function resume(context: RunContext, turn: PiTurn, messages: Message[], results: ToolResultMessage[], signal: AbortSignal | undefined): void {
  const { phase } = context.state.read();
  if (phase.kind !== 'paused') {
    turn.fail('The Cursor run is no longer waiting for tool results', false);
    return;
  }
  clearTimeout(phase.timer);
  forget(phase.calls);
  patchCell(context.state, { messages });
  watch(context, signal, turn);
  if (phase.late.length > 0) batch(context, turn, phase.late);
  else patchCell(context.state, { phase: { kind: 'streaming', turn } });
  for (const call of phase.calls) call.resolve(toToolResult(results.find((r) => r.toolCallId === call.id)));
  for (const event of phase.backlog) handleEvent(context, event);
}

/** Pi aborts one request at a time, so only the turn that request is streaming cancels the run. */
function watch(context: RunContext, signal: AbortSignal | undefined, turn: PiTurn | undefined): void {
  signal?.addEventListener(
    'abort',
    () => {
      if (turnOf(context.state.read().phase) === turn) void cancel(context);
    },
    { once: true },
  );
}

function park(context: RunContext, call: ParkedCall): void {
  const { phase } = context.state.read();
  if (phase.kind === 'streaming') batch(context, phase.turn, [call]);
  else if (phase.kind === 'batching') {
    clearTimeout(phase.timer);
    batch(context, phase.turn, [...phase.calls, call]);
  } else if (phase.kind === 'paused') patchCell(context.state, { phase: { ...phase, late: [...phase.late, call] } });
  else call.resolve(ENDED_RESULT);
}

/** Gathers `calls` for toolBatchMs, so parallel calls from one model step share one Pi turn. */
function batch(context: RunContext, turn: PiTurn, calls: ParkedCall[]): void {
  const timer = setTimeout(() => pause(context), CURSOR_CONFIG.toolBatchMs);
  patchCell(context.state, { phase: { kind: 'batching', turn, calls, timer } });
}

function pause(context: RunContext): void {
  const { phase } = context.state.read();
  if (phase.kind !== 'batching') return;
  const timer = setTimeout(() => void cancel(context), CURSOR_CONFIG.toolWaitMs);
  patchCell(context.state, { phase: { kind: 'paused', calls: phase.calls, late: [], backlog: [], timer } });
  parkedRuns.write(phase.calls.reduce((runs, call) => withEntry(runs, call.id, context.bridge), parkedRuns.read()));
  phase.turn.toolUse(phase.calls.map(({ id, name, arguments: args }) => ({ id, name, arguments: args })));
}

function handleEvent(context: RunContext, event: SDKMessage): void {
  const { phase } = context.state.read();
  if (phase.kind === 'paused') {
    patchCell(context.state, { phase: { ...phase, backlog: [...phase.backlog, event] } });
    return;
  }
  const turn = turnOf(phase);
  if (!turn) return;
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
  const { phase, messages } = context.state.read();
  const turn = turnOf(phase);
  if (result.status === 'finished' && turn) {
    done(context);
    turn.finish('stop');
    context.outcome.finished(turn, messages);
    return;
  }
  end(context, result.status === 'cancelled' ? 'Cursor run was cancelled' : describeRunError(result.error, result.requestId), result.status === 'cancelled');
}

function end(context: RunContext, message: string, aborted: boolean): void {
  const turn = turnOf(context.state.read().phase);
  done(context);
  turn?.fail(message, aborted);
  context.outcome.failed();
}

async function cancel(context: RunContext): Promise<void> {
  const { run } = context.state.read();
  if (run?.status !== 'running') return;
  await run.cancel().catch((error: unknown) => console.error('Cursor run cancel failed:', error));
  patchCell(context.state, { phase: release(context.state.read().phase) });
}

function done(context: RunContext): void {
  release(context.state.read().phase);
  patchCell(context.state, { phase: { kind: 'done' } });
}

/** Stops the phase's timers and answers every call it still holds with an error, so Cursor's tools stop waiting. */
function release(phase: Phase): Phase {
  if (phase.kind === 'batching') {
    clearTimeout(phase.timer);
    drop(phase.calls);
    return { kind: 'streaming', turn: phase.turn };
  }
  if (phase.kind === 'paused') {
    clearTimeout(phase.timer);
    drop([...phase.calls, ...phase.late]);
    return { ...phase, calls: [], late: [] };
  }
  return phase;
}

function drop(calls: ParkedCall[]): void {
  forget(calls);
  for (const call of calls) call.resolve(ENDED_RESULT);
}
