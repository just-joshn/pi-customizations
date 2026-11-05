// The Docker CLI is the container engine boundary for cloud machines: OrbStack, Docker Desktop, Colima, and remote
// engines all answer it, and `PSTACK_CLOUD_DOCKER_CONTEXT` picks a non-default engine the way `docker --context` does.
import { execFile } from 'node:child_process';

export const DOCKER_CONTEXT_ENV = 'PSTACK_CLOUD_DOCKER_CONTEXT';
const PROBE_TIMEOUT_MS = 5_000;

/** The `docker` argv prefix, with the configured context when one is set. */
export function dockerPrefix(env: NodeJS.ProcessEnv = process.env): string[] {
  const context = env[DOCKER_CONTEXT_ENV];
  return context === undefined || context === '' ? [] : ['--context', context];
}

export class DockerError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.name = 'DockerError';
    this.stderr = stderr;
  }
}

export interface DockerRun {
  timeoutMs?: number;
  input?: string | Buffer;
  signal?: AbortSignal;
}

/** Runs one docker command and resolves with its stdout; a non-zero exit rejects with the command's stderr. */
export function docker(args: readonly string[], options: DockerRun = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      [...dockerPrefix(), ...args],
      { encoding: 'buffer', maxBuffer: 64 << 20, ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }), ...(options.signal === undefined ? {} : { signal: options.signal }) },
      (error, stdout, stderr) => {
        const err = stderr.toString('utf8').trim();
        if (error === null) resolve(stdout.toString('utf8'));
        else reject(new DockerError(`docker ${args[0] ?? ''} failed: ${err === '' ? error.message : err}`, err));
      },
    );
    if (options.input !== undefined) child.stdin?.end(options.input);
    else child.stdin?.end();
  });
}

/** The engine's server version, or undefined when no engine answers within the probe timeout. */
export async function dockerServerVersion(): Promise<string | undefined> {
  try {
    const version = (await docker(['version', '--format', '{{.Server.Version}}'], { timeoutMs: PROBE_TIMEOUT_MS })).trim();
    return version === '' ? undefined : version;
  } catch {
    return undefined;
  }
}

export type ContainerState = 'running' | 'exited' | 'created' | 'paused' | 'restarting' | 'removing' | 'dead' | 'missing';

/** The container's state as the engine reports it, `missing` when it does not exist. */
export async function containerState(name: string): Promise<ContainerState> {
  try {
    const state = (await docker(['inspect', '--format', '{{.State.Status}}', name], { timeoutMs: PROBE_TIMEOUT_MS })).trim();
    switch (state) {
      case 'running':
      case 'exited':
      case 'created':
      case 'paused':
      case 'restarting':
      case 'removing':
      case 'dead':
        return state;
      default:
        return 'missing';
    }
  } catch (error) {
    if (error instanceof DockerError && /no such (object|container)/i.test(error.stderr)) return 'missing';
    throw error;
  }
}

export async function imageExists(image: string): Promise<boolean> {
  try {
    await docker(['image', 'inspect', '--format', '{{.Id}}', image], { timeoutMs: PROBE_TIMEOUT_MS });
    return true;
  } catch (error) {
    if (error instanceof DockerError && /no such image/i.test(error.stderr)) return false;
    throw error;
  }
}
