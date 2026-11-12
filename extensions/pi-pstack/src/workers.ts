// pstack_worker (spec 8.4, 9): spawn, inspect, steer, abort, and collect tmux-hosted Pi workers, plus the settle
// watcher that wakes the parent session exactly once per worker transition (contract "Wakeups").
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, delimiter, isAbsolute, join, relative } from 'node:path';

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
  type HostState,
  isTerminal,
  type LoadedAssignment,
  loadAssignment,
  parseRunId,
  parseWorkerId,
  projectRoot,
  type RunId,
  readBrief,
  readClaim,
  readHostState,
  readRun,
  runRootOf,
  runsDir,
  type Settle,
  type ThinkingLevel,
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
export type ModelResolver = (request: { model: string; thinkingLevel: ThinkingLevel | null; role: WorkerRole }, ctx: ExtensionContext) => ResolvedModel | Promise<ResolvedModel>;

/** `<provider>/<id>` literally; `inherit-parent` takes the parent session's model and thinking level. */
export const literalModelResolver: ModelResolver = ({ model, thinkingLevel }, ctx) => {
  if (model === 'inherit-parent') {
    if (ctx.model === undefined) throw new Error('model inherit-parent: the parent session has no model selected');
    return { provider: ctx.model.provider, id: ctx.model.id, thinkingLevel: thinkingLevel ?? (ctx.thinkingLevel as ThinkingLevel | undefined) ?? null };
  }
  const slash = model.indexOf('/');
  return { provider: model.slice(0, slash), id: model.slice(slash + 1), thinkingLevel };
};

export interface WorkerToolOptions {
  resolveModel?: ModelResolver;
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
  pollMs?: number;
  startupMs?: number;
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
  const agentsDir = options.agentsDir ?? join(PACKAGE_ROOT, 'generated', 'agents');
  const pollMs = options.pollMs ?? 1_000;
  const startupMs = options.startupMs ?? 30_000;
  // Wakes this instance handed to Pi since the active branch last changed. A follow-up queued behind a running turn is
  // not on the branch yet.
  const sent = new Set<string>();
  let current: { ctx: ExtensionContext; project: string } | undefined;
  let timer: NodeJS.Timeout | undefined;
  let polling: Promise<void> | undefined;

  const attach = (session: string) => `tmux -L ${socket} attach -t ${session}`;

