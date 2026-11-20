import { randomBytes } from 'node:crypto';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { frameSubagentReport } from './framing.ts';
import { createOutputLog } from './output-log.ts';
import { createBackgroundProgressTracker, type ProgressContext, subagentOutputPath } from './progress.ts';
import type { ToolResult } from './results.ts';

export const WAKE_MESSAGE_TYPE = 'pstack-subagent';
const ID_BYTES = 3;

type Mode = ProgressContext & { mode?: string };
type Update = (partial: ToolResult) => void;
export type JobRun = (signal: AbortSignal, onUpdate: Update) => Promise<ToolResult>;
type Running = { controller: AbortController; done: Promise<void> };

const interactive = (ctx: Mode): boolean => ctx.mode === 'tui' || ctx.mode === 'rpc';

const reportOf = (result: ToolResult): string =>
  result.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim() || '(no output)';

const formatWakeMessage = (wake: string, id: string, report: string, outputPath: string): string => `${wake}\n\nsubagent job ${id} finished.\n\n${frameSubagentReport(report)}\n\nOutput file: ${outputPath}`;

/** A new job's id and the file its log goes to. */
const newJobPaths = (): { id: string; outputPath: string } => {
  const id = `subagent-${randomBytes(ID_BYTES).toString('hex')}`;
  return { id, outputPath: subagentOutputPath(getAgentDir(), id) };
};

type Tracker = ReturnType<typeof createBackgroundProgressTracker>;

function recordUpdate(log: ReturnType<typeof createOutputLog>, progress: Tracker, id: string, partial: ToolResult): void {
  log.record(partial);
  progress.update(id, partial);
}

/** Aborts a job and says whether there was one. */
function abortJob(job: Running | undefined): boolean {
  job?.controller.abort();
  return job !== undefined;
}

const without = <V>(map: ReadonlyMap<string, V>, id: string): ReadonlyMap<string, V> => new Map([...map].filter(([key]) => key !== id));

async function runLogged(run: JobRun, signal: AbortSignal, onUpdate: Update, log: ReturnType<typeof createOutputLog>): Promise<string> {
  const result = await run(signal, onUpdate).then(
    (value) => ({ value, report: reportOf(value) }),
    (error: unknown) => ({ value: undefined, report: `Failed: ${error instanceof Error ? error.message : String(error)}` }),
  );
  if (result.value) log.record(result.value);
  log.finish(result.report);
  return result.report;
}

/**
 * Subagent calls that return a job id at once and report through a wake message when every worker finishes. An
 * interactive session is woken with a steering message. A print-mode Pi has no later turn to wake, so it collects
 * the reports and waits for them before it settles.
 */
export function createWakeJobs(pi: ExtensionAPI) {
  let running: ReadonlyMap<string, Running> = new Map();
  let undelivered: readonly string[] = [];
  const progress = createBackgroundProgressTracker();

  const deliver = (ctx: Mode, content: string): void => {
    if (interactive(ctx)) {
      pi.sendMessage({ customType: WAKE_MESSAGE_TYPE, content, display: true }, { triggerTurn: true, deliverAs: 'steer' });
      return;
    }
    undelivered = [...undelivered, content];
  };

  const start = (wake: string, ctx: Mode, run: JobRun, agents = ''): { id: string; outputPath: string } => {
    const { id, outputPath } = newJobPaths();
    const log = createOutputLog(outputPath, id);
    const controller = new AbortController();
    log.begin();
    progress.start(id, ctx, agents);
    const onUpdate: Update = (partial) => recordUpdate(log, progress, id, partial);
    const done = runLogged(run, controller.signal, onUpdate, log).then((report) => {
      running = without(running, id);
      progress.finish(id);
      deliver(ctx, formatWakeMessage(wake, id, report, outputPath));
      return undefined;
    });
    running = new Map([...running, [id, { controller, done }]]);
    return { id, outputPath };
  };

  const stop = (id: string): boolean => abortJob(running.get(id));

  const stopAll = (): void => {
    for (const job of running.values()) job.controller.abort();
  };

  const settle = async (): Promise<readonly string[]> => {
    await Promise.all([...running.values()].map((job) => job.done));
    const reports = undelivered;
    undelivered = [];
    return reports;
  };

  return { start, stop, stopAll, settle };
}
