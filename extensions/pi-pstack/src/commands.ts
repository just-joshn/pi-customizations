// /pstack (spec 8.3): the operator's one command. It turns the persistent style on and off, diagnoses the install,
// lists and controls runs and workers, and starts the automation event sources as watch workers.
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { VERSION } from '@earendil-works/pi-coding-agent';
import type { BennyAutomationKind } from './automation/model.ts';
import { listReceipts, verifyTarget } from './evidence.ts';
import { loadModelsConfig, type ResolvedModel, ROLE_NAMES, resolveRole } from './models.ts';
import { PACKAGE_ROOT, upstreamRevision } from './paths.ts';
import { controlHost, HostUnavailableError, hostTarget, inspectHost } from './rpc-client.ts';
import { appendEvent, loadAssignment, parseRunId, parseWorkerId, projectRoot, type RunId, readHostState, readRun, runRootOf, runsDir, tmuxSessionName, type WorkerId, workerDirOf, writeJsonAtomic } from './run-files.ts';
import { GENERATED_SKILLS, generatedSkillNames, type SlashConflict } from './skill-routing.ts';
import { STYLE_SKILL, setStyle, styleOn, styleSkillPath } from './style.ts';
import { type SpawnOptions, spawnAssignment, workerSocket } from './workers.ts';

export const MODELS_PATH = join(homedir(), '.pi', 'agent', 'pstack', 'models.json');
export const USAGE = 'Usage: /pstack on | off | status | doctor | workers | pause <run-id> | resume <run-id> | audit <run-id> | automation start|stop|status <name>';

export type PstackCommand =
  | { kind: 'on' | 'off' | 'status' | 'doctor' | 'workers' }
  | { kind: 'pause' | 'resume' | 'audit'; runId: RunId }
  | { kind: 'automation'; action: 'start' | 'stop' | 'status'; name: string }
  | { kind: 'usage'; error: string | null };

const AUTOMATION_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function parsePstackArgs(args: string): PstackCommand {
  const [verb = 'status', ...rest] = args.trim().split(/\s+/).filter(Boolean);
  if ((verb === 'on' || verb === 'off' || verb === 'status' || verb === 'doctor' || verb === 'workers') && rest.length === 0) return { kind: verb };
  if (verb === 'pause' || verb === 'resume' || verb === 'audit') {
    if (rest.length !== 1) return { kind: 'usage', error: `/pstack ${verb} takes one run id` };
    try {
      return { kind: verb, runId: parseRunId(rest[0]) };
    } catch (error) {
      return { kind: 'usage', error: (error as Error).message };
    }
  }
  if (verb === 'automation') {
    const [action, name] = rest;
    if ((action === 'start' || action === 'stop' || action === 'status') && name !== undefined && rest.length === 2) {
      return AUTOMATION_NAME.test(name) ? { kind: 'automation', action, name } : { kind: 'usage', error: `Automation name ${name} must match ${AUTOMATION_NAME}` };
    }
    return { kind: 'usage', error: '/pstack automation takes start, stop, or status and a name' };
  }
  return { kind: 'usage', error: verb === 'help' ? null : `Unknown /pstack subcommand: ${args.trim()}` };
}

// ---- TODO.md audit (contract "TODO.md")

export interface TodoItem {
  state: 'open' | 'done' | 'skipped';
  title: string;
  evidence: string[];
  skip: string | null;
}

/** Checkbox items of TODO.md. A step's nested lines belong to it, so its evidence or skip note may sit on any of them. */
export function parseTodo(text: string): TodoItem[] {
  const items: TodoItem[] = [];
  let block: string[] = [];
  const flush = () => {
    const all = block.join('\n');
    const match = /^- \[( |x|X|~)\] (.*)$/.exec(block[0] ?? '');
    block = [];
    if (match === null) return;
    const evidence = [...all.matchAll(/\(evidence: ([^)]+)\)/g)].flatMap((found) => (found[1] ?? '').split(/[,\s]+/).filter(Boolean));
    const skip = /\(skip: ([^)]*)\)/.exec(all)?.[1] ?? null;
    items.push({ state: match[1] === '~' ? 'skipped' : match[1] === ' ' ? 'open' : 'done', title: match[2] ?? '', evidence, skip });
  };
  for (const line of text.split('\n')) {
    if (/^- \[/.test(line) || /^#/.test(line)) {
      flush();
      block = [line];
    } else if (block.length > 0) block.push(line);
  }
  flush();
  return items;
}

