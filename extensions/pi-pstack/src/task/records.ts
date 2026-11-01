import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseSessionEntries, SessionManager } from '@earendil-works/pi-coding-agent';
import type { ModelSpec } from './models.ts';
import type { Worktree } from './worktree.ts';

/** What resume needs to restart an agent the way it first ran. */
export interface AgentRecord {
  agentId: string;
  type: string;
  model?: ModelSpec;
  readonly: boolean;
  /** The parent workspace the agent belongs to; a cloud agent runs in `worktree` instead. */
  cwd: string;
  createdAt: string;
  /** 1 for a subagent of the main chat, 2 for a subagent of a subagent; absent in records written before it existed. */
  depth?: number;
  worktree?: Worktree;
  /** The agent whose transcript this one started as a copy of (Task `fork`). */
  forkedFrom?: string;
}

function isWorktree(value: unknown): value is Worktree {
  const worktree = value as Partial<Worktree> | null;
  return typeof worktree === 'object' && worktree !== null && (['path', 'cwd', 'branch', 'base', 'commit'] as const).every((key) => typeof worktree[key] === 'string');
}

function isModel(value: unknown): value is ModelSpec {
  const model = value as Partial<ModelSpec> | null;
  return typeof model === 'object' && model !== null && typeof model.provider === 'string' && typeof model.id === 'string' && (model.thinking === undefined || typeof model.thinking === 'string');
}

function isRecord(value: unknown, agentId: string): value is AgentRecord {
  const record = value as Partial<AgentRecord> | null;
  return (
    typeof record === 'object' &&
    record !== null &&
    !Array.isArray(record) &&
    record.agentId === agentId &&
    typeof record.type === 'string' &&
    typeof record.readonly === 'boolean' &&
    typeof record.cwd === 'string' &&
    typeof record.createdAt === 'string' &&
    (record.model === undefined || isModel(record.model)) &&
    (record.depth === undefined || Number.isInteger(record.depth)) &&
    (record.worktree === undefined || isWorktree(record.worktree)) &&
    (record.forkedFrom === undefined || typeof record.forkedFrom === 'string')
  );
}

export function writeRecord(dir: string, record: AgentRecord): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${record.agentId}.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

export function readRecord(dir: string, agentId: string): AgentRecord | undefined {
  const path = join(dir, `${agentId}.json`);
  if (!existsSync(path)) return undefined;
  const unreadable = new Error(`Agent record ${path} is unreadable; delete it and start a new agent.`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw unreadable;
    throw error;
  }
  if (!isRecord(value, agentId)) throw unreadable;
  return value;
}

/** Pi names a session file `<timestamp>_<session id>.jsonl`; the agent ID is the session ID. */
export function transcriptFor(dir: string, agentId: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const file = readdirSync(dir).find((name) => name.endsWith(`_${agentId}.jsonl`));
  return file === undefined ? undefined : join(dir, file);
}

/** The working directory a Pi session file's header names, or undefined without a readable header. */
function sessionCwd(file: string): string | undefined {
  const [header] = parseSessionEntries(readFileSync(file, 'utf8').split('\n', 1)[0] ?? '');
  return header?.type === 'session' && typeof header.cwd === 'string' && header.cwd !== '' ? header.cwd : undefined;
}

/**
 * Starts `agentId`'s transcript as a copy of `sourceId`'s, through Pi's own session fork: a new session ID in the
 * header, the source as its parent session, and the source's working directory, so `--session-id` finds it where the
 * source ran. Returns the new transcript path.
 */
export function forkTranscript(dir: string, sourceId: string, agentId: string, turns?: number): string {
  const source = transcriptFor(dir, sourceId);
  if (source === undefined) throw new Error(`Agent ${sourceId} has no transcript to fork.`);
  const cwd = sessionCwd(source);
  if (cwd === undefined) throw new Error(`Agent ${sourceId}'s transcript ${source} has no session header, so it cannot be forked.`);
  const fork = SessionManager.forkFrom(source, cwd, dir, { id: agentId });
  const file = fork.getSessionFile();
  if (file === undefined) throw new Error(`Pi did not write a transcript for the fork of agent ${sourceId}.`);
  if (turns !== undefined) keepFirstTurns(fork, file, turns);
  return file;
}

