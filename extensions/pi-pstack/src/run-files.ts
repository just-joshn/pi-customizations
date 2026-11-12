// Run-root files shared by the parent extension and the tmux-hosted worker host (contract "Run files").
// The host runs under plain Node, so this module imports nothing outside node: builtins.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export type RunId = string & { readonly __brand: 'RunId' };
export type WorkerId = string & { readonly __brand: 'WorkerId' };

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

function parseId<T extends string>(value: unknown, what: string): T {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`Invalid ${what}: must match ${ID.source}`);
  return value as T;
}
export const parseRunId = (value: unknown): RunId => parseId<RunId>(value, 'runId');
export const parseWorkerId = (value: unknown): WorkerId => parseId<WorkerId>(value, 'workerId');

/**
 * `pstack_<runId>_<workerId>_<hash>`. Ids never contain `_`, so the parts cannot run together, and the hash of the
 * project root keeps two projects' runs apart on the one `pstack` tmux server.
 */
export const tmuxSessionName = (project: string, runId: RunId, workerId: WorkerId): string => `pstack_${runId}_${workerId}_${createHash('sha256').update(`${project}\0${runId}\0${workerId}`).digest('hex').slice(0, 8)}`;
export const TMUX_SESSION = /^pstack_[a-z0-9-]+_[a-z0-9-]+_[0-9a-f]{8}$/;

