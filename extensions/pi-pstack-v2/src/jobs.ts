import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { JOB_DIR_ENV, SANDBOX_ENV, type SandboxPolicy } from './sandbox.ts';

export type JobKind = 'pi' | 'command';

export interface JobSpec {
  id: string;
  name: string;
  kind: JobKind;
  cwd: string;
  /** What tmux runs: the command wrapped in its sandbox. Empty for a brokered request until the root launches it. */
  argv: string[];
  /** The command before sandboxing, and the policy it asked for. A broker launches from these after clamping the policy. */
  command: string[];
  policy: SandboxPolicy;
  /**
   * Launched by the root Pi on a sandboxed worker's behalf, because macOS cannot nest Seatbelt profiles. The worker cannot
   * reach the root's tmux server, so it reads the job's state from files only.
   */
  brokered: boolean;
  /** Session id of the Pi process that owns the job and receives its wake message. */
  owner: string;
  /** Message delivered to the owner when the job exits. Null means the owner is not woken. */
  wake: string | null;
  /** Relaunch the same job each time it exits cleanly, as a heartbeat. */
  repeat: boolean;
  /** Id of the first job in a repeat series. Stopping any job in the series stops the series. */
  series: string;
  /** Path of the tmux server socket the job runs under. */
  socket: string;
  /**
   * Protected paths that did not exist at launch. bubblewrap can only make existing paths read-only, so the
   * unsandboxed wrapper removes any of these the job created as soon as it exits.
   */
  revert: string[];
  createdAt: string;
}

export type JobStatus = { state: 'running' } | { state: 'exited'; code: number } | { state: 'lost' };

export interface Job {
  spec: JobSpec;
  dir: string;
  status: JobStatus;
}

export const STOPPED_EXIT_CODE = 143;

const shellQuote = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;

export const jobDir = (root: string, id: string): string => join(root, id);
export const outputPath = (dir: string): string => join(dir, 'output.log');

export function newJobId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return `${slug || 'job'}-${randomBytes(3).toString('hex')}`;
}

/**
 * One tmux server per owning session, started with that session's environment so jobs inherit PATH and credentials.
 * Its socket sits where sandboxed jobs cannot connect, since the server runs whatever it is sent outside the sandbox.
 * Inside a sandboxed job, the server lives under the job's own `nested/` directory instead.
 */
