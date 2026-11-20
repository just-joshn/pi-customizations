import { randomBytes } from 'node:crypto';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { ToolResult } from './results.ts';

export const WAKE_MESSAGE_TYPE = 'pstack-subagent';
const ID_BYTES = 3;

type Mode = { mode?: string };
type Running = { controller: AbortController; done: Promise<void> };

const interactive = (ctx: Mode): boolean => ctx.mode === 'tui' || ctx.mode === 'rpc';

const reportOf = (result: ToolResult): string =>
  result.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim() || '(no output)';

/**
 * Subagent calls that return a job id at once and report through a wake message when every worker finishes. An
 * interactive session is woken with a steering message. A print-mode Pi has no later turn to wake, so it collects
 * the reports and waits for them before it settles.
 */
export function createWakeJobs(pi: ExtensionAPI) {
  let running: ReadonlyMap<string, Running> = new Map();
  let undelivered: readonly string[] = [];

  const deliver = (ctx: Mode, content: string): void => {
    if (interactive(ctx)) {
      pi.sendMessage({ customType: WAKE_MESSAGE_TYPE, content, display: true }, { triggerTurn: true, deliverAs: 'steer' });
      return;
    }
    undelivered = [...undelivered, content];
  };

  const start = (wake: string, ctx: Mode, run: (signal: AbortSignal) => Promise<ToolResult>): string => {
    const id = `subagent-${randomBytes(ID_BYTES).toString('hex')}`;
    const controller = new AbortController();
    const done = (async (): Promise<void> => {
      const report = await run(controller.signal).then(reportOf, (error: unknown) => `Failed: ${error instanceof Error ? error.message : String(error)}`);
      running = new Map([...running].filter(([key]) => key !== id));
      deliver(ctx, `${wake}\n\nsubagent job ${id} finished.\n\n${report}`);
    })();
    running = new Map([...running, [id, { controller, done }]]);
    return id;
  };

  const stop = (id: string): boolean => {
    const job = running.get(id);
    job?.controller.abort();
    return job !== undefined;
  };

  const stopAll = (): void => {
    for (const job of running.values()) job.controller.abort();
  };

  /** Waits for every running job, then hands over the reports not yet delivered. */
  const settle = async (): Promise<readonly string[]> => {
    await Promise.all([...running.values()].map((job) => job.done));
    const reports = undelivered;
    undelivered = [];
    return reports;
  };

  return { start, stop, stopAll, settle };
}
