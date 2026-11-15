import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { jobAgentDir } from './credentials.ts';
import { JOB_DIR_ENV, SANDBOX_ENV, type SandboxPolicy, TOP_DIR_ENV } from './sandbox.ts';
import { type Inventory, inventory, inventoryFile } from './sweep.ts';

const sweepSource = fileURLToPath(new URL('./sweep.ts', import.meta.url));

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
  /**
   * Where the job's output, exit code, and launch markers live. It is the job directory itself, except for a brokered job,
   * whose results the root writes under the top-level job, where no worker can plant a link for the root to write through.
   */
  out: string;
  /** Session id of the Pi process that owns the job and receives its wake message. */
  owner: string;
  /** Message delivered to the owner when the job exits. Null means the owner is not woken. */
  wake: string | null;
  /** Relaunch the same job each time it exits cleanly, as a heartbeat. */
  repeat: boolean;
  /** Id of the first job in a repeat series. Stopping any job in the series stops the series. */
  series: string;
  /** Path of the tmux server socket the job runs under. Empty for a brokered request. */
  socket: string;
  /** Protected paths and checkout roots the wrapper sweeps after the job, for code that appeared while it ran. */
  sweep: { roots: string[]; protect: string[] };
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
const hash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

export const jobDir = (root: string, id: string): string => join(root, id);
export const outputPath = (out: string): string => join(out, 'output.log');
export const exitPath = (out: string): string => join(out, 'exit');
/** Where the root writes a brokered job's results: under the top-level job, which every descendant can read and none can write. */
export const resultsDir = (top: string, dir: string): string => join(top, 'brokered', hash(dir));
/** The tmux session a brokered job runs as on the root's server, named from its directory so a worker cannot pick another job's name. */
export const brokeredSession = (dir: string): string => `brokered-${hash(dir)}`;

