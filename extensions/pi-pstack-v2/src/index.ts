import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ExtensionAPI, type ExtensionContext, getAgentDir, stripFrontmatter } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { z } from 'zod';
import { claimWake, exitPath, type Job, type JobSpec, launch, list, newJobId, outputPath, read, stop, tail, tmuxSocket } from './jobs.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLL_MS = 2000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const RAW_OUTPUT_TAIL_LINES = 60;
const DEFAULT_OUTPUT_LINES = 80;
const DEFAULT_WAIT_SECONDS = 300;

export const modelsFile = (agentDir: string): string => join(agentDir, 'pstack-v2-models.md');
const jobsRoot = (): string => join(getAgentDir(), 'pstack-v2', 'jobs');
// A plain string enum, which every provider accepts, typed for TypeBox inference.
const stringEnum = <T extends readonly string[]>(values: T, description?: string) => Type.Unsafe<T[number]>({ type: 'string', enum: [...values], ...(description ? { description } : {}) });
const tmuxRunParameters = Type.Object({
  name: Type.String({ description: 'Short label, such as "watch-pr-123" or "dev-server".' }),
  command: Type.String({ description: 'Shell command, run with bash -c.' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory, relative to this session cwd. Default this session cwd.' })),
  wake: Type.Optional(Type.String({ description: 'Message to wake this session with when the command exits. Omit for a server you will stop yourself.' })),
  repeat: Type.Optional(Type.Boolean({ description: 'Restart the command after each clean exit and wake each time. Requires wake. Stop it with tmux_jobs stop.' })),
});
const tmuxJobsParameters = Type.Object({
  action: stringEnum(['list', 'output', 'wait', 'stop'] as const),
  ids: Type.Optional(Type.Array(Type.String(), { description: 'Job ids. Required for output and stop.' })),
  lines: Type.Optional(Type.Number({ description: 'Lines of output. Default 80.' })),
  timeout_seconds: Type.Optional(Type.Number({ description: 'Longest wait. Default 300.' })),
});
// Mirror the TypeBox parameters, which Pi checks before a tool runs, so these accept exactly the calls that reach it.
// Each tool validates with them and keeps Pi's own params object, so every key and its order reach the tool unchanged.
export const TmuxRunParamsSchema = z.looseObject({ name: z.string(), command: z.string(), cwd: z.string().optional(), wake: z.string().optional(), repeat: z.boolean().optional() });
export const TmuxJobsParamsSchema = z.looseObject({ action: z.enum(['list', 'output', 'wait', 'stop']), ids: z.array(z.string()).optional(), lines: z.number().optional(), timeout_seconds: z.number().optional() });
export { tmuxJobsParameters, tmuxRunParameters };

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }], details: undefined });

const skillsHint = `pstack skills, including ones hidden from the skill list, live at ${join(packageRoot, 'skills')}/<name>/SKILL.md. When a skill says to run another skill, read that file and follow it.`;
// A mode keeps a skill in context every turn. Pi rebuilds the system prompt each turn, so the skill rides there.
const MODE = 'pstack-mode';
const skillsDir = join(packageRoot, 'skills');
const skillNames = readdirSync(skillsDir).filter((name) => existsSync(join(skillsDir, name, 'SKILL.md')));
const modeSection = (name: string): string => {
  const file = join(skillsDir, name, 'SKILL.md');
  return `The user turned on ${name} mode with /pstack-mode. Follow this skill on every turn until the user turns it off with /pstack-mode off or switches modes. Do not drift back to default agent behavior.\n\n<skill name="${name}" location="${file}">\nReferences are relative to ${dirname(file)}.\n\n${stripFrontmatter(readFileSync(file, 'utf8')).trim()}\n</skill>`;
};

const duration = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / MS_PER_SECOND));
  return seconds < SECONDS_PER_MINUTE ? `${seconds}s` : `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ${seconds % SECONDS_PER_MINUTE}s`;
};

