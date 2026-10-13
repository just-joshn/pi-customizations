import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import type { Usage } from '@earendil-works/pi-ai';
import { PACKAGE_ROOT } from '../paths.ts';
import type { ModelSpec } from './models.ts';

// TodoWrite only changes the child's own todo list, so a readonly reviewer can still keep one. The child replaces
// bash with a sandboxed read-only shell (readonly-shell.ts).
const READONLY_TOOLS = 'read,grep,find,ls,bash,TodoWrite';
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}[A-Za-z0-9]$/;
const KILL_GRACE_MS = 3_000;

export interface ChildArgsOptions {
  sessionDir: string;
  agentId: string;
  model?: ModelSpec;
  readonly?: boolean;
  attachments?: readonly string[];
  /** The parent's project trust, so the child loads the same project resources (`ctx.isProjectTrusted()`). */
  trusted?: boolean;
}

/** Argv for one `pi --mode json` subagent run. The prompt travels on stdin, never in argv. */
export function childArgs(options: ChildArgsOptions): string[] {
  const model = options.model === undefined ? [] : ['--model', `${options.model.provider}/${options.model.id}`, ...(options.model.thinking === undefined ? [] : ['--thinking', options.model.thinking])];
  return [
    '--mode',
    'json',
    '--session-dir',
    options.sessionDir,
    '--session-id',
    options.agentId,
    '-e',
    PACKAGE_ROOT,
    ...(options.trusted === undefined ? [] : [options.trusted ? '--approve' : '--no-approve']),
    ...model,
    ...(options.readonly === true ? ['--tools', READONLY_TOOLS, '--no-mcp'] : []),
    ...(options.attachments ?? []).map((path) => `@${path}`),
  ];
}

export function validateAgentId(id: string): string {
  if (!AGENT_ID.test(id)) throw new Error(`"${id.slice(0, 80)}" is not a valid agent ID.`);
  return id;
}

/** Absolute paths of files to attach: `~` expands as in Pi's read paths, and each must be an existing file. */
export function resolveAttachments(paths: readonly string[], cwd: string, home: string = homedir()): string[] {
  return paths.map((path) => {
    const expanded = path === '~' || path.startsWith('~/') ? join(home, path.slice(1)) : path;
    const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
    if (!existsSync(absolute)) throw new Error(`file_attachments: ${absolute} does not exist`);
    if (!statSync(absolute).isFile()) throw new Error(`file_attachments: ${absolute} is not a file`);
    return absolute;
  });
}

export interface ChildOptions {
  command: readonly string[];
  args: readonly string[];
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onEvent?: (event: { type: string } & Record<string, unknown>) => void;
}

export interface ChildOutcome {
  finalText: string;
  usage: Usage;
  failure?: string;
  stderr: string;
}

export interface ChildHandle {
  done: Promise<ChildOutcome>;
  kill: () => void;
  pid: number | undefined;
}

export const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

export function addUsage(left: Usage, right: Usage): Usage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    totalTokens: left.totalTokens + right.totalTokens,
    cost: {
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      total: left.cost.total + right.cost.total,
    },
  };
}

interface AssistantRecord {
  text: string;
  stopReason?: string;
  errorMessage?: string;
}

/**
 * Usage a JSON-mode event adds to the child's session totals, counted the way Pi's own session stats count it:
 * assistant replies, tool results that carry nested usage (such as a grandchild subagent), and compactions.
 */
function usageOf(event: Record<string, unknown>): Usage | undefined {
  if (event['type'] === 'compaction_end') return (event['result'] as { usage?: Usage } | undefined)?.usage;
  const message = event['message'] as { role?: string; usage?: Usage } | undefined;
  if (event['type'] !== 'message_end' || (message?.role !== 'assistant' && message?.role !== 'toolResult')) return undefined;
  return message.usage;
}

function readAssistant(event: Record<string, unknown>): AssistantRecord | undefined {
  const message = event['message'] as { role?: string; content?: { type: string; text?: string }[]; stopReason?: string; errorMessage?: string } | undefined;
  if (event['type'] !== 'message_end' || message?.role !== 'assistant') return undefined;
  const text = (message.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');
  return {
    text,
    ...(message.stopReason === undefined ? {} : { stopReason: message.stopReason }),
    ...(message.errorMessage === undefined ? {} : { errorMessage: message.errorMessage }),
  };
}

function lineReader(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString('utf8');
    for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line !== '') onLine(line);
    }
  };
}

/** JSON mode reserves stdout for events, but a child extension can still print there; such a line must not crash the parent. */
function parseEvent(line: string): ({ type: string } & Record<string, unknown>) | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string' ? (value as { type: string } & Record<string, unknown>) : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/** Signals the child's whole process group. A group that is already gone (ESRCH) or not ours (EPERM) is left alone. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH' && code !== 'EPERM') throw error;
  }
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  signalGroup(pid, 'SIGTERM');
  setTimeout(() => signalGroup(pid, 'SIGKILL'), KILL_GRACE_MS).unref();
}

function outcomeOf(last: AssistantRecord | undefined, state: { usage: Usage; stderr: string; aborted: boolean }, code: number | null): ChildOutcome {
  const base = { finalText: last?.text ?? '', usage: state.usage, stderr: state.stderr };
  if (state.aborted) return { ...base, failure: 'Subagent was aborted' };
  if (last?.stopReason === 'error' || last?.stopReason === 'aborted') return { ...base, failure: last.errorMessage ?? `subagent stopped: ${last.stopReason}` };
  if (code !== 0) return { ...base, failure: `pi exited with code ${code}: ${state.stderr.trim().split('\n').at(-1) ?? ''}`.trim() };
  return base;
}

/** Runs one child in its own process group, so abort and shutdown can stop it and everything it started. */
export function startChild(options: ChildOptions): ChildHandle {
  const [command, ...prefix] = options.command;
  if (command === undefined) throw new Error('startChild needs a command');
  const child = spawn(command, [...prefix, ...options.args], { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  const state = { usage: zeroUsage(), stderr: '', aborted: false };
  let last: AssistantRecord | undefined;
  const kill = () => {
    state.aborted = true;
    killGroup(child.pid);
  };
  child.stdout.on(
    'data',
    lineReader((line) => {
      const event = parseEvent(line);
      if (event === undefined) {
        state.stderr = `${state.stderr}${line}\n`.slice(-8_192);
        return;
      }
      options.onEvent?.(event);
      const usage = usageOf(event);
      if (usage !== undefined) state.usage = addUsage(state.usage, usage);
      last = readAssistant(event) ?? last;
    }),
  );
  child.stderr.on('data', (chunk: Buffer) => {
    state.stderr = `${state.stderr}${chunk.toString('utf8')}`.slice(-8_192);
  });
  // A child that exits or is killed before it reads a large prompt closes the pipe. Unhandled, that EPIPE would be an
  // uncaught exception in the parent, and interactive Pi exits on one; the child's exit already reports the failure.
  child.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET') state.stderr = `${state.stderr}stdin: ${error.message}\n`.slice(-8_192);
  });
  if (options.signal?.aborted) kill();
  else options.signal?.addEventListener('abort', kill, { once: true });
  child.stdin.end(state.aborted ? undefined : options.prompt);
  const done = new Promise<ChildOutcome>((resolveDone) => {
    child.on('error', (error) => resolveDone({ finalText: '', usage: state.usage, stderr: state.stderr, failure: `could not start pi: ${error.message}` }));
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', kill);
      resolveDone(outcomeOf(last, state, code));
    });
  });
  return { done, kill, pid: child.pid };
}