  const reconcile = async ({ ctx, project }: { ctx: ExtensionContext; project: string }): Promise<void> => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile === undefined) return;
    const runs = ownedRuns(project, sessionFile);
    if (runs.length === 0) return;
    // tmux first: a host writes its final state before exiting, so a session seen gone means state.json is final.
    const live = await liveSessions(pi, socket);
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
  };

  const poll = (): Promise<void> => {
    if (polling !== undefined || current === undefined) return polling ?? Promise.resolve();
    polling = reconcile(current)
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
    sent.clear();
    watch(ctx);
    await poll();
  });
  pi.on('session_tree', async () => {
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
    const { runId, project, runRoot, run } = runOf(ctx, rawRunId);
    requireOwner(ctx, run, runId);
    const loaded = loadAssignment(assignmentPath);
    const assignment: Assignment = loaded.assignment;
    if (loaded.runRoot !== runRoot || assignment.runId !== runId) throw new Error(`Assignment must be ${join(runRoot, 'workers', '<workerId>', 'assignment.json')}`);
    if (assignment.capabilities.externalWrite) throw new Error(`Worker ${assignment.workerId} asks for externalWrite; only the parent or a trusted adapter writes to external systems, never a worker`);
    if (existsSync(join(loaded.workerDir, 'claim'))) throw new Error(`Worker ${assignment.workerId} is already claimed by a host; a second writer is forbidden. Spawn a fresh worker id instead.`);
    const session = tmuxSessionName(project, runId, assignment.workerId);
    let model: ResolvedModel | null = null;
    let roleDoc: string | null = null;
    if (assignment.kind === 'pi') {
      model = await resolveModel({ model: assignment.model, thinkingLevel: assignment.thinkingLevel, role: assignment.role }, ctx);
      roleDoc = roleDocument(agentsDir, assignment.role);
      readBrief(loaded.workerDir);
      if (assignment.workspace.mode === 'readonly' && (!existsSync(assignment.workspace.path) || !statSync(assignment.workspace.path).isDirectory())) throw new Error(`Readonly workspace ${assignment.workspace.path} is not a directory`);
    } else if (!existsSync(assignment.watch.cwd) || !statSync(assignment.watch.cwd).isDirectory()) throw new Error(`Watch cwd ${assignment.watch.cwd} is not a directory`);
    const command = options.piCommand ?? runningPiCommand();
    const launch: HostLaunch = {
      piCommand: [onPath(command[0] as string), ...command.slice(1)],
      model: model === null ? null : { provider: model.provider, id: model.id },
      thinkingLevel: model?.thinkingLevel ?? null,
      appendSystemPrompt: roleDoc,
      tools: assignment.workspace.mode === 'readonly' ? [...READONLY_TOOLS] : null,
      tmuxSession: session,
      extraArgs: options.extraPiArgs ?? [],
      env: options.extraEnv ?? {},
      credentialEnv: model === null ? [] : credentialEnv(model.provider),
    };
    const started = await pi.exec('tmux', ['-L', socket, 'new-session', '-d', '-s', session, '-c', loaded.workerDir, '--', nodeExecutable(), hostEntry(), loaded.file, JSON.stringify(launch)], { timeout: 10_000 });
    if (started.code !== 0) throw new Error(`tmux could not start ${session}: ${started.stderr.trim()}`);
    appendEvent(runRoot, { runId, workerId: assignment.workerId, kind: 'spawn', data: { tmuxSession: session, model: launch.model } });
    watch(ctx);

    const target = hostTarget(loaded);
    const deadline = Date.now() + startupMs;
    let state: HostState | undefined;
    while (Date.now() < deadline) {
      state = await inspectHost(target).catch(() => undefined);
      if (state !== undefined && state.phase !== 'starting') break;
      const written = readHostState(loaded.workerDir);
      if (written?.phase === 'failed') throw new Error(`Worker ${assignment.workerId} failed to start: ${written.reason}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (state === undefined || state.phase === 'starting')
      throw new Error(`Worker ${assignment.workerId} did not answer within ${startupMs} ms; it holds its claim, so inspect or abort it rather than respawning. Attach: ${attach(session)}`);
    // A watch command that already exited has produced its event; only a failure stops the spawn.
    if (state.phase === 'failed') throw new Error(`Worker ${assignment.workerId} failed to start: ${state.reason}`);
    if (assignment.kind === 'pi') await controlHost(target, 'start');
    return { workerId: assignment.workerId, tmuxSession: session, attach: attach(session), sessionFile: state.sessionFile, model: launch.model };
  };

  /**
   * The host does not answer. Ending its tmux session sends it SIGHUP, which runs the same orderly shutdown, but only
   * when the session's one pane is this assignment's claimed host; anything else is left running.
   */
  const endHostSession = async (loaded: LoadedAssignment, session: string, reason: string) => {
    const claim = readClaim(loaded.workerDir);
    const panes = await pi.exec('tmux', ['-L', socket, 'list-panes', '-s', '-t', `=${session}`, '-F', '#{pane_pid}'], { timeout: 5_000 });
    if (panes.code !== 0) return { disposition: 'unavailable', reason };
    const pids = panes.stdout.split('\n').filter((line) => line !== '');
    if (claim === undefined || pids.length !== 1 || Number(pids[0]) !== claim.hostPid)
      return { disposition: 'refused', reason: `${reason}; tmux session ${session} runs pid ${pids.join(',')}, not this worker's claimed host ${claim?.hostPid ?? '(no claim)'}, so it was left running` };
    const killed = await pi.exec('tmux', ['-L', socket, 'kill-session', '-t', `=${session}`], { timeout: 10_000 });
    return { disposition: killed.code === 0 ? 'session-ended' : 'unavailable', reason };
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
      const { runId, project, runRoot, run } = runOf(ctx, params.runId);
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
        const session = tmuxSessionName(project, runId, workerId);
        let receipt: unknown;
        try {
          receipt = await controlHost(hostTarget(loaded), 'shutdown');
        } catch (error) {
          if (!(error instanceof HostUnavailableError)) throw error;
          receipt = await endHostSession(loaded, session, error.message);
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