export interface AuditLine {
  item: TodoItem;
  verdict: 'pass' | 'fail' | 'inconclusive' | 'open' | 'skipped';
  notes: string[];
}

/** Each done step against its receipts: a step is done only when every receipt it cites verifies, as pstack_evidence verify checks it. */
export function auditRun(runRoot: string, runId: RunId): AuditLine[] {
  const todo = join(runRoot, 'TODO.md');
  if (!existsSync(todo)) throw new Error(`Run ${runId} has no TODO.md`);
  const receipts = listReceipts(runRoot, runId);
  return parseTodo(readFileSync(todo, 'utf8')).map((item): AuditLine => {
    if (item.state === 'open') return { item, verdict: 'open', notes: [] };
    if (item.state === 'skipped') return { item, verdict: 'skipped', notes: [item.skip === null ? 'skipped with no reason' : `skip: ${item.skip}`] };
    if (item.evidence.length === 0) return { item, verdict: 'inconclusive', notes: ['marked done with no evidence receipt'] };
    const notes: string[] = [];
    const verdicts = item.evidence.map((id) => {
      const recorded = receipts.find((entry) => entry.receipt.id === id);
      if (recorded === undefined) {
        notes.push(`receipt ${id} is not recorded`);
        return 'inconclusive';
      }
      const verdict = verifyTarget(runRoot, runId, recorded.receipt.target);
      notes.push(`${id} -> ${recorded.receipt.target}: ${verdict.kind}${verdict.kind === 'fail' ? ` (${verdict.defects.join('; ')})` : verdict.kind === 'inconclusive' ? ` (${verdict.reason})` : ''}`);
      return verdict.kind;
    });
    const verdict = verdicts.includes('fail') ? 'fail' : verdicts.includes('inconclusive') ? 'inconclusive' : 'pass';
    return { item, verdict, notes };
  });
}

const AUDIT_MARK: Record<AuditLine['verdict'], string> = { pass: '[x] pass', fail: '[x] FAIL', inconclusive: '[x] UNPROVEN', open: '[ ]', skipped: '[~]' };

function auditText(runId: RunId, lines: AuditLine[]): string {
  const count = (verdict: AuditLine['verdict']) => lines.filter((line) => line.verdict === verdict).length;
  return [
    `Audit of run ${runId}: ${count('pass')} proven, ${count('fail')} failed, ${count('inconclusive')} unproven, ${count('open')} open, ${count('skipped')} skipped.`,
    ...lines.flatMap((line) => [`${AUDIT_MARK[line.verdict]} ${line.item.title}`, ...line.notes.map((note) => `    ${note}`)]),
  ].join('\n');
}

// ---- runs and workers

interface RunView {
  runId: RunId;
  runRoot: string;
  project: string;
  title: string;
  parentSessionFile: string | null;
}

function runAt(project: string, runId: RunId): RunView {
  const runRoot = runRootOf(project, runId);
  if (!existsSync(join(runRoot, 'run.json'))) throw new Error(`Run ${runId} has no run.json under ${runsDir(project)}`);
  const run = readRun(runRoot);
  return { runId, runRoot, project, title: run.title, parentSessionFile: run.parentSessionFile };
}