/**
 * Cuts the copy's active branch just before its (turns + 1)th user message, so the fork opens at the end of turn `turns`.
 * `SessionManager.createBranchedSession(leafId)` mints its own session ID and file name, so it cannot truncate the file
 * `forkFrom(..., { id: agentId })` wrote under the agent's ID (docs/native-gaps.md).
 */
function keepFirstTurns(fork: SessionManager, file: string, turns: number): void {
  const branch = fork.getBranch();
  const cut = branch.filter((entry) => entry.type === 'message' && entry.message.role === 'user')[turns];
  if (cut === undefined) return;
  const kept = [fork.getHeader(), ...branch.slice(0, branch.indexOf(cut))];
  writeFileSync(file, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(''), { mode: 0o600 });
}

/**
 * Tools a writable launch gives back: those a launch-only readonly run (plan mode) took from the agent's last writable
 * loadout. Pi restores the tool loadout a session last recorded, so without them the agent would stay readonly.
 */
export function readonlyLaunchRestores(transcript: string): string[] {
  const active = new Set<string>();
  let writable: string[] = [];
  for (const entry of SessionManager.open(transcript).getBranch()) {
    if (entry.type !== 'message' || entry.message.role !== 'system') continue;
    for (const tool of entry.message.toolsRemoved ?? []) active.delete(tool.name);
    for (const tool of entry.message.toolsAdded ?? []) active.add(tool.name);
    if (active.has('write') || active.has('edit')) writable = [...active];
  }
  return writable.filter((name) => !active.has(name));
}

/** IDs of every agent with a record in `dir`. */
export function recordIds(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const isPid = (value: number) => Number.isInteger(value) && value > 0;

/** The live pid the agent's run lock names, or undefined when no live process holds it. */
export function runningPid(dir: string, agentId: string): number | undefined {
  const holder = holderOf(join(dir, `${agentId}.lock`));
  return holder !== undefined && isPid(holder) && alive(holder) ? holder : undefined;
}

/** The pid a lock names: undefined when the file is gone, NaN when it holds no readable pid. */
function holderOf(path: string): number | undefined {
  try {
    return Number.parseInt(readFileSync(path, 'utf8'), 10);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function createExclusive(path: string): boolean {
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

function writeAtomically(path: string, text: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600 });
  renameSync(temporary, path);
}

const stillRunning = (agentId: string, holder: number | undefined, path: string) =>
  new Error(`Agent ${agentId} is still running (pid ${holder !== undefined && isPid(holder) ? holder : 'unknown'}; lock ${path}). Wait for its completion before resuming it.`);

export interface RunLock {
  /** Names the process that writes the transcript, so the lock stays held exactly as long as that process lives. */
  holdFor: (pid: number) => void;
  /** Removes the lock unless another holder has taken it over since. */
  release: () => void;
}

/**
 * Pi appends to a session file without a lock, so two processes on one agent ID would interleave its transcript.
 * The lock file holds the pid of the process writing the transcript. A lock without a readable pid counts as held.
 * A dead holder's lock is removed only if it still names that holder, then created again exclusively; two
 * processes taking over the same stale lock in the narrow window between that re-read and the removal can both succeed.
 */
export function acquireRunLock(dir: string, agentId: string): RunLock {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${agentId}.lock`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (createExclusive(path)) {
      let owner = process.pid;
      return {
        holdFor: (pid) => {
          writeAtomically(path, String(pid));
          owner = pid;
        },
        // Best effort: a lock left behind names a pid that will be dead, so the next acquire takes it over.
        release: () => {
          try {
            if (holderOf(path) === owner) rmSync(path, { force: true });
          } catch (error) {
            if (!['EACCES', 'EPERM', 'EROFS', 'EBUSY', 'EIO'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          }
        },
      };
    }
    const holder = holderOf(path);
    if (holder !== undefined && (!isPid(holder) || alive(holder))) throw stillRunning(agentId, holder, path);
    if (holder !== undefined && holderOf(path) === holder) rmSync(path, { force: true });
  }
  throw stillRunning(agentId, holderOf(path), path);
}