export function tmuxSocket(owner: string, env: NodeJS.ProcessEnv = process.env): string {
  const parent = env[JOB_DIR_ENV];
  if (env[SANDBOX_ENV] === '1' && parent) return join(parent, 'nested', 'tmux.sock');
  const dir = `/tmp/pstack-v2-${process.getuid?.() ?? 0}`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${createHash('sha256').update(owner).digest('hex').slice(0, 16)}.sock`);
}

function tmux(socket: string, args: string[]): void {
  const env = { ...process.env };
  delete env['TMUX'];
  delete env['TMUX_PANE'];
  execFileSync('tmux', ['-S', socket, ...args], { stdio: 'ignore', env });
}

function write(dir: string, spec: JobSpec, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'job.json'), `${JSON.stringify(spec, null, 2)}\n`);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
}

/** Starts the wrapper that runs argv, captures its output, removes what it should not have created, and records its exit code. */
function run(dir: string, kind: JobKind, cwd: string, argv: string[], revertPaths: string[], socket: string, session: string): void {
  const command = `${SANDBOX_ENV}=1 ${JOB_DIR_ENV}=${shellQuote(dir)} ${argv.map(shellQuote).join(' ')} < /dev/null`;
  const out = shellQuote(outputPath(dir));
  const capture = kind === 'pi' ? `${command} > ${out} 2> ${shellQuote(join(dir, 'stderr.log'))}; code=$?` : `${command} 2>&1 | tee ${out}; code=\${PIPESTATUS[0]}`;
  const exit = shellQuote(join(dir, 'exit'));
  const revert = revertPaths.map((path) => `if [ -e ${shellQuote(path)} ] || [ -L ${shellQuote(path)} ]; then rm -rf ${shellQuote(path)}; echo ${shellQuote(`pstack removed ${path}, which the job created.`)} >> ${out}; fi; `).join('');
  const script = `${capture}; ${revert}echo $code > ${exit}.tmp && mv ${exit}.tmp ${exit}`;
  tmux(socket, ['new-session', '-d', '-s', session, '-c', cwd, 'bash', '-c', script]);
}

/** Creates the job directory, writes its spec, and starts it in a detached tmux session. */
export function launch(root: string, spec: JobSpec, files: Record<string, string> = {}): Job {
  const dir = jobDir(root, spec.id);
  write(dir, spec, files);
  run(dir, spec.kind, spec.cwd, spec.argv, spec.revert, spec.socket, spec.id);
  return { spec, dir, status: { state: 'running' } };
}

/** Writes a job for the root Pi to launch, from inside a macOS sandbox that cannot start a narrower one itself. */
export function request(root: string, spec: JobSpec, files: Record<string, string> = {}): Job {
  const dir = jobDir(root, spec.id);
  write(dir, { ...spec, argv: [], socket: '', brokered: true }, files);
  return { spec, dir, status: { state: 'running' } };
}

/** The tmux session a brokered job runs as on the root's server, named from its directory so a worker cannot pick another job's name. */
export const brokeredSession = (dir: string): string => `brokered-${createHash('sha256').update(dir).digest('hex').slice(0, 16)}`;

/** Launches a brokered request on the root's tmux server. The caller has already sandboxed argv under a policy it clamped. */
export function launchBrokered(dir: string, spec: JobSpec, argv: string[], revert: string[], socket: string): void {
  writeFileSync(join(dir, 'launched'), '');
  run(dir, spec.kind, spec.cwd, argv, revert, socket, brokeredSession(dir));
}

export function status(dir: string, spec: JobSpec): JobStatus {
  const exit = join(dir, 'exit');
  const exited = (): JobStatus | undefined => (existsSync(exit) ? { state: 'exited', code: Number(readFileSync(exit, 'utf8').trim()) } : undefined);
  const before = exited();
  if (before) return before;
  if (spec.brokered) return { state: 'running' };
  try {
    tmux(spec.socket, ['has-session', '-t', `=${spec.id}`]);
    return { state: 'running' };
  } catch {
    // The job may have written its exit code and closed its session between the two checks.
    return exited() ?? { state: 'lost' };
  }
}

export function readSpec(dir: string): JobSpec | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8')) as JobSpec;
  } catch {
    return undefined;
  }
}

/** Reads one of the owner's jobs. Another session's job reads as missing. */
export function read(root: string, id: string, owner: string): Job | undefined {
  const dir = jobDir(root, id);
  const spec = readSpec(dir);
  return spec?.owner === owner ? { spec, dir, status: status(dir, spec) } : undefined;
}

export function list(root: string, owner: string): Job[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((id) => read(root, id, owner))
    .filter((job): job is Job => job !== undefined)
    .sort((a, b) => a.spec.createdAt.localeCompare(b.spec.createdAt));
}

export function stop(job: Job): void {
  // The root's broker sees this marker and ends the session, which the worker that requested it cannot reach.
  if (job.spec.brokered) writeFileSync(join(job.dir, 'stop'), '');
  try {
    tmux(job.spec.socket, ['kill-session', '-t', `=${job.spec.id}`]);
  } catch {
    // Already gone.
  }
  try {
    tmux(join(job.dir, 'nested', 'tmux.sock'), ['kill-server']);
  } catch {
    // The job started no jobs of its own.
  }
  const exit = join(job.dir, 'exit');
  if (!existsSync(exit)) {
    writeFileSync(`${exit}.tmp`, `${STOPPED_EXIT_CODE}\n`);
    renameSync(`${exit}.tmp`, exit);
  }
  claimWake(job);
}

/** Returns true exactly once per job, so a wake survives restarts without being delivered twice. */
export function claimWake(job: Job): boolean {
  try {
    writeFileSync(join(job.dir, 'woken'), '', { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

export function tail(dir: string, lines: number): string {
  const file = outputPath(dir);
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n');
}

export const attachCommand = (spec: JobSpec): string => `tmux -S ${spec.socket} attach -t ${spec.id}`;
