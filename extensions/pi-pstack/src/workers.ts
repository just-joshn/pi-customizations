// pstack_worker (spec 8.4, 9): spawn, inspect, steer, abort, and collect tmux-hosted Pi workers, plus the settle
// watcher that wakes the parent session exactly once per worker transition (contract "Wakeups").
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, delimiter, isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';

import { StringEnum } from '@earendil-works/pi-ai';
import { findEnvKeys } from '@earendil-works/pi-ai/compat';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { PACKAGE_ROOT } from './paths.ts';
import { piCommand as runningPiCommand } from './pi-command.ts';
import { controlHost, HostUnavailableError, hostTarget, inspectHost } from './rpc-client.ts';
import {
  type Assignment,
  appendEvent,
  type ClaimIdentity,
  formatTmuxIdentity,
  type HostState,
  isTerminal,
  type LoadedAssignment,
  launchEnvPath,
  loadAssignment,
  parseRunId,
  parseTmuxIdentity,
  parseWorkerId,
  projectRoot,
  type RunId,
  readBrief,
  readClaim,
  readHostState,
  readRun,
  readTmuxIdentity,
  runRootOf,
  runsDir,
  type Settle,
  type ThinkingLevel,
  TMUX_IDENTITY_FORMAT,
  type TmuxIdentity,
  tmuxIdentityPath,
  tmuxSessionName,
  type WakePhase,
  type WorkerId,
  type WorkerRole,
  workerDirOf,
} from './run-files.ts';
import type { HostLaunch } from './worker-host.ts';

export const WAKE_TYPE = 'pstack-worker';
export const READONLY_TOOLS = ['read', 'grep', 'find', 'ls'] as const;

export interface ResolvedModel {
  provider: string;
  id: string;
  thinkingLevel: ThinkingLevel | null;
}

/** Turns an assignment's model spec into a concrete model. src/models.ts supplies the role-aware one. */
export interface ModelRequest {
  model: string;
  thinkingLevel: ThinkingLevel | null;
  role: WorkerRole;
}

export type ModelResolver = (request: ModelRequest, ctx: ExtensionContext) => ResolvedModel | Promise<ResolvedModel>;

/** `<provider>/<id>` literally; `inherit-parent` takes the parent session's model and thinking level. */
export const literalModelResolver: ModelResolver = ({ model, thinkingLevel }, ctx) => {
  if (model === 'inherit-parent') {
    if (ctx.model === undefined) throw new Error('model inherit-parent: the parent session has no model selected');
    return { provider: ctx.model.provider, id: ctx.model.id, thinkingLevel: thinkingLevel ?? (ctx.thinkingLevel as ThinkingLevel | undefined) ?? null };
  }
  const slash = model.indexOf('/');
  return { provider: model.slice(0, slash), id: model.slice(slash + 1), thinkingLevel };
};

export interface WorkerToolOptions extends Omit<SpawnOptions, 'resolveModel' | 'exec'> {
  resolveModel?: ModelResolver;
  pollMs?: number;
}

export interface SpawnResult {
  workerId: WorkerId;
  tmuxSession: string;
  attach: string;
  sessionFile: string | null;
  model: { provider: string; id: string } | null;
}

export interface Transition {
  transitionId: string;
  runId: RunId;
  workerId: WorkerId;
  phase: WakePhase;
  reason: string | null;
}

/**
 * Every wake a worker owes its parent, derived only from what exists: the host's recorded settles, plus one
 * `unavailable` when the tmux session is gone and the host never recorded a terminal phase.
 */