function report(job: Job): string {
  const exit = exitPath(job.dir);
  const took = existsSync(exit) ? ` (${duration(statSync(exit).mtimeMs - Date.parse(job.spec.createdAt))})` : '';
  const state = job.status.state === 'exited' ? `exited with code ${job.status.code}` : 'was lost (its tmux session ended without an exit code)';
  return [`tmux job ${job.spec.name} (${job.spec.id}) ${state}${took}. Raw output: ${outputPath(job.dir)}`, job.spec.wake ?? '', `<output>\n${tail(outputPath(job.dir), RAW_OUTPUT_TAIL_LINES).trim()}\n</output>`]
    .filter(Boolean)
    .join('\n\n');
}

function describe(job: Job): string {
  const state = job.status.state === 'exited' ? `exited ${job.status.code}` : job.status.state;
  const attach = job.status.state === 'running' ? `\n  attach: tmux -S ${job.spec.socket} attach -t ${job.spec.id}` : '';
  return `${job.spec.id}  ${state}  ${job.spec.name}\n  follow: tail -f ${outputPath(job.dir)}${attach}`;
}

type Waiter = { signal: AbortSignal | undefined; update: ((partial: ReturnType<typeof text>) => void) | undefined; ctx: ExtensionContext };

/** Polls until no job runs, the deadline passes, or the user sends a message, so they are never shut out until the timeout. */
async function blockWhileRunning(current: () => Job[], deadline: number, { signal, update, ctx }: Waiter): Promise<void> {
  const running = (): number => current().filter((job) => job.status.state === 'running').length;
  while (running() > 0 && Date.now() < deadline && !signal?.aborted && !ctx.hasPendingMessages()) {
    update?.(text(`Waiting on ${running()} job(s)...`));
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

const outputOf = (job: Job, lines: number): string => `${describe(job)}\n${tail(outputPath(job.dir), lines)}`;

/** A heartbeat or a server never stops on its own, so waiting on everything leaves them out. */
const waitableIds = (root: string, owner: string): string[] =>
  list(root, owner)
    .filter((job) => job.status.state === 'running' && !job.spec.repeat && job.spec.wake !== null)
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

/** Mutable session state, held as rebound closure variables so each extension instance keeps its own. */
type PstackState = {
  stoppedSeries: () => ReadonlySet<string>;
  stopSeries: (ids: Iterable<string>) => void;
  awaited: () => ReadonlySet<string>;
  await: (ids: readonly string[]) => void;
  release: (ids: readonly string[]) => void;
  settling: () => boolean;
  setSettling: (value: boolean) => void;
  mode: () => string | undefined;
  setMode: (value: string | undefined) => void;
  watcher: () => ReturnType<typeof setInterval> | undefined;
  setWatcher: (value: ReturnType<typeof setInterval> | undefined) => void;
};

function createState(): PstackState {
  // Jobs a tmux_jobs wait call is blocking on. Their report goes back as that call's result, not as a wake.
  let awaited: ReadonlySet<string> = new Set();
  let stoppedSeries: ReadonlySet<string> = new Set();
  // While a print-mode run settles, agent_before_settle delivers the reports itself.
  let settling = false;
  let mode: string | undefined;
  let watcher: ReturnType<typeof setInterval> | undefined;
  return {
    stoppedSeries: () => stoppedSeries,
    stopSeries: (ids) => {
      stoppedSeries = new Set([...stoppedSeries, ...ids]);
    },
    awaited: () => awaited,
    await: (ids) => {
      awaited = new Set([...awaited, ...ids]);
    },
    release: (ids) => {
      awaited = new Set([...awaited].filter((id) => !ids.includes(id)));
    },
    settling: () => settling,
    setSettling: (value) => {
      settling = value;
    },
    mode: () => mode,
    setMode: (value) => {
      mode = value;
    },
    watcher: () => watcher,
    setWatcher: (value) => {
      watcher = value;
    },
  };
}

// Reports a finished job whose wake was just claimed, restarting it first when it is a heartbeat that exited cleanly.
const finish = (state: PstackState, job: Job): string => {
  if (!job.spec.repeat) return report(job);
  // A heartbeat repeats only while it exits cleanly, so a failing command cannot wake the session in a tight loop.
  if (job.status.state !== 'exited' || job.status.code !== 0) return `${report(job)}\n\nThis heartbeat did not exit cleanly, so it was not restarted.`;
  try {
    if (state.stoppedSeries().has(job.spec.series)) return report(job);
    launch(jobsRoot(), { ...job.spec, id: newJobId(job.spec.name), createdAt: new Date().toISOString() });
    return report(job);
  } catch (error) {
    return `${report(job)}\n\nThis heartbeat could not be restarted: ${error instanceof Error ? error.message : String(error)}`;
  }
};

/** The job's directory, from the model's cwd, which tmux needs to exist. */
function workingDir(base: string, cwd: string | undefined): string {
  const dir = resolve(base, cwd ?? '.');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`cwd ${dir} is not a directory.`);
  return dir;
}

const interactive = (ctx: ExtensionContext): boolean => ctx.mode === 'tui' || ctx.mode === 'rpc';

const deliverFinished = (pi: ExtensionAPI, state: PstackState, ctx: ExtensionContext): void => {
  const jobs = list(jobsRoot(), ctx.sessionManager.getSessionId());
  for (const job of jobs) {
    if (job.spec.wake === null || job.status.state === 'running' || state.awaited().has(job.spec.id) || !claimWake(job)) continue;
    pi.sendMessage({ customType: 'pstack-job', content: finish(state, job), display: true }, { triggerTurn: true, deliverAs: 'steer' });
  }
  if (ctx.hasUI) {
    const running = jobs.filter((job) => job.status.state === 'running').length;
    ctx.ui.setStatus('pstack', running ? `tmux jobs: ${running} running` : undefined);
  }
};

const tick = (pi: ExtensionAPI, state: PstackState, ctx: ExtensionContext): void => {
  if (!interactive(ctx) && (state.settling() || ctx.isIdle())) return;
  try {
    deliverFinished(pi, state, ctx);
  } catch (error) {
    if (ctx.hasUI) ctx.ui.notify(`pstack job watcher: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
};

/** Ends the session's tmux server; false when it started no jobs and so had none. */
function killTmuxServer(socket: string): boolean {
  return spawnSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' }).status === 0;
}

function registerWatcher(pi: ExtensionAPI, state: PstackState): void {
  pi.on('session_start', async (_event, ctx) => {
    restoreMode(state, ctx);
    clearInterval(state.watcher());
    state.setWatcher(setInterval(() => tick(pi, state, ctx), POLL_MS));
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    clearInterval(state.watcher());
    state.setWatcher(undefined);
    // A print-mode worker's leftover jobs, such as a dev server it never stopped, end with it.
    if (interactive(ctx)) return;
    killTmuxServer(tmuxSocket(ctx.sessionManager.getSessionId()));
  });

  // A print-mode run would exit while its jobs still run, so it waits for them and continues with their reports.
  pi.on('agent_before_settle', async (event, ctx) => {
    if (interactive(ctx)) return;
    const owner = ctx.sessionManager.getSessionId();
    const pending = () => list(jobsRoot(), owner).filter((job) => job.spec.wake !== null && !job.spec.repeat && !existsSync(join(job.dir, 'woken')));
    if (pending().length === 0) return;
    state.setSettling(true);
    try {
      while (pending().some((job) => job.status.state === 'running')) await new Promise((done) => setTimeout(done, POLL_MS));
      const finished = pending().filter(claimWake);
      return {
        entries: [...event.entries, ...finished.map((job) => ({ type: 'custom_message' as const, customType: 'pstack-job', content: finish(state, job), display: true }))],
        continue: true,
      };
    } finally {
      state.setSettling(false);
    }
  });
}

const showMode = (state: PstackState, ctx: ExtensionContext): void => {
  if (ctx.hasUI) ctx.ui.setStatus(MODE, state.mode() ? `mode: ${state.mode()}` : undefined);
};

// The mode lives on the session branch, so a resumed session or a /tree jump gets the mode that branch had.
const restoreMode = (state: PstackState, ctx: ExtensionContext): void => {
  const recorded = ctx.sessionManager.getBranch().reduce<string | undefined>((current, entry) => (entry.type === 'custom' && entry.customType === MODE ? (entry.data as { skill?: string } | undefined)?.skill : current), undefined);
  state.setMode(recorded && skillNames.includes(recorded) ? recorded : undefined);
  showMode(state, ctx);
};

function registerModeCommand(pi: ExtensionAPI, state: PstackState): void {
  pi.registerCommand(MODE, {
    description: 'Keep a pstack skill in context every turn. /pstack-mode off ends it.',
    getArgumentCompletions: (prefix: string) => {
      const items = ['off', ...skillNames].filter((name) => name.startsWith(prefix)).map((name) => ({ value: name, label: name }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const name = z.string().parse(args).trim();
      if (!name) {
        const mode = state.mode();
        if (ctx.hasUI) ctx.ui.notify(mode ? `${mode} mode is on. /pstack-mode off ends it.` : 'No pstack mode is on. /pstack-mode <skill> starts one.', 'info');
        return;
      }
      if (name !== 'off' && !skillNames.includes(name)) {
        if (ctx.hasUI) ctx.ui.notify(`${name} is not a pstack skill. Pick one from /pstack-mode's completions.`, 'error');
        return;
      }
      state.setMode(name === 'off' ? undefined : name);
      pi.appendEntry(MODE, { skill: state.mode() });
      showMode(state, ctx);
    },
  });
  pi.on('session_tree', async (_event, ctx) => restoreMode(state, ctx));
}

