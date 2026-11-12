// The tmux-hosted worker host (spec 9). It claims one assignment, runs `pi --mode rpc` (or a watch command) in the
// worker's workspace, relays control requests from a private unix socket and from the operator's terminal, and keeps
// state.json current. It never reasons about the work. Runs under plain Node: node: builtins and run-files.ts only.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  appendEvent,
  type Capabilities,
  controlSocketPath,
  type HostPhase,
  type HostState,
  isTerminal,
  type LoadedAssignment,
  launchEnvPath,
  loadAssignment,
  MAX_SETTLES,
  readBrief,
  runRootOf,
  type SettlePhase,
  THINKING_LEVELS,
  type ThinkingLevel,
  TMUX_SESSION,
  writeJsonAtomic,
} from './run-files.ts';

export const MAX_CONTROL_BYTES = 65_536;
export const MAX_INSTRUCTION_BYTES = 32_768;
const MAX_RPC_RECORD = 8 * 1024 * 1024;
const MAX_BRIEF_BYTES = 1024 * 1024;
const RPC_DEADLINE_MS = 10_000;
const ABORT_DEADLINE_MS = 60_000;

/** What the parent decided at spawn time and the immutable assignment cannot say (the resolved model, how to run Pi). */
export interface HostLaunch {
  piCommand: string[];
  model: { provider: string; id: string } | null;
  thinkingLevel: ThinkingLevel | null;
  appendSystemPrompt: string | null;
  /** Pi's --tools allowlist, or null for Pi's defaults. */
  tools: string[] | null;
  tmuxSession: string;
  extraArgs: string[];
  /** Names of the credential variables the resolved provider reads; a minimal environment keeps only these. Their values travel in launch-env.json. */
  credentialEnv: string[];
}

/** What env 'minimal' keeps besides PSTACK_* and the provider's credential variables (contract "Capability boundary"). */
const MINIMAL_ENV = ['PATH', 'HOME', 'LANG', 'TERM', 'TMPDIR', 'PI_CODING_AGENT_DIR'] as const;

export const HOST_OPERATIONS = ['inspect', 'start', 'prompt', 'steer', 'follow-up', 'cancel', 'shutdown'] as const;
export type HostOperation = (typeof HOST_OPERATIONS)[number];
const TEXT_OPERATIONS: readonly HostOperation[] = ['prompt', 'steer', 'follow-up'];

export interface ControlRequest {
  id: string;
  workerId: string;
  digest: string;
  instance?: string;
  operation: HostOperation;
  text?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function parseLaunch(text: string | undefined): HostLaunch {
  if (text === undefined) throw new Error('Missing launch argument');
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) throw new Error('Launch must be an object');
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((part) => typeof part === 'string' && !part.includes('\0'));
  const { piCommand, model, thinkingLevel, appendSystemPrompt, tools, tmuxSession, extraArgs, credentialEnv } = raw;
  if (!strings(piCommand) || piCommand.length === 0 || !isAbsolute(piCommand[0] ?? '')) throw new Error('Launch piCommand must start with an absolute executable');
  if (model !== null && !(isRecord(model) && typeof model['provider'] === 'string' && typeof model['id'] === 'string')) throw new Error('Launch model must be { provider, id } or null');
  if (thinkingLevel !== null && !(THINKING_LEVELS as readonly unknown[]).includes(thinkingLevel)) throw new Error('Launch thinkingLevel is invalid');
  if (appendSystemPrompt !== null && !(typeof appendSystemPrompt === 'string' && isAbsolute(appendSystemPrompt))) throw new Error('Launch appendSystemPrompt must be an absolute path or null');
  if (tools !== null && !(strings(tools) && tools.every((name) => /^[A-Za-z0-9_*+-]+$/.test(name)))) throw new Error('Launch tools must be tool names or null');
  if (typeof tmuxSession !== 'string' || !TMUX_SESSION.test(tmuxSession)) throw new Error('Launch tmuxSession is invalid');
  if (!strings(extraArgs)) throw new Error('Launch extraArgs must be strings');
  if (!strings(credentialEnv) || credentialEnv.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new Error('Launch credentialEnv must be variable names');
  return {
    piCommand,
    model: model as HostLaunch['model'],
    thinkingLevel: thinkingLevel as ThinkingLevel | null,
    appendSystemPrompt: appendSystemPrompt as string | null,
    tools: tools as string[] | null,
    tmuxSession,
    extraArgs,
    credentialEnv,
  };
}

/**
 * The worker's whole environment before the PSTACK_* identity variables, as the parent writes it to launch-env.json:
 * everything the parent has for env 'inherit', and for 'minimal' every allowed name, null where the parent has none.
 * The host builds the child's environment from this alone, never from its own, which tmux gave it from whatever
 * environment the tmux server started with.
 */
export function launchEnvironment(mode: Capabilities['env'], credentialEnv: readonly string[], source: Record<string, string | undefined>): Record<string, string | null> {
  if (mode === 'inherit') return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const names = new Set([...MINIMAL_ENV, ...credentialEnv, ...Object.keys(source).filter((name) => name.startsWith('PSTACK_'))]);
  return Object.fromEntries([...names].map((name) => [name, source[name] ?? null]));
}

/** Reads the parent's launch-env.json once and unlinks it, so the values exist only in this process from here on. */
function takeLaunchEnv(workerDir: string): Record<string, string | null> {
  const path = launchEnvPath(workerDir);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let raw: unknown;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Error(`${path} must be a private regular file owned by this user`);
    raw = JSON.parse(readFileSync(fd, 'utf8'));
  } finally {
    closeSync(fd);
    unlinkSync(path);
  }
  if (!isRecord(raw) || Object.entries(raw).some(([name, value]) => !/^[^=\0]+$/.test(name) || (typeof value !== 'string' && value !== null))) throw new Error(`${path} must map variable names to strings or null`);
  return raw as Record<string, string | null>;
}