export function newJobId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
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
function tmux(socket: string, args: string[]): void {
  const env = { ...process.env };
  delete env['TMUX'];
  delete env['TMUX_PANE'];
  try {
    execFileSync('tmux', ['-S', basename(socket), ...args], { stdio: 'ignore', env, cwd: dirname(socket) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('pstack needs tmux to run jobs and found none on PATH. Install tmux and try again.');
    throw error;
  }
}

function write(dir: string, spec: JobSpec, files: Record<string, string>): void {
  mkdirSync(join(dir, 'tmp'), { recursive: true });
  writeFileSync(join(dir, 'job.json'), `${JSON.stringify(spec, null, 2)}\n`);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
}

/**
 * A private temp directory and caches for the job. Shared temp directories and user caches hold code that unsandboxed
 * programs later load, such as Pi's compiled-extension cache, so a job may write none of them.
 */
export const privateEnv = (tmp: string): Record<string, string> => ({
  TMPDIR: tmp,
  TMP: tmp,
  TEMP: tmp,
  XDG_CACHE_HOME: join(tmp, 'cache'),
  npm_config_cache: join(tmp, 'npm'),
  BUN_INSTALL_CACHE_DIR: join(tmp, 'bun'),
  PIP_CACHE_DIR: join(tmp, 'pip'),
  UV_CACHE_DIR: join(tmp, 'uv'),
  GOCACHE: join(tmp, 'go-build'),
  GOMODCACHE: join(tmp, 'go-mod'),
  YARN_CACHE_FOLDER: join(tmp, 'yarn'),
  DENO_DIR: join(tmp, 'deno'),
  GRADLE_USER_HOME: join(tmp, 'gradle'),
  npm_config_store_dir: join(tmp, 'pnpm'),
});

interface Run {
  kind: JobKind;
  cwd: string;
  argv: string[];
  inventory: Inventory;
  socket: string;
  session: string;
  /** The job's own directory, exported to it as its job directory. */
  dir: string;
  /** Where output and the exit code go. */
  out: string;
  top: string;
}

/**
 * Starts the wrapper that runs argv, captures its output, quarantines what it should not have created, and records its
 * exit code. The job runs in its own process group while the wrapper waits on it, so when `tmux_jobs stop` hangs the
 * session up, the trap fires at once. Bash would defer a trap until a foreground command finished. On every exit path the
 * whole group is killed before cleanup, so no child the job left behind can act after it, and a job that ignores TERM
 * gets KILL after a short grace period.
 */
function run(job: Run): void {
  // Pi's own variable points every job at its top-level job's agent directory, so no job's Pi writes your real credentials.
  const env = Object.entries({ [SANDBOX_ENV]: '1', [JOB_DIR_ENV]: job.dir, [TOP_DIR_ENV]: job.top, PI_CODING_AGENT_DIR: jobAgentDir(job.top), ...privateEnv(join(job.dir, 'tmp')) })
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(' ');
  const command = `${env} ${job.argv.map(shellQuote).join(' ')} < /dev/null`;
  const out = shellQuote(outputPath(job.out));
  const exit = shellQuote(exitPath(job.out));
  // Output goes straight to its file, not through a pipe, so a child the job leaves running cannot hold the job open.
  const body = job.kind === 'pi' ? `${command} > ${out} 2> ${shellQuote(join(job.out, 'stderr.log'))}` : `${command} > ${out} 2>&1`;
  // Node refuses to strip types from a file under node_modules, where an npm install keeps this one. The copy sits in the
  // job's results directory, which the job cannot write.
  const sweepCopy = join(job.out, 'sweep.ts');
  const script = [
    'set -m',
    `echo $$ > ${shellQuote(join(job.out, 'wrapper.pid'))}`,
    'finished=0',
    'finish() {',
    '  [ "$finished" = 1 ] && return',
    '  finished=1',
    '  kill -KILL -- -$pid 2>/dev/null; wait $pid 2>/dev/null',
    // Off the terminal: once tmux is gone, Node reopening the terminal to report an error blocks forever and holds a pty.
    `  ${shellQuote(process.execPath)} ${shellQuote(sweepCopy)} ${shellQuote(inventoryFile(job.out))} < /dev/null >> ${out} 2>&1`,
    `  echo "$1" > ${exit}.tmp && mv ${exit}.tmp ${exit}`,
    '}',
    `trap 'kill -TERM -- -$pid 2>/dev/null; for i in $(seq 30); do kill -0 -- -$pid 2>/dev/null || break; sleep 0.1; done; finish ${STOPPED_EXIT_CODE}; exit ${STOPPED_EXIT_CODE}' HUP TERM INT`,
    `${body} &`,
    'pid=$!',
    'wait $pid',
    'finish "$?"',
  ].join('\n');
  // The script lives beside the job's results, where only the process that launched it can write, and runs from there,
  // since a long list of protected paths would not fit on a tmux command line.
  const file = join(job.out, 'wrapper.sh');
  writeFileSync(inventoryFile(job.out), JSON.stringify(job.inventory));
  copyFileSync(sweepSource, sweepCopy);
  writeFileSync(file, `${script}\n`);
  tmux(job.socket, ['new-session', '-d', '-s', job.session, '-c', job.cwd, 'bash', file]);
}

const takeInventory = (spec: JobSpec, out: string): Inventory => inventory(spec.sweep.roots, spec.sweep.protect, join(out, 'quarantine'), outputPath(out));

const inheritedTop = (dir: string): string => (process.env[SANDBOX_ENV] === '1' ? (process.env[TOP_DIR_ENV] ?? dir) : dir);

/** Creates the job directory, writes its spec, and starts it in a detached tmux session. */
export function launch(root: string, spec: JobSpec, files: Record<string, string> = {}): Job {
  const dir = jobDir(root, spec.id);
  const full = { ...spec, out: dir };
  write(dir, full, files);
  run({ kind: spec.kind, cwd: spec.cwd, argv: spec.argv, inventory: takeInventory(spec, dir), socket: spec.socket, session: spec.id, dir, out: dir, top: inheritedTop(dir) });
  return { spec: full, dir, status: { state: 'running' } };
}

/** Writes a job for the root Pi to launch, from inside a macOS sandbox that cannot start a narrower one itself. */
export function request(root: string, spec: JobSpec, files: Record<string, string> = {}): Job {
  const dir = jobDir(root, spec.id);
  const top = process.env[TOP_DIR_ENV];
  if (!top) throw new Error('A sandboxed worker needs its top-level job directory to request a job.');
  const full = { ...spec, argv: [], socket: '', brokered: true, out: resultsDir(top, dir) };
  write(dir, full, files);
  return { spec: full, dir, status: { state: 'running' } };
}

/** Records a brokered job's result in its root-owned results directory, for a launch the root refused or could not start. */
export function settleBrokered(out: string, code: number, message: string): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(outputPath(out), `${message}\n`);
  writeFileSync(join(out, 'launched'), '');
  writeFileSync(exitPath(out), `${code}\n`);
}

/** Launches a brokered request on the root's tmux server. The caller has already sandboxed argv under a policy it clamped. */
export function launchBrokered(top: string, dir: string, spec: JobSpec, sweepWhat: JobSpec['sweep'], argv: string[], socket: string): void {
  const out = resultsDir(top, dir);
  mkdirSync(out, { recursive: true });
  try {
    run({ kind: spec.kind, cwd: spec.cwd, argv, inventory: takeInventory({ ...spec, sweep: sweepWhat }, out), socket, session: brokeredSession(dir), dir, out, top });
    writeFileSync(join(out, 'launched'), '');
  } catch (error) {
    settleBrokered(out, 127, `pstack could not launch this job: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function status(dir: string, spec: JobSpec): JobStatus {
  const exit = exitPath(spec.out);
  const exited = (): JobStatus | undefined => (existsSync(exit) ? { state: 'exited', code: Number(readFileSync(exit, 'utf8').trim()) } : undefined);
  const before = exited();
  if (before) return before;
  if (spec.brokered) return existsSync(join(dir, 'stop')) ? { state: 'exited', code: STOPPED_EXIT_CODE } : { state: 'running' };
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

/**
 * Ends a job. Hanging up its tmux session runs the wrapper's cleanup, and on Linux takes every process the job started
 * with it. A brokered job is ended by the root, which sees the stop marker on its next tick.
 */
export async function stop(job: Job): Promise<void> {
  if (job.spec.brokered) {
    writeFileSync(join(job.dir, 'stop'), '');
  } else {
    try {
      tmux(job.spec.socket, ['kill-session', '-t', `=${job.spec.id}`]);
    } catch {
      // Already gone.
    }
    // The wrapper records the exit once it has ended the job and cleaned up. Only a wrapper that is already gone, and so
    // can never record it, leaves that to stop.
    const exit = exitPath(job.spec.out);
    const deadline = Date.now() + 6_000;
    const wrapper = Number(readEnd(join(job.spec.out, 'wrapper.pid'), 32).trim());
    const alive = (): boolean => {
      try {
        process.kill(wrapper, 0);
        return wrapper > 0;
      } catch {
        return false;
      }
    };
    // The wrapper keeps cleaning up after its session is gone, so waiting ends once it records the exit or is itself gone.
    while (!existsSync(exit) && Date.now() < deadline && alive()) await new Promise((done) => setTimeout(done, 50));
    if (!existsSync(exit)) {
      writeFileSync(`${exit}.tmp`, `${STOPPED_EXIT_CODE}\n`);
      renameSync(`${exit}.tmp`, exit);
    }
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

function readRange(path: string, start: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }
  return buffer;
}

/** The end of a file, read without loading the whole of it, since a job's output can be very large. */
export function readEnd(path: string, bytes: number): string {
  if (!existsSync(path)) return '';
  const size = statSync(path).size;
  const length = Math.min(size, bytes);
  return readRange(path, size - length, length).toString('utf8');
}

const isContinuation = (byte: number | undefined): boolean => byte !== undefined && (byte & 0xc0) === 0x80;

/**
 * The start and the end of a file with a note of how many bytes lie between, so a verdict on its first line survives a
 * long output. Both cuts fall on character boundaries.
 */
export function excerpt(path: string, head: number, tailBytes: number): string {
  if (!existsSync(path)) return '';
  const size = statSync(path).size;
  if (size <= head + tailBytes) return readEnd(path, size);
  const first = readRange(path, 0, head);
  let lead = first.length - 1;
  while (lead > 0 && isContinuation(first[lead])) lead--;
  const byte = first[lead] ?? 0;
  const end = lead + (byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1) > first.length ? lead : first.length;
  const last = readRange(path, size - tailBytes, tailBytes);
  let from = 0;
  while (isContinuation(last[from])) from++;
  const omitted = size - end - (last.length - from);
  return `${first.subarray(0, end).toString('utf8')}\n[... ${omitted} bytes omitted, full output at ${path} ...]\n${last.subarray(from).toString('utf8')}`;
}

export function tail(path: string, lines: number): string {
  return readEnd(path, 256 * 1024)
    .split('\n')
    .slice(-lines)
    .join('\n');
}