/** The git toplevel of `cwd`, or `cwd` outside git; always a real path. */
export function projectRoot(cwd: string): string {
  try {
    return realpathSync(execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return realpathSync(cwd);
  }
}

export const runsDir = (project: string): string => join(project, '.pi', 'pstack', 'runs');
export const runRootOf = (project: string, runId: RunId): string => join(runsDir(project), runId);
const projectOfRunRoot = (runRoot: string): string => resolve(runRoot, '..', '..', '..', '..');
export const workerDirOf = (runRoot: string, workerId: WorkerId): string => join(runRoot, 'workers', workerId);

/** `path` lies inside `root` (or is `root`), after resolving symlinks of whatever exists. */
export function isInside(root: string, path: string): boolean {
  const real = (target: string): string => {
    let probe = resolve(target);
    const rest: string[] = [];
    while (!existsSync(probe)) {
      rest.unshift(basename(probe));
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    return join(realpathSync(probe), ...rest);
  };
  const rel = relative(real(root), real(path));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** The host's control socket. A path over 100 bytes would exceed the unix socket limit, so it moves under /tmp. */
export function controlSocketPath(runRoot: string, workerId: WorkerId): string {
  const local = join(workerDirOf(runRoot, workerId), 'control.sock');
  if (Buffer.byteLength(local) <= 100) return local;
  const uid = process.getuid?.() ?? 0;
  return join('/tmp', `pstack-${uid}`, `${createHash('sha256').update(runRoot).digest('hex').slice(0, 16)}-${workerId}.sock`);
}

export function writeJsonAtomic(path: string, value: unknown, mode = 0o600): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(temporary, path);
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const MAX_EVENT_DATA = 4096;

/** Appends one audit line to `events.jsonl`. Data is truncated so one line stays a single small append. */
export function appendEvent(runRoot: string, event: { runId: RunId; workerId?: WorkerId; kind: string; data?: unknown }): void {
  let data = JSON.stringify(event.data ?? null);
  if (data.length > MAX_EVENT_DATA) data = JSON.stringify(`${data.slice(0, MAX_EVENT_DATA)}…`);
  const line = `{"ts":${JSON.stringify(new Date().toISOString())},"runId":${JSON.stringify(event.runId)}${event.workerId === undefined ? '' : `,"workerId":${JSON.stringify(event.workerId)}`},"kind":${JSON.stringify(event.kind)},"data":${data}}\n`;
  appendFileSync(join(runRoot, 'events.jsonl'), line, { mode: 0o600 });
}

export interface RunRecord {
  schemaVersion: 1;
  runId: RunId;
  title: string;
  playbook: string;
  upstreamRevision: string;
  createdAt: string;
  parentSessionFile: string | null;
  inputCommit: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function readRun(runRoot: string): RunRecord {
  const raw = readJson(join(runRoot, 'run.json'));
  if (!isRecord(raw) || raw['schemaVersion'] !== 1) throw new Error(`${runRoot}/run.json: unsupported schema`);
  const runId = parseRunId(raw['runId']);
  if (runId !== basename(runRoot)) throw new Error(`${runRoot}/run.json: runId ${runId} does not name its directory`);
  const parent = raw['parentSessionFile'];
  if (parent !== null && typeof parent !== 'string') throw new Error(`${runRoot}/run.json: parentSessionFile must be a string or null`);
  return raw as unknown as RunRecord;
}

export const WORKER_ROLES = ['poteto', 'explorer', 'investigator', 'candidate', 'judge', 'verifier', 'reviewer', 'owner', 'watcher', 'comment-sicko', 'general'] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type Workspace = { mode: 'worktree'; inputCommit: string } | { mode: 'readonly'; path: string } | { mode: 'container'; inputCommit: string };

/** What a worker may reach beyond its workspace (contract "Capability boundary"). */
export interface Capabilities {
  mcp: 'inherit' | 'none';
  env: 'inherit' | 'minimal';
  externalWrite: boolean;
  /** Registers pstack_worker in the worker, for Orchestrate's sub-coordinators. Absent means false. */
  spawn?: boolean;
}
export const ENGINEERING_CAPABILITIES: Capabilities = { mcp: 'inherit', env: 'inherit', externalWrite: false };
/** Defaults for a worker of an automation run, the run whose run.json has no parent session. */
const AUTOMATION_CAPABILITIES: Capabilities = { mcp: 'none', env: 'minimal', externalWrite: false };

/** A container worker holds only its provider credential and what it is explicitly given, as an upstream cloud agent holds no host credentials: its environment defaults to 'minimal'. */
const defaultCapabilities = (role: Capabilities, workspace: Workspace): Capabilities => (workspace.mode === 'container' ? { ...role, env: 'minimal' } : role);

function parseCapabilities(raw: unknown): Capabilities {
  if (
    !isRecord(raw) ||
    !['env,externalWrite,mcp', 'env,externalWrite,mcp,spawn'].includes(Object.keys(raw).sort().join(',')) ||
    !['inherit', 'none'].includes(raw['mcp'] as string) ||
    !['inherit', 'minimal'].includes(raw['env'] as string) ||
    typeof raw['externalWrite'] !== 'boolean' ||
    (raw['spawn'] !== undefined && typeof raw['spawn'] !== 'boolean')
  )
    throw new Error("Assignment capabilities must be { mcp: 'inherit' | 'none', env: 'inherit' | 'minimal', externalWrite: boolean, spawn?: boolean }");
  return { mcp: raw['mcp'] as Capabilities['mcp'], env: raw['env'] as Capabilities['env'], externalWrite: raw['externalWrite'], ...(typeof raw['spawn'] === 'boolean' ? { spawn: raw['spawn'] } : {}) };
}

interface AssignmentBase {
  schemaVersion: 1;
  runId: RunId;
  workerId: WorkerId;
  role: WorkerRole;
  model: string;
  thinkingLevel: ThinkingLevel | null;
  workspace: Workspace;
  skills: string[];
  capabilities: Capabilities;
}
export type Assignment = (AssignmentBase & { kind: 'pi'; brief: string }) | (AssignmentBase & { kind: 'watch'; brief?: string; watch: { argv: string[]; cwd: string } });

const BRIEF = 'brief.md';
const MODEL_SPEC = /^(inherit-parent|[^/\s:]+\/[^\s]+)$/;
const COMMIT = /^[0-9a-f]{7,64}$/;

/** What an omitted optional field becomes: the default capabilities of the run's workers, and the project root for paths. */
export interface AssignmentDefaults {
  capabilities: Capabilities;
  projectRoot: string;
}

/**
 * Parses untrusted assignment JSON into the complete contract shape; unknown fields are rejected. Omitted
 * `schemaVersion`, `kind`, `skills`, `thinkingLevel`, `capabilities`, readonly `workspace.path`, and `watch.cwd` take
 * their defaults, so parsing a parsed assignment returns it unchanged.
 */
export function parseAssignment(raw: unknown, defaults: AssignmentDefaults): Assignment {
  if (!isRecord(raw)) throw new Error('Assignment must be a JSON object');
  const allowed = ['schemaVersion', 'runId', 'workerId', 'kind', 'role', 'brief', 'model', 'thinkingLevel', 'workspace', 'skills', 'watch', 'capabilities'];
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`Assignment has unknown fields: ${unknown.join(', ')}`);
  if ((raw['schemaVersion'] ?? 1) !== 1) throw new Error('Assignment schemaVersion must be 1');
  const runId = parseRunId(raw['runId']);
  const workerId = parseWorkerId(raw['workerId']);
  const kind = raw['kind'] ?? 'pi';
  if (kind !== 'pi' && kind !== 'watch') throw new Error("Assignment kind must be 'pi' or 'watch'");
  const role = raw['role'];
  if (typeof role !== 'string' || !(WORKER_ROLES as readonly string[]).includes(role)) throw new Error(`Assignment role must be one of ${WORKER_ROLES.join(', ')}`);
  const model = raw['model'];
  if (typeof model !== 'string' || !MODEL_SPEC.test(model)) throw new Error("Assignment model must be 'inherit-parent' or '<provider>/<id>'");
  const thinkingLevel = raw['thinkingLevel'] ?? null;
  if (thinkingLevel !== null && !(typeof thinkingLevel === 'string' && (THINKING_LEVELS as readonly string[]).includes(thinkingLevel))) throw new Error(`Assignment thinkingLevel must be null or one of ${THINKING_LEVELS.join(', ')}`);
  const workspace = raw['workspace'];
  if (!isRecord(workspace)) throw new Error('Assignment workspace must be an object');
  let parsedWorkspace: Workspace;
  if ((workspace['mode'] === 'worktree' || workspace['mode'] === 'container') && Object.keys(workspace).length === 2 && typeof workspace['inputCommit'] === 'string' && COMMIT.test(workspace['inputCommit']))
    parsedWorkspace = { mode: workspace['mode'], inputCommit: workspace['inputCommit'] };
  else if (workspace['mode'] === 'readonly' && Object.keys(workspace).every((key) => key === 'mode' || key === 'path') && (workspace['path'] === undefined || (typeof workspace['path'] === 'string' && isAbsolute(workspace['path']))))
    parsedWorkspace = { mode: 'readonly', path: (workspace['path'] as string | undefined) ?? defaults.projectRoot };
  else throw new Error("Assignment workspace must be { mode: 'worktree' | 'container', inputCommit: <sha> } or { mode: 'readonly', path: <absolute> }");
  const skills = raw['skills'] ?? [];
  if (!Array.isArray(skills) || skills.some((skill) => typeof skill !== 'string' || skill.length === 0)) throw new Error('Assignment skills must be an array of skill names');
  const brief = raw['brief'];
  if (brief !== undefined && brief !== BRIEF) throw new Error(`Assignment brief must be '${BRIEF}'`);
  const capabilities = raw['capabilities'] === undefined ? defaultCapabilities(defaults.capabilities, parsedWorkspace) : parseCapabilities(raw['capabilities']);
  if (capabilities.spawn === true && parsedWorkspace.mode !== 'worktree') throw new Error("Assignment capabilities.spawn needs a worktree workspace: a sub-coordinator writes its workers' assignments and keeps its runs in its own workspace");
  const base: AssignmentBase = { schemaVersion: 1, runId, workerId, role: role as WorkerRole, model, thinkingLevel: thinkingLevel as ThinkingLevel | null, workspace: parsedWorkspace, skills: skills as string[], capabilities };
  if (kind === 'pi') {
    if (raw['watch'] !== undefined) throw new Error("Assignment watch is only for kind 'watch'");
    if (typeof brief !== 'string') throw new Error("Assignment kind 'pi' needs a brief");
    return { ...base, kind, brief };
  }
  const watch = raw['watch'];
  if (!isRecord(watch) || Object.keys(watch).some((key) => key !== 'argv' && key !== 'cwd')) throw new Error("Assignment kind 'watch' needs watch: { argv, cwd }");
  const argv = watch['argv'];
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((part) => typeof part !== 'string' || part.includes('\0'))) throw new Error('Assignment watch.argv must be a non-empty string array');
  const cwd = watch['cwd'] ?? defaults.projectRoot;
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('Assignment watch.cwd must be absolute');
  return { ...base, kind, ...(typeof brief === 'string' ? { brief } : {}), watch: { argv: argv as string[], cwd } };
}

/**
 * The worker's brief, `<workerDir>/brief.md`: a regular file, not a symlink or a second name for a file elsewhere.
 * `workerDir` must be canonical, as loadAssignment guarantees.
 */
export function readBrief(workerDir: string): Buffer {
  const path = join(workerDir, BRIEF);
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new Error(`${path} must be a regular file, not a symlink`);
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path) throw new Error(`${path} must be a regular file with a single link inside the worker directory`);
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

export interface LoadedAssignment {
  assignment: Assignment;
  /** Canonical path of assignment.json. */
  file: string;
  runRoot: string;
  workerDir: string;
  /** sha256 of the assignment bytes: the identity both sides of the control socket must agree on. */
  digest: string;
}

function ownedEntry(path: string, directory: boolean): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error(`${path} must be a real ${directory ? 'directory' : 'file'}`);
  if (process.getuid !== undefined && stat.uid !== process.getuid()) throw new Error(`${path} is not owned by this user`);
}

/** Loads an assignment that must sit at its canonical `<runRoot>/workers/<workerId>/assignment.json`. */
export function loadAssignment(path: string): LoadedAssignment {
  if (!isAbsolute(path)) throw new Error('Assignment path must be absolute');
  const file = resolve(path);
  if (basename(file) !== 'assignment.json') throw new Error('Assignment file must be named assignment.json');
  ownedEntry(file, false);
  if (realpathSync(file) !== file) throw new Error('Assignment path must be canonical (no symlinks)');
  const workerDir = dirname(file);
  ownedEntry(workerDir, true);
  const runRoot = dirname(dirname(workerDir));
  if (basename(dirname(workerDir)) !== 'workers' || basename(dirname(runRoot)) !== 'runs') throw new Error('Assignment must be at <runRoot>/workers/<workerId>/assignment.json');
  const bytes = readFileSync(file);
  const automated = readRun(runRoot).parentSessionFile === null;
  const assignment = parseAssignment(JSON.parse(bytes.toString('utf8')), { capabilities: automated ? AUTOMATION_CAPABILITIES : ENGINEERING_CAPABILITIES, projectRoot: projectOfRunRoot(runRoot) });
  if (assignment.workerId !== basename(workerDir)) throw new Error(`Assignment workerId ${assignment.workerId} does not name its directory`);
  if (assignment.runId !== basename(runRoot)) throw new Error(`Assignment runId ${assignment.runId} does not name its run root`);
  return { assignment, file, runRoot, workerDir, digest: createHash('sha256').update(bytes).digest('hex') };
}

// The host process's state. A run's outcome is a Settle, so an aborted or failed run leaves a live host idle.
export const LIVE_PHASES = ['starting', 'idle', 'running', 'cancelling', 'stopping'] as const;
export const TERMINAL_PHASES = ['stopped', 'failed', 'exited'] as const;
export type HostPhase = (typeof LIVE_PHASES)[number] | (typeof TERMINAL_PHASES)[number];
/** 'handled': an extension command answered the prompt and no run started. */
export type SettlePhase = 'idle' | 'handled' | 'failed' | 'aborted' | 'exited';
export type WakePhase = SettlePhase | 'unavailable';

export interface Settle {
  sequence: number;
  /** The latest unit of work this outcome covers. */
  generation: number;
  phase: SettlePhase;
  reason: string | null;
  at: string;
}

export interface HostState {
  schemaVersion: 1;
  runId: RunId;
  workerId: WorkerId;
  kind: Assignment['kind'];
  digest: string;
  instance: string;
  hostPid: number;
  childPid: number | null;
  tmuxSession: string;
  socketPath: string;
  phase: HostPhase;
  reason: string | null;
  model: { provider: string; id: string } | null;
  sessionFile: string | null;
  briefSent: boolean;
  /** The latest unit of work the host accepted. A worker's result is a settle covering it. */
  generation: number;
  /** Every settle, oldest first: each one is a wake the parent may not have seen yet. */
  settles: Settle[];
  exit: { code: number | null; signal: string | null } | null;
  updatedAt: string;
}

/** A host with this many settles refuses new work rather than drop a settle the parent may not have seen. */
export const MAX_SETTLES = 10_000;

export const isTerminal = (phase: HostPhase): boolean => (TERMINAL_PHASES as readonly string[]).includes(phase);

export function readHostState(workerDir: string): HostState | undefined {
  const path = join(workerDir, 'state.json');
  if (!existsSync(path)) return undefined;
  const raw = readJson(path);
  if (!isRecord(raw) || raw['schemaVersion'] !== 1 || typeof raw['instance'] !== 'string' || !Array.isArray(raw['settles'])) throw new Error(`${path}: malformed host state`);
  return raw as unknown as HostState;
}

/** The host's claim record, written once when it takes the assignment. */
export interface ClaimIdentity {
  digest: string;
  instance: string;
  hostPid: number;
  /** processStartTime(hostPid) as the host read it, so a later process that reuses the pid is never taken for the host. */
  hostStarted: string;
}

/**
 * When the process with this pid started, as text that reads the same for the same process from any process, or
 * undefined when no process has the pid. Linux: starttime (clock ticks after boot) from /proc/<pid>/stat. Elsewhere:
 * `ps -o lstart=` in UTC under the C locale, to the second.
 */
export function processStartTime(pid: number): string | undefined {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // The command name, field 2, may contain spaces and parentheses; starttime is field 22.
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    } catch {
      return undefined;
    }
  }
  try {
    return execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { LC_ALL: 'C', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000 }).trim() || undefined;
  } catch {
    // ps exits non-zero when no process has the pid.
    return undefined;
  }
}

