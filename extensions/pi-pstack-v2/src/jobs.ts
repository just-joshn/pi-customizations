import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SANDBOX_ENV } from './sandbox.ts';

export type JobKind = 'pi' | 'command';

export interface JobSpec {
  id: string;
  name: string;
  kind: JobKind;
  cwd: string;
  /** The sandboxed command. */
  argv: string[];
  /** Session id of the Pi process that owns the job and receives its wake message. */
  owner: string;
  /** Message delivered to the owner when the job exits. Null means the owner is not woken. */
  wake: string | null;
  /** Relaunch the same job each time it exits, as a heartbeat. */
  repeat: boolean;
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

/** One tmux server per owning session, started with that session's environment so jobs inherit PATH and credentials. */
export const tmuxSocket = (owner: string): string => `pstack-v2-${owner.slice(0, 8)}`;

function tmux(owner: string, args: string[]): void {
  const env = { ...process.env };
  delete env['TMUX'];
  delete env['TMUX_PANE'];
  execFileSync('tmux', ['-L', tmuxSocket(owner), ...args], { stdio: 'ignore', env });
}

/** Creates the job directory, writes its spec, and starts it in a detached tmux session. */
export function launch(root: string, spec: JobSpec, files: Record<string, string> = {}): Job {
  const dir = jobDir(root, spec.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'job.json'), `${JSON.stringify(spec, null, 2)}\n`);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  const command = `${SANDBOX_ENV}=1 ${spec.argv.map(shellQuote).join(' ')} < /dev/null`;
  const out = shellQuote(outputPath(dir));
  const capture = spec.kind === 'pi' ? `${command} > ${out} 2> ${shellQuote(join(dir, 'stderr.log'))}; code=$?` : `${command} 2>&1 | tee ${out}; code=\${PIPESTATUS[0]}`;
  const exit = shellQuote(join(dir, 'exit'));
  const script = `${capture}; echo $code > ${exit}.tmp && mv ${exit}.tmp ${exit}`;
  tmux(spec.owner, ['new-session', '-d', '-s', spec.id, '-c', spec.cwd, 'bash', '-c', script]);
  return { spec, dir, status: { state: 'running' } };
}

export function status(dir: string, spec: JobSpec): JobStatus {
  const exit = join(dir, 'exit');
  const exited = (): JobStatus | undefined => (existsSync(exit) ? { state: 'exited', code: Number(readFileSync(exit, 'utf8').trim()) } : undefined);
  const before = exited();
  if (before) return before;
  try {
    tmux(spec.owner, ['has-session', '-t', `=${spec.id}`]);
    return { state: 'running' };
  } catch {
    // The job may have written its exit code and closed its session between the two checks.
    return exited() ?? { state: 'lost' };
  }
}

export function read(root: string, id: string): Job | undefined {
  const dir = jobDir(root, id);
  const file = join(dir, 'job.json');
  if (!existsSync(file)) return undefined;
  const spec = JSON.parse(readFileSync(file, 'utf8')) as JobSpec;
  return { spec, dir, status: status(dir, spec) };
}

export function list(root: string, owner: string): Job[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((id) => read(root, id))
    .filter((job): job is Job => job !== undefined && job.spec.owner === owner)
    .sort((a, b) => a.spec.createdAt.localeCompare(b.spec.createdAt));
}

export function stop(job: Job): void {
  try {
    tmux(job.spec.owner, ['kill-session', '-t', `=${job.spec.id}`]);
  } catch {
    // Already gone.
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

export const attachCommand = (spec: JobSpec): string => `tmux -L ${tmuxSocket(spec.owner)} attach -t ${spec.id}`;
