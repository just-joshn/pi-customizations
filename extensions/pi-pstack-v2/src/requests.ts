import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { jobAgentDir } from './credentials.ts';
import { addWorktree, dropWorktree, gitPath, protectedPaths } from './git.ts';
import { brokeredSession, exitPath, type Job, type JobSpec, launchBrokered, readSpec, resultsDir, settleBrokered } from './jobs.ts';
import { landing, within } from './paths.ts';
import { type SandboxPolicy, sandboxed } from './sandbox.ts';

const MAX_REQUEST_DEPTH = 8;
const EXIT_REFUSED = 126;
const EXIT_LOST = 137;
const EXIT_LAUNCH_FAILED = 127;
const strings = z.array(z.string());

type CreatedWorktree = { path: string; repo: string; createdBranch: string | undefined };

const requestedWorktreePath = (out: string): string => landing(join(out, 'worktree'));

function createRequestedWorktree(top: Job, spec: JobSpec, out: string, grant: string[]): CreatedWorktree | { refused: string } {
  const asked: unknown = spec.createWorktree;
  if (spec.kind !== 'pi' || typeof asked !== 'object' || asked === null) return { refused: 'Only a Pi worker request can ask for a worktree.' };
  const { branch, base } = asked as Record<string, unknown>;
  if (typeof branch !== 'string' || (base !== undefined && typeof base !== 'string')) return { refused: 'Its worktree request is malformed.' };
  const repo = top.spec.cwd;
  const common = gitPath(repo, '--git-common-dir');
  if (common === undefined || !within(common, grant)) return { refused: `The worker that asked may not write the repository at ${repo}, so it cannot get a worktree of it.` };
  const path = requestedWorktreePath(out);
  try {
    return { path, repo, createdBranch: addWorktree(repo, path, branch, base) ? branch : undefined };
  } catch (error) {
    return { refused: `pstack could not create the worktree: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The checkouts a job may write, and the protected paths in them, which its wrapper sweeps after it for code that appeared. */
export const sweepFor = (policy: SandboxPolicy): JobSpec['sweep'] => ({
  // A job's own session, nested, temp, and agent directories live under Pi's agent directory. A worktree does too, and is a checkout.
  roots: policy.writable.filter((path) => (basename(path) === 'worktree' || !within(path, [policy.agentDir])) && !within(path, policy.gitDirs)),
  protect: policy.protect.filter((path) => within(path, policy.writable)),
});

const readGrant = (out: string): string[] => {
  try {
    const grant = strings.safeParse(JSON.parse(readFileSync(join(out, 'granted.json'), 'utf8')));
    return grant.success ? grant.data : [];
  } catch {
    return [];
  }
};

const isStrings = (value: unknown): value is string[] => strings.safeParse(value).success;

const tmuxKill = (socket: string, session: string): void => {
  try {
    execFileSync('tmux', ['-S', socket, 'kill-session', '-t', `=${session}`], { stdio: 'ignore' });
  } catch {
    // Already gone.
  }
};

function hasSession(socket: string, session: string): boolean {
  try {
    execFileSync('tmux', ['-S', socket, 'has-session', '-t', `=${session}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** A worker writes these files, so anything malformed is skipped instead of stopping every other request. */
const wellFormed = (spec: JobSpec): boolean => {
  const policy = spec.policy;
  if (!policy || (spec.kind !== 'pi' && spec.kind !== 'command') || typeof spec.cwd !== 'string' || !isStrings(spec.command) || spec.command.length === 0) return false;
  return [policy.writable, policy.protect, policy.lock, policy.gitDirs].every(isStrings);
};

/** What a request asked to write or run in that its requester may not, or undefined when it is allowed. */
function refusalFor(top: Job, spec: JobSpec, worktree: string | undefined, grant: string[]): string | undefined {
  const checked = spec.policy.writable.map(landing).filter((path) => path !== worktree);
  const cwdAllowed = worktree === undefined ? within(spec.cwd, [top.spec.cwd, ...grant]) : landing(spec.cwd) === worktree;
  const refused = [...checked.filter((path) => !within(path, grant)), ...(cwdAllowed ? [] : [`cwd ${spec.cwd}`])];
  return refused.length ? `pstack refused to launch this job. It asked to write outside what the job that requested it may write: ${refused.join(', ')}` : undefined;
}

/** Ends the tmux session of a launched request whose requester is done, and settles one that vanished. */
function superviseLaunched(socket: string, session: string, out: string, ending: boolean): void {
  if (ending) tmuxKill(socket, session);
  else if (!hasSession(socket, session)) settleBrokered(out, EXIT_LOST, 'pstack lost this job: its tmux session ended without an exit code.');
}

type Launch = { top: Job; socket: string; spec: JobSpec; dir: string; out: string; grant: string[] };

/** Builds the policy a request runs under from the paths just validated, so swapping a link afterwards changes nothing. */
function grantedPolicy({ top, dir }: Launch, writable: string[], guarded: { protect: string[]; lock: string[]; gitDirs: string[] }): SandboxPolicy {
  const base: SandboxPolicy = {
    writable,
    protect: [...guarded.protect, ...top.spec.policy.protect],
    lock: [...guarded.lock, ...top.spec.policy.lock],
    gitDirs: [...guarded.gitDirs, ...top.spec.policy.gitDirs],
    checkouts: [],
    credentials: jobAgentDir(top.dir),
    agentDir: getAgentDir(),
    jobDir: dir,
  };
  return { ...base, checkouts: sweepFor(base).roots };
}

function startRequest(request: Launch, made: CreatedWorktree | undefined, checked: string[], writesWorktree: boolean): boolean {
  const { top, socket, spec, dir, out } = request;
  const common = made === undefined ? undefined : gitPath(made.path, '--git-common-dir');
  const guarded = made === undefined ? spec.policy : protectedPaths(made.path, common);
  const writable = made !== undefined && writesWorktree ? [...checked, made.path, ...(common ? [landing(common)] : [])] : checked;
  const granted = grantedPolicy(request, writable, guarded);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'granted.json'), JSON.stringify(writable));
  // The worker supplies tmp, so it is trusted only if it is one of the writable paths validated above.
  const { tmp: asked, ...rest } = spec;
  const tmp = typeof asked === 'string' && writable.includes(landing(asked)) ? landing(asked) : undefined;
  return launchBrokered(top.dir, dir, { ...rest, ...(made ? { cwd: made.path } : {}), ...(tmp ? { tmp } : {}) }, sweepFor(granted), sandboxed(spec.command, granted), socket);
}

/** Validates a not yet launched request against its requester's grant, then launches it or settles it as refused. */
function launchRequest(request: Launch): void {
  const { top, spec, out, grant } = request;
  const worktree = spec.createWorktree === undefined ? undefined : requestedWorktreePath(out);
  const asked = spec.policy.writable.map(landing);
  const refusal = refusalFor(top, spec, worktree, grant);
  if (refusal) return settleBrokered(out, EXIT_REFUSED, refusal);
  const made = worktree === undefined ? undefined : createRequestedWorktree(top, spec, out, grant);
  if (made !== undefined && 'refused' in made) return settleBrokered(out, EXIT_REFUSED, `pstack refused to launch this job. ${made.refused}`);
  const checked = asked.filter((path) => path !== worktree);
  let launched = false;
  try {
    launched = startRequest(request, made, checked, worktree !== undefined && asked.includes(worktree));
  } catch (error) {
    settleBrokered(out, EXIT_LAUNCH_FAILED, `pstack could not launch this job: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (made !== undefined && !launched) {
    rmSync(made.path, { recursive: true, force: true });
    dropWorktree(made.repo, made.createdBranch);
  }
}

function serveRequest(top: Job, socket: string, dir: string, requesterDone: boolean, depth: number, grant: string[]): void {
  // A worker could link an entry back up its own tree, so only real directories are followed.
  if (!lstatSync(dir).isDirectory()) return;
  const spec = readSpec(dir);
  if (!spec || !wellFormed(spec)) return;
  const out = resultsDir(top.dir, dir);
  const stopped = existsSync(join(dir, 'stop'));
  const done = existsSync(exitPath(out)) || stopped;
  // A request's own requests may write only what the root granted it, recorded where no worker can write.
  serveRequests(top, socket, join(dir, 'nested'), requesterDone || done, depth + 1, readGrant(out));
  if (!spec.brokered || existsSync(exitPath(out))) return;
  if (existsSync(join(out, 'launched'))) return superviseLaunched(socket, brokeredSession(dir), out, requesterDone || stopped);
  if (requesterDone || stopped) return;
  if (spec.kind === 'pi' && depth > 0) return settleBrokered(out, EXIT_REFUSED, 'pstack refused to start this Pi worker. A worker started by another worker cannot start workers of its own.');
  launchRequest({ top, socket, spec, dir, out, grant });
}

/**
 * Launches the requests that sandboxed workers under one of this session's jobs wrote. A request may write only inside
 * what the root granted the top-level job, so no worker can hand a descendant more than it was given. The root only
 * reads from the request directory, which a worker controls, and writes results under the top-level job.
 */
export function serveRequests(top: Job, socket: string, nested: string, requesterDone: boolean, depth = 0, grant: string[] = top.spec.policy.writable): void {
  // A worker could link its nested directory back up its own tree, so only real directories are followed, and not far.
  if (depth > MAX_REQUEST_DEPTH || !existsSync(nested) || !lstatSync(nested).isDirectory()) return;
  for (const name of readdirSync(nested)) {
    try {
      serveRequest(top, socket, join(nested, name), requesterDone, depth, grant);
    } catch {
      // One request failing must not stop the others.
    }
  }
}
