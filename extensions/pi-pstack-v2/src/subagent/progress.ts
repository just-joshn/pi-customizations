import * as path from 'node:path';

import type { ToolResult } from './results.ts';

export const PROGRESS_KEY = 'pstack-subagent';
const THROTTLE_MS = 500;
const BUSY_THROTTLE_MS = 5000;
const BUSY_JOB_COUNT = 20;

/** Where a wake job's persistent JSONL log lives. */
export const subagentOutputPath = (agentDir: string, id: string): string => path.join(agentDir, 'pstack-v2', 'subagents', `${id}.output`);

export interface ProgressUi {
  setStatus?(key: string, text: string | undefined): void;
  setWidget?(key: string, lines: string[] | undefined): void;
}

export interface ProgressContext {
  hasUI?: boolean;
  ui?: ProgressUi;
}

export interface JobProgress {
  readonly id: string;
  readonly startedAt: number;
  readonly agents: string;
  readonly turns: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

const countToolCalls = (result: ToolResult): number =>
  (result.details?.results ?? []).reduce((total, worker) => total + worker.messages.reduce((sum, message) => (message.role === 'assistant' ? sum + message.content.filter((part) => part.type === 'toolCall').length : sum), 0), 0);

/** Reads the live numbers out of one snapshot of a job's workers. */
export function statsFrom(job: JobProgress, result: ToolResult): JobProgress {
  const workers = result.details?.results ?? [];
  const sum = (pick: (usage: (typeof workers)[number]['usage']) => number): number => workers.reduce((total, worker) => total + pick(worker.usage), 0);
  return {
    ...job,
    agents: [...new Set(workers.map((worker) => worker.agent))].join(',') || job.agents,
    turns: sum((usage) => usage.turns),
    toolCalls: countToolCalls(result),
    inputTokens: sum((usage) => usage.input),
    outputTokens: sum((usage) => usage.output),
  };
}

export const progressLine = (job: JobProgress): string => `${job.id} ${job.agents} ${job.turns}t ${job.toolCalls} tools ${job.inputTokens + job.outputTokens} tok`;

const newJob = (id: string, startedAt: number, agents: string): JobProgress => ({ id, startedAt, agents, turns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 });

/** Milliseconds until the next flush is due: the longer interval applies once many jobs are running. */
const flushWait = (jobCount: number, lastFlush: number, now: number): number => lastFlush + (jobCount > BUSY_JOB_COUNT ? BUSY_THROTTLE_MS : THROTTLE_MS) - now;

/** Writes the running jobs to the status line and widget, or clears both when none run. */
function publish(ui: ProgressUi | undefined, jobs: ReadonlyMap<string, JobProgress>): void {
  const running = jobs.size > 0;
  ui?.setStatus?.(PROGRESS_KEY, running ? `subagents: ${jobs.size} running` : undefined);
  ui?.setWidget?.(PROGRESS_KEY, running ? [...jobs.values()].map(progressLine) : undefined);
}

/** Shows running wake jobs in Pi's status line and widget, throttled, and clears both when the last job ends. */
export function createBackgroundProgressTracker(clock: () => number = Date.now) {
  let jobs: ReadonlyMap<string, JobProgress> = new Map();
  let target: ProgressContext | undefined;
  let lastFlush = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancelTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const flush = (): void => {
    cancelTimer();
    lastFlush = clock();
    publish(target?.hasUI ? target.ui : undefined, jobs);
  };

  const throttled = (): void => {
    const wait = flushWait(jobs.size, lastFlush, clock());
    if (wait <= 0) return flush();
    if (timer !== undefined) return;
    timer = setTimeout(flush, wait);
    timer.unref();
  };

  const start = (id: string, ctx: ProgressContext, agents = ''): void => {
    target = ctx;
    jobs = new Map([...jobs, [id, newJob(id, clock(), agents)]]);
    flush();
  };

  const update = (id: string, result: ToolResult): void => {
    const job = jobs.get(id);
    if (!job) return;
    jobs = new Map([...jobs, [id, statsFrom(job, result)]]);
    throttled();
  };

  const finish = (id: string): void => {
    jobs = new Map([...jobs].filter(([key]) => key !== id));
    flush();
  };

  return { start, update, finish, running: (): readonly JobProgress[] => [...jobs.values()] };
}

export type BackgroundProgressTracker = ReturnType<typeof createBackgroundProgressTracker>;