export function workerTransitions(runId: RunId, workerId: WorkerId, state: HostState | undefined, claim: ClaimIdentity | undefined, sessionAlive: boolean | undefined): Transition[] {
  const instance = state?.instance ?? claim?.instance;
  if (instance === undefined) return [];
  const settles: Settle[] = state?.settles ?? [];
  const transitions: Transition[] = settles.map((settle) => ({ transitionId: `${workerId}:${instance}:${settle.sequence}`, runId, workerId, phase: settle.phase, reason: settle.reason }));
  if (sessionAlive === false && (state === undefined || !isTerminal(state.phase))) {
    const next = (settles.at(-1)?.sequence ?? 0) + 1;
    transitions.push({ transitionId: `${workerId}:${instance}:${next}`, runId, workerId, phase: 'unavailable', reason: 'The worker host is gone and recorded no final state' });
  }
  return transitions;
}

const PHASE_TEXT: Record<WakePhase, string> = {
  idle: 'finished its work and is idle',
  failed: 'failed',
  aborted: 'was aborted',
  exited: 'watch command exited',
  unavailable: 'is unavailable',
};

export function wakeText(transition: Transition): string {
  return `pstack worker ${transition.workerId} in run ${transition.runId} ${PHASE_TEXT[transition.phase]}${transition.reason === null ? '' : `: ${transition.reason}`}. Collect it with pstack_worker {"action":"collect","runId":"${transition.runId}","workerId":"${transition.workerId}"}.`;
}

/** Which `pstack_*` tmux sessions have a live pane. undefined when tmux itself could not answer. */
async function liveSessions(pi: ExtensionAPI, socket: string): Promise<Set<string> | undefined> {
  const result = await pi.exec('tmux', ['-L', socket, 'list-panes', '-a', '-F', '#{session_name} #{pane_dead}'], { timeout: 5_000 });
  if (result.code !== 0) return /no server running|error connecting|No such file/.test(result.stderr) ? new Set() : undefined;
  return new Set(
    result.stdout
      .split('\n')
      .map((line) => line.split(' '))
      .filter(([name, dead]) => name?.startsWith('pstack_') === true && dead === '0')
      .map(([name]) => name as string),
  );
}

/** Wakes on the active branch: from the root to the current leaf, the conversation the parent model sees. */
function deliveredTransitions(ctx: ExtensionContext): Set<string> {
  const ids = new Set<string>();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== 'custom_message' || entry.customType !== WAKE_TYPE) continue;
    const id = (entry.details as { transitionId?: unknown } | undefined)?.transitionId;
    if (typeof id === 'string') ids.add(id);
  }
  return ids;
}

function ownedRuns(project: string, sessionFile: string): { runId: RunId; runRoot: string }[] {
  const dir = runsDir(project);
  if (!existsSync(dir)) return [];
  const runs: { runId: RunId; runRoot: string }[] = [];
  for (const name of readdirSync(dir)) {
    const runRoot = join(dir, name);
    if (!existsSync(join(runRoot, 'run.json'))) continue;
    try {
      const run = readRun(runRoot);
      if (run.parentSessionFile === sessionFile) runs.push({ runId: run.runId, runRoot });
    } catch {
      // A malformed run.json belongs to whoever wrote it; it cannot be ours to wake.
    }
  }
  return runs;
}

function workerIds(runRoot: string): WorkerId[] {
  const dir = join(runRoot, 'workers');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    try {
      return [parseWorkerId(name)];
    } catch {
      return [];
    }
  });
}

function onPath(command: string): string {
  if (isAbsolute(command)) return command;
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    const candidate = join(dir, command);
    if (dir !== '' && existsSync(candidate)) return candidate;
  }
  throw new Error(`${command} is not on PATH`);
}

/** Node for the host: this process when it is Node, else `node` on PATH (Pi may run as a compiled binary or under Bun). */
function nodeExecutable(): string {
  return /^node(\.exe)?$/i.test(basename(process.execPath)) ? process.execPath : onPath('node');
}

/** Plain Node cannot strip types under node_modules, so an installed package runs the built host when it has one. */
function hostEntry(): string {
  const built = join(PACKAGE_ROOT, 'dist', 'worker-host.js');
  return existsSync(built) ? built : join(PACKAGE_ROOT, 'src', 'worker-host.ts');
}