/** The worker's environment before the PSTACK_* identity variables: the parent's snapshot, narrowed again for env 'minimal'. */
function workerEnv(loaded: LoadedAssignment, launch: HostLaunch, launchEnv: Record<string, string | null>): Record<string, string> {
  const present = Object.entries(launchEnv).filter((entry): entry is [string, string] => entry[1] !== null);
  if (loaded.assignment.capabilities.env === 'inherit') return Object.fromEntries(present);
  const allowed = new Set<string>([...MINIMAL_ENV, ...launch.credentialEnv]);
  return Object.fromEntries(present.filter(([name]) => allowed.has(name) || name.startsWith('PSTACK_')));
}

export function validateControl(value: unknown, loaded: LoadedAssignment, instance: string): ControlRequest {
  if (!isRecord(value)) throw new Error('Control must be an object');
  const allowed = ['id', 'workerId', 'digest', 'instance', 'operation', 'text'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Unknown control field');
  if (typeof value['id'] !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value['id'])) throw new Error('Invalid command id');
  if (value['workerId'] !== loaded.assignment.workerId || value['digest'] !== loaded.digest) throw new Error('Assignment identity mismatch');
  const operation = value['operation'];
  if (typeof operation !== 'string' || !(HOST_OPERATIONS as readonly string[]).includes(operation)) throw new Error('Unknown operation');
  if (operation !== 'inspect' && value['instance'] !== instance) throw new Error('Host instance mismatch');
  const text = value['text'];
  if (TEXT_OPERATIONS.includes(operation as HostOperation)) {
    if (typeof text !== 'string' || text.length === 0 || Buffer.byteLength(text) > MAX_INSTRUCTION_BYTES) throw new Error(`Instruction must contain 1 to ${MAX_INSTRUCTION_BYTES} bytes`);
  } else if (text !== undefined) throw new Error('Unexpected instruction text');
  return value as unknown as ControlRequest;
}

function workspaceDir(loaded: LoadedAssignment): string {
  const { assignment } = loaded;
  if (assignment.kind === 'watch') return assignment.watch.cwd;
  return assignment.workspace.mode === 'worktree' ? join(loaded.workerDir, 'worktree') : assignment.workspace.path;
}

