import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { type ExtensionAPI, type ExtensionContext, getAgentDir } from '@earendil-works/pi-coding-agent';
import { claimWake, isOneShotWakeJob, type Job, jobFiles, launch, list, newJobId, stop, tail, tmuxSocket, wakeClaimed } from './jobs.ts';
import { pollOutputNotifications } from './output-notify.ts';

export const POLL_MS = 2000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const RAW_OUTPUT_TAIL_LINES = 60;

export const sleep = (ms: number): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

export const jobsRoot = (): string => join(getAgentDir(), 'pstack-v2', 'jobs');

const duration = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / MS_PER_SECOND));
  return seconds < SECONDS_PER_MINUTE ? `${seconds}s` : `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ${seconds % SECONDS_PER_MINUTE}s`;
};

/** The report a finished job wakes the session with: how it ended, its wake message, and the tail of its output. */
export function report(job: Job): string {
  const files = jobFiles(job.dir);
  const took = existsSync(files.exit) ? ` (${duration(statSync(files.exit).mtimeMs - Date.parse(job.spec.createdAt))})` : '';
  const state = job.status.state === 'exited' ? `exited with code ${job.status.code}` : 'was lost (its tmux session ended without an exit code)';
  return [`tmux job ${job.spec.name} (${job.spec.id}) ${state}${took}. Raw output: ${files.output}`, job.spec.wake ?? '', `<output>\n${tail(files.output, RAW_OUTPUT_TAIL_LINES).trim()}\n</output>`].filter(Boolean).join('\n\n');
}

/**
 * What the watcher and the tmux_jobs tool share, held as rebound closure variables so each extension instance keeps its own.
 * The ids a tmux_jobs wait is blocking on report as that call's result, not as a wake. A stopped series is never restarted.
 */
export type JobWatch = {
  isSeriesStopped: (series: string) => boolean;
  stopSeries: (ids: Iterable<string>) => void;
  isAwaited: (id: string) => boolean;
  await: (ids: readonly string[]) => void;
  release: (ids: readonly string[]) => void;
};

export function createJobWatch(): JobWatch {
  let awaited: ReadonlySet<string> = new Set();
  let stoppedSeries: ReadonlySet<string> = new Set();
  return {
    isSeriesStopped: (series) => stoppedSeries.has(series),
    stopSeries: (ids) => {
      stoppedSeries = new Set([...stoppedSeries, ...ids]);
    },
    isAwaited: (id) => awaited.has(id),
    await: (ids) => {
      awaited = new Set([...awaited, ...ids]);
    },
    release: (ids) => {
      awaited = new Set([...awaited].filter((id) => !ids.includes(id)));
    },
  };
}

// Reports a finished job whose wake was just claimed, restarting it first when it is a heartbeat that exited cleanly.
export const finish = (watch: JobWatch, job: Job): string => {
  if (!job.spec.repeat) return report(job);
  // A heartbeat repeats only while it exits cleanly, so a failing command cannot wake the session in a tight loop.
  if (job.status.state !== 'exited' || job.status.code !== 0) return `${report(job)}\n\nThis heartbeat did not exit cleanly, so it was not restarted.`;
  try {
    if (watch.isSeriesStopped(job.spec.series)) return report(job);
    launch(jobsRoot(), { ...job.spec, id: newJobId(job.spec.name), createdAt: new Date().toISOString() });
    return report(job);
  } catch (error) {
    return `${report(job)}\n\nThis heartbeat could not be restarted: ${error instanceof Error ? error.message : String(error)}`;
  }
};

/** Stops every run of the series each named job belongs to, finished runs included, so none is restarted after the stop. */
export async function stopRuns(watch: JobWatch, owner: string, named: readonly Job[]): Promise<readonly Job[]> {
  const series = new Set(named.map((job) => job.spec.series));
  // Recorded before stopping, so a run that finishes meanwhile is not restarted into a run this stop misses.
  watch.stopSeries(series);
  const jobs = list(jobsRoot(), owner).filter((job) => series.has(job.spec.series));
  await Promise.all(jobs.map(stop));
  return jobs;
}

const interactive = (ctx: ExtensionContext): boolean => ctx.mode === 'tui' || ctx.mode === 'rpc';

const sendJobMessage = (pi: ExtensionAPI, content: string): void => {
  pi.sendMessage({ customType: 'pstack-job', content, display: true }, { triggerTurn: true, deliverAs: 'steer' });
};

/** Wakes the session with each new output match of a job that watches its output; returns false while unread output remains. */
const deliverOutputMatches = (pi: ExtensionAPI, watch: JobWatch, job: Job): boolean => {
  if (job.spec.notifyOnOutput === undefined || wakeClaimed(job) || watch.isSeriesStopped(job.spec.series) || watch.isAwaited(job.spec.id)) return true;
  const { messages, done } = pollOutputNotifications(job);
  for (const content of messages) sendJobMessage(pi, content);
  if (done && job.spec.wake === null) claimWake(job);
  return done;
};

const deliverFinished = (pi: ExtensionAPI, watch: JobWatch, ctx: ExtensionContext): void => {
  const jobs = list(jobsRoot(), ctx.sessionManager.getSessionId());
  for (const job of jobs) {
    if (!deliverOutputMatches(pi, watch, job)) continue;
    if (job.spec.wake === null || job.status.state === 'running' || watch.isAwaited(job.spec.id) || !claimWake(job)) continue;
    sendJobMessage(pi, finish(watch, job));
  }
  if (ctx.hasUI) {
    const running = jobs.filter((job) => job.status.state === 'running').length;
    ctx.ui.setStatus('pstack', running ? `tmux jobs: ${running} running` : undefined);
  }
};

// While a print-mode run settles, agent_before_settle delivers the reports itself.
const tick = (pi: ExtensionAPI, watch: JobWatch, ctx: ExtensionContext, settling: boolean): void => {
  if (!interactive(ctx) && (settling || ctx.isIdle())) return;
  try {
    deliverFinished(pi, watch, ctx);
  } catch (error) {
    if (ctx.hasUI) ctx.ui.notify(`pstack job watcher: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
};

/** Ends the session's tmux server; false when it started no jobs and so had none. */
function killTmuxServer(socket: string): boolean {
  return spawnSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore', windowsHide: true }).status === 0;
}

export function registerWatcher(pi: ExtensionAPI, watch: JobWatch): void {
  let settling = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  pi.on('session_start', async (_event, ctx) => {
    clearInterval(timer);
    timer = setInterval(() => tick(pi, watch, ctx, settling), POLL_MS);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    clearInterval(timer);
    timer = undefined;
    // A print-mode worker's leftover jobs, such as a dev server it never stopped, end with it.
    if (interactive(ctx)) return;
    killTmuxServer(tmuxSocket(ctx.sessionManager.getSessionId()));
  });

  // A print-mode run would exit while its jobs still run, so it waits for them and continues with their reports.
  pi.on('agent_before_settle', async (event, ctx) => {
    if (interactive(ctx)) return undefined;
    const owner = ctx.sessionManager.getSessionId();
    const pending = () => list(jobsRoot(), owner).filter((job) => isOneShotWakeJob(job.spec) && !wakeClaimed(job));
    if (pending().length === 0) return undefined;
    settling = true;
    try {
      while (pending().some((job) => job.status.state === 'running')) {
        await sleep(POLL_MS);
      }
      const finished = pending().filter(claimWake);
      return {
        entries: [...event.entries, ...finished.map((job) => ({ type: 'custom_message' as const, customType: 'pstack-job', content: finish(watch, job), display: true }))],
        continue: true,
      };
    } finally {
      settling = false;
    }
  });
}