function promptSections(transcript: string | undefined, mode: string | undefined): Record<string, string> {
  const models = modelsFile(getAgentDir());
  return {
    ...(transcript && {
      'pstack-session': `This session's transcript is ${transcript}. A worker cannot find this file by itself, so put the path in any brief that asks a worker to read the transcript.`,
    }),
    ...(mode && { [MODE]: modeSection(mode) }),
    ...(existsSync(models) && { 'pstack-models': `Role lines from ${models}, written by /skill:setup-pstack:\n${readFileSync(models, 'utf8').trim()}` }),
  };
}

// Pi 1.5.2 reads prompt additions only from the options object it passes in (runner.js emitBeforeAgentStart),
// so this is the one place that writes into a host-owned object.
function writeIntoHostPrompt(options: { promptGuidelines: string[]; sections: Record<string, string> }, guideline: string, sections: Record<string, string>): void {
  if (!options.promptGuidelines.includes(guideline)) options.promptGuidelines.push(guideline);
  Object.assign(options.sections, sections);
}

function registerPromptHook(pi: ExtensionAPI, state: PstackState): void {
  pi.on('before_agent_start', async (event, ctx) => {
    writeIntoHostPrompt(event.systemPromptOptions, skillsHint, promptSections(ctx.sessionManager.getSessionFile(), state.mode()));
  });
}

