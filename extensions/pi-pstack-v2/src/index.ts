import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ExtensionAPI, type ExtensionContext, getAgentDir, stripFrontmatter } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { jobAgentDir, makeJobAgentDir, syncTokens } from './credentials.ts';
import { claimWake, clip, excerpt, exitPath, type Job, type JobSpec, launch, list, newJobId, outputPath, read, request, stop, tail, tmuxSocket } from './jobs.ts';
import { JOB_DIR_ENV, SANDBOX_ENV, type SandboxPolicy, sandboxed, TOP_DIR_ENV } from './sandbox.ts';
import { gitPath, projectPath, protectedPaths } from './git.ts';
import { within } from './paths.ts';
import { serveRequests, sweepFor } from './requests.ts';
import { workerReport } from './transcript.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLL_MS = 2000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const STDERR_TAIL_LINES = 40;
const RAW_OUTPUT_TAIL_LINES = 60;
const DEFAULT_OUTPUT_LINES = 80;
const DEFAULT_WAIT_SECONDS = 300;
const REPORT_LIMIT = 20000;
// A report's first lines hold its verdict, so they are kept ahead of the end when a report is cut.
const REPORT_HEAD = 4000;

export const modelsFile = (agentDir: string): string => join(agentDir, 'pstack-v2-models.md');
const insideJob = (): boolean => process.env[SANDBOX_ENV] === '1';
const topJobsRoot = (): string => join(getAgentDir(), 'pstack-v2', 'jobs');
// A sandboxed worker can write only inside its own job directory's `nested/`, so the jobs it starts live there.
const jobsRoot = (env: Readonly<Record<string, string | undefined>> = process.env): string => {
  const parent = env[JOB_DIR_ENV];
  return env[SANDBOX_ENV] === '1' && parent ? join(parent, 'nested') : topJobsRoot();
};
// A plain string enum, which every provider accepts, typed for TypeBox inference.
const stringEnum = <T extends readonly string[]>(values: T, description?: string) => Type.Unsafe<T[number]>({ type: 'string', enum: [...values], ...(description ? { description } : {}) });
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
const SANDBOX_NOTE =
  'You run in the pstack sandbox. The shared /tmp, macOS per-user temp directory, and user caches are read-only. Keep temp files in $TMPDIR, your own temp directory. Chromium uses the same private directory through MAC_CHROMIUM_TMPDIR. Tools that ignore both variables cannot write shared temp files. `ps` and `top` are refused, so read the load with `uptime`. In a checkout you cannot write, a bash here-document fails, so `cd "$TMPDIR"` first or write the file with printf. Unix sockets are refused, so ssh-agent, gpg-agent, and git over SSH with agent-held keys fail: use an HTTPS remote (`gh auth setup-git`) or leave the push to the session that started you. Code that runs outside the sandbox later stays read-only: `.git/hooks` and git config, `.pi` extensions and settings, and editor and harness configuration (`.vscode`, `.idea`, `*.code-workspace`, `.cursorignore`, and `.cursor` and `.claude` apart from their rules, commands, worktrees, skills, and agents). Any such file you create anyway moves to quarantine when your job ends.';
const flagValue = (command: string[], flag: string): string | undefined => (command.includes(flag) ? command[command.indexOf(flag) + 1] : undefined);

const duration = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / MS_PER_SECOND));
  return seconds < SECONDS_PER_MINUTE ? `${seconds}s` : `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ${seconds % SECONDS_PER_MINUTE}s`;
};