function workerIdsOf(runRoot: string): WorkerId[] {
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

/** The latest pause or resume in the run's event trail. */
export function runPaused(runRoot: string): boolean {
  const path = join(runRoot, 'events.jsonl');
  if (!existsSync(path)) return false;
  let paused = false;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const kind = (JSON.parse(line) as { kind?: unknown }).kind;
      if (kind === 'pause') paused = true;
      if (kind === 'resume') paused = false;
    } catch {
      // A torn final line from a crashed writer says nothing about pausing.
    }
  }
  return paused;
}

function requireOwner(ctx: ExtensionContext, run: RunView): void {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (run.parentSessionFile === null) throw new Error(`Run ${run.runId} belongs to an automation adapter, not a chat; stop its source with /pstack automation stop`);
  if (sessionFile === undefined || run.parentSessionFile !== sessionFile) throw new Error(`Run ${run.runId} belongs to session ${run.parentSessionFile}, not this one; only its parent session may pause or resume it`);
}

type Exec = ExtensionAPI['exec'];

/** Names of the tmux sessions on the pstack server; undefined when tmux could not answer. */
async function tmuxSessions(exec: Exec, socket: string): Promise<Set<string> | undefined> {
  const listed = await exec('tmux', ['-L', socket, 'list-sessions', '-F', '#{session_name}'], { timeout: 5_000 }).catch(() => undefined);
  if (listed === undefined) return undefined;
  if (listed.code !== 0) return /no server running|error connecting|No such file/.test(listed.stderr) ? new Set() : undefined;
  return new Set(listed.stdout.split('\n').filter(Boolean));
}

interface WorkerView {
  workerId: WorkerId;
  kind: string;
  role: string;
  phase: string;
  session: string;
  live: boolean | undefined;
}

function workerView(run: RunView, workerId: WorkerId, sessions: Set<string> | undefined): WorkerView {
  const workerDir = workerDirOf(run.runRoot, workerId);
  let kind = '?';
  let role = '?';
  try {
    const { assignment } = loadAssignment(join(workerDir, 'assignment.json'));
    kind = assignment.kind;
    role = assignment.role;
  } catch {
    // An unreadable assignment still shows the worker, with its state.
  }
  let phase: string;
  try {
    phase = readHostState(workerDir)?.phase ?? (existsSync(join(workerDir, 'claim')) ? 'claimed' : 'not spawned');
  } catch (error) {
    phase = `unreadable state (${(error as Error).message})`;
  }
  const session = tmuxSessionName(run.project, run.runId, workerId);
  return { workerId, kind, role, phase, session, live: sessions?.has(session) };
}

const attachOf = (socket: string, session: string) => `tmux -L ${socket} attach -t ${session}`;

function workerLine(view: WorkerView, socket: string): string {
  const tmux = view.live === undefined ? 'tmux unknown' : view.live ? `attach: ${attachOf(socket, view.session)}` : 'tmux session gone';
  return `  ${view.workerId} (${view.kind}, ${view.role}): ${view.phase}; ${tmux}`;
}

function ownerLabel(ctx: ExtensionContext, run: RunView): string {
  if (run.parentSessionFile === null) return 'automation';
  return run.parentSessionFile === ctx.sessionManager.getSessionFile() ? 'this session' : 'another session';
}

async function workersText(exec: Exec, socket: string, ctx: ExtensionContext): Promise<string> {
  const project = projectRoot(ctx.cwd);
  const dir = runsDir(project);
  const runIds = existsSync(dir) ? readdirSync(dir).filter((name) => existsSync(join(dir, name, 'run.json'))) : [];
  if (runIds.length === 0) return `No pstack runs under ${dir}.`;
  const sessions = await tmuxSessions(exec, socket);
  const lines: string[] = [];
  for (const name of runIds.sort()) {
    let run: RunView;
    try {
      run = runAt(project, parseRunId(name));
    } catch (error) {
      lines.push(`${name}: unreadable (${(error as Error).message})`);
      continue;
    }
    lines.push(`${run.runId} "${run.title}" (owner: ${ownerLabel(ctx, run)}${runPaused(run.runRoot) ? ', paused' : ''})`);
    const workers = workerIdsOf(run.runRoot);
    if (workers.length === 0) lines.push('  no workers');
    for (const workerId of workers) lines.push(workerLine(workerView(run, workerId, sessions), socket));
  }
  return lines.join('\n');
}