function roleDocument(agentsDir: string, role: WorkerRole): string {
  const own = join(agentsDir, `${role}.md`);
  const path = (role === 'poteto' || role === 'comment-sicko') && existsSync(own) ? own : join(agentsDir, 'general.md');
  if (!existsSync(path)) throw new Error(`Role instructions are missing: ${path}`);
  return path;
}

// Credential sources pi-ai reads for these providers besides an API key variable (env-api-keys.js).
const AMBIENT_CREDENTIALS: Record<string, string[]> = {
  'amazon-bedrock': [
    'AWS_PROFILE',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_REGION',
    'AWS_DEFAULT_REGION',
    'AWS_BEARER_TOKEN_BEDROCK',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
  ],
  'google-vertex': ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION'],
};

/**
 * The environment variables that carry the provider's credentials, so a minimal worker environment keeps them.
 * Credentials from /login live in auth.json under PI_CODING_AGENT_DIR (or HOME's ~/.pi/agent), which env 'minimal' keeps.
 */
function credentialEnv(provider: string): string[] {
  return [...(findEnvKeys(provider) ?? []), ...(AMBIENT_CREDENTIALS[provider] ?? [])];
}

function finalAssistantText(sessionFile: string | null): string | null {
  if (sessionFile === null || !existsSync(sessionFile)) return null;
  let text: string | null = null;
  for (const line of readFileSync(sessionFile, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const entry = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
    if (entry.type !== 'message' || entry.message?.role !== 'assistant') continue;
    const content = entry.message.content;
    const parts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.flatMap((part: { type?: string; text?: string }) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])) : [];
    if (parts.length > 0) text = parts.join('');
  }
  return text;
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(relative(dir, path));
    }
  };
  walk(dir);
  return files.sort();
}

export type Exec = (command: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>;

const execFileAsync = promisify(execFile);

/** pi.exec's contract on plain Node, for callers without an ExtensionAPI. */
export const nodeExec: Exec = async (command, args, options) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: options.timeout, encoding: 'utf8' });
    return { stdout, stderr, code: 0, killed: false };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: unknown; killed?: boolean };
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? String(error), code: typeof failure.code === 'number' ? failure.code : 1, killed: failure.killed === true };
  }
};

export interface SpawnOptions {
  /** The assignment's model; null runs Pi's configured default. Defaults to the literal `<provider>/<id>`, and Pi's default for `inherit-parent`, since a run without a parent session has no model to inherit. */
  resolveModel?: (request: ModelRequest) => ResolvedModel | null | Promise<ResolvedModel | null>;
  exec?: Exec;
  /** tmux server name for `tmux -L`; tests use a private one. */
  tmuxSocket?: string;
  /** How the host starts Pi; the first element must resolve to an absolute executable. Defaults to the running Pi. */
  piCommand?: string[];
  /** Appended to every worker's Pi argv, after the contract's arguments. */
  extraPiArgs?: string[];
  /** Added to every worker's environment. */
  extraEnv?: Record<string, string>;
  /** Folder with the role instruction documents (`<role>.md`, `general.md`). */
  agentsDir?: string;
  startupMs?: number;
  /** How long a lost tmux answer is reconciled before a worker with no host and no session counts as never started. */
  startCheckMs?: number;
}

type StartCheck = { outcome: 'started'; identity: TmuxIdentity | undefined } | { outcome: 'not-started' } | { outcome: 'unknown' };

/**
 * Whether a host for the worker started, decided from what exists when tmux's own answer is lost. The host's
 * claim/identity.json proves it started, and the session whose pane is that host gives the tmux identity. No claim and
 * no session by the worker's name when the wait ends establishes that nothing started; a session by that name with no
 * claim leaves it unknown.
 */
