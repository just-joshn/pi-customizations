import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { hostEnv } from './host-env.ts';
import { passthroughObject } from './object-schema.ts';

export interface JobSpec {
  id: string;
  name: string;
  cwd: string;
  /** The argv tmux runs, such as `bash -c <command>`. */
  command: string[];
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
  createdAt: string;
}

/** A job.json is read as written: older and newer versions of it differ in which keys they hold. */
const JobSpecSchema = passthroughObject<JobSpec>();

export type JobStatus = { state: 'running' } | { state: 'exited'; code: number } | { state: 'lost' };

export interface Job {
  spec: JobSpec;
  dir: string;
  status: JobStatus;
}

export const STOPPED_EXIT_CODE = 143;
const HASH_LENGTH = 16;
const JOB_ID_SUFFIX_BYTES = 3;
const STOP_GRACE_MS = 6000;
const PID_FILE_BYTES = 32;
const STOP_POLL_MS = 50;
const TAIL_WINDOW_KIBIBYTES = 256;
const BYTES_PER_KIBIBYTE = 1024;
const TAIL_WINDOW_BYTES = TAIL_WINDOW_KIBIBYTES * BYTES_PER_KIBIBYTE;

const shellQuote = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;
const hash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, HASH_LENGTH);

export const jobDir = (root: string, id: string): string => join(root, id);
export const outputPath = (dir: string): string => join(dir, 'output.log');
export const exitPath = (dir: string): string => join(dir, 'exit');

export function newJobId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return `${slug || 'job'}-${randomBytes(JOB_ID_SUFFIX_BYTES).toString('hex')}`;
}

/** One tmux server per owning session, started with that session's environment so jobs inherit PATH and credentials. */
export function tmuxSocket(owner: string): string {
  const uid = process.getuid?.() ?? 0;
  const dir = `/tmp/pstack-v2-${uid}`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Another local user could create this directory first and serve a socket of their own in it.
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) throw new Error(`${dir} must be a directory owned by you with mode 700.`);
  return join(dir, `${hash(owner)}.sock`);
}

// tmux reaches the socket through a relative path from its directory, so a deeply nested socket stays under the
// 104 to 108 byte limit on Unix socket paths.
function tmuxRun(socket: string, args: string[]): SpawnSyncReturns<Buffer> {
  const { TMUX: _tmux, TMUX_PANE: _pane, ...env } = hostEnv();
  return spawnSync('tmux', ['-S', basename(socket), ...args], { stdio: 'ignore', env, cwd: dirname(socket) });
}

/** Whether tmux ran and exited zero. A missing tmux or session reads as false. */
const tmuxOk = (socket: string, args: string[]): boolean => tmuxRun(socket, args).status === 0;

