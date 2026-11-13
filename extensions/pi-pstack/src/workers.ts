// pstack_worker (spec 8.4, 9): spawn, inspect, steer, abort, and collect tmux-hosted Pi workers, plus the settle
// watcher that wakes the parent session exactly once per worker transition (contract "Wakeups").
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';

import { StringEnum } from '@earendil-works/pi-ai';
import { findEnvKeys } from '@earendil-works/pi-ai/compat';
import { getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { agentDirOf, type ContainerAuth, MIN_OAUTH_LIFETIME_MS, prepareContainerAuth } from './container-auth.ts';
import { ENGINE_ENV, outDirOf, type PreparedContainer, prepareContainer, removeRecordedContainers, writeEngineRecord } from './container.ts';
import { ingestContainerReceipts, registerEvidenceTool } from './evidence.ts';
import { PACKAGE_ROOT, upstreamRevision } from './paths.ts';
import { piCommand as runningPiCommand } from './pi-command.ts';
import { createReadonlyBashTool, releaseReadonlySandbox } from './readonly-shell.ts';
import { controlHost, HostUnavailableError, hostTarget, inspectHost } from './rpc-client.ts';
import {
  type Assignment,
  appendEvent,
  type Capabilities,
  type ClaimIdentity,
  formatTmuxIdentity,
  ensureRun,
  ensureRunStateIgnored,
  type HostState,
  isInside,
  isTerminal,
  type LoadedAssignment,
  launchEnvPath,
  loadAssignment,
  parseRunId,
  parseTmuxIdentity,
  parseWorkerId,
  processStartTime,
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
  writeJsonAtomic,
} from './run-files.ts';
import { listFilesBelow, readFileBelow } from './untrusted-output.ts';
import { type HostLaunch, launchEnvironment } from './worker-host.ts';

export const WAKE_TYPE = 'pstack-worker';
export const READONLY_TOOLS = ['read', 'grep', 'find', 'ls', 'bash_readonly', 'pstack_evidence'] as const;
/**
 * Pi keeps MCP tools registered under a --tools list unless an entry starts with `mcp__`: codemode scripts and tool_search reach
 * them all (cli.md "MCP tools"). A readonly worker therefore names the read-only MCP tools it may use as `mcp__<server>__<tool>`
 * entries, which makes Pi filter the rest for codemode and tool_search alike. With none to name, `--exclude-tools 'mcp__*'` removes them all.
 */
export const MCP_ACCESS_TOOLS = ['codemode', 'tool_search'] as const;

const MCP_TOOL_NAME = /^mcp__[A-Za-z0-9_]+__[A-Za-z0-9_]+$/;

/**
 * An operator list of MCP tools: `<agent dir>/pstack/<name>`, `{ "tools": ["mcp__<server>__<tool>"] }`. Names are exact, so one entry
 * never admits a server's other tools by pattern or by namespace. A missing file is undefined, and a malformed one throws.
 */
function operatorToolList(env: Readonly<Record<string, string | undefined>>, name: string): string[] | undefined {
  const file = join(agentDirOf(env), 'pstack', name);
  if (!existsSync(file)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const tools = typeof raw === 'object' && raw !== null ? (raw as { tools?: unknown }).tools : undefined;
  if (!Array.isArray(tools) || !tools.every((tool) => typeof tool === 'string' && MCP_TOOL_NAME.test(tool))) throw new Error(`${file} must be { "tools": ["mcp__<server>__<tool>", ...] } with exact tool names and no patterns`);
  return tools;
}

/**
 * The operator's list of MCP tools a readonly worker may call, `<agent dir>/pstack/readonly-mcp.json`.
 * It is the only authority. A server's `readOnlyHint` annotation is not: Pi reports it, but it is the server's own unverified claim.
 * A missing file authorizes nothing.
 */
export function readonlyMcpTools(env: Readonly<Record<string, string | undefined>>): string[] {
  return operatorToolList(env, 'readonly-mcp.json') ?? [];
}

/**
 * The operator's list of MCP write tools the trusted tracker worker may call, `<agent dir>/pstack/tracker-mcp.json`. Only the agent
 * dir is read: no project file, adapter skill, or brief can add to it. A missing, malformed, or empty file throws, because a tracker
 * worker with no write authorization must not start, and nothing falls back to the unrestricted MCP route.
 */
export function trackerMcpTools(env: Readonly<Record<string, string | undefined>>): string[] {
  const file = join(agentDirOf(env), 'pstack', 'tracker-mcp.json');
  const tools = operatorToolList(env, 'tracker-mcp.json');
  if (tools === undefined) throw new Error(`${file} is missing; list the MCP write tools the tracker worker may call as { "tools": ["mcp__<server>__<tool>"] }`);
  if (tools.length === 0) throw new Error(`${file} lists no tools; name the MCP write tools the tracker worker may call`);
  return tools;
}

/**
 * Pi's tool selection for a readonly worker: read-class tools, plus the MCP route unless the worker has no MCP. Every worker
 * reaches only the `authorized` MCP tools. `externalWrite` never widens this.
 */
export function readonlyTools(capabilities: Pick<Capabilities, 'mcp'>, authorized: readonly string[]): { tools: string[]; excludeTools: string[] } {
  if (capabilities.mcp === 'none') return { tools: [...READONLY_TOOLS], excludeTools: [] };
  return { tools: [...READONLY_TOOLS, ...MCP_ACCESS_TOOLS, ...authorized], excludeTools: authorized.length === 0 ? ['mcp__*'] : [] };
}

export interface ResolvedModel {
  provider: string;
  id: string;
  thinkingLevel: ThinkingLevel | null;
  /** Why the resolved model or level is not the assignment's, when it is not. Recorded in the worker state, the spawn event, and the spawn reply. */
  note?: string;
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
  if (slash === -1) throw new Error(`Model ${model} is a family default; it needs the model registry to name a provider`);
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
  modelNote: string | null;
}

export interface Transition {
  transitionId: string;
  runId: RunId;
  workerId: WorkerId;
  phase: WakePhase;
  reason: string | null;
  /** A watch worker's output tail, carried by its `exited` wake. */
  output?: string;
}

/**
 * Every wake a worker owes its parent, derived only from what exists: the host's recorded settles, plus one
 * `unavailable` when the tmux session is gone and the host never recorded a terminal phase.
 */
export function workerTransitions(runId: RunId, workerId: WorkerId, state: HostState | undefined, claim: ClaimIdentity | undefined, sessionAlive: boolean | undefined): Transition[] {
  const instance = state?.instance ?? claim?.instance;
  if (instance === undefined) return [];
  const settles: Settle[] = state?.settles ?? [];
  const transitions: Transition[] = settles.map((settle) => ({ transitionId: `${workerId}:${instance}:${settle.sequence}`, runId, workerId, phase: settle.phase, reason: settle.reason, ...(settle.phase === 'exited' && state?.output ? { output: state.output } : {}) }));
  if (sessionAlive === false && (state === undefined || !isTerminal(state.phase))) {
    const next = (settles.at(-1)?.sequence ?? 0) + 1;
    transitions.push({ transitionId: `${workerId}:${instance}:${next}`, runId, workerId, phase: 'unavailable', reason: 'The worker host is gone and recorded no final state' });
  }
  return transitions;
}

const PHASE_TEXT: Record<WakePhase, string> = {
  idle: 'finished its work and is idle',
  handled: 'handled its prompt as a command and is idle',
  failed: 'failed',
  aborted: 'was aborted',
  exited: 'watch command exited',
  unavailable: 'is unavailable',
};

const WAKE_OUTPUT_TAIL = 1024;

export function wakeText(transition: Transition): string {
  return `pstack worker ${transition.workerId} in run ${transition.runId} ${PHASE_TEXT[transition.phase]}${transition.reason === null ? '' : `: ${transition.reason}`}.${transition.output === undefined ? '' : ` Last output:\n${transition.output.slice(-WAKE_OUTPUT_TAIL)}\n`} Collect it with pstack_worker {"action":"collect","runId":"${transition.runId}","workerId":"${transition.workerId}"}.`;
}

const collectedMarker = (workerDir: string, transitionId: string): string => join(workerDir, 'collected', transitionId.replace(/[^A-Za-z0-9._-]/g, '_'));

/** A settle the parent already collected owes it no wake: the result is in its context, and a wake would only buy a turn that repeats it. */
const isCollected = (workerDir: string, transitionId: string): boolean => existsSync(collectedMarker(workerDir, transitionId));

/** Marks every settle `collect` just returned. Idempotent: the marker is a file named for the transition, and writing it again changes nothing. */
function markCollected(workerDir: string, transitions: Transition[]): void {
  for (const { transitionId } of transitions) {
    const marker = collectedMarker(workerDir, transitionId);
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, '');
  }
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
 * The environment variables that carry the provider's credentials, so a minimal worker environment keeps them. With no
 * provider, Pi picks one itself, so every known provider's variables are kept.
 * Credentials from /login live in auth.json under PI_CODING_AGENT_DIR (or HOME's ~/.pi/agent), which env 'minimal' keeps.
 */
function credentialEnv(provider: string | undefined): string[] {
  if (provider === undefined) return [...new Set(getBuiltinProviders().flatMap(credentialEnv))];
  return [...(findEnvKeys(provider) ?? []), ...(AMBIENT_CREDENTIALS[provider] ?? [])];
}

/**
 * What Pi starts on when it gets no --model: `defaultProvider` and `defaultModel` in settings.json under the agent directory the
 * worker will see (PI_CODING_AGENT_DIR, else ~/.pi/agent). Either is undefined when the file names none.
 */
function defaultSettings(env: Record<string, string | undefined>): { provider: string | undefined; model: string | undefined } {
  try {
    const settings = JSON.parse(readFileSync(join(agentDirOf(env), 'settings.json'), 'utf8')) as { defaultProvider?: unknown; defaultModel?: unknown };
    return { provider: typeof settings.defaultProvider === 'string' ? settings.defaultProvider : undefined, model: typeof settings.defaultModel === 'string' ? settings.defaultModel : undefined };
  } catch {
    // Pi starts without this file's settings too.
    return { provider: undefined, model: undefined };
  }
}

const defaultProvider = (env: Record<string, string | undefined>): string | undefined => defaultSettings(env).provider;

function finalAssistantText(transcript: string | null): string | null {
  if (transcript === null) return null;
  let text: string | null = null;
  for (const line of transcript.split('\n')) {
    if (line.trim() === '') continue;
    let entry: { type?: string; message?: { role?: string; content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      // A crash can tear the last line, and a container worker's file is its own to write.
      continue;
    }
    if (entry.type !== 'message' || entry.message?.role !== 'assistant') continue;
    const content = entry.message.content;
    const parts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.flatMap((part: { type?: string; text?: string }) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])) : [];
    if (parts.length > 0) text = parts.join('');
  }
  return text;
}

const readTranscript = (sessionFile: string | null): string | null => (sessionFile === null || !existsSync(sessionFile) ? null : readFileSync(sessionFile, 'utf8'));

/**
 * A worker's final assistant message, read from its session file. A container worker's session file is under its output
 * directory, which it controls, so it is read without following a symlink (see untrusted-output.ts). Automation settling
 * and `collect` both read it here.
 */
export function workerFinalText(loaded: LoadedAssignment, sessionFile: string | null): string | null {
  const { workerDir, assignment } = loaded;
  if (assignment.workspace.mode !== 'container') return finalAssistantText(readTranscript(sessionFile));
  const sessionRel = sessionFile === null ? null : relative(workerDir, sessionFile);
  if (sessionRel === null || sessionRel.startsWith('..') || sessionRel.split('/')[0] !== 'session') return null;
  const file = readFileBelow(outDirOf(workerDir), sessionRel);
  return finalAssistantText(file.kind === 'ok' ? file.bytes.toString('utf8') : null);
}

function collectOutputs(loaded: LoadedAssignment, sessionFile: string | null): { report: string | null; finalText: string | null; evidence: string[] } {
  const { workerDir, assignment } = loaded;
  const finalText = workerFinalText(loaded, sessionFile);
  if (assignment.workspace.mode === 'readonly') return { report: finalText, finalText, evidence: [] };
  if (assignment.workspace.mode !== 'container') {
    const report = join(workerDir, 'report.md');
    return { report: existsSync(report) ? readFileSync(report, 'utf8') : null, finalText, evidence: listFiles(join(workerDir, 'evidence')) };
  }
  const out = outDirOf(workerDir);
  const report = readFileBelow(out, 'report.md');
  return {
    report: report.kind === 'ok' ? report.bytes.toString('utf8') : report.kind === 'missing' ? null : '(refused: report.md leaves the worker output directory)',
    finalText,
    evidence: listFilesBelow(out, 'evidence'),
  };
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
  /** Trusted code (the tracker adapter) may start a worker whose assignment holds `externalWrite: true`. `pstack_worker` never sets it, so a model cannot. */
  allowExternalWrite?: boolean;
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
  /** A container worker's Pi: the JS entry (`.../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`) of the install to mount. Defaults to PSTACK_CONTAINER_PI, then the running Pi. */
  containerPi?: string;
  /** Read-only host paths a container worker can also read, mounted at the same path. */
  containerMounts?: string[];
  /**
   * Has Pi resolve a provider's credential now: it refreshes an OAuth token near expiry and resolves a key that is a command or an
   * environment reference. A container worker never holds a refresh token, so the host does this before it hands over the token.
   * `pstack_worker` supplies the session's model registry; callers without one can pass only a literal key or a token with life left.
   */
  providerAuth?: (provider: string) => Promise<unknown>;
  /** Package directories that register the worker's model provider, in place of finding them in settings.json (or PSTACK_CONTAINER_PROVIDER_PACKAGES). */
  containerProviderPackages?: string[];
  /** The least life an OAuth access token may have left for a container worker. Defaults to 10 minutes. */
  minOAuthValidityMs?: number;
  /** How long the host may take to answer. A container worker's clone and install count, so it defaults to 5 minutes there and 30 seconds otherwise. */
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

/** Whether the brief names report.md; a worker whose brief never does is not missing a report it was never asked for. */
function briefAsksForReport(workerDir: string): boolean {
  try {
    return /report\.md/i.test(readBrief(workerDir).toString('utf8'));
  } catch {
    return false;
  }
}

const parentlessModel = ({ model, thinkingLevel }: ModelRequest): ResolvedModel | null => {
  if (model === 'inherit-parent') return null;
  const slash = model.indexOf('/');
  if (slash === -1) throw new Error(`Model ${model} is a family default; it needs the model registry to name a provider`);
  return { provider: model.slice(0, slash), id: model.slice(slash + 1), thinkingLevel };
};

/** Spawn tree levels, matching upstream Orchestrate: the root chat (1), a sub-coordinator (2), and its workers (3). */
const MAX_DEPTH = 3;

/** This process's level in the spawn tree: PSTACK_DEPTH, which the parent sets for every worker; the root has none. */
function spawnDepth(env: NodeJS.ProcessEnv): number {
  const raw = env['PSTACK_DEPTH'];
  if (raw === undefined || raw === '') return 1;
  if (!/^[1-9]$/.test(raw)) throw new Error(`PSTACK_DEPTH ${raw} is not a spawn depth`);
  return Number(raw);
}

/**
 * The one way a worker starts, for pstack_worker and for automation runs alike: claim the assignment, hand the host
 * its launch environment, start it in tmux, wait for its handshake, and send the brief. The caller checks ownership.
 */
/** The tmux server pstack workers live on. Under vitest the real `pstack` server is forbidden, so no test can touch a user's workers. */
/**
 * Whether the pid that claimed a worker is not its host. Only positive evidence counts: a dead pid, or a live pid with
 * a different start time. A start time that cannot be read leaves a live pid treated as the host, so its launch
 * secrets stay rather than being removed from a host that may still be starting.
 */
export function claimedHostGone(pid: number, hostStarted: string, startTime: (pid: number) => string | undefined = processStartTime): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
  }
  const started = startTime(pid);
  return started !== undefined && started !== hostStarted;
}

export function workerSocket(explicit?: string): string {
  const socket = explicit ?? process.env['PSTACK_TMUX_SOCKET'] ?? 'pstack';
  if (socket === 'pstack' && process.env['VITEST']) throw new Error('tests must not use the real pstack tmux server; set PSTACK_TMUX_SOCKET or pass tmuxSocket');
  return socket;
}

/** The MCP tools a readonly worker's --tools names: the read list, plus the tracker write list when a trusted spawner grants `externalWrite`. */
function authorizedMcpTools(capabilities: Pick<Capabilities, 'mcp' | 'externalWrite'>, env: Readonly<Record<string, string | undefined>>): string[] {
  if (capabilities.mcp === 'none') return [];
  return [...new Set([...readonlyMcpTools(env), ...(capabilities.externalWrite ? trackerMcpTools(env) : [])])];
}

export async function spawnAssignment(project: string, runId: RunId, assignmentPath: string, options: SpawnOptions = {}): Promise<SpawnResult> {
  const exec = options.exec ?? nodeExec;
  const socket = workerSocket(options.tmuxSocket);
  const agentsDir = options.agentsDir ?? join(PACKAGE_ROOT, 'generated', 'agents');
  const attach = (session: string) => `tmux -L ${socket} attach -t ${session}`;
  const root = realpathSync(project);
  const runRoot = runRootOf(root, runId);
  ensureRunStateIgnored(root);
  let loaded = loadAssignment(assignmentPath);
  const assignment: Assignment = loaded.assignment;
  if (loaded.runRoot !== runRoot || assignment.runId !== runId) throw new Error(`Assignment must be ${join(runRoot, 'workers', '<workerId>', 'assignment.json')}`);
  if (assignment.capabilities.externalWrite && options.allowExternalWrite !== true) throw new Error(`Worker ${assignment.workerId} asks for externalWrite; only the parent or a trusted adapter writes to external systems, never a worker`);
  if (assignment.capabilities.externalWrite && !(assignment.kind === 'pi' && assignment.workspace.mode === 'readonly')) throw new Error(`Worker ${assignment.workerId} asks for externalWrite; only a readonly Pi worker can hold it, never a worktree, container, or watch worker`);
  const depth = spawnDepth(process.env) + 1;
  const spawns = assignment.capabilities.spawn === true;
  if (depth > MAX_DEPTH) throw new Error(`Spawn depth is capped at ${MAX_DEPTH} levels (root, sub-coordinator, worker), and this process is at level ${depth - 1}; it cannot spawn workers`);
  if (spawns && depth === MAX_DEPTH) throw new Error(`Worker ${assignment.workerId} asks for spawn: true at depth ${depth}, the last of ${MAX_DEPTH} levels (root, sub-coordinator, worker); a sub-coordinator's workers cannot spawn`);
  const session = tmuxSessionName(root, runId, assignment.workerId);
  let model: ResolvedModel | null = null;
  let roleDoc: string | null = null;
  if (assignment.kind === 'pi') {
    model = await (options.resolveModel ?? parentlessModel)({ model: assignment.model, thinkingLevel: assignment.thinkingLevel, role: assignment.role });
    roleDoc = roleDocument(agentsDir, assignment.role);
    readBrief(loaded.workerDir);
    if (assignment.workspace.mode === 'readonly' && (!existsSync(assignment.workspace.path) || !statSync(assignment.workspace.path).isDirectory())) throw new Error(`Readonly workspace ${assignment.workspace.path} is not a directory`);
  } else if (!existsSync(assignment.watch.cwd) || !statSync(assignment.watch.cwd).isDirectory()) throw new Error(`Watch cwd ${assignment.watch.cwd} is not a directory`);
  const command = options.piCommand ?? runningPiCommand();
  // This process's environment now, not the tmux server's, which dates from when the server started.
  const source = { ...process.env, ...options.extraEnv };
  const inContainer = assignment.kind === 'pi' && assignment.workspace.mode === 'container';
  // A container sees no settings.json, so the model Pi would have defaulted to on the host is named to it.
  const hostDefault = inContainer && model === null ? defaultSettings(source) : undefined;
  const launchModel = model !== null ? { provider: model.provider, id: model.id } : hostDefault?.provider !== undefined && hostDefault.model !== undefined ? { provider: hostDefault.provider, id: hostDefault.model } : null;
  const provider = launchModel?.provider ?? (assignment.kind === 'pi' ? defaultProvider(source) : undefined);
  // Everything a container needs is settled before the claim, so a refusal leaves no claim behind.
  let container: PreparedContainer | null = null;
  if (assignment.kind === 'pi' && assignment.workspace.mode === 'container') {
    const auth: ContainerAuth | undefined =
      provider === undefined
        ? undefined
        : await prepareContainerAuth({
            provider,
            source,
            projectRoot: root,
            builtin: new Set(getBuiltinProviders()),
            ...(options.providerAuth === undefined ? {} : { resolve: options.providerAuth }),
            ...(options.containerProviderPackages === undefined ? {} : { packages: options.containerProviderPackages }),
            minOAuthValidityMs: options.minOAuthValidityMs ?? MIN_OAUTH_LIFETIME_MS,
          });
    container = await prepareContainer({
      project: root,
      runId,
      workerId: assignment.workerId,
      session,
      inputCommit: assignment.workspace.inputCommit,
      source,
      packageRoot: PACKAGE_ROOT,
      piEntry: options.containerPi ?? source['PSTACK_CONTAINER_PI'] ?? process.argv[1],
      roleDoc,
      extraMounts: options.containerMounts ?? [],
      forge: assignment.capabilities.forge === true,
      auth: { authJson: auth?.authJson ?? null, mounts: auth?.packages.mounts ?? [], extensions: auth?.packages.extensions ?? [] },
    });
  }
  const startupMs = options.startupMs ?? (container === null ? 30_000 : 300_000);
  const readonly = assignment.workspace.mode === 'readonly' ? readonlyTools(assignment.capabilities, authorizedMcpTools(assignment.capabilities, source)) : undefined;
  const launch: HostLaunch = {
    piCommand: container === null ? [onPath(command[0] as string), ...command.slice(1)] : container.piCommand,
    model: launchModel,
    modelNote: model?.note ?? null,
    thinkingLevel: model?.thinkingLevel ?? assignment.thinkingLevel,
    appendSystemPrompt: roleDoc,
    tools: readonly?.tools ?? null,
    excludeTools: readonly?.excludeTools ?? [],
    tmuxSession: session,
    extraArgs: [...(container?.piArgs ?? []), ...(options.extraPiArgs ?? [])],
    // A container worker's forge token travels under GH_TOKEN, so a minimal environment must let that name through.
    credentialEnv: assignment.kind === 'pi' ? [...credentialEnv(provider), ...(assignment.capabilities.forge === true ? ['GH_TOKEN'] : [])] : [],
    container: container?.plan ?? null,
  };
  // A sub-coordinator's workers share its tmux server and never inherit its PSTACK_SPAWN.
  const launchEnv = {
    // The docker client's own configuration travels with the snapshot, and the host keeps it out of the container.
    ...launchEnvironment(assignment.capabilities.env, container === null ? launch.credentialEnv : [...launch.credentialEnv, ...ENGINE_ENV], source, container === null),
    ...container?.env,
    PSTACK_DEPTH: String(depth),
    PSTACK_SPAWN: spawns ? '1' : null,
    ...(spawns ? { PSTACK_TMUX_SOCKET: socket } : {}),
  };
  const claimDir = join(loaded.workerDir, 'claim');
  // The claim protects an immutable, complete file: omitted defaults are written in while no one holds the claim.
  // Every spawner writes the same bytes, so a racing spawner that claims first loses nothing.
  if (!existsSync(claimDir) && readFileSync(loaded.file, 'utf8') !== `${JSON.stringify(assignment, null, 2)}\n`) {
    writeJsonAtomic(loaded.file, assignment);
    loaded = loadAssignment(loaded.file);
  }
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
      if (container !== null) writeEngineRecord(loaded.workerDir, container.engine);
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
    appendEvent(runRoot, {
      runId,
      workerId: assignment.workerId,
      kind: 'spawn',
      data: { tmuxSession: session, model: launch.model, ...(launch.modelNote === null ? {} : { modelNote: launch.modelNote }), ...(container === null ? {} : { container: { name: session, image: container.image, engine: container.engineVersion, remote: container.remote } }) },
    });
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
  return { workerId: assignment.workerId, tmuxSession: session, attach: attach(session), sessionFile: state.sessionFile, model: launch.model, modelNote: launch.modelNote ?? null };
}

const WorkerParams = Type.Object({
  action: StringEnum(['spawn', 'inspect', 'steer', 'abort', 'collect'] as const, {
    description: 'spawn starts a worker from its assignment file; inspect reads live state; steer sends a message; abort stops the worker; collect reads its result once settled.',
  }),
  runId: Type.String({
    description:
      'The run id, the folder under .pi/pstack/runs. You choose it: a short lowercase id such as how-retries. The first spawn into an id with no run creates the run for this session; later spawns, inspect, steer, abort, and collect reuse the id. A run another session owns is refused.',
  }),
  playbook: Type.Optional(Type.String({ description: 'spawn: the skill that started the run, recorded in run.json when this spawn creates the run (for example how, why, arena, swarm).' })),
  workerId: Type.Optional(Type.String({ description: 'inspect, steer, abort, collect: the worker id.' })),
  assignmentPath: Type.Optional(Type.String({ description: 'spawn: absolute path of <runRoot>/workers/<workerId>/assignment.json.' })),
  message: Type.Optional(Type.String({ description: 'steer: the instruction. Delivered as a steer while the worker runs, or as its next prompt when idle.' })),
});

const text = (value: string, details: unknown) => ({ content: [{ type: 'text' as const, text: value }], details });

/** What aborting a worker needs besides the worker: how to run tmux, which server, and how long to wait to learn whether a launch started. */
export interface AbortContext {
  exec: Exec;
  socket: string;
  startCheckMs: number;
}

const listedSessions = async ({ exec, socket }: AbortContext): Promise<string[]> => {
  const listed = await exec('tmux', ['-L', socket, 'list-sessions', '-F', TMUX_IDENTITY_FORMAT], { timeout: 5_000 });
  return listed.code === 0 ? listed.stdout.split('\n') : [];
};

/**
 * The host does not answer. Ending its tmux session sends it SIGHUP, which runs the same orderly shutdown, but only
 * when the claimed session id still names the session created then, on the same server; anything else is left running.
 */
const endHostSession = async (context: AbortContext, loaded: LoadedAssignment, reason: string) => {
  const owned = readTmuxIdentity(loaded.workerDir);
  if (owned === undefined) return { disposition: 'refused', reason: `${reason}; the claim records no tmux session, so nothing was ended` };
  const line = formatTmuxIdentity(owned);
  if (!(await listedSessions(context)).includes(line)) return { disposition: 'refused', reason: `${reason}; tmux session ${line} no longer exists, so nothing was ended` };
  // tmux checks the identity and kills in one server command, so the session cannot change in between.
  const same = `#{&&:#{==:#{pid},${owned.serverPid}},#{&&:#{==:#{start_time},${owned.serverStarted}},#{==:#{session_created},${owned.created}}}}`;
  await context.exec('tmux', ['-L', context.socket, 'if-shell', '-F', '-t', owned.sessionId, same, `kill-session -t ${owned.sessionId}`], { timeout: 10_000 });
  return (await listedSessions(context)).includes(line) ? { disposition: 'refused', reason: `${reason}; tmux session ${line} did not end` } : { disposition: 'session-ended', reason };
};

/**
 * Whether the host that claimed the worker can never run again: the session recorded in claim/tmux.json is gone from
 * the server, and no live process has the claim's host pid with the host's start time. A host that may still be
 * starting would read launch-env.json, so only then may the file go.
 */
const claimingHostGone = async (context: AbortContext, loaded: LoadedAssignment): Promise<boolean> => {
  const claim = readClaim(loaded.workerDir);
  const owned = readTmuxIdentity(loaded.workerDir);
  if (claim === undefined || owned === undefined || (await listedSessions(context)).includes(formatTmuxIdentity(owned))) return false;
  return claimedHostGone(claim.hostPid, claim.hostStarted);
};

/**
 * A claim with no identity.json may belong to a spawn whose parent died before tmux started a host. When no host and
 * no session by the worker's name appear within the wait, the worker is abandoned: its launch secrets are removed and
 * its claim stays, so it is never spawned again. A fresh worker id is the retry.
 */
async function abortUnreachable(context: AbortContext, project: string, loaded: LoadedAssignment, reason: string) {
  const { runId, workerId } = loaded.assignment;
  const claimDir = join(loaded.workerDir, 'claim');
  if (!existsSync(claimDir) || existsSync(join(claimDir, 'identity.json'))) {
    const ended = await endHostSession(context, loaded, reason);
    if (!existsSync(launchEnvPath(loaded.workerDir)) || !(await claimingHostGone(context, loaded))) return ended;
    rmSync(launchEnvPath(loaded.workerDir), { force: true });
    return { ...ended, reason: `${ended.reason}; the host that claimed the worker is gone, so its unread launch-env.json was removed` };
  }
  const check = await checkStart(context.exec, context.socket, tmuxSessionName(project, runId, workerId), loaded.workerDir, context.startCheckMs);
  if (check.outcome === 'started') {
    try {
      return await controlHost(hostTarget(loaded), 'shutdown');
    } catch (error) {
      if (!(error instanceof HostUnavailableError)) throw error;
      return endHostSession(context, loaded, error.message);
    }
  }
  if (check.outcome === 'unknown') return { disposition: 'refused', reason: `${reason}; a tmux session by the worker's name exists but no host claimed the worker, so nothing was ended` };
  rmSync(launchEnvPath(loaded.workerDir), { force: true });
  appendEvent(loaded.runRoot, { runId, workerId, kind: 'abandoned', data: { reason } });
  return { disposition: 'abandoned', reason: 'No host started for this claim. The claim stays, so the worker is never spawned again; retry with a fresh worker id' };
}

/** Removes the worker's container by label once abort has stopped its host, whichever way the host ended. */
async function removeContainers(project: string, loaded: LoadedAssignment) {
  if (loaded.assignment.workspace.mode !== 'container') return;
  const { runId, workerId } = loaded.assignment;
  // A worker with no claim never started a container, so there is nothing to remove.
  if (!existsSync(join(loaded.workerDir, 'claim'))) return;
  try {
    const ids = await removeRecordedContainers(loaded.workerDir, tmuxSessionName(project, runId, workerId));
    if (ids.length > 0) appendEvent(loaded.runRoot, { runId, workerId, kind: 'container_removed', data: { ids } });
  } catch (error) {
    appendEvent(loaded.runRoot, { runId, workerId, kind: 'container_removal_failed', data: { error: error instanceof Error ? error.message : String(error) } });
  }
}

/**
 * The `abort` action of pstack_worker: the host's `shutdown`, then, for a host that cannot be reached, the verified
 * paths above (end the claimed tmux session, or abandon a claim no host ever took), then container removal, and the
 * `abort` event with the receipt. Automation sources call this too, so a deadline reaches a worker the same way.
 */
export async function abortWorker(project: string, loaded: LoadedAssignment, options: { exec?: Exec; tmuxSocket?: string; startCheckMs?: number } = {}): Promise<unknown> {
  const context: AbortContext = { exec: options.exec ?? nodeExec, socket: workerSocket(options.tmuxSocket), startCheckMs: options.startCheckMs ?? 10_000 };
  let receipt: unknown;
  try {
    receipt = await controlHost(hostTarget(loaded), 'shutdown');
  } catch (error) {
    if (!(error instanceof HostUnavailableError)) throw error;
    receipt = await abortUnreachable(context, project, loaded, error.message);
  }
  await removeContainers(project, loaded);
  appendEvent(loaded.runRoot, { runId: loaded.assignment.runId, workerId: loaded.assignment.workerId, kind: 'abort', data: receipt });
  return receipt;
}

/**
 * The pstack tools inside a worker (PSTACK_WORKER=1): pstack_evidence always, bash_readonly in a readonly workspace
 * (PSTACK_READONLY=1), and pstack_worker only for a sub-coordinator, the worker its parent spawned with
 * capabilities.spawn (PSTACK_SPAWN=1).
 */
export function registerWorkerSideTools(pi: ExtensionAPI, env: NodeJS.ProcessEnv, options: WorkerToolOptions = {}): void {
  registerEvidenceTool(pi);
  if (env['PSTACK_READONLY'] === '1') {
    pi.registerTool(createReadonlyBashTool('bash_readonly'));
    pi.on('session_shutdown', releaseReadonlySandbox);
  }
  if (env['PSTACK_SPAWN'] === '1') registerWorkerTools(pi, options);
}

export function registerWorkerTools(pi: ExtensionAPI, options: WorkerToolOptions = {}): void {
  const resolveModel = options.resolveModel ?? literalModelResolver;
  const socket = workerSocket(options.tmuxSocket);
  const pollMs = options.pollMs ?? 1_000;
  const startCheckMs = options.startCheckMs ?? 10_000;
  const exec: Exec = (command, args, execOptions) => pi.exec(command, args, execOptions);
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
          if (delivered.has(transition.transitionId) || sent.has(transition.transitionId) || isCollected(workerDir, transition.transitionId)) continue;
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

  /** The first line of the brief, the run's title; the run id when the brief has no usable line. */
  const titleOf = (assignmentPath: string, runId: RunId): string => {
    try {
      const line = readFileSync(join(dirname(assignmentPath), 'brief.md'), 'utf8').split('\n').find((candidate) => candidate.trim() !== '');
      return line === undefined ? runId : line.trim().slice(0, 120);
    } catch {
      return runId;
    }
  };
  const commitOf = (project: string): string | null => {
    try {
      return execFileSync('git', ['-C', project, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };

  /** A skill outside poteto-mode names a free run id and spawns; the run it names is made here, owned by the caller. */
  const createRunFor = (ctx: ExtensionContext, rawRunId: string, assignmentPath: string, playbook: string | undefined): void => {
    const runId = parseRunId(rawRunId);
    const project = projectRoot(ctx.cwd);
    const runRoot = runRootOf(project, runId);
    if (existsSync(join(runRoot, 'run.json'))) return;
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile === undefined) throw new Error(`Run ${runId} has no run.json and this session has no session file to own one`);
    if (!existsSync(assignmentPath) || !isInside(runRoot, assignmentPath)) throw new Error(`Assignment must be ${join(runRoot, 'workers', '<workerId>', 'assignment.json')}`);
    ensureRun(project, { runId, title: titleOf(assignmentPath, runId), playbook: playbook ?? null, upstreamRevision: upstreamRevision(), parentSessionFile: sessionFile, inputCommit: commitOf(project) });
  };

  const spawnWorker = async (ctx: ExtensionContext, rawRunId: string, assignmentPath: string | undefined, playbook: string | undefined): Promise<SpawnResult> => {
    if (assignmentPath === undefined) throw new Error('assignmentPath is required');
    createRunFor(ctx, rawRunId, assignmentPath, playbook);
    const { runId, project, run } = runOf(ctx, rawRunId);
    requireOwner(ctx, run, runId);
    const registry = (ctx as { modelRegistry?: { getApiKeyForProvider(provider: string): Promise<unknown> } }).modelRegistry;
    const providerAuth = options.providerAuth ?? (registry === undefined ? undefined : (provider: string) => registry.getApiKeyForProvider(provider));
    const result = await spawnAssignment(project, runId, assignmentPath, { ...options, exec, ...(providerAuth === undefined ? {} : { providerAuth }), resolveModel: (request) => resolveModel(request, ctx) });
    watch(ctx);
    return result;
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
      `Run pstack workers: real Pi processes in tmux sessions, each with its own assignment file under .pi/pstack/runs/<runId>/workers/<workerId>/. You choose the runId (a short lowercase id); write the assignment and brief under it, then spawn: the first spawn into an id creates the run for this session, with no other setup. spawn returns with the tmux attach command once the worker's host answers. When tmux loses its answer about the launch, spawn first waits up to ${startCheckMs / 1000} s to learn whether the worker started. Assignment model accepts inherit-parent, <provider>/<id>, <provider>/<id>:<level>, or a family default such as grok-4.7-xhigh-fast. A suffix sets the level; a conflicting non-null thinkingLevel is rejected. The parent is woken by a pstack-worker message when the worker settles. inspect reads live state, steer sends an instruction, abort clears queued work and stops the worker, collect returns report.md, the final assistant text, and evidence files once the worker has settled. A readonly worker writes no report.md, so collect returns its final reply as the report.`,
    promptSnippet: 'Spawn, inspect, steer, abort, or collect tmux-hosted pstack worker processes',
    promptGuidelines: ['Use pstack_worker collect only after a pstack-worker wake message or an inspect that shows the worker settled; before that it returns live state, not a result.'],
    parameters: WorkerParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.action === 'spawn') {
        const result = await spawnWorker(ctx, params.runId, params.assignmentPath, params.playbook);
        return text(
          `Spawned worker ${result.workerId} (${result.model === null ? 'watch' : `${result.model.provider}/${result.model.id}`}).${result.modelNote === null ? '' : `\nModel note: ${result.modelNote}`}\nAttach: ${result.attach}\nSession file: ${result.sessionFile ?? '(none)'}\nYou will get a pstack-worker message when it settles.`,
          result,
        );
      }
      const { runId, project, runRoot, run } = runOf(ctx, params.runId);
      const loaded = workerOf(runRoot, params.workerId);
      const { workerId } = loaded.assignment;
      if (params.action === 'inspect') {
        const result = await inspectWorker(loaded);
        return text(result.available ? `Worker ${workerId}: ${result.state.phase}${result.state.output ? `\nOutput tail:\n${result.state.output}` : ''}` : `Worker ${workerId}: unavailable (${result.reason})`, result);
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
        const receipt = await abortWorker(project, loaded, { exec, tmuxSocket: socket, startCheckMs });
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
      const worker = collectOutputs(loaded, state.sessionFile);
      markCollected(loaded.workerDir, workerTransitions(runId, workerId, state, readClaim(loaded.workerDir), undefined));
      // The receipts a container worker recorded join the run's receipts here, so collect and verify agree on what exists.
      const receipts = loaded.assignment.workspace.mode === 'container' ? ingestContainerReceipts(runRoot, runId) : undefined;
      const result = {
        settled: true,
        available: inspected.available,
        phase: inspected.available ? state.phase : 'unavailable',
        lastSettle,
        ...worker,
        ...(receipts === undefined ? {} : { receipts }),
        sessionFile: state.sessionFile,
      };
      const rejected = receipts === undefined || receipts.rejected.length === 0 ? '' : `\n\nContainer receipts rejected: ${receipts.rejected.map(({ workerId: from, file, reason }) => `${from}/${file}: ${reason}`).join('; ')}`;
      const settledLine = `Worker ${workerId} settled (${lastSettle.phase}${inspected.available ? '' : ', host gone'}).`;
      if (loaded.assignment.workspace.mode === 'readonly') return text(`${settledLine}\n\nReport (a readonly worker's final reply, since it cannot write report.md):\n${result.finalText ?? '(none)'}${rejected}`, result);
      return text(
        `${settledLine}\n\nreport.md:\n${result.report ?? (briefAsksForReport(loaded.workerDir) ? '(missing: the brief asked for it and the worker did not write it)' : '(none requested: the brief never names report.md; the final assistant text below is the report)')}\n\nFinal assistant text:\n${result.finalText ?? '(none)'}\n\nEvidence files: ${result.evidence.join(', ') || '(none)'}${rejected}`,
        result,
      );
    },
  });
}