/**
 * Environment values the parent hands one host: provider credentials and configured extra variables. The parent
 * writes it 0600 and exclusively before starting the host; the host reads it once and unlinks it before Pi starts.
 */
export const launchEnvPath = (workerDir: string): string => join(workerDir, 'claim', 'launch-env.json');

/**
 * The tmux session the parent created for the host, as `new-session -P -F TMUX_IDENTITY_FORMAT` reported it. A
 * session id and creation second repeat when the server exits with its last session and restarts within the second,
 * so the server's pid and start time are part of the identity.
 */
export interface TmuxIdentity {
  serverPid: string;
  serverStarted: string;
  sessionId: string;
  created: string;
}

export const TMUX_IDENTITY_FORMAT = '#{pid} #{start_time} #{session_id} #{session_created}';
export const tmuxIdentityPath = (workerDir: string): string => join(workerDir, 'claim', 'tmux.json');
export const formatTmuxIdentity = (identity: TmuxIdentity): string => `${identity.serverPid} ${identity.serverStarted} ${identity.sessionId} ${identity.created}`;

export function parseTmuxIdentity(text: string): TmuxIdentity | undefined {
  const match = /^(\d+) (\d+) (\$\d+) (\d+)\n?$/.exec(text);
  return match === null ? undefined : { serverPid: match[1] as string, serverStarted: match[2] as string, sessionId: match[3] as string, created: match[4] as string };
}

export function readTmuxIdentity(workerDir: string): TmuxIdentity | undefined {
  const path = tmuxIdentityPath(workerDir);
  if (!existsSync(path)) return undefined;
  const raw = readJson(path);
  const identity = isRecord(raw) && ['serverPid', 'serverStarted', 'sessionId', 'created'].every((key) => typeof raw[key] === 'string') ? parseTmuxIdentity(formatTmuxIdentity(raw as unknown as TmuxIdentity)) : undefined;
  if (identity === undefined) throw new Error(`${path}: malformed tmux identity`);
  return identity;
}

export function readClaim(workerDir: string): ClaimIdentity | undefined {
  const path = join(workerDir, 'claim', 'identity.json');
  if (!existsSync(path)) return undefined;
  const raw = readJson(path);
  if (!isRecord(raw) || typeof raw['instance'] !== 'string' || typeof raw['hostStarted'] !== 'string') throw new Error(`${path}: malformed claim`);
  return raw as unknown as ClaimIdentity;
}
