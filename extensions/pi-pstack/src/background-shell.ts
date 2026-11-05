// Cursor's background shell: a command that keeps running while the agent works, an output file with a status
// header and an exit footer, a notification when the command finishes or prints a watched line, and AwaitShell to
// poll or wait. Texts follow what Cursor CLI 2026.10.22 returns and sends (parity/pstack-native-parity-2026-11-04).
import { type ChildProcess, spawn } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, statSync, writeSync } from 'node:fs';
import { constants } from 'node:os';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getShellConfig, truncateTail } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import { isOneShot } from './modes.ts';
import { firstMatcher, OutputWatchDependencyError, type OutputWatchRequest, ShellOutputWatch } from './shell-output-watch.ts';

export const SHELL_NOTICE_TYPE = 'pstack/shell';
const BACKGROUND_TOOL = 'bash_background';
const AWAIT_TOOL = 'AwaitShell';

const FIELD_WIDTH = 9;
const HEADER_REFRESH_MS = 5_000;
const DEFAULT_AWAIT_MS = 30_000;
const MAX_AWAIT_MS = 7_140_000;
const KILL_GRACE_MS = 2_000;
const FOLLOW_UP = 'Briefly inform the user about the task result and perform any follow-up actions (if needed).';

type JobStatus = 'running' | 'succeeded' | 'failed' | 'aborted';
type NoticeStatus = 'success' | 'error' | 'aborted';

interface ShellJob {
  readonly id: string;
  readonly pid: number;
  readonly command: string;
  readonly cwd: string;
  readonly title: string;
  readonly toolCallId: string;
  readonly path: string;
  readonly startedAt: number;
  readonly fd: number;
  readonly headerBytes: number;
  readonly statusOffset: number;
  readonly runningOffset: number;
  readonly child: ChildProcess;
  readonly watch: ShellOutputWatch | undefined;
  readonly listeners: Set<() => void>;
  readonly done: Promise<void>;
  /** Where the next output byte goes; the header is rewritten in place, so the file is never opened for append. */
  size: number;
  /** Where the output ends once the footer is written. */
  bodyEnd: number | undefined;
  status: JobStatus;
  exitCode: number | undefined;
  endedAt: number | undefined;
  /** AwaitShell or a foreground wait saw the end, so no completion notification follows. */
  observed: boolean;
  /** Waits in progress (AwaitShell or a foreground wait); one of them reports the end instead of a notification. */
  awaiting: number;
  refresh: ReturnType<typeof setInterval> | undefined;
}

export interface ShellNotice {
  kind: 'progress' | 'finished';
  status: NoticeStatus;
  taskId: string;
  shellId: string;
  title: string;
  toolCallId: string;
  detail?: string;
  outputPath?: string;
}

const pad = (value: string) => value.padEnd(FIELD_WIDTH, ' ');

/** The header Cursor writes: fixed-width status and running time, so both can be rewritten in place. */
export function terminalHeader(fields: { pid: number; cwd: string; command: string; title: string; startedAt: number }): { text: string; statusOffset: number; runningOffset: number } {
  const before = ['---', `pid: ${fields.pid}`, `cwd: ${JSON.stringify(fields.cwd)}`, `command: ${JSON.stringify(fields.command)}`, `title: ${JSON.stringify(fields.title)}`, 'status: '].join('\n');
  const middle = `${pad('running')}\nstarted_at: ${new Date(fields.startedAt).toISOString()}\nrunning_for_ms: `;
  const text = `${before}${middle}${pad('0')}\n---\n`;
  const statusOffset = Buffer.byteLength(before);
  return { text, statusOffset, runningOffset: statusOffset + Buffer.byteLength(middle) };
}

export function terminalFooter(exitCode: number, elapsedMs: number, endedAt: number): string {
  return `\n---\nexit_code: ${exitCode}\nelapsed_ms: ${elapsedMs}\nended_at: ${new Date(endedAt).toISOString()}\n---\n`;
}