/** abort semantics (contract pstack_worker abort): the host clears queued work, aborts the run, and shuts down. */
async function stopWorker(run: RunView, workerId: WorkerId, by: string): Promise<string> {
  const loaded = loadAssignment(join(workerDirOf(run.runRoot, workerId), 'assignment.json'));
  try {
    const receipt = await controlHost(hostTarget(loaded), 'shutdown');
    appendEvent(run.runRoot, { runId: run.runId, workerId, kind: 'abort', data: { by, receipt } });
    return 'stopped';
  } catch (error) {
    if (!(error instanceof HostUnavailableError)) return `refused (${(error as Error).message})`;
    return `not live (${readHostState(loaded.workerDir)?.phase ?? 'no host state'})`;
  }
}

async function dirtyWorktree(exec: Exec, run: RunView, workerId: WorkerId): Promise<string | undefined> {
  const worktree = join(workerDirOf(run.runRoot, workerId), 'worktree');
  if (!existsSync(worktree)) return undefined;
  const status = await exec('git', ['-C', worktree, 'status', '--porcelain'], { timeout: 10_000 });
  return status.code === 0 && status.stdout.trim() !== '' ? worktree : undefined;
}

async function pauseText(pi: ExtensionAPI, ctx: ExtensionContext, runId: RunId): Promise<string> {
  const run = runAt(projectRoot(ctx.cwd), runId);
  requireOwner(ctx, run);
  appendEvent(run.runRoot, { runId, kind: 'pause', data: { sessionFile: ctx.sessionManager.getSessionFile() ?? null } });
  pi.appendEntry('pstack/run', { runId, action: 'pause' });
  const lines = [`Paused run ${runId}. Its workers were stopped; their worktrees and session files stay on disk.`];
  for (const workerId of workerIdsOf(run.runRoot)) {
    const outcome = await stopWorker(run, workerId, 'pause');
    const dirty = await dirtyWorktree(pi.exec.bind(pi), run, workerId);
    lines.push(`  ${workerId}: ${outcome}${dirty === undefined ? '' : `; uncommitted changes kept in ${dirty}`}`);
  }
  lines.push(`Resume with /pstack resume ${runId}.`);
  return lines.join('\n');
}

async function resumeText(pi: ExtensionAPI, ctx: ExtensionContext, socket: string, runId: RunId): Promise<string> {
  const run = runAt(projectRoot(ctx.cwd), runId);
  requireOwner(ctx, run);
  const wasPaused = runPaused(run.runRoot);
  appendEvent(run.runRoot, { runId, kind: 'resume', data: { sessionFile: ctx.sessionManager.getSessionFile() ?? null } });
  pi.appendEntry('pstack/run', { runId, action: 'resume' });
  const sessions = await tmuxSessions(pi.exec.bind(pi), socket);
  const lines = [`Resumed run ${runId}${wasPaused ? '' : ' (it was not paused)'}. Workers:`];
  for (const workerId of workerIdsOf(run.runRoot)) {
    const view = workerView(run, workerId, sessions);
    let live: string | undefined;
    try {
      live = (await inspectHost(hostTarget(loadAssignment(join(workerDirOf(run.runRoot, workerId), 'assignment.json'))))).phase;
    } catch {
      live = undefined;
    }
    const next =
      live !== undefined
        ? `live (${live})`
        : view.phase === 'stopped' || view.phase === 'failed' || view.phase === 'exited'
          ? `${view.phase}; respawn its remaining work under a fresh worker id with a consolidated brief`
          : `${view.phase}; no live host`;
    lines.push(`  ${workerId}: ${next}`);
  }
  return lines.join('\n');
}

// ---- automation event sources as watch workers

