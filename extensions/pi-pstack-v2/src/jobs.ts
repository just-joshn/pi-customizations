import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { z } from 'zod';
import { hostEnv } from './host-env.ts';

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
  /** Variables exported to the command before it runs. */
  env?: Record<string, string>;
}

/**
 * A job.json an older version wrote may lack any key but these three, which every version has held, so the rest read as
 * their quietest value: no wake, no repeat, no socket, and a series of its own.
 */
const JobSpecSchema = z
  .object({
    id: z.string(),
    owner: z.string(),
    createdAt: z.string(),
    name: z.string().optional(),
    cwd: z.string().default(''),
    command: z.array(z.string()).default([]),
    wake: z.string().nullable().default(null),
    repeat: z.boolean().default(false),
    series: z.string().optional(),
    socket: z.string().default(''),
    env: z.record(z.string(), z.string()).optional(),
  })
  .transform(({ name, series, env, ...rest }): JobSpec => ({ ...rest, name: name ?? rest.id, series: series ?? rest.id, ...(env ? { env } : {}) }));

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

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const shellQuote = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;
const hash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, HASH_LENGTH);

/** Every file a job keeps in its directory. */
export const jobFiles = (dir: string) => ({
  spec: join(dir, 'job.json'),
  wrapper: join(dir, 'wrapper.sh'),
  wrapperPid: join(dir, 'wrapper.pid'),
  output: join(dir, 'output.log'),
  exit: join(dir, 'exit'),
  woken: join(dir, 'woken'),
});

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
  const dir = join(tmpdir(), `pstack-v2-${uid}`);
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
  return spawnSync('tmux', ['-S', basename(socket), ...args], { stdio: 'ignore', env, cwd: dirname(socket), windowsHide: true });
}

/** Whether tmux ran and exited zero. A missing tmux or session, or a job.json that names no socket, reads as false. */
const tmuxOk = (socket: string, args: string[]): boolean => socket !== '' && tmuxRun(socket, args).status === 0;

/** Why a tmux command failed, or undefined when it ran and exited zero. */
function tmuxFailure(socket: string, args: string[], result: SpawnSyncReturns<Buffer>): Error | undefined {
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return new Error('pstack needs tmux to run jobs and found none on PATH. Install tmux and try again.');
  if (result.error) return result.error;
  return result.status === 0 ? undefined : new Error(`Command failed: tmux -S ${basename(socket)} ${args.join(' ')}`);
}

function exportLines(env: Record<string, string>): string[] {
  return Object.entries(env).map(([name, value]) => {
    if (!ENV_NAME.test(name)) throw new Error(`${JSON.stringify(name)} is not a valid environment variable name.`);
    return `export ${name}=${shellQuote(value)}`;
  });
}

/** The shell script that runs the job in its own process group, mirrors its output, and records its exit on every exit path. */
function wrapperScript(dir: string, command: string[], env: Record<string, string> = {}): string {
  const files = jobFiles(dir);
  const out = shellQuote(files.output);
  const exit = shellQuote(files.exit);
  return [
    'set -m',
    ...exportLines(env),
    `echo $$ > ${shellQuote(files.wrapperPid)}`,
    'finished=0',
    'finish() {',
    '  [ "$finished" = 1 ] && return',
    '  finished=1',
    '  kill -KILL -- -$pid 2>/dev/null; wait $pid 2>/dev/null',
    '  kill $mirror 2>/dev/null',
    // The temp name holds the wrapper's pid, so a stop that records the exit itself never writes the same file.
    `  echo "$1" > ${exit}.$$.tmp && mv ${exit}.$$.tmp ${exit}`,
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
 * that ignores TERM gets KILL after a short grace period. A job that tmux fails to start leaves no directory behind.
 */
export function launch(root: string, spec: JobSpec): Job {
  const dir = join(root, spec.id);
  const files = jobFiles(dir);
  const script = wrapperScript(dir, spec.command, spec.env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(files.spec, `${JSON.stringify(spec, null, 2)}\n`);
  // The script runs from a file, since a long command would not fit on a tmux command line.
  writeFileSync(files.wrapper, `${script}\n`);
  const args = ['new-session', '-d', '-s', spec.id, '-c', spec.cwd, 'bash', files.wrapper];
  const failure = tmuxFailure(spec.socket, args, tmuxRun(spec.socket, args));
  if (failure) {
    rmSync(dir, { recursive: true, force: true });
    throw failure;
  }
  return { spec, dir, status: { state: 'running' } };
}

export function status(dir: string, spec: JobSpec): JobStatus {
  const exit = jobFiles(dir).exit;
  const exited = (): JobStatus | undefined => (existsSync(exit) ? { state: 'exited', code: Number(readFileSync(exit, 'utf8').trim()) } : undefined);
  const before = exited();
  if (before) return before;
  if (tmuxOk(spec.socket, ['has-session', '-t', `=${spec.id}`])) return { state: 'running' };
  // The job may have written its exit code and closed its session between the two checks.
  return exited() ?? { state: 'lost' };
}

export function readSpec(dir: string): JobSpec | undefined {
  try {
    return JobSpecSchema.safeParse(JSON.parse(readFileSync(jobFiles(dir).spec, 'utf8'))).data;
  } catch {
    return undefined;
  }
}

/** Reads one of the owner's jobs. Another session's job reads as missing. */
export function read(root: string, id: string, owner: string): Job | undefined {
  const dir = join(root, id);
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
  const { exit, wrapperPid } = jobFiles(job.dir);
  const deadline = Date.now() + STOP_GRACE_MS;
  const wrapper = Number(readEnd(wrapperPid, PID_FILE_BYTES).trim());
  while (!existsSync(exit) && Date.now() < deadline && wrapperAlive(wrapper)) {
    await new Promise((done) => {
      setTimeout(done, STOP_POLL_MS);
    });
  }
  if (!existsSync(exit)) {
    const temp = `${exit}.${process.pid}.tmp`;
    writeFileSync(temp, `${STOPPED_EXIT_CODE}\n`);
    renameSync(temp, exit);
  }
}

/** Returns true exactly once per job, so a wake survives restarts without being delivered twice. */
export function claimWake(job: Job): boolean {
  try {
    writeFileSync(jobFiles(job.dir).woken, '', { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

/** Whether the job's wake was already claimed, by the watcher or by a stop. */
export const wakeClaimed = (job: Job): boolean => existsSync(jobFiles(job.dir).woken);

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
