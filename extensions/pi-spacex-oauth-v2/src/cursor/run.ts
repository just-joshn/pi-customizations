import { randomUUID } from 'node:crypto';

import type { Run, RunResult, SDKCustomTool, SDKCustomToolResult, SDKJsonValue, SDKMessage } from '@cursor/sdk';
import type { JsonObject, Message, Tool, ToolResultMessage } from '@earendil-works/pi-ai';
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

/** Runs waiting on Pi tool results, by Pi tool call id. */
const parkedRuns = new Map<string, CursorRun>();

export const findParkedRun = (toolCallIds: string[]): CursorRun | undefined => {
  const runs = new Set(toolCallIds.map((id) => parkedRuns.get(id)));
  const [run] = runs;
  return runs.size === 1 ? run : undefined;
};

function toToolResult(result: ToolResultMessage | undefined): SDKCustomToolResult {
  if (!result) return { content: [{ type: 'text', text: 'Pi returned no result for this tool call.' }], isError: true };
  const content = result.content.map((c) => (c.type === 'text' ? { type: 'text' as const, text: c.text } : { type: 'image' as const, data: c.data, mimeType: c.mimeType }));
  return { content: content.length > 0 ? content : [{ type: 'text', text: '' }], isError: result.isError };
}

/**
 * One Cursor run bridged onto Pi turns. Cursor owns the agent loop, so when the model calls a Pi tool,
 * execute() parks the call: the current Pi turn ends with toolUse, and the run waits until Pi sends the
 * tool results in its next request, which resumes the run into a new turn.
 */
export class CursorRun {
  private turn: PiTurn | undefined;
  private backlog: SDKMessage[] = [];
  private parked: ParkedCall[] = [];
  private batchTimer: NodeJS.Timeout | undefined;
  private waitTimer: NodeJS.Timeout | undefined;
  private run: Run | undefined;
  private messages: Message[];
  private readonly outcome: RunOutcome;

  constructor(turn: PiTurn, messages: Message[], outcome: RunOutcome) {
    this.turn = turn;
    this.messages = messages;
    this.outcome = outcome;
  }

  /** Pi's tools as SDK custom tools whose execute() parks the call for Pi to run. */
  customTools(tools: Tool[]): Record<string, SDKCustomTool> {
    const entries = tools.map((tool): [string, SDKCustomTool] => [
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.parameters as Record<string, SDKJsonValue>,
        execute: (args) => new Promise((resolve) => this.park({ id: `call_${randomUUID()}`, name: tool.name, arguments: args as JsonObject, resolve })),
      },
    ]);
    return Object.fromEntries(entries);
  }

  start(run: Run, signal: AbortSignal | undefined): void {
    this.run = run;
    this.watch(signal, this.turn);
    void this.pump(run);
  }

  resume(turn: PiTurn, messages: Message[], results: ToolResultMessage[], signal: AbortSignal | undefined): void {
    clearTimeout(this.waitTimer);
    this.turn = turn;
    this.messages = messages;
    this.watch(signal, turn);
    const calls = this.parked;
    this.parked = [];
    for (const call of calls) {
      parkedRuns.delete(call.id);
      call.resolve(toToolResult(results.find((r) => r.toolCallId === call.id)));
    }
    const backlog = this.backlog;
    this.backlog = [];
    for (const event of backlog) this.handle(event);
  }

  /** Pi aborts one request at a time, so only the turn that request is streaming cancels the run. */
  private watch(signal: AbortSignal | undefined, turn: PiTurn | undefined): void {
    signal?.addEventListener('abort', () => this.turn === turn && void this.cancel(), { once: true });
  }

  private park(call: ParkedCall): void {
    this.parked = [...this.parked, call];
    clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(() => this.pause(), CURSOR_CONFIG.toolBatchMs);
  }

  private pause(): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = undefined;
    for (const call of this.parked) parkedRuns.set(call.id, this);
    turn.toolUse(this.parked.map(({ id, name, arguments: args }) => ({ id, name, arguments: args })));
    this.waitTimer = setTimeout(() => void this.cancel(), CURSOR_CONFIG.toolWaitMs);
  }

  private handle(event: SDKMessage): void {
    const turn = this.turn;
    if (!turn) {
      this.backlog = [...this.backlog, event];
      return;
    }
    if (event.type === 'assistant') {
      for (const block of event.message.content) if (block.type === 'text' && block.text) turn.text(block.text);
    } else if (event.type === 'thinking') {
      if (event.text) turn.thinking(event.text);
      if (event.thinking_duration_ms !== undefined) turn.closeBlock();
    }
  }

  private async pump(run: Run): Promise<void> {
    try {
      for await (const event of run.stream()) this.handle(event);
      this.settle(await run.wait());
    } catch (error) {
      console.error('Cursor run stream failed:', error);
      this.end(describeCursorError(error), false);
    }
  }

  private settle(result: RunResult): void {
    const turn = this.turn;
    if (result.status === 'finished' && turn) {
      this.cleanup();
      turn.finish('stop');
      this.outcome.finished(turn, this.messages);
      return;
    }
    this.end(result.status === 'cancelled' ? 'Cursor run was cancelled' : describeRunError(result.error, result.requestId), result.status === 'cancelled');
  }

  private end(message: string, aborted: boolean): void {
    this.cleanup();
    this.turn?.fail(message, aborted);
    this.turn = undefined;
    this.outcome.failed();
  }

  private async cancel(): Promise<void> {
    const run = this.run;
    if (run?.status !== 'running') return;
    await run.cancel().catch((error: unknown) => console.error('Cursor run cancel failed:', error));
    this.cleanup();
  }

  private cleanup(): void {
    clearTimeout(this.batchTimer);
    clearTimeout(this.waitTimer);
    const calls = this.parked;
    this.parked = [];
    for (const call of calls) {
      parkedRuns.delete(call.id);
      call.resolve({ content: [{ type: 'text', text: 'The run ended before Pi answered this tool call.' }], isError: true });
    }
  }
}