/** One run per automation source; each start is a fresh worker, since a claimed worker is never spawned twice. */
export const automationRunId = (name: string): RunId => parseRunId(`serve-${createHash('sha256').update(name).digest('hex').slice(0, 12)}`);

export type AutomationSource = { kind: 'routine' } | { kind: 'benny'; bennyKind: BennyAutomationKind };

/**
 * A routine made by routine-setup, or the Benny automation whose configured name this is. The Benny loader needs the
 * yaml dependency, so it loads only here: a local install without node_modules still loads the extension.
 */
export async function automationSource(project: string, name: string): Promise<AutomationSource> {
  const routine = join(project, '.pi', 'pstack', 'automation', name, 'config.json');
  if (existsSync(routine) && (JSON.parse(readFileSync(routine, 'utf8')) as { kind?: unknown }).kind === 'routine') return { kind: 'routine' };
  const problems: string[] = [];
  if (existsSync(join(project, '.pi', 'benny', 'configuration.yaml'))) {
    const { loadBennyConfig } = await import('./automation/configuration.ts');
    for (const bennyKind of ['triage', 'reproduce'] as const) {
      try {
        if (loadBennyConfig(project, bennyKind).name === name) return { kind: 'benny', bennyKind };
      } catch (error) {
        problems.push((error as Error).message);
      }
    }
  }
  throw new Error(`No automation named ${name}: no routine at ${routine} and no Benny automation by that name in .pi/benny/configuration.yaml${problems.length === 0 ? '' : ` (${[...new Set(problems)].join('; ')})`}`);
}

export function automationArgv(project: string, name: string, source: AutomationSource): string[] {
  if (source.kind === 'routine') return ['node', join(PACKAGE_ROOT, 'scripts', 'routine-setup.mjs'), '--project', project, '--name', name, '--serve'];
  return ['node', join(PACKAGE_ROOT, 'scripts', 'automation-serve.mjs'), '--project', project, '--kind', source.bennyKind];
}

async function liveSources(run: RunView): Promise<WorkerId[]> {
  const live: WorkerId[] = [];
  for (const workerId of workerIdsOf(run.runRoot)) {
    try {
      const state = await inspectHost(hostTarget(loadAssignment(join(workerDirOf(run.runRoot, workerId), 'assignment.json'))));
      if (state.phase !== 'stopped' && state.phase !== 'failed' && state.phase !== 'exited') live.push(workerId);
    } catch {
      // No host answers: not running.
    }
  }
  return live;
}

async function startAutomation(ctx: ExtensionContext, name: string, spawnOptions: SpawnOptions): Promise<string> {
  const project = projectRoot(ctx.cwd);
  const source = await automationSource(project, name);
  const runId = automationRunId(name);
  const runRoot = runRootOf(project, runId);
  if (!existsSync(join(runRoot, 'run.json'))) {
    mkdirSync(join(runRoot, 'workers'), { recursive: true });
    writeJsonAtomic(join(runRoot, 'run.json'), {
      schemaVersion: 1,
      runId,
      title: `Automation ${name} event source`,
      playbook: 'automation-source',
      upstreamRevision: upstreamRevision(),
      createdAt: new Date().toISOString(),
      parentSessionFile: ctx.sessionManager.getSessionFile() ?? null,
      inputCommit: null,
    });
  }
  const run = runAt(project, runId);
  const running = await liveSources(run);
  if (running.length > 0) return `Automation ${name} is already running as worker ${running.join(', ')}. Stop it first with /pstack automation stop ${name}.`;
  const workerId = parseWorkerId(`source-${workerIdsOf(runRoot).length + 1}`);
  const assignmentPath = join(workerDirOf(runRoot, workerId), 'assignment.json');
  mkdirSync(workerDirOf(runRoot, workerId));
  writeJsonAtomic(assignmentPath, {
    schemaVersion: 1,
    runId,
    workerId,
    kind: 'watch',
    role: 'watcher',
    model: 'inherit-parent',
    thinkingLevel: null,
    workspace: { mode: 'readonly', path: project },
    skills: [],
    watch: { argv: automationArgv(project, name, source), cwd: project },
  });
  const result = await spawnAssignment(project, runId, assignmentPath, spawnOptions);
  return `Started automation ${name} (${source.kind === 'routine' ? 'webhook routine' : `Benny ${source.bennyKind}`}) as watch worker ${workerId} in run ${runId}. Its receiver URL is printed in the tmux pane. Attach: ${result.attach}`;
}