export function launchText(job: Pick<ShellJob, 'id' | 'pid' | 'command' | 'path'>): string {
  return ['Background command started successfully.', `Shell ID: ${job.id}`, `PID: ${job.pid}`, `Command: ${job.command}`, `Output will be written to ${job.path}. Don't mention Shell ID to the user.`].join('\n');
}

export function movedText(job: Pick<ShellJob, 'id' | 'pid' | 'path'>, waitedMs: number, output: string): string {
  return [
    `The command did not complete in ${waitedMs}ms and was sent to the background.`,
    `Shell ID: ${job.id}`,
    `PID: ${job.pid}`,
    `The output is being written to ${job.path}. Don't mention Shell ID to the user.`,
    '',
    'Output collected before backgrounding:',
    '',
    '```',
    tail(output, job.path),
    '```',
  ].join('\n');
}

export function finishedText(exitCode: number, elapsedMs: number, output: string, path: string): string {
  return [`Exit code: ${exitCode}`, '', 'Command output:', '', '```', tail(output, path), '```', '', `Command completed in ${elapsedMs} ms.`].join('\n');
}

function tail(output: string, path: string): string {
  const result = truncateTail(output);
  return result.truncated ? `[showing the last ${result.outputLines} of ${result.totalLines} lines; the full output is in ${path}]\n${result.content}` : output;
}

export function noticeText(notice: ShellNotice): string {
  return [
    '<system_notification>',
    `The following task has ${notice.kind === 'finished' ? 'finished' : 'notified'}. If you were already aware, ignore this notification and do not restate prior responses.`,
    '',
    '<task>',
    'kind: shell',
    `status: ${notice.status}`,
    `task_id: ${notice.taskId}`,
    `title: ${notice.title}`,
    `tool_call_id: ${notice.toolCallId}`,
    ...(notice.detail === undefined ? [] : [`detail: ${notice.detail}`]),
    ...(notice.outputPath === undefined ? [] : [`output_path: ${notice.outputPath}`]),
    '</task>',
    '</system_notification>',
    FOLLOW_UP,
  ].join('\n');
}

function exitStatus(code: number | null, signal: NodeJS.Signals | null): { status: JobStatus; exitCode: number } {
  if (signal !== null) return { status: 'aborted', exitCode: 128 + (constants.signals[signal] ?? 0) };
  const exitCode = code ?? 1;
  return { status: exitCode === 0 ? 'succeeded' : 'failed', exitCode };
}