/** Pi's argv after the launch command, for a kind 'pi' worker. */
export function piArgs(loaded: LoadedAssignment, launch: HostLaunch): string[] {
  return [
    '--mode',
    'rpc',
    '--session-dir',
    join(loaded.workerDir, 'session'),
    ...(launch.model === null ? [] : ['--model', `${launch.model.provider}/${launch.model.id}`]),
    ...(launch.thinkingLevel === null ? [] : ['--thinking', launch.thinkingLevel]),
    ...(launch.appendSystemPrompt === null ? [] : ['--append-system-prompt', launch.appendSystemPrompt]),
    ...(launch.tools === null ? [] : ['--tools', launch.tools.join(',')]),
    ...(loaded.assignment.capabilities.mcp === 'none' ? ['--no-mcp'] : []),
    ...launch.extraArgs,
  ];
}

/**
 * Claims the assignment exclusively inside the claim/ directory the parent created at spawn. A second host for the
 * same assignment fails here and never starts Pi.
 */
function claim(loaded: LoadedAssignment, instance: string): void {
  writeFileSync(join(loaded.workerDir, 'claim', 'identity.json'), `${JSON.stringify({ digest: loaded.digest, instance, hostPid: process.pid })}\n`, { mode: 0o600, flag: 'wx' });
}

/**
 * Creates `<workerDir>/worktree` on a new branch pstack-run/<runId>/<workerId> at the input commit, under this host's
 * exclusive claim. Anything already at the path, or a branch already by that name, is refused: a worker never reuses
 * a checkout or a branch, so it always starts from exactly the input commit.
 */
function prepareWorktree(loaded: LoadedAssignment, inputCommit: string): void {
  const { runId, workerId } = loaded.assignment;
  const project = resolve(loaded.runRoot, '..', '..', '..', '..');
  if (runRootOf(project, runId) !== loaded.runRoot) throw new Error(`${loaded.runRoot} is not <project>/.pi/pstack/runs/${runId}`);
  const path = join(loaded.workerDir, 'worktree');
  const branch = `pstack-run/${runId}/${workerId}`;
  const git = (...args: string[]) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }).trim();
  if (lstatSync(path, { throwIfNoEntry: false }) !== undefined) throw new Error(`${path}: worktree already exists; a worker never reuses one. Spawn a fresh worker id.`);
  let commit: string;
  try {
    commit = git('rev-parse', '--verify', '--quiet', `${inputCommit}^{commit}`);
  } catch {
    throw new Error(`inputCommit ${inputCommit} names no commit in ${project}`);
  }
  try {
    git('worktree', 'add', '--quiet', '-b', branch, path, commit);
  } catch (error) {
    throw new Error(`git worktree add ${path} on new branch ${branch} failed: ${(error as { stderr?: string }).stderr?.trim() || message(error)}`);
  }
}

function prepareSocket(path: string): void {
  const directory = dirname(path);
  if (directory.startsWith('/tmp/pstack-')) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error(`${directory} must be a private directory owned by this user`);
  }
  // This host holds the claim, so any socket file here was left by a dead host for the same assignment.
  if (existsSync(path)) unlinkSync(path);
}