async function stopAutomation(ctx: ExtensionContext, name: string): Promise<string> {
  const project = projectRoot(ctx.cwd);
  const runId = automationRunId(name);
  if (!existsSync(join(runRootOf(project, runId), 'run.json'))) return `Automation ${name} was never started in ${project}.`;
  const run = runAt(project, runId);
  const running = await liveSources(run);
  if (running.length === 0) return `Automation ${name} is not running.`;
  const outcomes = await Promise.all(running.map(async (workerId) => `${workerId}: ${await stopWorker(run, workerId, 'automation stop')}`));
  return `Stopped automation ${name}: ${outcomes.join(', ')}.`;
}

async function automationStatus(exec: Exec, socket: string, ctx: ExtensionContext, name: string): Promise<string> {
  const project = projectRoot(ctx.cwd);
  let kind: string;
  try {
    const source = await automationSource(project, name);
    kind = source.kind === 'routine' ? 'webhook routine' : `Benny ${source.bennyKind}`;
  } catch (error) {
    kind = `unconfigured (${(error as Error).message})`;
  }
  const runId = automationRunId(name);
  if (!existsSync(join(runRootOf(project, runId), 'run.json'))) return `Automation ${name}: ${kind}; never started.`;
  const run = runAt(project, runId);
  const sessions = await tmuxSessions(exec, socket);
  const running = await liveSources(run);
  const lines = [`Automation ${name}: ${kind}; ${running.length === 0 ? 'not running' : `running as ${running.join(', ')}`} (run ${runId}).`];
  for (const workerId of workerIdsOf(run.runRoot)) {
    const view = workerView(run, workerId, sessions);
    let url = '';
    if (view.live === true) {
      const pane = await exec('tmux', ['-L', socket, 'capture-pane', '-p', '-J', '-t', view.session], { timeout: 5_000 }).catch(() => undefined);
      const found = pane?.code === 0 ? /"url":"(https?:[^"]+)"/.exec(pane.stdout)?.[1] : undefined;
      if (found !== undefined) url = `; receiver ${found}`;
    }
    lines.push(`${workerLine(view, socket)}${url}`);
  }
  return lines.join('\n');
}

// ---- status and doctor

function statusText(pi: ExtensionAPI, ctx: ExtensionContext): string {
  const on = styleOn(ctx.sessionManager.getBranch());
  const project = projectRoot(ctx.cwd);
  const dir = runsDir(project);
  const sessionFile = ctx.sessionManager.getSessionFile();
  const runs = existsSync(dir) ? readdirSync(dir).filter((name) => existsSync(join(dir, name, 'run.json'))) : [];
  const owned = runs.filter((name) => {
    try {
      return readRun(join(dir, name)).parentSessionFile === sessionFile;
    } catch {
      return false;
    }
  });
  const skill = styleSkillPath(pi);
  return [
    `pstack style: ${on ? 'on' : 'off'} (${skill === undefined ? `${STYLE_SKILL} skill not loaded` : `${STYLE_SKILL} from ${skill}`}).`,
    `Runs in ${project}: ${runs.length}, ${owned.length} owned by this session${owned.some((name) => runPaused(join(dir, name))) ? ', some paused' : ''}. /pstack workers lists them.`,
  ].join('\n');
}