function compile(pattern: string): (text: string) => string | undefined {
  try {
    return firstMatcher(pattern);
  } catch (error) {
    if (error instanceof OutputWatchDependencyError) throw error;
    throw new Error(`Invalid pattern /${pattern}/: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sessionEnv(ctx: ExtensionContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PI_SESSION_ID: ctx.sessionManager.getSessionId() };
  const file = ctx.sessionManager.getSessionFile();
  if (file !== undefined) env['PI_SESSION_FILE'] = file;
  if (ctx.model !== undefined) {
    env['PI_PROVIDER'] = ctx.model.provider;
    env['PI_MODEL'] = ctx.model.id;
  }
  return env;
}

/** Process groups of running jobs, killed if this process exits before a session shutdown could stop them. */
const liveGroups = new Set<number>();
let exitHookInstalled = false;
function trackGroup(pid: number): void {
  liveGroups.add(pid);
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const group of liveGroups) signalGroupId(group, 'SIGKILL');
  });
}

function signalGroupId(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
  } catch {
    // The process group is already gone.
  }
}

const sleep = (ms: number, signal: AbortSignal | undefined) =>
  new Promise<void>((done) => {
    if (signal?.aborted === true) return done();
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      done();
    }
    signal?.addEventListener('abort', finish, { once: true });
  });

export interface ShellJobsOptions {
  terminalsDir: (ctx: ExtensionContext) => string;
  shellPath: () => string | undefined;
}

export interface StartRequest {
  command: string;
  cwd: string;
  title: string;
  toolCallId: string;
  watch?: OutputWatchRequest;
}

/** Every background shell this runtime started, and the notifications they owe the agent. */
export function createShellJobs(options: ShellJobsOptions, deliver: (notice: ShellNotice) => void) {
  const jobs = new Map<string, ShellJob>();
  let nextId: number | undefined;

  const allocateId = (dir: string): string => {
    nextId ??= 100_000 + Math.floor(Math.random() * 800_000);
    while (existsSync(join(dir, `${nextId}.txt`))) nextId += 1;
    const id = String(nextId);
    nextId += 1;
    return id;
  };

  const writeAt = (job: ShellJob, text: string, position: number) => {
    const bytes = Buffer.from(text, 'utf8');
    writeSync(job.fd, bytes, 0, bytes.length, position);
  };
  const append = (job: ShellJob, text: string | Buffer) => {
    const bytes = typeof text === 'string' ? Buffer.from(text, 'utf8') : text;
    writeSync(job.fd, bytes, 0, bytes.length, job.size);
    job.size += bytes.length;
  };
  const refreshRunning = (job: ShellJob) => writeAt(job, pad(String((job.endedAt ?? Date.now()) - job.startedAt)), job.runningOffset);
  const notify = (job: ShellJob) => {
    for (const listener of [...job.listeners]) listener();
  };

  const finish = (job: ShellJob, status: JobStatus, exitCode: number, announce: boolean) => {
    if (job.status !== 'running') return;
    const endedAt = Date.now();
    Object.assign(job, { status, exitCode, endedAt, observed: job.observed || job.awaiting > 0 });
    if (job.refresh !== undefined) clearInterval(job.refresh);
    writeAt(job, pad(status), job.statusOffset);
    refreshRunning(job);
    job.bodyEnd = job.size;
    append(job, terminalFooter(exitCode, endedAt - job.startedAt, endedAt));
    closeSync(job.fd);
    job.watch?.finish(announce);
    if (announce) {
      if (!job.observed) {
        const noticeStatus: NoticeStatus = status === 'succeeded' ? 'success' : status === 'failed' ? 'error' : 'aborted';
        deliver({
          kind: 'finished',
          status: noticeStatus,
          taskId: job.id,
          shellId: job.id,
          title: job.title,
          toolCallId: job.toolCallId,
          ...(noticeStatus === 'error' ? { detail: `exit_code=${exitCode}` } : {}),
        });
      }
    }
    notify(job);
  };

  const start = (ctx: ExtensionContext, request: StartRequest): ShellJob => {
    if (!existsSync(request.cwd) || !statSync(request.cwd).isDirectory()) throw new Error(`Working directory ${request.cwd} does not exist.`);
    const dir = options.terminalsDir(ctx);
    mkdirSync(dir, { recursive: true });
    const id = allocateId(dir);
    const path = join(dir, `${id}.txt`);
    let watch: ShellOutputWatch | undefined;
    if (request.watch !== undefined && request.watch.pattern.trim() !== '') {
      try {
        watch = new ShellOutputWatch(request.watch, (notice) => {
          deliver({ kind: 'progress', status: 'success', taskId: `${id}:task_progress:${notice.sequence}`, shellId: id, title: notice.title, toolCallId: request.toolCallId, detail: notice.detail, outputPath: path });
        });
      } catch (error) {
        if (error instanceof OutputWatchDependencyError) throw error;
        console.warn('Invalid shell output notification pattern', { shellId: id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const config = getShellConfig(options.shellPath());
    const viaStdin = config.commandTransport === 'stdin';
    const child = spawn(config.shell, viaStdin ? config.args : [...config.args, request.command], {
      cwd: request.cwd,
      env: sessionEnv(ctx),
      detached: process.platform !== 'win32',
      stdio: [viaStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let spawnError: Error | undefined;
    child.once('error', (error) => {
      spawnError = error;
    });
    if (viaStdin) child.stdin?.end(request.command);
    if (child.pid === undefined) throw new Error(`Could not start ${config.shell}${spawnError === undefined ? '' : `: ${spawnError.message}`}.`);
    const startedAt = Date.now();
    const header = terminalHeader({ pid: child.pid, cwd: request.cwd, command: request.command, title: request.title, startedAt });
    const fd = openSync(path, 'w+');
    let release: () => void = () => undefined;
    const job: ShellJob = {
      id,
      pid: child.pid,
      command: request.command,
      cwd: request.cwd,
      title: request.title,
      toolCallId: request.toolCallId,
      path,
      startedAt,
      fd,
      headerBytes: Buffer.byteLength(header.text),
      statusOffset: header.statusOffset,
      runningOffset: header.runningOffset,
      child,
      watch,
      listeners: new Set(),
      done: new Promise<void>((resolveDone) => {
        release = resolveDone;
      }),
      size: 0,
      bodyEnd: undefined,
      status: 'running',
      exitCode: undefined,
      endedAt: undefined,
      observed: false,
      awaiting: 0,
      refresh: undefined,
    };
    append(job, header.text);
    job.refresh = setInterval(() => refreshRunning(job), HEADER_REFRESH_MS);
    job.refresh.unref();
    for (const stream of [child.stdout, child.stderr]) {
      if (stream === null) continue;
      const decoder = new StringDecoder('utf8');
      stream.on('data', (chunk: Buffer) => {
        if (job.status !== 'running') return;
        const text = decoder.write(chunk);
        append(job, text);
        job.watch?.observe(text);
        notify(job);
      });
      stream.on('end', () => {
        if (job.status !== 'running') return;
        const text = decoder.end();
        append(job, text);
        job.watch?.observe(text);
        notify(job);
      });
    }
    child.on('error', (error) => {
      if (job.status === 'running') append(job, `${error.message}\n`);
      finish(job, 'failed', 127, true);
      release();
    });
    child.on('close', (code, signal) => {
      liveGroups.delete(job.pid);
      const { status, exitCode } = exitStatus(code, signal);
      finish(job, status, exitCode, true);
      release();
    });
    trackGroup(job.pid);
    jobs.set(id, job);
    return job;
  };

  /** The command's output so far: the file between the header and the footer. */
  const output = (job: ShellJob): string => {
    const length = Math.max(0, (job.bodyEnd ?? job.size) - job.headerBytes);
    const buffer = Buffer.alloc(length);
    const fd = job.status === 'running' ? job.fd : openSync(job.path, 'r');
    try {
      readSync(fd, buffer, 0, length, job.headerBytes);
    } finally {
      if (fd !== job.fd) closeSync(fd);
    }
    return buffer.toString('utf8');
  };
  const fileSize = (job: ShellJob) => (job.status === 'running' ? fstatSync(job.fd).size : statSync(job.path).size);

  /** Resolves when the job ends, prints, or `ms` passes, or the signal aborts. A job that ends meanwhile counts as observed. */
  const change = (job: ShellJob, ms: number, signal: AbortSignal | undefined) =>
    new Promise<void>((done) => {
      if (job.status !== 'running' || signal?.aborted === true) return done();
      job.awaiting += 1;
      const timer = setTimeout(stop, ms);
      function stop() {
        clearTimeout(timer);
        job.awaiting -= 1;
        job.listeners.delete(stop);
        signal?.removeEventListener('abort', stop);
        done();
      }
      job.listeners.add(stop);
      signal?.addEventListener('abort', stop, { once: true });
    });

  const awaitJob = async (shellId: string, waitMs: number, pattern: string | undefined, signal: AbortSignal | undefined): Promise<string> => {
    const job = jobs.get(shellId.trim());
    if (job === undefined) throw new Error(`Error awaiting task: No shell found for id ${shellId}`);
    const regex = pattern === undefined || pattern === '' ? undefined : compile(pattern);
    const deadline = Date.now() + waitMs;
    for (;;) {
      if (job.status !== 'running') {
        job.observed = true;
        return [`Task completed in ${(job.endedAt ?? Date.now()) - job.startedAt}ms with exit code: ${job.exitCode}.`, `output_file_path: ${job.path}`, `output_length: ${fileSize(job)}`].join('\n');
      }
      const matched = regex?.(output(job));
      const remaining = deadline - Date.now();
      if (matched !== undefined || remaining <= 0 || signal?.aborted === true) {
        const suffix = regex === undefined ? '' : matched === undefined ? ' Pattern did NOT match.' : ` Pattern matched: ${matched}`;
        return [`Task still running after ${Date.now() - job.startedAt}ms...${suffix}`, `output_file_path: ${job.path}`, `output_length: ${fileSize(job)}`].join('\n');
      }
      await change(job, remaining, signal);
    }
  };

  const signalGroup = (job: ShellJob, signal: NodeJS.Signals) => signalGroupId(job.pid, signal);

  /** Session end: every running job is stopped and recorded as aborted, with no notification. */
  const shutdown = () => {
    for (const job of jobs.values()) {
      if (job.status !== 'running') continue;
      signalGroup(job, 'SIGTERM');
      const kill = setTimeout(() => signalGroup(job, 'SIGKILL'), KILL_GRACE_MS);
      kill.unref();
      finish(job, 'aborted', 128 + constants.signals.SIGTERM, false);
    }
  };
  return {
    start,
    output,
    awaitJob,
    change,
    shutdown,
    running: () => [...jobs.values()].filter((job) => job.status === 'running'),
    stop: (job: ShellJob) => {
      signalGroup(job, 'SIGTERM');
      setTimeout(() => signalGroup(job, 'SIGKILL'), KILL_GRACE_MS).unref();
    },
  };
}

type ShellJobs = ReturnType<typeof createShellJobs>;

const NotifyParams = Type.Object({
  pattern: Type.String({ description: 'Regex pattern matched against each line of stdout/stderr output. Output redirected only to a file will not trigger it. Do not match all outputs.' }),
  reason: Type.String({ description: '5 or less words describing why you are watching for this output. It titles the notification.' }),
  debounce_ms: Type.Optional(Type.Number({ description: 'Milliseconds that must elapse between notifications. The minimum is 5000ms.' })),
});

const BackgroundParams = Type.Object({
  command: Type.String({ description: 'The command to execute' }),
  description: Type.Optional(Type.String({ description: 'Very short phrase naming what this command does; it titles the notifications about it. Avoid leading with verbs or using trailing periods' })),
  block_until_ms: Type.Optional(
    Type.Number({
      description:
        'How long to wait for the command in the foreground before moving it to the background, in milliseconds. 0 (the default) starts it in the background at once. A command that finishes within the wait returns its output and sends no notification.',
    }),
  ),
  notify_on_output: Type.Optional(
    Type.Object(NotifyParams.properties, { description: 'Optional output notification config. Each output line which matches the pattern will notify you. ONLY set this when the user explicitly requests monitoring.' }),
  ),
  working_directory: Type.Optional(Type.String({ description: 'The absolute path to the working directory to execute the command in (defaults to current directory)' })),
});

const AwaitParams = Type.Object({
  shell_id: Type.Optional(Type.String({ description: 'Optional shell id to poll. If omitted, this tool sleeps for the full block_until_ms duration and then returns. Required when block_until_ms is 0.' })),
  block_until_ms: Type.Optional(
    Type.Number({
      maximum: MAX_AWAIT_MS,
      description: 'Max sleep time to block before returning (in milliseconds). Defaults to 30000ms. Set to 0 only together with shell_id, for a non-blocking status check of that shell. Must not exceed 7140000 (119 minutes).',
    }),
  ),
  pattern: Type.Optional(
    Type.String({
      description:
        'Block until the regex matches stdout/stderr stream (or task completes). Matches anywhere in the shell output, not just new output. Will not match terminal file headers or footers, e.g. exit_code. Accepts RE2 regex syntax (no lookahead, lookbehind or backreferences), compiled in multiline mode so ^ and $ match at line boundaries.',
    }),
  ),
  waiting_for_subagent: Type.Optional(Type.Boolean({ description: 'Set this to true if you are waiting for subagent(s) to complete. Remember you should NOT be doing this and instead end your turn or do parallel work.' })),
});

const BACKGROUND_DESCRIPTION = [
  'Run a shell command in the background, or wait up to block_until_ms for it in the foreground and then move it to the background. Use it for work that should keep running while you do other things: dev servers, watchers, slow scans and builds, and a watcher whose output should wake you. Use bash for ordinary commands.',
  '',
  'The result names a shell ID, a PID, and an output file. The file starts with a header (pid, cwd, command, title, status, started_at, running_for_ms, refreshed every 5000ms) and ends with a footer (exit_code, elapsed_ms, ended_at) once the command finishes. After your turn ends you are notified when the command finishes, and on each notify_on_output match. Do not wait for those: keep working or end your turn. Poll with AwaitShell only when you are blocked on this job. Stop a job with `kill <pid>`.',
].join('\n');

const AWAIT_DESCRIPTION = [
  'Check or poll a backgrounded shell job. For work that does not have a shell id, you can omit the shell_id arg to sleep for the full `block_until_ms` duration (prefer this over sleeping in the shell). At the end of your turn, you will be notified about any unawaited jobs that completed. If you think a job completed (e.g. because you killed it), observe it with AwaitShell to skip the notification, because stale notifications can confuse the user.',
  '',
  'Prefer NOT to poll reflexively with AwaitShell. Multitask on independent work while backgrounded jobs run, or finish your turn and rely on the end-of-turn completion notification. Poll with AwaitShell only when one of the following is true:',
  "- Your very next step is blocked on this specific job's result and you have no other productive work to do, OR",
  '- The task requires close monitoring (see shell guidance below).',
  '- NEVER USE THIS TO POLL OR WAIT VACUOUSLY FOR A SUBAGENT LAUNCHED WITH THE Task TOOL — rely on the end-of-turn completion notification instead (it is delivered as soon as the subagent finishes; guessing a wait time is inefficient).',
  '- Shell: only poll with AwaitShell when the command requires close monitoring. Close monitoring means a long-running job that can silently hang, degrade, or need a course correction before it completes — e.g. training runs, eval runs, deployments, long builds, datagen pipelines, DB migrations, large data transfers. For fire-and-forget commands (tests, installs, dev servers/watchers, short scripts, etc.) the completion notification is enough — start them, keep working, and only poll with AwaitShell later if you end up blocked on the result.',
  "- Shell sanity check (regardless of close monitoring): when you spawn a command directly into the background (`block_until_ms: 0`), do a single status check by reading the output file to confirm the command didn't fail to start. This is a one-shot smoke check, not a polling loop.",
  '- Shell close-monitoring guidance (only applies in the close-monitoring case above):',
  "  - HARD STOPPING CONSTRAINT: once you've decided to actively poll, don't stop until (a) the job terminates, (b) the command reaches a healthy steady state (only for non-terminating commands, e.g. dev server/watcher), or (c) the command is hung — follow the hang guidance below.",
  '  - Waiting until a regex matches the output can be useful for e.g. known startup/status/error logs.',
  "  - Size `block_until_ms` to the command's expected runtime. When waiting further, avoid round 5-minute waits: prefer slices of 60–270s (keeps prompt cache warm) or 1200s+ (one cache miss buys a long wait).",
  '  - Output file header has `pid` and `running_for_ms` (updated every 5000ms).',
  '  - When finished, footer with `exit_code` and `elapsed_ms` appears (regex only matches the body, not header/footer).',
  '  - If the command is taking longer than expected and appears hung (use judgment based on command type), kill the process if safe to do so using the pid in the header. If possible, fix the hang and proceed.',
].join('\n');

interface AwaitDetails {
  shellId?: string;
  sleptMs?: number;
}

const SUBAGENT_NOTE = 'This subagent stops its background jobs when it finishes, so await any job whose result you need before you finish.';

const clampWait = (value: number | undefined, fallback: number) => Math.min(MAX_AWAIT_MS, Math.max(0, Math.round(value ?? fallback)));

function seconds(ms: number): string {
  const value = ms / 1000;
  return Number.isInteger(value) ? `${value}s` : `${value.toFixed(1)}s`;
}

export function shellNoticeCardText(message: { content: string | { type: string; text?: string }[]; details?: unknown }): string {
  const notice = message.details as Partial<ShellNotice> | undefined;
  if (notice?.title === undefined || notice.shellId === undefined) return typeof message.content === 'string' ? message.content : message.content.map((part) => part.text ?? '').join('');
  const head = `${notice.title} · ${notice.kind === 'progress' ? 'output matched' : notice.status} · shell ${notice.shellId}`;
  return notice.detail === undefined ? head : `${head}\n${notice.detail}`;
}

export interface BackgroundShellOptions {
  terminalsDir: (ctx: ExtensionContext) => string;
  /** One-shot runs that may wait at settle for their jobs, as Cursor's print mode does: print and JSON runs, not subagents. */
  waitsForJobs: (ctx: ExtensionContext) => boolean;
  /** A subagent's jobs end with it. */
  endsWithTurn: boolean;
}

/** bash_background and AwaitShell, plus the notifications their jobs send. */
export function registerBackgroundShell(pi: ExtensionAPI, options: BackgroundShellOptions): { hasRunningJobs: () => boolean } {
  const pending: ShellNotice[] = [];
  const arrivals = new Set<() => void>();
  let mode: ExtensionContext['mode'] | undefined;
  let retired = false;
  const deliver = (notice: ShellNotice) => {
    if (retired) return;
    if (mode !== undefined && isOneShot(mode)) {
      pending.push(notice);
      for (const arrived of [...arrivals]) arrived();
    } else pi.sendMessage({ customType: SHELL_NOTICE_TYPE, content: noticeText(notice), display: true, details: notice }, { triggerTurn: true, deliverAs: 'followUp' });
  };
  const nextArrival = () =>
    new Promise<void>((done) => {
      const arrived = () => {
        arrivals.delete(arrived);
        done();
      };
      arrivals.add(arrived);
    });
  const jobs: ShellJobs = createShellJobs(
    {
      terminalsDir: options.terminalsDir,
      shellPath: () => {
        const value = (pi.getSettings() as { shellPath?: unknown }).shellPath;
        return typeof value === 'string' && value !== '' ? value.replace(/^~(?=$|\/)/, process.env['HOME'] ?? '~') : undefined;
      },
    },
    deliver,
  );

  pi.registerMessageRenderer?.(SHELL_NOTICE_TYPE, (message) => new Text(shellNoticeCardText(message), 0, 0));
  pi.on('session_start', (_event, ctx) => {
    mode = ctx.mode;
    retired = false;
  });
  // Cursor's print mode holds its exit for background shells and reports each notification as a turn.
  pi.on('agent_before_settle', async (event, ctx) => {
    if (!isOneShot(ctx.mode) || event.outcome === 'aborted') return undefined;
    if (pending.length === 0 && (!options.waitsForJobs(ctx) || jobs.running().length === 0)) return undefined;
    if (pending.length === 0) await nextArrival();
    const ready = pending.splice(0);
    if (ready.length === 0) return undefined;
    return {
      entries: [...event.entries, ...ready.map((notice) => ({ type: 'custom_message' as const, customType: SHELL_NOTICE_TYPE, content: noticeText(notice), display: true, details: notice }))],
      continue: true,
    };
  });
  pi.on('session_shutdown', () => {
    retired = true;
    pending.splice(0);
    for (const arrived of [...arrivals]) arrived();
    jobs.shutdown();
  });

  pi.registerTool({
    name: BACKGROUND_TOOL,
    label: 'bash (background)',
    description: BACKGROUND_DESCRIPTION,
    promptSnippet: 'Run a shell command in the background, with notifications when it finishes or prints a watched line',
    parameters: BackgroundParams,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = params.working_directory === undefined || params.working_directory.trim() === '' ? ctx.cwd : resolve(ctx.cwd, params.working_directory);
      const title = params.description?.trim() || params.command.trim().split('\n')[0]?.slice(0, 80) || params.command;
      const watch = params.notify_on_output;
      const job = jobs.start(ctx, {
        command: params.command,
        cwd,
        title,
        toolCallId,
        ...(watch === undefined ? {} : { watch: { pattern: watch.pattern, reason: watch.reason, ...(watch.debounce_ms === undefined ? {} : { debounceMs: watch.debounce_ms }) } }),
      });
      const blockMs = clampWait(params.block_until_ms, 0);
      const details = { shellId: job.id, pid: job.pid, outputPath: job.path };
      const note = options.endsWithTurn ? `\n${SUBAGENT_NOTE}` : '';
      if (blockMs === 0) return { content: [{ type: 'text', text: `${launchText(job)}${note}` }], details };
      const deadline = Date.now() + blockMs;
      while (job.status === 'running' && Date.now() < deadline && signal?.aborted !== true) await jobs.change(job, deadline - Date.now(), signal);
      if (signal?.aborted === true && job.status === 'running') {
        jobs.stop(job);
        throw new Error('The command was stopped because the call was cancelled.');
      }
      if (job.status !== 'running') {
        job.observed = true;
        return { content: [{ type: 'text', text: finishedText(job.exitCode ?? 1, (job.endedAt ?? Date.now()) - job.startedAt, jobs.output(job), job.path) }], details: { ...details, exitCode: job.exitCode } };
      }
      return { content: [{ type: 'text', text: `${movedText(job, blockMs, jobs.output(job))}${note}` }], details };
    },
  });

  pi.registerTool({
    name: AWAIT_TOOL,
    label: 'AwaitShell',
    description: AWAIT_DESCRIPTION,
    promptSnippet: 'Poll or wait for a background shell job, or sleep',
    parameters: AwaitParams,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async execute(_toolCallId, params, signal): Promise<{ content: { type: 'text'; text: string }[]; details: AwaitDetails }> {
      if (params.waiting_for_subagent === true) throw new Error('You should NOT wait for subagents to complete. End your turn instead; completions are queued, or do parallel work.');
      const waitMs = clampWait(params.block_until_ms, DEFAULT_AWAIT_MS);
      const shellId = params.shell_id?.trim();
      if (shellId === undefined || shellId === '') {
        if (waitMs === 0) throw new Error('Invalid arguments:\nshell_id: Required when block_until_ms is 0. Without shell_id there is nothing to check: pass the shell_id to check, or a nonzero block_until_ms to sleep.');
        const started = Date.now();
        await sleep(waitMs, signal);
        return { content: [{ type: 'text', text: `Slept for ${seconds(Date.now() - started >= waitMs ? waitMs : Date.now() - started)}.` }], details: { sleptMs: Date.now() - started } };
      }
      const text = await jobs.awaitJob(shellId, waitMs, params.pattern, signal);
      return { content: [{ type: 'text', text }], details: { shellId } };
    },
  });

  return { hasRunningJobs: () => jobs.running().length > 0 };
}
