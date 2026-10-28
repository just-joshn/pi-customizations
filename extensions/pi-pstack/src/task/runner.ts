import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import type { ImageContent, Usage } from '@earendil-works/pi-ai';
import { PACKAGE_ROOT } from '../paths.ts';
import type { ModelSpec } from './models.ts';

// TodoWrite only changes the child's own todo list, so a readonly reviewer can still keep one. The child replaces
// bash with a sandboxed read-only shell (readonly-shell.ts).
const READONLY_TOOLS = 'read,grep,find,ls,bash,TodoWrite';
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}[A-Za-z0-9]$/;
export const KILL_GRACE_MS = 3_000;
// Dialogs block a run until answered. A subagent has nobody to ask, so its owner dismisses them.
const DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor']);

export interface ChildArgsOptions {
  sessionDir: string;
  agentId: string;
  model?: ModelSpec;
  readonly?: boolean;
  /** Tools to add back to the loadout Pi restores from the transcript (records.ts `readonlyLaunchRestores`). */
  restoreTools?: readonly string[];
  /** The parent's project trust, so the child loads the same project resources (`ctx.isProjectTrusted()`). */
  trusted?: boolean;
}

/** Argv for one `pi --mode rpc` subagent process. Its prompts travel as RPC commands on stdin, never in argv. */
export function childArgs(options: ChildArgsOptions): string[] {
  const model = options.model === undefined ? [] : ['--model', `${options.model.provider}/${options.model.id}`, ...(options.model.thinking === undefined ? [] : ['--thinking', options.model.thinking])];
  return [
    '--mode',
    'rpc',
    '--session-dir',
    options.sessionDir,
    '--session-id',
    options.agentId,
    '-e',
    PACKAGE_ROOT,
    ...(options.trusted === undefined ? [] : [options.trusted ? '--approve' : '--no-approve']),
    ...model,
    ...(options.readonly === true ? ['--tools', READONLY_TOOLS, '--no-mcp'] : []),
    ...(options.readonly !== true && (options.restoreTools ?? []).length > 0 ? ['--tools', (options.restoreTools ?? []).map((name) => `+${name}`).join(',')] : []),
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

const isBmp = (bytes: Buffer) => bytes.length >= 30 && bytes.toString('latin1', 0, 2) === 'BM' && [12, 40, 52, 56, 108, 124].includes(bytes.readUInt32LE(14));
const IMAGE_TYPES: [string, (bytes: Buffer) => boolean][] = [
  ['image/png', (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[3] !== 0xf7],
  ['image/gif', (bytes) => /^GIF8[79]a/.test(bytes.toString('latin1', 0, 6))],
  ['image/webp', (bytes) => bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP'],
  ['image/bmp', isBmp],
];

export interface ChildInput {
  text: string;
  images: ImageContent[];
}

/**
 * The first message Pi builds from piped input and `@file` arguments, which RPC mode does not accept: the trimmed
 * prompt, then each non-empty text file in a <file> block, and each image as an attachment with an empty <file> block.
 */
export function withAttachments(prompt: string, attachments: readonly string[]): ChildInput {
  let text = prompt.trim();
  const images: ImageContent[] = [];
  for (const path of attachments) {
    const bytes = readFileSync(path);
    if (bytes.length === 0) continue;
    const mimeType = IMAGE_TYPES.find(([, matches]) => matches(bytes))?.[0];
    if (mimeType === undefined) {
      text += `<file name="${path}">\n${bytes.toString('utf8').replace(/^\uFEFF/, '')}\n</file>\n`;
      continue;
    }
    images.push({ type: 'image', mimeType, data: bytes.toString('base64') });
    text += `<file name="${path}"></file>\n`;
  }
  return { text, images };
}

export interface ChildOptions {
  command: readonly string[];
  args: readonly string[];
  prompt: string;
  images?: readonly ImageContent[];
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
  /** Ends the child and its process group now: session shutdown or an aborted foreground call. */
  kill: () => void;
  /** stop_agent: aborts the run over RPC so the transcript records it, then kills the group if it outlives the grace period. */
  stop: () => void;
  /** Queues a message into the running turn (a new turn if the run just ended); rejects once the child is closing. */
  steer: (text: string, images: readonly ImageContent[]) => Promise<void>;
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

/** RPC mode reserves stdout for protocol records, but a child extension can still print there; such a line must not crash the parent. */
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
export function signalGroup(pid: number, signal: NodeJS.Signals): void {
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

interface ChildState {
  usage: Usage;
  stderr: string;
  aborted: boolean;
  stopped: boolean;
  /** Why Pi refused the first prompt. */
  refused?: string;
}

function outcomeOf(last: AssistantRecord | undefined, state: ChildState, code: number | null): ChildOutcome {
  const base = { finalText: last?.text ?? '', usage: state.usage, stderr: state.stderr };
  if (state.aborted) return { ...base, failure: 'Subagent was aborted' };
  if (state.stopped) return { ...base, failure: 'Subagent was stopped with stop_agent' };
  if (state.refused !== undefined) return { ...base, failure: state.refused };
  if (last?.stopReason === 'error' || last?.stopReason === 'aborted') return { ...base, failure: last.errorMessage ?? `subagent stopped: ${last.stopReason}` };
  if (code !== 0) return { ...base, failure: `pi exited with code ${code}: ${state.stderr.trim().split('\n').at(-1) ?? ''}`.trim() };
  return base;
}

interface RpcResponse {
  id?: string;
  success: boolean;
  error?: string;
  data?: { disposition?: string; steering?: string[]; followUp?: string[] };
}

/**
 * Runs one `pi --mode rpc` child in its own process group, so abort and shutdown can stop it and everything it started.
 * The child stays open while its run is active or a command awaits its response, so a steer always lands in a run;
 * once the run settles with nothing outstanding, closing stdin makes Pi save the session and exit.
 * Pi's `RpcClient` cannot start or end this child (no detached spawn, stdin close, `extension_ui_response`, or exit
 * code); docs/native-gaps.md records each missing mechanism.
 */
export function startChild(options: ChildOptions): ChildHandle {
  const [command, ...prefix] = options.command;
  if (command === undefined) throw new Error('startChild needs a command');
  const child = spawn(command, [...prefix, ...options.args], { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  const state: ChildState = { usage: zeroUsage(), stderr: '', aborted: false, stopped: false };
  let last: AssistantRecord | undefined;
  let open = true;
  let idle = true;
  let steered = false;
  let nextId = 0;
  let grace: ReturnType<typeof setTimeout> | undefined;
  const waiting = new Map<string, (response: RpcResponse) => void>();

  const write = (record: Record<string, unknown>) => {
    if (open) child.stdin.write(`${JSON.stringify(record)}\n`);
  };
  const close = () => {
    if (!open) return;
    open = false;
    child.stdin.end();
  };
  const request = (record: Record<string, unknown>, onResponse: (response: RpcResponse) => void) => {
    const id = `pstack-${nextId++}`;
    waiting.set(id, onResponse);
    write({ ...record, id });
  };
  const prompt = (text: string, images: readonly ImageContent[], onResponse: (response: RpcResponse) => void, streamingBehavior?: 'steer') =>
    request({ type: 'prompt', message: text, ...(images.length === 0 ? {} : { images }), ...(streamingBehavior === undefined ? {} : { streamingBehavior }) }, (response) => {
      if (response.data?.disposition === 'started') idle = false;
      onResponse(response);
    });
  // A steer can reach Pi just as its run ends and stay queued with no run to take it, so it goes out as a new prompt.
  const closeWhenSettled = () => {
    if (!open || !idle || waiting.size > 0) return;
    if (!steered || state.stopped) return close();
    steered = false;
    request({ type: 'clear_queue' }, (response) => {
      const left = [...(response.data?.steering ?? []), ...(response.data?.followUp ?? [])];
      if (left.length > 0) prompt(left.join('\n\n'), [], () => undefined);
    });
  };

  const kill = () => {
    state.aborted = true;
    killGroup(child.pid);
  };
  const stop = () => {
    if (state.stopped || state.aborted) return;
    state.stopped = true;
    request({ type: 'clear_queue' }, () => undefined);
    request({ type: 'abort' }, () => undefined);
    grace = setTimeout(() => killGroup(child.pid), KILL_GRACE_MS);
    grace.unref();
  };
  const steer = (text: string, images: readonly ImageContent[]) =>
    new Promise<void>((resolve, reject) => {
      if (!open || state.stopped || state.aborted) return reject(new Error('The subagent has finished its run.'));
      steered = true;
      prompt(text, images, (response) => (response.success ? resolve() : reject(new Error(response.error ?? 'Pi refused the message.'))), 'steer');
    });

  const onRecord = (record: { type: string } & Record<string, unknown>) => {
    if (record.type === 'response') {
      const response = record as unknown as RpcResponse;
      const onResponse = response.id === undefined ? undefined : waiting.get(response.id);
      if (onResponse === undefined) return;
      waiting.delete(response.id as string);
      onResponse(response);
      return closeWhenSettled();
    }
    if (record.type === 'extension_ui_request') {
      if (DIALOG_METHODS.has(String(record['method']))) write({ type: 'extension_ui_response', id: record['id'], cancelled: true });
      return;
    }
    options.onEvent?.(record);
    if (record.type === 'agent_start') idle = false;
    const usage = usageOf(record);
    if (usage !== undefined) state.usage = addUsage(state.usage, usage);
    last = readAssistant(record) ?? last;
    if (record.type === 'agent_settled') {
      idle = true;
      closeWhenSettled();
    }
  };

  child.stdout.on(
    'data',
    lineReader((line) => {
      const record = parseEvent(line);
      if (record === undefined) state.stderr = `${state.stderr}${line}\n`.slice(-8_192);
      else onRecord(record);
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
  if (state.aborted || (options.prompt.trim() === '' && (options.images ?? []).length === 0)) close();
  else
    prompt(options.prompt, options.images ?? [], (response) => {
      if (!response.success) state.refused = response.error ?? 'Pi refused the prompt.';
    });
  const done = new Promise<ChildOutcome>((resolveDone) => {
    child.on('error', (error) => resolveDone({ finalText: '', usage: state.usage, stderr: state.stderr, failure: `could not start pi: ${error.message}` }));
    child.on('close', (code) => {
      open = false;
      clearTimeout(grace);
      options.signal?.removeEventListener('abort', kill);
      resolveDone(outcomeOf(last, state, code));
      for (const onResponse of waiting.values()) onResponse({ success: false, error: 'The subagent exited.' });
      waiting.clear();
    });
  });
  return { done, kill, stop, steer, pid: child.pid };
}