async function checkStart(exec: Exec, socket: string, session: string, workerDir: string, waitMs: number): Promise<StartCheck> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const listed = await exec('tmux', ['-L', socket, 'list-panes', '-a', '-F', `#{session_name} #{pane_pid} ${TMUX_IDENTITY_FORMAT}`], { timeout: 5_000 });
    const noServer = listed.code !== 0 && /no server running|error connecting|No such file/.test(listed.stderr);
    const rows =
      listed.code === 0
        ? listed.stdout
            .split('\n')
            .map((line) => line.split(' '))
            .filter(([name]) => name === session)
        : [];
    let claim: ClaimIdentity | undefined;
    try {
      claim = readClaim(workerDir);
    } catch {
      // The host is still writing it.
    }
    if (claim !== undefined) {
      const row = rows.find(([, panePid]) => panePid === String(claim.hostPid));
      return { outcome: 'started', identity: row === undefined ? undefined : parseTmuxIdentity(row.slice(2).join(' ')) };
    }
    const sessionPresent = rows.length > 0 || (listed.code !== 0 && !noServer) || existsSync(join(workerDir, 'claim', 'identity.json'));
    if (Date.now() >= deadline) return sessionPresent ? { outcome: 'unknown' } : { outcome: 'not-started' };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const parentlessModel = ({ model, thinkingLevel }: ModelRequest): ResolvedModel | null => {
  if (model === 'inherit-parent') return null;
  const slash = model.indexOf('/');
  return { provider: model.slice(0, slash), id: model.slice(slash + 1), thinkingLevel };
};

/**
 * The one way a worker starts, for pstack_worker and for automation runs alike: claim the assignment, hand the host
 * its launch environment, start it in tmux, wait for its handshake, and send the brief. The caller checks ownership.
 */