function tmux(socket: string, args: string[]): void {
  const result = tmuxRun(socket, args);
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') throw new Error('pstack needs tmux to run jobs and found none on PATH. Install tmux and try again.');
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed: tmux -S ${basename(socket)} ${args.join(' ')}`);
}

/** The shell script that runs the job in its own process group, mirrors its output, and records its exit on every exit path. */
function wrapperScript(dir: string, command: string[]): string {
  const out = shellQuote(outputPath(dir));
  const exit = shellQuote(exitPath(dir));
  return [
    'set -m',
    `echo $$ > ${shellQuote(join(dir, 'wrapper.pid'))}`,
    'finished=0',
    'finish() {',
    '  [ "$finished" = 1 ] && return',
    '  finished=1',
    '  kill -KILL -- -$pid 2>/dev/null; wait $pid 2>/dev/null',
    '  kill $mirror 2>/dev/null',
    `  echo "$1" > ${exit}.tmp && mv ${exit}.tmp ${exit}`,
    '}',
    `trap 'kill -TERM -- -$pid 2>/dev/null; for i in $(seq 30); do kill -0 -- -$pid 2>/dev/null || break; sleep 0.1; done; finish ${STOPPED_EXIT_CODE}; exit ${STOPPED_EXIT_CODE}' HUP TERM INT`,
    // Output goes straight to its file, not through a pipe, so a child the job leaves running cannot hold the job open.
    `${command.map(shellQuote).join(' ')} < /dev/null > ${out} 2>&1 &`,
    'pid=$!',
    // The session's pane shows the output as it is written, so attaching to it is a live view of the job.
    `tail -n +1 -f ${out} 2>/dev/null &`,
    'mirror=$!',
    'wait $pid',
    'finish "$?"',
  ].join('\n');
}

/**
 * Creates the job directory, writes its spec and wrapper, and starts it in a detached tmux session. The job runs in its
 * own process group while the wrapper waits on it, so when `tmux_jobs stop` hangs the session up, the trap fires at once.
 * Bash would defer a trap until a foreground command finished. On every exit path the whole group is killed, and a job
 * that ignores TERM gets KILL after a short grace period.
 */
export function launch(root: string, spec: JobSpec): Job {
  const dir = jobDir(root, spec.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'job.json'), `${JSON.stringify(spec, null, 2)}\n`);
  // The script runs from a file, since a long command would not fit on a tmux command line.
  const file = join(dir, 'wrapper.sh');
  writeFileSync(file, `${wrapperScript(dir, spec.command)}\n`);
  tmux(spec.socket, ['new-session', '-d', '-s', spec.id, '-c', spec.cwd, 'bash', file]);
  return { spec, dir, status: { state: 'running' } };
}

export function status(dir: string, spec: JobSpec): JobStatus {
  const exit = exitPath(dir);
  const exited = (): JobStatus | undefined => (existsSync(exit) ? { state: 'exited', code: Number(readFileSync(exit, 'utf8').trim()) } : undefined);
  const before = exited();
  if (before) return before;
  // A job.json an older version wrote may name no socket, and no tmux server can still run it.
  if (spec.socket && tmuxOk(spec.socket, ['has-session', '-t', `=${spec.id}`])) return { state: 'running' };
  // The job may have written its exit code and closed its session between the two checks.
  return exited() ?? { state: 'lost' };
}

export function readSpec(dir: string): JobSpec | undefined {
  try {
    return JobSpecSchema.parse(JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8')));
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
    .toSorted((a, b) => a.spec.createdAt.localeCompare(b.spec.createdAt));
}

const wrapperAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return pid > 0;
  } catch {
    return false;
  }
};

/** Ends a job. Hanging up its tmux session runs the wrapper's cleanup, which ends every process in the job's group. */
export async function stop(job: Job): Promise<void> {
  // Claimed first, since the session is gone before the wrapper records the exit, and the watcher would report the job lost.
  claimWake(job);
  // A session that is already gone makes this fail, which is expected.
  tmuxOk(job.spec.socket, ['kill-session', '-t', `=${job.spec.id}`]);
  // The wrapper records the exit once it has ended the job. Only a wrapper that is already gone, and so can never record
  // it, leaves that to stop.
  const exit = exitPath(job.dir);
  const deadline = Date.now() + STOP_GRACE_MS;
  const wrapper = Number(readEnd(join(job.dir, 'wrapper.pid'), PID_FILE_BYTES).trim());
  while (!existsSync(exit) && Date.now() < deadline && wrapperAlive(wrapper)) await new Promise((done) => setTimeout(done, STOP_POLL_MS));
  if (!existsSync(exit)) {
    writeFileSync(`${exit}.tmp`, `${STOPPED_EXIT_CODE}\n`);
    renameSync(`${exit}.tmp`, exit);
  }
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

/** The end of a file, read without loading the whole of it, since a job's output can be very large. */
export function readEnd(path: string, bytes: number): string {
  if (!existsSync(path)) return '';
  const size = statSync(path).size;
  const length = Math.min(size, bytes);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString('utf8');
}

export function tail(path: string, lines: number): string {
  return readEnd(path, TAIL_WINDOW_BYTES).split('\n').slice(-lines).join('\n');
}
