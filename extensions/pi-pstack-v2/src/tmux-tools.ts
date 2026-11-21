import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { StringEnum } from '@earendil-works/pi-ai';
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { z } from 'zod';
import { resolveGondolinConfig, SHARED_BUILD_CACHE_FLAG } from './gondolin/config.ts';
import { buildCacheEnv, ensureSharedBuildCacheDir, sharedBuildCacheHostDir } from './gondolin/shared-cache.ts';
import { hostEnv } from './host-env.ts';
import { claimWake, createJobSpec, isOneShotWakeJob, type Job, jobFiles, launch, list, read, tail } from './jobs.ts';
import { type OutputNotificationConfig, validateOutputNotificationConfig } from './output-notify.ts';
import { finish, type JobWatch, jobsRoot, POLL_MS, report, sleep, stopRuns } from './watcher.ts';

const MS_PER_SECOND = 1000;
const DEFAULT_OUTPUT_LINES = 80;
const DEFAULT_WAIT_SECONDS = 300;

const tmuxRunParameters = Type.Object({
  name: Type.String({ description: 'Short label, such as "watch-pr-123" or "dev-server".' }),
  command: Type.String({ description: 'Shell command, run with bash -c.' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory, relative to this session cwd. Default this session cwd.' })),
  wake: Type.Optional(Type.String({ description: 'Message to wake this session with when the command exits. Omit for a server you will stop yourself.' })),
  repeat: Type.Optional(Type.Boolean({ description: 'Restart the command after each clean exit and wake each time. Requires wake. Stop it with tmux_jobs stop.' })),
  notify_on_output: Type.Optional(
    Type.Object({
      pattern: Type.String({ description: 'Regular expression (multiline) matched against new output lines. Each match wakes this session.' }),
      reason: Type.Optional(Type.String({ description: 'Why you are watching, shown as the notification title.' })),
      debounce_seconds: Type.Optional(Type.Number({ description: 'Batch later matches for at least this long. Minimum and default 5.' })),
      notification_limit: Type.Optional(Type.Number({ description: 'Stop notifying after this many matches. Default 100.' })),
    }),
  ),
});
const tmuxJobsParameters = Type.Object({
  action: StringEnum(['list', 'output', 'wait', 'stop'] as const),
  ids: Type.Optional(Type.Array(Type.String(), { description: 'Job ids. Required for output and stop.' })),
  lines: Type.Optional(Type.Number({ description: 'Lines of output. Default 80.' })),
  timeout_seconds: Type.Optional(Type.Number({ description: 'Longest wait. Default 300.' })),
});
// Mirror the TypeBox parameters, which Pi checks before a tool runs, so these accept exactly the calls that reach it.
// StringEnum types its field as unknown, so the parsed shape names it.
const NotifyOnOutputSchema = z.object({ pattern: z.string(), reason: z.string().optional(), debounce_seconds: z.number().optional(), notification_limit: z.number().optional() });
const TmuxRunParamsSchema = z.looseObject({ name: z.string(), command: z.string(), cwd: z.string().optional(), wake: z.string().optional(), repeat: z.boolean().optional(), notify_on_output: NotifyOnOutputSchema.optional() });
const TmuxJobsParamsSchema = z.looseObject({ action: z.enum(['list', 'output', 'wait', 'stop']), ids: z.array(z.string()).optional(), lines: z.number().optional(), timeout_seconds: z.number().optional() });

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }], details: undefined });

function describe(job: Job): string {
  const state = job.status.state === 'exited' ? `exited ${job.status.code}` : job.status.state;
  const attach = job.status.state === 'running' ? `\n  attach: tmux -S ${job.spec.socket} attach -t ${job.spec.id}` : '';
  return `${job.spec.id}  ${state}  ${job.spec.name}\n  follow: tail -f ${jobFiles(job.dir).output}${attach}`;
}

const outputOf = (job: Job, lines: number): string => `${describe(job)}\n${tail(jobFiles(job.dir).output, lines)}`;

type Waiter = { signal: AbortSignal | undefined; update: ((partial: ReturnType<typeof text>) => void) | undefined; ctx: ExtensionContext };

/** Polls until no job runs, the deadline passes, or the user sends a message, so they are never shut out until the timeout. */
async function blockWhileRunning(current: () => Job[], deadline: number, { signal, update, ctx }: Waiter): Promise<void> {
  const running = (): number => current().filter((job) => job.status.state === 'running').length;
  while (running() > 0 && Date.now() < deadline && !signal?.aborted && !ctx.hasPendingMessages()) {
    update?.(text(`Waiting on ${running()} job(s)...`));
    await sleep(POLL_MS);
  }
}

/** A heartbeat, a server, or an output watcher never stops on its own, so waiting on everything leaves them out. */
const waitableIds = (root: string, owner: string): string[] =>
  list(root, owner)
    .filter((job) => job.status.state === 'running' && isOneShotWakeJob(job.spec))
    .map((job) => job.spec.id);

/** The jobs a tmux_jobs action named, each of which must belong to this session. */
function namedJobs(root: string, owner: string, action: string, ids: string[] | undefined): Job[] {
  if (!ids?.length) throw new Error(`${action} needs ids.`);
  return ids.map((id) => {
    const job = read(root, id, owner);
    if (!job) throw new Error(`No job ${id} in this session.`);
    return job;
  });
}

/** The job's directory, from the model's cwd, which tmux needs to exist. */
function workingDir(base: string, cwd: string | undefined): string {
  const dir = resolve(base, cwd ?? '.');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`cwd ${dir} is not a directory.`);
  return dir;
}