function registerTmuxRun(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'tmux_run',
    label: 'Run in tmux',
    description:
      'Run a shell command in its own tmux session instead of a background shell. Use it for watchers, dev servers, long builds, and heartbeat timers. With wake set, you are woken with that message and the output tail when the command exits. With repeat, the command restarts each time it exits cleanly, so `sleep 3600` plus a wake message is an hourly tick. The command reads no input.',
    promptSnippet: 'Run a long-lived or watched command in tmux and get woken when it exits',
    promptGuidelines: ['Use tmux_run for any command that would otherwise run in the background. Never background a command with &, nohup, setsid, or disown.'],
    parameters: tmuxRunParameters,
    async execute(_id, params, _signal, _update, ctx) {
      TmuxRunParamsSchema.parse(params);
      const input = params;
      if (input.repeat && input.wake === undefined) throw new Error('repeat needs a wake message, or nothing would ever notice the ticks.');
      const owner = ctx.sessionManager.getSessionId();
      const id = newJobId(input.name);
      const spec: JobSpec = {
        id,
        name: input.name,
        cwd: workingDir(ctx.cwd, input.cwd),
        command: ['bash', '-c', input.command],
        owner,
        wake: input.wake ?? null,
        repeat: input.repeat ?? false,
        series: id,
        socket: tmuxSocket(owner),
        createdAt: new Date().toISOString(),
      };
      return text(`Started ${describe(launch(jobsRoot(), spec))}`);
    },
  });
}