async function firstLine(exec: Exec, command: string, args: string[]): Promise<string | undefined> {
  const result = await exec(command, args, { timeout: 8_000 }).catch(() => undefined);
  return result?.code === 0 ? result.stdout.trim().split('\n')[0] : undefined;
}

async function containerEngine(exec: Exec): Promise<string> {
  const server = await firstLine(exec, 'docker', ['version', '--format', '{{.Server.Version}}']);
  if (server !== undefined) return `docker engine ${server}`;
  const client = await firstLine(exec, 'docker', ['--version']);
  if (client !== undefined) return `${client}, but its engine is not reachable`;
  const podman = await firstLine(exec, 'podman', ['--version']);
  return podman ?? 'none found (container workers are unavailable)';
}

function modelLines(ctx: ExtensionContext): string[] {
  if (!existsSync(MODELS_PATH)) return [`models.json: missing at ${MODELS_PATH}; the skill defaults apply (run /setup-pstack)`, ...roleLines(ctx, loadModelsConfig(MODELS_PATH))];
  try {
    const config = loadModelsConfig(MODELS_PATH);
    return [`models.json: valid at ${MODELS_PATH} (budget ${config.budget}, ${Object.keys(config.roles).length} role lines)`, ...roleLines(ctx, config)];
  } catch (error) {
    return [`models.json: INVALID at ${MODELS_PATH} (${(error as Error).message}); worker spawns fail until it is fixed`];
  }
}

const modelName = (model: ResolvedModel) => `${model.provider}/${model.id}:${model.thinkingLevel}`;

function roleLines(ctx: ExtensionContext, config: ReturnType<typeof loadModelsConfig>): string[] {
  if (ctx.model === undefined) return ['role resolution: skipped, the session has no model to resolve inherit-parent against'];
  const parent: ResolvedModel = { provider: ctx.model.provider, id: ctx.model.id, thinkingLevel: (ctx.thinkingLevel ?? 'off') as ResolvedModel['thinkingLevel'] };
  const limited = ROLE_NAMES.flatMap((role) => {
    const { models, limitations } = resolveRole(role, ctx.modelRegistry, parent, config);
    return limitations.length === 0 ? [] : [`  ${role}: ${models.map(modelName).join(', ') || 'unresolved'}; ${limitations.join('; ')}`];
  });
  return [`role resolution: ${ROLE_NAMES.length - limited.length} of ${ROLE_NAMES.length} roles resolve as configured`, ...limited];
}

/** Recording a receipt hard-links it into place (contract "Run files"), so the run root's filesystem must allow it. */
export function hardLinkCheck(runsRoot: string): string {
  let dir = runsRoot;
  while (!existsSync(dir)) dir = dirname(dir);
  let probe: string | undefined;
  try {
    probe = mkdtempSync(join(dir, '.pstack-link-check-'));
    writeFileSync(join(probe, 'a'), '');
    linkSync(join(probe, 'a'), join(probe, 'b'));
    return `hard links: supported at ${dir}`;
  } catch (error) {
    return `hard links: NOT supported at ${dir} (${(error as NodeJS.ErrnoException).code ?? (error as Error).message}); recording evidence receipts will fail`;
  } finally {
    if (probe !== undefined) rmSync(probe, { recursive: true, force: true });
  }
}