export async function runHost(assignmentFile: string, launchText: string | undefined): Promise<void> {
  const loaded = loadAssignment(assignmentFile);
  const launch = parseLaunch(launchText);
  const { assignment, workerDir, runRoot } = loaded;
  const instance = randomUUID();
  claim(loaded, instance);
  const launchEnv = takeLaunchEnv(workerDir);
  const socketPath = controlSocketPath(runRoot, assignment.workerId);
  const sessionDir = join(workerDir, 'session');

  let phase: HostPhase = 'starting';
  let reason: string | null = null;
  let exit: HostState['exit'] = null;
  let model: HostState['model'] = null;
  let sessionFile: string | null = null;
  let briefSent = false;
  // Units of work accepted for forwarding to Pi, and the highest of them Pi has acknowledged. Both change only while
  // handling a response record, in stdout order, so a settle sees exactly the acknowledgements that preceded it.
  let generation = 0;
  let acknowledged = 0;
  // Prompt request id to the generation it carries, until Pi answers it, even after its deadline.
  const unacknowledged = new Map<string, number>();
  // get_state request id to the outcome its quiescence check records. A run's own settle records even when no new
  // generation is outstanding; any other check records only to cover acknowledged work no settle covers yet.
  const quiescenceChecks = new Map<string, { phase: SettlePhase; reason: string | null; always: boolean }>();
  // The outcome of the latest agent_settled while no settle has recorded it, because Pi was not quiescent yet.
  let unrecorded: { phase: SettlePhase; reason: string | null } | undefined;
  let settles: HostState['settles'] = [];
  let childPid: number | null = null;
  let stderrTail = '';
  let requestNumber = 0;
  let runFailure: string | undefined;
  let childExited = false;
  let mutationPending = false;
  let server: Server | undefined;
  let terminal: Interface | undefined;
  let fatal: Promise<void> | undefined;
  const waiting = new Map<string, { timer: NodeJS.Timeout; resolve: (data: unknown) => void; reject: (error: Error) => void }>();
  const seen = new Set<string>();
  const sockets = new Set<Socket>();

  const observation = (): HostState => ({
    schemaVersion: 1,
    runId: assignment.runId,
    workerId: assignment.workerId,
    kind: assignment.kind,
    digest: loaded.digest,
    instance,
    hostPid: process.pid,
    childPid,
    tmuxSession: launch.tmuxSession,
    socketPath,
    phase,
    reason,
    model,
    sessionFile,
    briefSent,
    generation,
    settles,
    exit,
    updatedAt: new Date().toISOString(),
  });
  const event = (kind: string, data?: unknown) => {
    try {
      appendEvent(runRoot, { runId: assignment.runId, workerId: assignment.workerId, kind, data });
    } catch (error) {
      display('host diagnostic', `events.jsonl append failed: ${message(error)}`);
    }
  };
  const save = () => writeJsonAtomic(join(workerDir, 'state.json'), observation());
  const display = (kind: string, value: unknown) => process.stdout.write(`[${kind}] ${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
  /** Records an outcome. A run's settle covers what Pi acknowledged; the host ending covers everything accepted. */
  const settle = (settlePhase: SettlePhase, why: string | null, covers = generation) => {
    unrecorded = undefined;
    const last = settles.at(-1)?.sequence ?? 0;
    settles = [...settles, { sequence: last + 1, generation: covers, phase: settlePhase, reason: why, at: new Date().toISOString() }];
    save();
    event('settle', settles.at(-1));
    display('host settled', { phase: settlePhase, reason: why });
  };

  if (assignment.kind === 'pi' && assignment.workspace.mode === 'worktree') {
    try {
      prepareWorktree(loaded, assignment.workspace.inputCommit);
    } catch (error) {
      phase = 'failed';
      reason = message(error);
      display('host failure', reason);
      settle('failed', reason);
      event('failure', { reason });
      process.exitCode = 1;
      return;
    }
  }
  const env = { ...workerEnv(loaded, launch, launchEnv), PSTACK_WORKER: '1', PSTACK_RUN_ID: assignment.runId, PSTACK_WORKER_ID: assignment.workerId, PSTACK_RUN_ROOT: runRoot };
  const command: string[] = assignment.kind === 'watch' ? assignment.watch.argv : [...launch.piCommand, ...piArgs(loaded, launch)];
  const child: ChildProcess = spawn(command[0] as string, command.slice(1), {
    cwd: workspaceDir(loaded),
    detached: true,
    env,
    stdio: assignment.kind === 'watch' ? ['ignore', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
  });
  childPid = child.pid ?? null;

  const rejectWaiting = (error: Error) => {
    for (const pending of waiting.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    waiting.clear();
  };
  const signalChild = (signal: NodeJS.Signals) => {
    if (childExited || child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  const closed = new Promise<void>((resolveClosed) => {
    child.once('close', (code, signal) => {
      childExited = true;
      exit = { code, signal };
      rejectWaiting(new Error(`Child exited (${code ?? signal}); outstanding command outcomes are unknown`));
      event('child_exit', exit);
      if (phase === 'stopping') {
        save();
      } else if (fatal === undefined) {
        // A child that exits on its own never counts as success: Pi dying is a failure, a watch command ending is its event.
        const watchEnded = assignment.kind === 'watch';
        phase = watchEnded ? 'exited' : 'failed';
        reason = watchEnded ? `Watch command exited (${code ?? signal})` : `Pi exited unexpectedly (${code ?? signal})${stderrTail === '' ? '' : `: ${stderrTail.slice(-500)}`}`;
        settle(watchEnded ? 'exited' : 'failed', reason);
      }
      resolveClosed();
    });
  });
  const writeRpc = (record: Record<string, unknown>) =>
    new Promise<void>((resolveWrite, reject) => {
      const stdin = child.stdin;
      if (childExited || stdin === null || stdin.destroyed) return reject(new Error('Pi is unavailable; outcome unknown'));
      stdin.write(`${JSON.stringify(record)}\n`, (error) => (error ? reject(error) : resolveWrite()));
    });
  const nextRequestId = () => `${instance}-${++requestNumber}`;
  const request = (type: string, fields: Record<string, unknown> = {}, deadline = RPC_DEADLINE_MS, id = nextRequestId()) =>
    new Promise<unknown>((resolveRequest, reject) => {
      if (waiting.size >= 32) return reject(new Error('Too many pending RPC commands'));
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`Pi ${type} deadline expired; outcome unknown, do not retry`));
      }, deadline);
      waiting.set(id, { timer, resolve: resolveRequest, reject });
      writeRpc({ id, type, ...fields }).catch((error: Error) => {
        if (!waiting.delete(id)) return;
        clearTimeout(timer);
        reject(error);
      });
    });
  /** Asks Pi whether it is quiescent; the response branch records the settle when it is. */
  const checkQuiescence = (outcome: { phase: SettlePhase; reason: string | null; always: boolean }) => {
    const id = nextRequestId();
    quiescenceChecks.set(id, outcome);
    request('get_state', {}, RPC_DEADLINE_MS, id).catch((error: Error) => {
      quiescenceChecks.delete(id);
      if (!childExited && phase !== 'stopping') void fail(error);
    });
  };
  /** After a quiescent transition that is not a run's settle: covers acknowledged work no settle covers yet. */
  const recheck = (fallback: { phase: SettlePhase; reason: string | null }) => checkQuiescence({ ...(unrecorded ?? fallback), always: false });
  const closeChild = async () => {
    if (childExited) return closed;
    if (assignment.kind === 'watch') signalChild('SIGTERM');
    else child.stdin?.end();
    const term = setTimeout(() => signalChild('SIGTERM'), 3_000);
    const kill = setTimeout(() => signalChild('SIGKILL'), 6_000);
    try {
      return await closed;
    } finally {
      clearTimeout(term);
      clearTimeout(kill);
    }
  };
  const finishHost = () => {
    terminal?.close();
    process.stdin.pause();
    for (const socket of sockets) socket.end();
    server?.close(() => {
      try {
        unlinkSync(socketPath);
      } catch {
        // Node removes a listening unix socket on close; the file may already be gone.
      }
      process.exitCode = phase === 'failed' ? 1 : 0;
    });
    if (server === undefined) process.exitCode = phase === 'failed' ? 1 : 0;
  };
  const fail = (error: unknown): Promise<void> => {
    if (fatal !== undefined) return fatal;
    const wasTerminal = isTerminal(phase);
    phase = 'failed';
    reason = message(error);
    display('host failure', reason);
    fatal = (async () => {
      try {
        if (!wasTerminal) settle('failed', reason);
        event('failure', { reason });
      } catch {
        // The failure is already on the terminal; storage may be what failed.
      }
      signalChild('SIGTERM');
      await closeChild();
      finishHost();
    })();
    return fatal;
  };

  child.once('error', (error) => void fail(error));
  if (assignment.kind === 'pi') {
    child.stdin?.on('error', (error) => {
      if (phase !== 'stopping' && !childExited) void fail(error);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderrTail = `${stderrTail}${text}`.slice(-8192);
      display('pi diagnostic', text.slice(-8192).trimEnd());
    });
    let rpcBuffer = Buffer.alloc(0);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    child.stdout?.on('data', (chunk: Buffer) => {
      try {
        rpcBuffer = Buffer.concat([rpcBuffer, chunk]);
        for (let newline = rpcBuffer.indexOf(10); newline !== -1; newline = rpcBuffer.indexOf(10)) {
          if (newline > MAX_RPC_RECORD) throw new Error('Pi record exceeds the size limit');
          let line = rpcBuffer.subarray(0, newline);
          rpcBuffer = rpcBuffer.subarray(newline + 1);
          if (line.at(-1) === 13) line = line.subarray(0, -1);
          onRecord(JSON.parse(decoder.decode(line)) as unknown);
        }
        if (rpcBuffer.length > MAX_RPC_RECORD) throw new Error('Unterminated Pi record exceeds the size limit');
      } catch (error) {
        void fail(error);
      }
    });
  }

  const onRecord = (record: unknown) => {
    if (!isRecord(record) || typeof record['type'] !== 'string') throw new Error('Malformed Pi RPC record');
    const type = record['type'];
    if (type === 'agent_start') {
      runFailure = undefined;
      if (phase === 'idle') phase = 'running';
      save();
      event('agent_start');
    } else if (type === 'message_end' && isRecord(record['message']) && record['message']['role'] === 'assistant') {
      const assistant = record['message'];
      const stop = assistant['stopReason'];
      if (stop === 'error') runFailure = typeof assistant['errorMessage'] === 'string' ? assistant['errorMessage'] : 'Model error';
      const content = assistant['content'];
      const text = Array.isArray(content) ? content.flatMap((part) => (isRecord(part) && part['type'] === 'text' && typeof part['text'] === 'string' ? [part['text']] : [])).join('') : '';
      if (text !== '') display('pi response', text);
    } else if (type === 'tool_execution_start') {
      display('pi tool', `${String(record['toolName'])} ${JSON.stringify(record['args'] ?? {}).slice(0, 300)}`);
    } else if (type === 'agent_settled') {
      const aborted = record['aborted'] === true;
      if (phase === 'running') phase = 'idle';
      // Which work this settle covers is decided by the answer to get_state, not here: see the response branch.
      unrecorded = { phase: aborted ? 'aborted' : runFailure !== undefined ? 'failed' : 'idle', reason: aborted ? 'Run aborted' : (runFailure ?? null) };
      checkQuiescence({ ...unrecorded, always: true });
    } else if (type === 'compaction_end' || type === 'auto_retry_end') {
      // Either can end after the run's agent_settled found Pi busy; no other settle may follow.
      recheck({ phase: 'idle', reason: null });
    } else if (type === 'response') {
      const id = typeof record['id'] === 'string' ? record['id'] : undefined;
      const success = record['success'] === true;
      const data = record['data'];
      const carried = id === undefined ? undefined : unacknowledged.get(id);
      if (id !== undefined && carried !== undefined) {
        unacknowledged.delete(id);
        if (success) acknowledged = Math.max(acknowledged, carried);
        // A rejected prompt is no work. A handled one ran as a command and joins no run, so its settle comes from here.
        else if (generation === carried) generation -= 1;
        save();
        if (success && isRecord(data) && data['disposition'] === 'handled') recheck({ phase: 'handled', reason: null });
      }
      const check = id === undefined ? undefined : quiescenceChecks.get(id);
      if (id !== undefined && check !== undefined) {
        quiescenceChecks.delete(id);
        // Pi is quiescent: no run active and nothing queued, so every acknowledged prompt has run to this settle.
        // Otherwise the settle covers nothing and the next one decides. A shutdown records its own single settle.
        const quiescent = success && isRecord(data) && data['isStreaming'] === false && data['pendingMessageCount'] === 0;
        const outstanding = acknowledged > (settles.at(-1)?.generation ?? 0);
        if (quiescent && phase !== 'stopping' && !isTerminal(phase) && (check.always || outstanding)) settle(check.phase, check.reason, acknowledged);
      }
      const pending = id === undefined ? undefined : waiting.get(id);
      if (pending !== undefined && id !== undefined) {
        waiting.delete(id);
        clearTimeout(pending.timer);
        if (record['success'] === true) pending.resolve(record['data']);
        else pending.reject(new Error(typeof record['error'] === 'string' ? record['error'] : 'Pi rejected command'));
      }
    } else if (type === 'extension_ui_request') {
      // Nobody answers a dialog inside a worker; cancelling keeps the run from blocking forever.
      display('pi ui', { method: record['method'], title: record['title'] });
      if (['select', 'confirm', 'input', 'editor'].includes(String(record['method']))) void writeRpc({ type: 'extension_ui_response', id: record['id'], cancelled: true }).catch(fail);
    }
  };

  const inspectPi = async (): Promise<HostState> => {
    if (childExited || assignment.kind === 'watch' || isTerminal(phase)) return observation();
    const fresh = await request('get_state');
    if (!isRecord(fresh) || typeof fresh['sessionFile'] !== 'string' || dirname(fresh['sessionFile']) !== sessionDir) throw new Error('Pi session is not in the assigned session directory');
    const freshModel = isRecord(fresh['model']) ? { provider: String(fresh['model']['provider']), id: String(fresh['model']['id']) } : null;
    if (launch.model !== null && (freshModel?.provider !== launch.model.provider || freshModel.id !== launch.model.id))
      throw new Error(`Pi model ${freshModel?.provider}/${freshModel?.id} is not the assigned ${launch.model.provider}/${launch.model.id}`);
    if (sessionFile !== null && fresh['sessionFile'] !== sessionFile) throw new Error('Pi session changed unexpectedly');
    sessionFile = fresh['sessionFile'];
    model = freshModel;
    return observation();
  };

  /**
   * Forwards one unit of work, persisted as unsettled first so a collect never reads an older settle as its result.
   * Always a prompt with a streaming behavior: it starts a run when Pi is idle and joins the active run otherwise,
   * where RPC steer or follow_up sent as a run ends would queue behind a run that never starts.
   */
  const forward = async (text: string, streamingBehavior: 'steer' | 'followUp') => {
    if (settles.length >= MAX_SETTLES) throw new Error(`Worker has recorded ${settles.length} settles, the limit; spawn a fresh worker for more work`);
    generation += 1;
    save();
    const id = nextRequestId();
    unacknowledged.set(id, generation);
    const result = await request('prompt', { message: text, streamingBehavior }, RPC_DEADLINE_MS, id);
    return { disposition: isRecord(result) ? result['disposition'] : undefined };
  };

  const dispatch = async (operation: HostOperation, text?: string): Promise<unknown> => {
    if (operation === 'inspect') return inspectPi();
    if (mutationPending || phase === 'stopping' || phase === 'cancelling') throw new Error('Host control is busy; request rejected');
    if (operation !== 'shutdown' && (childExited || isTerminal(phase))) throw new Error(`Worker is ${phase}; request rejected`);
    if (assignment.kind === 'watch' && operation !== 'shutdown') throw new Error('A watch worker only accepts inspect and shutdown');
    mutationPending = true;
    try {
      event('control', { operation });
      if (operation === 'start') {
        if (briefSent) throw new Error('Brief already sent; request not replayed');
        const brief = readBrief(workerDir);
        if (brief.length === 0 || brief.length > MAX_BRIEF_BYTES) throw new Error(`Brief must contain 1 to ${MAX_BRIEF_BYTES} bytes`);
        const result = await forward(brief.toString('utf8'), 'followUp');
        briefSent = true;
        save();
        return result;
      }
      if (operation === 'prompt' || operation === 'steer' || operation === 'follow-up') return forward(text as string, operation === 'steer' ? 'steer' : 'followUp');
      if (operation === 'cancel') {
        const before = (await request('get_state')) as Record<string, unknown>;
        phase = 'cancelling';
        const removed = await request('clear_queue');
        await request('abort', {}, ABORT_DEADLINE_MS);
        const after = (await request('get_state')) as Record<string, unknown>;
        if (after['isStreaming'] === true || after['pendingMessageCount'] !== 0) throw new Error('Cancellation did not reach quiescence');
        phase = 'idle';
        save();
        recheck({ phase: 'aborted', reason: 'Run cancelled' });
        return { disposition: 'cancelled', removed, wasStreaming: before['isStreaming'] === true };
      }
      const before = phase;
      phase = 'stopping';
      reason = 'Stopped';
      save();
      let removed: unknown = null;
      if (!childExited && assignment.kind === 'pi') {
        // Queued work goes first, so abort cannot hand Pi the next queued message.
        removed = await request('clear_queue').catch(() => null);
        await request('abort', {}, ABORT_DEADLINE_MS).catch(() => undefined);
      }
      await closeChild();
      // A worker that already failed or exited keeps that outcome; it was announced when it happened.
      phase = isTerminal(before) ? before : 'stopped';
      if (isTerminal(before)) save();
      else settle('aborted', 'Stopped by request');
      event('shutdown', exit);
      return { disposition: 'stopped', removed, exit };
    } catch (error) {
      if (phase === 'cancelling') phase = childExited ? 'failed' : 'idle';
      throw error;
    } finally {
      mutationPending = false;
    }
  };

  const serve = (socket: Socket) => {
    if (sockets.size >= 8) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let received = false;
    const timeout = setTimeout(() => socket.destroy(), ABORT_DEADLINE_MS + 15_000);
    socket.on('error', () => undefined);
    socket.once('close', () => {
      clearTimeout(timeout);
      sockets.delete(socket);
    });
    const respond = (value: unknown) => socket.end(`${JSON.stringify(value)}\n`);
    socket.on('data', (chunk: Buffer) => {
      if (received) {
        socket.destroy();
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_CONTROL_BYTES) {
        received = true;
        respond({ ok: false, error: 'Control record exceeds limit', outcome: 'rejected' });
        return;
      }
      const newline = buffer.indexOf(10);
      if (newline === -1) return;
      received = true;
      void (async () => {
        let control: ControlRequest | undefined;
        try {
          if (buffer.subarray(newline + 1).length !== 0) throw new Error('Only one control record per connection');
          control = validateControl(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, newline))), loaded, instance);
          if (seen.has(control.id)) throw new Error('Duplicate command id; request not replayed');
          if (seen.size >= 4096) seen.clear();
          seen.add(control.id);
          const result = await dispatch(control.operation, control.text);
          respond({ ok: true, id: control.id, workerId: assignment.workerId, digest: loaded.digest, instance, result });
          if (control.operation === 'shutdown') finishHost();
        } catch (error) {
          respond({ ok: false, id: control?.id, error: message(error), outcome: /unknown/.test(message(error)) ? 'unknown' : 'rejected' });
        }
      })();
    });
  };

  try {
    event('launch', { command, hostPid: process.pid, childPid: child.pid, instance });
    save();
    if (assignment.kind === 'pi') await inspectPi();
    if (!isTerminal(phase)) phase = assignment.kind === 'watch' ? 'running' : 'idle';
    save();
    prepareSocket(socketPath);
    const umask = process.umask(0o077);
    server = createServer(serve);
    try {
      await new Promise<void>((resolveListen, reject) => {
        server?.once('error', reject);
        server?.listen(socketPath, resolveListen);
      });
    } finally {
      process.umask(umask);
    }
    chmodSync(socketPath, 0o600);
    event('ready', { phase, socketPath });
    display('host ready', { worker: assignment.workerId, run: assignment.runId, phase, model, sessionFile, socket: socketPath });
    display('host help', 'prompt <text> | steer <text> | follow-up <text> | cancel | status | shutdown   (Ctrl-C cancels the current run)');
    terminal = createInterface({ input: process.stdin, crlfDelay: Infinity });
    terminal.on('line', (line) => {
      const space = line.indexOf(' ');
      const word = space === -1 ? line.trim() : line.slice(0, space);
      const operation = word === 'status' ? 'inspect' : word;
      const text = space === -1 ? undefined : line.slice(space + 1);
      if (operation === '') return;
      try {
        const control = validateControl({ id: randomUUID(), workerId: assignment.workerId, digest: loaded.digest, instance, operation, ...(text === undefined ? {} : { text }) }, loaded, instance);
        display('operator command', line);
        void dispatch(control.operation, control.text)
          .then((result) => {
            display('operator receipt', result);
            if (control.operation === 'shutdown') finishHost();
          })
          .catch((error: unknown) => display('operator error', message(error)));
      } catch (error) {
        display('operator error', message(error));
      }
    });
    for (const signal of ['SIGTERM', 'SIGHUP'] as const)
      process.on(signal, () => {
        if (phase === 'stopping') return;
        void dispatch('shutdown').then(finishHost, fail);
      });
    process.on('SIGINT', () => {
      if (assignment.kind === 'pi' && phase === 'running')
        void dispatch('cancel').then(
          (result) => display('operator receipt', result),
          (error: unknown) => display('operator error', message(error)),
        );
    });
  } catch (error) {
    await fail(error);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHost(process.argv[2] ?? '', process.argv[3]).catch((error: unknown) => {
    console.error(`[host failure] ${message(error)}`);
    process.exitCode = 1;
  });
}