function report(job: Job): string {
  const output = outputPath(job.spec.out);
  const transcript = job.spec.kind === 'pi' ? workerReport(flagValue(job.spec.command, '--session-dir'), job.spec.createdAt) : undefined;
  // The run's duration and tool-call count show at a glance a worker that spun or did nothing.
  const exit = exitPath(job.spec.out);
  const took = [existsSync(exit) ? duration(statSync(exit).mtimeMs - Date.parse(job.spec.createdAt)) : '', transcript ? `${transcript.toolCalls} tool calls` : ''].filter(Boolean).join(', ');
  const state = `${job.status.state === 'exited' ? `exited with code ${job.status.code}` : 'was lost (its tmux session ended without an exit code)'}${took ? ` (${took})` : ''}`;
  const answers = transcript?.answers ?? [];
  const body =
    answers.length && transcript
      ? clip(answers.join('\n\n[Later completed answer]\n\n'), REPORT_HEAD, REPORT_LIMIT - REPORT_HEAD, transcript.path)
      : job.spec.kind === 'pi'
        ? excerpt(output, REPORT_HEAD, REPORT_LIMIT - REPORT_HEAD)
        : tail(output, RAW_OUTPUT_TAIL_LINES);
  // A worker that fails at startup, such as on a bad model or credential, says why only on stderr.
  const failed = job.status.state !== 'exited' || job.status.code !== 0 || !body.trim();
  const errors = failed ? tail(join(job.spec.out, 'stderr.log'), STDERR_TAIL_LINES).trim() : '';
  return [
    `tmux job ${job.spec.name} (${job.spec.id}) ${state}. Raw output: ${output}`,
    transcript ? `Transcript: ${transcript.path}` : '',
    job.spec.wake ?? '',
    job.spec.kind === 'pi' && !answers.length ? '[No completed transcript answers available; showing raw stdout.]' : '',
    `<output>\n${body.trim()}\n</output>`,
    errors ? `<stderr>\n${errors}\n</stderr>` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function describe(job: Job): string {
  const state = job.status.state === 'exited' ? `exited ${job.status.code}` : job.status.state;
  const attach = job.spec.socket && job.status.state === 'running' ? `\n  attach: tmux -S ${job.spec.socket} attach -t ${job.spec.id}` : '';
  return `${job.spec.id}  ${job.spec.kind}  ${state}  ${job.spec.name}\n  follow: tail -f ${outputPath(job.spec.out)}${attach}`;
}

// A sandboxed worker asks the root Pi to launch for it on every platform, so nested jobs get the same sandbox everywhere
// and no job needs a tmux server of its own. macOS could not apply a second Seatbelt profile anyway.
const brokering = (): boolean => insideJob();

/** Starts a job under its own sandbox, or writes it as a request for the root Pi when this process cannot. */
function start(root: string, spec: JobSpec, files: Record<string, string> = {}, resolved: Record<string, string> = {}): Job {
  const jobDir = join(root, spec.id);
  // A job started from inside another uses its top-level job's agent directory, which that start already created.
  const top = insideJob() ? (process.env[TOP_DIR_ENV] ?? jobDir) : jobDir;
  if (!insideJob()) makeJobAgentDir(getAgentDir(), jobAgentDir(jobDir), resolved);
  // Every job gets a private temp directory, since the shared ones hold code unsandboxed programs load, and writes
  // credentials only to its top-level job's copy.
  // A command a worker starts shares the worker's temp directory, so a path the worker hands it under $TMPDIR exists for both.
  const parent = process.env[JOB_DIR_ENV];
  const tmp = insideJob() && parent && spec.kind === 'command' ? join(parent, 'tmp') : undefined;
  const sized: SandboxPolicy = { ...spec.policy, jobDir, credentials: jobAgentDir(top), writable: [...new Set([...spec.policy.writable, join(jobDir, 'tmp'), ...(tmp ? [tmp] : [])])] };
  // A writable path that holds Pi's agent directory would let the job rewrite Pi's own code and settings.
  const holder = sized.writable.find((path) => within(sized.agentDir, [path]));
  if (holder) throw new Error(`pstack will not let a job write ${holder}, because it contains Pi's agent directory ${sized.agentDir}. Run Pi from a project directory.`);
  spec = { ...spec, sweep: sweepFor(sized), ...(tmp ? { tmp } : {}) };
  const policy: SandboxPolicy = { ...sized, checkouts: spec.sweep.roots };
  // bubblewrap binds only paths that exist, so the private temp directory exists before the sandbox is built.
  mkdirSync(join(jobDir, 'tmp'), { recursive: true });
  if (brokering()) return request(root, { ...spec, policy }, files);
  return launch(root, { ...spec, policy, argv: sandboxed(spec.command, policy) }, files);
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

const outputOf = (job: Job, lines: number): string =>
  job.spec.kind === 'pi' && job.status.state !== 'running' ? report(job) : `${describe(job)}\n${tail(outputPath(job.spec.out), lines)}`;

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
    // The next run gets its own temp directory in place of this one's.
    const policy = { ...job.spec.policy, writable: job.spec.policy.writable.filter((path) => path !== join(job.dir, 'tmp')) };
    start(jobsRoot(), { ...job.spec, policy, id: newJobId(job.spec.name), brokered: false, createdAt: new Date().toISOString() });
    return report(job);
  } catch (error) {
    return `${report(job)}\n\nThis heartbeat could not be restarted: ${error instanceof Error ? error.message : String(error)}`;
  }
};

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

const serve = (ctx: ExtensionContext): void => {
  if (brokering()) return;
  const owner = ctx.sessionManager.getSessionId();
  for (const top of list(jobsRoot(), owner)) if (top.spec.kind === 'pi') serveRequests(top, tmuxSocket(owner), join(top.dir, 'nested'), top.status.state !== 'running');
};

// Carries refreshed OAuth tokens between your credentials and each top-level job's copy, once more after the job ends.
const syncCredentials = (ctx: ExtensionContext): void => {
  if (insideJob()) return;
  for (const job of list(jobsRoot(), ctx.sessionManager.getSessionId())) {
    const copy = jobAgentDir(job.dir);
    if (!existsSync(join(copy, 'auth.json')) || existsSync(join(job.dir, 'tokens-synced'))) continue;
    if (syncTokens(getAgentDir(), copy) && job.status.state !== 'running') writeFileSync(join(job.dir, 'tokens-synced'), '');
  }
};

// Each step runs on its own, so one failing does not stop the others.
const tick = (pi: ExtensionAPI, state: PstackState, ctx: ExtensionContext): void => {
  const deliverable = interactive(ctx) || (!state.settling() && !ctx.isIdle());
  for (const step of [() => syncCredentials(ctx), () => serve(ctx), () => deliverable && deliverFinished(pi, state, ctx)]) {
    try {
      step();
    } catch (error) {
      if (ctx.hasUI) ctx.ui.notify(`pstack job watcher: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }
};

/** Ends the session's tmux server; false when it started no jobs and so had none. */
function killTmuxServer(socket: string): boolean {
  try {
    execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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
      syncCredentials(ctx);
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
  const recorded = ctx.sessionManager
    .getBranch()
    .reduce<string | undefined>((current, entry) => (entry.type === 'custom' && entry.customType === MODE ? (entry.data as { skill?: string } | undefined)?.skill : current), undefined);
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
      const name = args.trim();
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

function registerPromptHook(pi: ExtensionAPI, state: PstackState): void {
  pi.on('before_agent_start', async (event, ctx) => {
    const options = event.systemPromptOptions;
    if (!options.promptGuidelines.includes(skillsHint)) Object.assign(options.promptGuidelines, [...options.promptGuidelines, skillsHint]);
    const transcript = ctx.sessionManager.getSessionFile();
    if (transcript)
      options.sections['pstack-session'] =
        `This session's transcript is ${transcript}. A worker's Pi agent directory is its job's own, so it cannot find this file by itself. Put the path in any brief that asks a worker to read the transcript.`;
    if (insideJob()) options.sections['pstack-sandbox'] = SANDBOX_NOTE;
    const models = modelsFile(getAgentDir());
    const mode = state.mode();
    if (mode) options.sections[MODE] = modeSection(mode);
    if (existsSync(models)) options.sections['pstack-models'] = `Role lines from ${models}, written by /skill:setup-pstack:\n${readFileSync(models, 'utf8').trim()}`;
  });
}

function registerTmuxRun(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'tmux_run',
    label: 'Run in tmux',
    description:
      'Run a shell command in its own tmux session, inside the pstack sandbox, instead of a background shell. Use it for watchers, dev servers, long builds, and heartbeat timers. With wake set, you are woken with that message and the output tail when the command exits. With repeat, the command restarts each time it exits cleanly, so `sleep 3600` plus a wake message is an hourly tick. The shared /tmp is read-only to the command, so it keeps temp files in $TMPDIR, its own temp directory. The command reads no input.',
    promptSnippet: 'Run a long-lived or watched command in tmux and get woken when it exits',
    promptGuidelines: ['Use tmux_run for any command that would otherwise run in the background. Never background a command with &, nohup, setsid, or disown.'],
    parameters: Type.Object({
      name: Type.String({ description: 'Short label, such as "watch-pr-123" or "dev-server".' }),
      command: Type.String({ description: 'Shell command, run with bash -c.' }),
      cwd: Type.Optional(Type.String({ description: 'Working directory inside this project. Default this session cwd. The command may write only here, in its git directory, and in temp directories.' })),
      wake: Type.Optional(Type.String({ description: 'Message to wake this session with when the command exits. Omit for a server you will stop yourself.' })),
      repeat: Type.Optional(Type.Boolean({ description: 'Restart the command after each clean exit and wake each time. Requires wake. Stop it with tmux_jobs stop.' })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      if (params.repeat && params.wake === undefined) throw new Error('repeat needs a wake message, or nothing would ever notice the ticks.');
      const root = jobsRoot();
      const id = newJobId(params.name);
      const owner = ctx.sessionManager.getSessionId();
      const cwd = projectPath(ctx, params.cwd);
      const common = gitPath(cwd, '--git-common-dir');
      const guarded = protectedPaths(cwd, common);
      const policy = { writable: [cwd, ...(common ? [common] : [])], protect: guarded.protect, lock: guarded.lock, gitDirs: guarded.gitDirs, checkouts: [], credentials: '', agentDir: getAgentDir(), jobDir: join(root, id) };
      const spec: JobSpec = {
        id,
        name: params.name,
        kind: 'command',
        cwd,
        argv: [],
        command: ['bash', '-c', params.command],
        policy,
        brokered: false,
        owner,
        wake: params.wake ?? null,
        repeat: params.repeat ?? false,
        series: id,
        socket: brokering() ? '' : tmuxSocket(owner),
        sweep: { roots: [], protect: [] },
        out: join(root, id),
        createdAt: new Date().toISOString(),
      };
      try {
        return text(`Started ${describe(start(root, spec))}`);
      } catch (error) {
        rmSync(join(root, id), { recursive: true, force: true });
        throw error;
      }
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

function registerTmuxJobs(pi: ExtensionAPI, state: PstackState): void {
  pi.registerTool({
    name: 'tmux_jobs',
    label: 'tmux jobs',
    description:
      "Inspect or control this session's tmux_run jobs. list shows every job with its state, a command to follow its output, and for a running job a command to attach to its tmux session, where the output shows live and Ctrl-C stops it. output shows the last lines of a command or running job. wait blocks until the named jobs (default every running job with a wake) exit, the timeout passes, or the user sends a message, then returns their reports. A job with a wake reports on its own, so end your turn instead of waiting unless the wait is short. stop ends jobs, and every later run of a repeating one, and suppresses their wake.",
    parameters: Type.Object({
      action: stringEnum(['list', 'output', 'wait', 'stop'] as const),
      ids: Type.Optional(Type.Array(Type.String(), { description: 'Job ids. Required for output and stop.' })),
      lines: Type.Optional(Type.Number({ description: 'Lines for raw output. Exited Pi workers show their completed answers instead. Default 80.' })),
      timeout_seconds: Type.Optional(Type.Number({ description: 'Longest wait. Default 300.' })),
    }),
    async execute(_id, params, signal, update, ctx) {
      const root = jobsRoot();
      const owner = ctx.sessionManager.getSessionId();
      const named = (): Job[] => namedJobs(root, owner, params.action, params.ids);
      if (params.action === 'list') {
        const jobs = list(root, owner);
        return text(jobs.length ? jobs.map(describe).join('\n') : 'No jobs in this session.');
      }
      if (params.action === 'output') return text(named().map((job) => outputOf(job, params.lines ?? DEFAULT_OUTPUT_LINES)).join('\n\n'));
      if (params.action === 'wait') return text(await waitFor(state, root, owner, params.ids, params.timeout_seconds, { signal, update, ctx }));
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