/** Blocks on the named jobs, or every waitable one, and reports each. */
async function waitFor(state: PstackState, root: string, owner: string, named: string[] | undefined, timeout: number | undefined, waiter: Waiter): Promise<string> {
  const ids = named?.length ? named : waitableIds(root, owner);
  const current = () => ids.map((id) => read(root, id, owner)).filter((job): job is Job => job !== undefined);
  state.await(ids);
  try {
    await blockWhileRunning(current, Date.now() + (timeout ?? DEFAULT_WAIT_SECONDS) * MS_PER_SECOND, waiter);
    // A job whose wake the watcher already delivered is reported plainly, without restarting a heartbeat twice.
    const reports = current().map((job) => (job.status.state === 'running' ? `${describe(job)}\n  still running` : claimWake(job) ? finish(state, job) : report(job)));
    return reports.join('\n\n') || 'No jobs to wait on.';
  } finally {
    state.release(ids);
  }
}

const jobOutputs = (jobs: Job[], lines: number): string => jobs.map((job) => outputOf(job, lines)).join('\n\n');

function registerTmuxJobs(pi: ExtensionAPI, state: PstackState): void {
  pi.registerTool({
    name: 'tmux_jobs',
    label: 'tmux jobs',
    description:
      "Inspect or control this session's tmux_run jobs. list shows every job with its state, a command to follow its output, and for a running job a command to attach to its tmux session, where the output shows live and Ctrl-C stops it. output shows the last lines of a command or running job. wait blocks until the named jobs (default every running job with a wake) exit, the timeout passes, or the user sends a message, then returns their reports. A job with a wake reports on its own, so end your turn instead of waiting unless the wait is short. stop ends jobs, and every later run of a repeating one, and suppresses their wake.",
    parameters: tmuxJobsParameters,
    async execute(_id, params, signal, update, ctx) {
      TmuxJobsParamsSchema.parse(params);
      const input = params;
      const root = jobsRoot();
      const owner = ctx.sessionManager.getSessionId();
      const named = (): Job[] => namedJobs(root, owner, input.action, input.ids);
      if (input.action === 'list') {
        const jobs = list(root, owner);
        return text(jobs.length ? jobs.map(describe).join('\n') : 'No jobs in this session.');
      }
      if (input.action === 'output') return text(jobOutputs(named(), input.lines ?? DEFAULT_OUTPUT_LINES));
      if (input.action === 'wait') return text(await waitFor(state, root, owner, input.ids, input.timeout_seconds, { signal, update, ctx }));
      if (input.action !== 'stop') throw new Error(`Unknown action ${String(input.action)}`);
      const series = new Set(named().map((job) => job.spec.series));
      // Recorded before stopping, so a run that finishes meanwhile is not restarted into a run this stop misses.
      state.stopSeries(series);
      // Every run in the series, finished ones included, so a run that just exited is not restarted after the stop.
      const jobs = list(root, owner).filter((job) => series.has(job.spec.series));
      await Promise.all(jobs.map(stop));
      return text(`Stopped ${jobs.map((job) => job.spec.id).join(', ')}.`);
    },
  });
}

export default function pstack(pi: ExtensionAPI) {
  const state = createState();
  registerModeCommand(pi, state);
  registerWatcher(pi, state);
  registerPromptHook(pi, state);
  registerTmuxRun(pi);
  registerTmuxJobs(pi, state);
}