export async function spawnAssignment(project: string, runId: RunId, assignmentPath: string, options: SpawnOptions = {}): Promise<SpawnResult> {
  const exec = options.exec ?? nodeExec;
  const socket = options.tmuxSocket ?? 'pstack';
  const agentsDir = options.agentsDir ?? join(PACKAGE_ROOT, 'generated', 'agents');
  const startupMs = options.startupMs ?? 30_000;
  const attach = (session: string) => `tmux -L ${socket} attach -t ${session}`;
  const runRoot = runRootOf(realpathSync(project), runId);
  const loaded = loadAssignment(assignmentPath);
  const assignment: Assignment = loaded.assignment;
  if (loaded.runRoot !== runRoot || assignment.runId !== runId) throw new Error(`Assignment must be ${join(runRoot, 'workers', '<workerId>', 'assignment.json')}`);
  if (assignment.capabilities.externalWrite) throw new Error(`Worker ${assignment.workerId} asks for externalWrite; only the parent or a trusted adapter writes to external systems, never a worker`);
  const session = tmuxSessionName(realpathSync(project), runId, assignment.workerId);
  let model: ResolvedModel | null = null;
  let roleDoc: string | null = null;
  if (assignment.kind === 'pi') {
    model = await (options.resolveModel ?? parentlessModel)({ model: assignment.model, thinkingLevel: assignment.thinkingLevel, role: assignment.role });
    roleDoc = roleDocument(agentsDir, assignment.role);
    readBrief(loaded.workerDir);
    if (assignment.workspace.mode === 'readonly' && (!existsSync(assignment.workspace.path) || !statSync(assignment.workspace.path).isDirectory())) throw new Error(`Readonly workspace ${assignment.workspace.path} is not a directory`);
  } else if (!existsSync(assignment.watch.cwd) || !statSync(assignment.watch.cwd).isDirectory()) throw new Error(`Watch cwd ${assignment.watch.cwd} is not a directory`);
  const command = options.piCommand ?? runningPiCommand();
  const launch: HostLaunch = {
    piCommand: [onPath(command[0] as string), ...command.slice(1)],
    model: model === null ? null : { provider: model.provider, id: model.id },
    thinkingLevel: model?.thinkingLevel ?? assignment.thinkingLevel,
    appendSystemPrompt: roleDoc,
    tools: assignment.workspace.mode === 'readonly' ? [...READONLY_TOOLS] : null,
    tmuxSession: session,
    extraArgs: options.extraPiArgs ?? [],
    credentialEnv: model === null ? [] : credentialEnv(model.provider),
  };
  // Values come from this process now, not from the tmux server, whose environment dates from when it started.
  const launchEnv = { ...Object.fromEntries(launch.credentialEnv.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]]))), ...options.extraEnv };
  const claimDir = join(loaded.workerDir, 'claim');
  try {
    mkdirSync(claimDir, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Worker ${assignment.workerId} is already claimed by a host; a second writer is forbidden. Spawn a fresh worker id instead.`);
    throw error;
  }
  const secrets = launchEnvPath(loaded.workerDir);
  const release = (error: Error) => {
    rmSync(claimDir, { recursive: true, force: true });
    return error;
  };
  const target = hostTarget(loaded);
  let state: HostState | undefined;
  // launch-env.json leaves the disk on every path out of here; claim/ goes only where non-start is established.
  try {
    try {
      writeFileSync(secrets, JSON.stringify(launchEnv), { mode: 0o600, flag: 'wx' });
    } catch (error) {
      throw release(error as Error);
    }
    const started = await exec('tmux', ['-L', socket, 'new-session', '-d', '-P', '-F', TMUX_IDENTITY_FORMAT, '-s', session, '-c', loaded.workerDir, '--', nodeExecutable(), hostEntry(), loaded.file, JSON.stringify(launch)], {
      timeout: 10_000,
    }).catch((error: unknown): Awaited<ReturnType<Exec>> => ({ stdout: '', stderr: error instanceof Error ? error.message : String(error), code: 1, killed: true }));
    // tmux exits with an error only when it created nothing. A killed or timed-out client says nothing about what the
    // server did, so the claim stays until the evidence settles it.
    if (started.code !== 0 && !started.killed) throw release(new Error(`tmux could not start ${session}: ${started.stderr.trim()}`));
    let tmuxIdentity = started.code === 0 ? parseTmuxIdentity(started.stdout) : undefined;
    if (tmuxIdentity === undefined) {
      const check = await checkStart(exec, socket, session, loaded.workerDir, options.startCheckMs ?? 10_000);
      const lost = `tmux gave no session identity for ${session} (${(started.stderr || started.stdout).trim()})`;
      if (check.outcome === 'not-started') throw release(new Error(`${lost}, and no host started or claimed it within the wait: the worker did not start and its claim is released`));
      if (check.outcome === 'unknown')
        throw new Error(`${lost}; a session by that name exists but no host claimed the worker, so whether it started is unknown. The claim stays: abort it, or spawn a fresh worker id. Attach: ${attach(session)}`);
      tmuxIdentity = check.identity;
    }
    if (tmuxIdentity !== undefined) writeFileSync(tmuxIdentityPath(loaded.workerDir), JSON.stringify(tmuxIdentity), { mode: 0o600, flag: 'wx' });
    appendEvent(runRoot, { runId, workerId: assignment.workerId, kind: 'spawn', data: { tmuxSession: session, model: launch.model } });
    const deadline = Date.now() + startupMs;
    while (Date.now() < deadline) {
      state = await inspectHost(target).catch(() => undefined);
      if (state !== undefined && state.phase !== 'starting') break;
      const written = readHostState(loaded.workerDir);
      if (written?.phase === 'failed') throw new Error(`Worker ${assignment.workerId} failed to start: ${written.reason}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    rmSync(secrets, { force: true });
  }
  if (state === undefined || state.phase === 'starting') throw new Error(`Worker ${assignment.workerId} did not answer within ${startupMs} ms; it holds its claim, so inspect or abort it rather than respawning. Attach: ${attach(session)}`);
  // A watch command that already exited has produced its event; only a failure stops the spawn.
  if (state.phase === 'failed') throw new Error(`Worker ${assignment.workerId} failed to start: ${state.reason}`);
  if (assignment.kind === 'pi') await controlHost(target, 'start');
  return { workerId: assignment.workerId, tmuxSession: session, attach: attach(session), sessionFile: state.sessionFile, model: launch.model };
}