/** Host jobs share the Gondolin build caches when they are on, so sandboxed and unsandboxed commands reuse each other's downloads. */
function sharedCacheEnv(pi: ExtensionAPI, localCwd: string): Record<string, string> | undefined {
  const flag = typeof pi.getFlag === 'function' ? pi.getFlag(SHARED_BUILD_CACHE_FLAG) : undefined;
  const config = resolveGondolinConfig({ localCwd, agentDir: getAgentDir(), env: hostEnv(), flag });
  return config.enableSharedBuildCache ? { ...buildCacheEnv(ensureSharedBuildCacheDir(sharedBuildCacheHostDir()), { join }) } : undefined;
}

/** The validated notify_on_output config, in the job spec's camelCase shape, or undefined when none was given. */
function notifyConfig(input: z.infer<typeof NotifyOnOutputSchema> | undefined): OutputNotificationConfig | undefined {
  if (!input) return undefined;
  const config: OutputNotificationConfig = {
    pattern: input.pattern,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.debounce_seconds !== undefined ? { debounceSeconds: input.debounce_seconds } : {}),
    ...(input.notification_limit !== undefined ? { notificationLimit: input.notification_limit } : {}),
  };
  validateOutputNotificationConfig(config);
  return config;
}

function registerTmuxRun(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'tmux_run',
    label: 'Run in tmux',
    description:
      'Run a shell command in its own tmux session instead of a background shell. Use it for watchers, dev servers, long builds, and heartbeat timers. With wake set, you are woken with that message and the output tail when the command exits. With repeat, the command restarts each time it exits cleanly, so `sleep 3600` plus a wake message is an hourly tick. With notify_on_output, every line of output matching the pattern wakes you (the first at once, later ones batched at least 5 seconds apart, up to a limit), so a watcher can stay running and report events. The command reads no input.',
    promptSnippet: 'Run a long-lived or watched command in tmux and get woken when it exits',
    promptGuidelines: ['Use tmux_run for any command that would otherwise run in the background. Never background a command with &, nohup, setsid, or disown.'],
    parameters: tmuxRunParameters,
    async execute(_id, params, _signal, _update, ctx) {
      const input = TmuxRunParamsSchema.parse(params);
      if (input.repeat && input.wake === undefined) throw new Error('repeat needs a wake message, or nothing would ever notice the ticks.');
      const owner = ctx.sessionManager.getSessionId();
      const notifyOnOutput = notifyConfig(input.notify_on_output);
      const env = sharedCacheEnv(pi, ctx.cwd);
      const spec = createJobSpec({
        name: input.name,
        cwd: workingDir(ctx.cwd, input.cwd),
        shellCommand: input.command,
        owner,
        wake: input.wake ?? null,
        repeat: input.repeat ?? false,
        ...(env ? { env } : {}),
        ...(notifyOnOutput ? { notifyOnOutput } : {}),
      });
      return text(`Started ${describe(launch(jobsRoot(), spec))}`);
    },
  });
}

/** Blocks on the named jobs, or every waitable one, and reports each. */
async function waitFor(watch: JobWatch, root: string, owner: string, named: string[] | undefined, timeout: number | undefined, waiter: Waiter): Promise<string> {
  const ids = named?.length ? named : waitableIds(root, owner);
  const current = () => ids.map((id) => read(root, id, owner)).filter((job): job is Job => job !== undefined);
  watch.await(ids);
  try {
    await blockWhileRunning(current, Date.now() + (timeout ?? DEFAULT_WAIT_SECONDS) * MS_PER_SECOND, waiter);
    // A job whose wake the watcher already delivered is reported plainly, without restarting a heartbeat twice.
    const reports = current().map((job) => (job.status.state === 'running' ? `${describe(job)}\n  still running` : claimWake(job) ? finish(watch, job) : report(job)));
    return reports.join('\n\n') || 'No jobs to wait on.';
  } finally {
    watch.release(ids);
  }
}

function registerTmuxJobs(pi: ExtensionAPI, watch: JobWatch): void {
  pi.registerTool({
    name: 'tmux_jobs',
    label: 'tmux jobs',
    description:
      "Inspect or control this session's tmux_run jobs. list shows every job with its state, a command to follow its output, and for a running job a command to attach to its tmux session, where the output shows live and Ctrl-C stops it. output shows the last lines of a command or running job. wait blocks until the named jobs (default every running job with a wake) exit, the timeout passes, or the user sends a message, then returns their reports. A job with a wake reports on its own, so end your turn instead of waiting unless the wait is short. stop ends jobs, and every later run of a repeating one, and suppresses their wake.",
    parameters: tmuxJobsParameters,
    async execute(_id, params, signal, update, ctx) {
      const input = TmuxJobsParamsSchema.parse(params);
      const root = jobsRoot();
      const owner = ctx.sessionManager.getSessionId();
      const named = (): Job[] => namedJobs(root, owner, input.action, input.ids);
      if (input.action === 'list') {
        const jobs = list(root, owner);
        return text(jobs.length ? jobs.map(describe).join('\n') : 'No jobs in this session.');
      }
      if (input.action === 'output') {
        const lines = input.lines ?? DEFAULT_OUTPUT_LINES;
        const jobs = named();
        return text(jobs.map((job) => outputOf(job, lines)).join('\n\n'));
      }
      if (input.action === 'wait') return text(await waitFor(watch, root, owner, input.ids, input.timeout_seconds, { signal, update, ctx }));
      const stopped = await stopRuns(watch, owner, named());
      return text(`Stopped ${stopped.map((job) => job.spec.id).join(', ')}.`);
    },
  });
}

export function registerTmuxTools(pi: ExtensionAPI, watch: JobWatch): void {
  registerTmuxRun(pi);
  registerTmuxJobs(pi, watch);
}