async function doctorText(pi: ExtensionAPI, ctx: ExtensionContext, conflicts: SlashConflict[]): Promise<string> {
  const exec = pi.exec.bind(pi);
  const tmux = await firstLine(exec, 'tmux', ['-V']);
  const mcpServers = [...new Set(pi.getAllTools().flatMap((tool) => (tool.name.startsWith('mcp__') ? [tool.name.split('__')[1] ?? ''] : [])))].filter(Boolean).sort();
  const generated = generatedSkillNames();
  const loaded = pi.getCommands().filter((command) => command.source === 'skill' && command.sourceInfo.path.startsWith(GENERATED_SKILLS)).length;
  return [
    'pstack doctor',
    `tmux: ${tmux ?? 'NOT FOUND (workers need tmux)'}`,
    `pi: ${VERSION}`,
    `container engine: ${await containerEngine(exec)}`,
    ...modelLines(ctx),
    `MCP servers: ${mcpServers.length === 0 ? 'none' : mcpServers.join(', ')}`,
    `generated skills: ${generated.length} (${loaded} loaded from ${GENERATED_SKILLS})`,
    `upstream lock: ${upstreamRevision()}`,
    hardLinkCheck(runsDir(projectRoot(ctx.cwd))),
    conflicts.length === 0 ? 'slash names: no conflicts; every skill has its /name' : `slash names: ${conflicts.length} conflict(s), use /pstack:<name>`,
    ...conflicts.map((conflict) => `  /${conflict.name} is ${conflict.owner}; use /pstack:${conflict.name}`),
  ].join('\n');
}

// ---- registration

export interface CommandOptions {
  conflicts: () => SlashConflict[];
  /** Passed to the automation source spawn; tests give it a private tmux server and environment. */
  spawnOptions?: SpawnOptions;
}

const SUBCOMMANDS = ['on', 'off', 'status', 'doctor', 'workers', 'pause', 'resume', 'audit', 'automation'];

export function registerPstackCommand(pi: ExtensionAPI, options: CommandOptions): void {
  const spawnOptions = options.spawnOptions ?? {};
  const run = async (command: PstackCommand, ctx: ExtensionCommandContext): Promise<string> => {
    const socket = workerSocket(spawnOptions.tmuxSocket);
    const exec = pi.exec.bind(pi);
    switch (command.kind) {
      case 'on': {
        if (styleSkillPath(pi) === undefined) throw new Error(`The ${STYLE_SKILL} skill is not loaded, so the pstack style cannot be turned on`);
        setStyle(pi, ctx, true);
        return `pstack style on. Each new task gets the ${STYLE_SKILL} skill once; /pstack off ends it.`;
      }
      case 'off':
        setStyle(pi, ctx, false);
        return 'pstack style off.';
      case 'status':
        return statusText(pi, ctx);
      case 'doctor':
        return doctorText(pi, ctx, options.conflicts());
      case 'workers':
        return workersText(exec, socket, ctx);
      case 'pause':
        return pauseText(pi, ctx, command.runId);
      case 'resume': {
        const text = await resumeText(pi, ctx, socket, command.runId);
        pi.sendMessage(
          {
            customType: 'pstack-run',
            content: `${text}\nFollow the Session pickup playbook for run ${command.runId}: its TODO.md, events.jsonl, and worker reports are the trail.`,
            display: true,
            details: { runId: command.runId, action: 'resume' },
          },
          { triggerTurn: true, deliverAs: 'followUp' },
        );
        return text;
      }
      case 'audit': {
        const runRoot = runAt(projectRoot(ctx.cwd), command.runId).runRoot;
        return auditText(command.runId, auditRun(runRoot, command.runId));
      }
      case 'automation':
        if (command.action === 'start') return startAutomation(ctx, command.name, { ...spawnOptions, tmuxSocket: socket });
        if (command.action === 'stop') return stopAutomation(ctx, command.name);
        return automationStatus(exec, socket, ctx, command.name);
      case 'usage':
        throw new Error(command.error === null ? USAGE : `${command.error}\n${USAGE}`);
    }
  };
  pi.registerCommand('pstack', {
    description: 'pstack: on, off, status, doctor, workers, pause/resume/audit <run-id>, automation start|stop|status <name>',
    getArgumentCompletions: (prefix) => {
      const items = SUBCOMMANDS.filter((name) => name.startsWith(prefix.trim())).map((name) => ({ value: name, label: name }));
      return items.length === 0 ? null : items;
    },
    handler: async (args, ctx) => {
      try {
        ctx.ui.notify(await run(parsePstackArgs(args), ctx), 'info');
      } catch (error) {
        ctx.ui.notify((error as Error).message, 'error');
      }
    },
  });
}