const WorkerParams = Type.Object({
  action: StringEnum(['spawn', 'inspect', 'steer', 'abort', 'collect'] as const, {
    description: 'spawn starts a worker from its assignment file; inspect reads live state; steer sends a message; abort stops the worker; collect reads its result once settled.',
  }),
  runId: Type.String({ description: 'The run id (the folder under .pi/pstack/runs).' }),
  workerId: Type.Optional(Type.String({ description: 'inspect, steer, abort, collect: the worker id.' })),
  assignmentPath: Type.Optional(Type.String({ description: 'spawn: absolute path of <runRoot>/workers/<workerId>/assignment.json.' })),
  message: Type.Optional(Type.String({ description: 'steer: the instruction. Delivered as a steer while the worker runs, or as its next prompt when idle.' })),
});

const text = (value: string, details: unknown) => ({ content: [{ type: 'text' as const, text: value }], details });

export function registerWorkerTools(pi: ExtensionAPI, options: WorkerToolOptions = {}): void {
  const resolveModel = options.resolveModel ?? literalModelResolver;
  const socket = options.tmuxSocket ?? 'pstack';
  const pollMs = options.pollMs ?? 1_000;
  // Wakes this instance handed to Pi since the active branch last changed. A follow-up queued behind a running turn is
  // not on the branch yet.
  const sent = new Set<string>();
  // Bumped on every session_start and session_tree. A pass that began under an older version is discarded and rerun,
  // so it never sends wakes chosen for another session or branch.
  let branchVersion = 0;
  let current: { ctx: ExtensionContext; project: string } | undefined;
  let timer: NodeJS.Timeout | undefined;
  let polling: Promise<void> | undefined;

  /** One pass; false when the branch changed while it waited on tmux, so its view is stale and nothing was sent. */
  const reconcile = async ({ ctx, project }: { ctx: ExtensionContext; project: string }): Promise<boolean> => {
    const version = branchVersion;
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile === undefined) return true;
    const runs = ownedRuns(project, sessionFile);
    if (runs.length === 0) return true;
    // tmux first: a host writes its final state before exiting, so a session seen gone means state.json is final.
    const live = await liveSessions(pi, socket);
    if (version !== branchVersion) return false;
    const delivered = deliveredTransitions(ctx);
    for (const { runId, runRoot } of runs) {
      for (const workerId of workerIds(runRoot)) {
        const workerDir = workerDirOf(runRoot, workerId);
        let transitions: Transition[];
        try {
          transitions = workerTransitions(runId, workerId, readHostState(workerDir), readClaim(workerDir), live?.has(tmuxSessionName(project, runId, workerId)));
        } catch {
          continue;
        }
        for (const transition of transitions) {
          if (delivered.has(transition.transitionId) || sent.has(transition.transitionId)) continue;
          appendEvent(runRoot, { runId, workerId, kind: 'wake', data: { transitionId: transition.transitionId, phase: transition.phase } });
          // A throw stops this pass with the wake still unsent, so the next poll tries it again.
          pi.sendMessage({ customType: WAKE_TYPE, content: wakeText(transition), display: true, details: { transitionId: transition.transitionId, runId, workerId, phase: transition.phase } }, { triggerTurn: true, deliverAs: 'followUp' });
          sent.add(transition.transitionId);
        }
      }
    }
    return true;
  };

  const poll = (): Promise<void> => {
    if (polling !== undefined || current === undefined) return polling ?? Promise.resolve();
    polling = (async () => {
      while (current !== undefined && !(await reconcile(current))) {
        // The branch changed mid-pass; run again against the current one.
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        polling = undefined;
      });
    return polling;
  };

  const watch = (ctx: ExtensionContext) => {
    if (current?.ctx !== ctx) current = { ctx, project: projectRoot(ctx.cwd) };
    if (timer === undefined) {
      timer = setInterval(() => void poll(), pollMs);
      timer.unref();
    }
  };

  pi.on('session_start', async (_event, ctx) => {
    branchVersion += 1;
    sent.clear();
    watch(ctx);
    await poll();
  });
  pi.on('session_tree', async () => {
    branchVersion += 1;
    sent.clear();
    await poll();
  });
  pi.on('session_shutdown', async () => {
    clearInterval(timer);
    timer = undefined;
    current = undefined;
    await polling;
  });

  const runOf = (ctx: ExtensionContext, rawRunId: string) => {
    const runId = parseRunId(rawRunId);
    const project = projectRoot(ctx.cwd);
    const runRoot = runRootOf(project, runId);
    if (!existsSync(join(runRoot, 'run.json'))) throw new Error(`Run ${runId} has no run.json under ${runsDir(project)}`);
    return { runId, project, runRoot, run: readRun(runRoot) };
  };
  const requireOwner = (ctx: ExtensionContext, run: { parentSessionFile: string | null }, runId: RunId) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile === undefined || run.parentSessionFile !== sessionFile) throw new Error(`Run ${runId} belongs to session ${run.parentSessionFile ?? '(none)'}, not this one; only its parent session may control its workers`);
  };
  const workerOf = (runRoot: string, rawWorkerId: string | undefined) => {
    if (rawWorkerId === undefined) throw new Error('workerId is required');
    const workerId = parseWorkerId(rawWorkerId);
    return loadAssignment(join(workerDirOf(runRoot, workerId), 'assignment.json'));
  };

  const spawnWorker = async (ctx: ExtensionContext, rawRunId: string, assignmentPath: string | undefined): Promise<SpawnResult> => {
    if (assignmentPath === undefined) throw new Error('assignmentPath is required');
    const { runId, project, run } = runOf(ctx, rawRunId);
    requireOwner(ctx, run, runId);
    const result = await spawnAssignment(project, runId, assignmentPath, { ...options, exec: (command, args, execOptions) => pi.exec(command, args, execOptions), resolveModel: (request) => resolveModel(request, ctx) });
    watch(ctx);
    return result;
  };

  /**
   * The host does not answer. Ending its tmux session sends it SIGHUP, which runs the same orderly shutdown, but only
   * when the claimed session id still names the session created then, on the same server; anything else is left running.
   */
  const endHostSession = async (loaded: LoadedAssignment, reason: string) => {
    const owned = readTmuxIdentity(loaded.workerDir);
    const sessions = async () => {
      const listed = await pi.exec('tmux', ['-L', socket, 'list-sessions', '-F', TMUX_IDENTITY_FORMAT], { timeout: 5_000 });
      return listed.code === 0 ? listed.stdout.split('\n') : [];
    };
    if (owned === undefined) return { disposition: 'refused', reason: `${reason}; the claim records no tmux session, so nothing was ended` };
    const line = formatTmuxIdentity(owned);
    if (!(await sessions()).includes(line)) return { disposition: 'refused', reason: `${reason}; tmux session ${line} no longer exists, so nothing was ended` };
    // tmux checks the identity and kills in one server command, so the session cannot change in between.
    const same = `#{&&:#{==:#{pid},${owned.serverPid}},#{&&:#{==:#{start_time},${owned.serverStarted}},#{==:#{session_created},${owned.created}}}}`;
    await pi.exec('tmux', ['-L', socket, 'if-shell', '-F', '-t', owned.sessionId, same, `kill-session -t ${owned.sessionId}`], { timeout: 10_000 });
    return (await sessions()).includes(line) ? { disposition: 'refused', reason: `${reason}; tmux session ${line} did not end` } : { disposition: 'session-ended', reason };
  };

  const inspectWorker = async (loaded: LoadedAssignment): Promise<{ available: true; state: HostState } | { available: false; phase: 'unavailable'; reason: string; lastState: HostState | null }> => {
    try {
      return { available: true, state: await inspectHost(hostTarget(loaded)) };
    } catch (error) {
      return { available: false, phase: 'unavailable', reason: error instanceof Error ? error.message : String(error), lastState: readHostState(loaded.workerDir) ?? null };
    }
  };

  pi.registerTool({
    name: 'pstack_worker',
    label: 'pstack worker',
    description:
      'Run pstack workers: real Pi processes in tmux sessions, each with its own assignment file under .pi/pstack/runs/<runId>/workers/<workerId>/. spawn returns at once with the tmux attach command; the parent is woken by a pstack-worker message when the worker settles. inspect reads live state, steer sends an instruction, abort clears queued work and stops the worker, collect returns report.md, the final assistant text, and evidence files once the worker has settled.',
    promptSnippet: 'Spawn, inspect, steer, abort, or collect tmux-hosted pstack worker processes',
    promptGuidelines: ['Use pstack_worker collect only after a pstack-worker wake message or an inspect that shows the worker settled; before that it returns live state, not a result.'],
    parameters: WorkerParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.action === 'spawn') {
        const result = await spawnWorker(ctx, params.runId, params.assignmentPath);
        return text(
          `Spawned worker ${result.workerId} (${result.model === null ? 'watch' : `${result.model.provider}/${result.model.id}`}).\nAttach: ${result.attach}\nSession file: ${result.sessionFile ?? '(none)'}\nYou will get a pstack-worker message when it settles.`,
          result,
        );
      }
      const { runId, runRoot, run } = runOf(ctx, params.runId);
      const loaded = workerOf(runRoot, params.workerId);
      const { workerId } = loaded.assignment;
      if (params.action === 'inspect') {
        const result = await inspectWorker(loaded);
        return text(result.available ? `Worker ${workerId}: ${result.state.phase}` : `Worker ${workerId}: unavailable (${result.reason})`, result);
      }
      if (params.action === 'steer') {
        requireOwner(ctx, run, runId);
        if (params.message === undefined || params.message === '') throw new Error('message is required');
        const receipt = await controlHost(hostTarget(loaded), 'steer', params.message);
        appendEvent(runRoot, { runId, workerId, kind: 'steer', data: receipt });
        return text(`Sent to worker ${workerId}.`, receipt);
      }
      if (params.action === 'abort') {
        requireOwner(ctx, run, runId);
        let receipt: unknown;
        try {
          receipt = await controlHost(hostTarget(loaded), 'shutdown');
        } catch (error) {
          if (!(error instanceof HostUnavailableError)) throw error;
          receipt = await endHostSession(loaded, error.message);
        }
        appendEvent(runRoot, { runId, workerId, kind: 'abort', data: receipt });
        return text(`Aborted worker ${workerId}.`, receipt);
      }
      const inspected = await inspectWorker(loaded);
      const state = inspected.available ? inspected.state : inspected.lastState;
      const lastSettle = state?.settles.at(-1) ?? null;
      const settled = state !== null && lastSettle !== null && lastSettle.generation === state.generation && (isTerminal(state.phase) || state.phase === 'idle');
      if (!settled) {
        const live = inspected.available ? inspected.state : { phase: 'unavailable', reason: inspected.reason, lastState: inspected.lastState };
        return text(`Worker ${workerId} has not settled (${live.phase}); no result yet.`, { settled: false, live });
      }
      const report = join(loaded.workerDir, 'report.md');
      const result = {
        settled: true,
        available: inspected.available,
        phase: inspected.available ? state.phase : 'unavailable',
        lastSettle,
        report: existsSync(report) ? readFileSync(report, 'utf8') : null,
        finalText: finalAssistantText(state.sessionFile),
        evidence: listFiles(join(loaded.workerDir, 'evidence')),
        sessionFile: state.sessionFile,
      };
      return text(
        `Worker ${workerId} settled (${lastSettle.phase}${inspected.available ? '' : ', host gone'}).\n\nreport.md:\n${result.report ?? '(missing)'}\n\nFinal assistant text:\n${result.finalText ?? '(none)'}\n\nEvidence files: ${result.evidence.join(', ') || '(none)'}`,
        result,
      );
    },
  });
}
