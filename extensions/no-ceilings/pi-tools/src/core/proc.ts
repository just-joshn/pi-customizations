import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

/** Locate a bundled binary in the agent bin directory, then on PATH. */
export function resolveBinary(name: string, agentDir?: string): string | undefined {
  const candidates = agentDir === undefined ? [] : [path.join(agentDir, 'bin', name), path.join(agentDir, 'bin', `${name}.exe`)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  const probe = spawnSync(name, ['--version'], { stdio: 'pipe' });
  return probe.error ? undefined : name;
}

export interface StreamRunOptions {
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  /** Kill the process after this many output lines. */
  readonly maxLines?: number;
  /** Kill the process after this many output bytes. */
  readonly maxBytes?: number;
  /** Stop storing lines after this many; the process keeps running unless `maxLines` is reached. */
  readonly keepLines?: number;
  /** Extra bytes counted per kept line, matching a trailing newline. */
  readonly perLineOverhead?: number;
}

export interface StreamRunResult {
  readonly lines: readonly string[];
  readonly totalLines: number;
  readonly totalBytes: number;
  /** Set when a cap, the timeout, or an explicit stop ended the run early. */
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly limitReached: boolean;
  readonly killedByByteCap: boolean;
  readonly stderr: string;
  readonly exitCode: number | null;
}

interface InternalState {
  lines: string[];
  totalLines: number;
  totalBytes: number;
  truncated: boolean;
  timedOut: boolean;
  limitReached: boolean;
  killedByByteCap: boolean;
  stderr: string;
  stopped: boolean;
}

/**
 * Run a binary and stream stdout lines with byte and line caps.
 * A timeout or cap resolves with what was collected so callers can return partial results.
 */
export async function streamLines(binary: string, args: readonly string[], options: StreamRunOptions): Promise<StreamRunResult> {
  const keepLines = options.keepLines ?? Number.POSITIVE_INFINITY;
  const perLine = options.perLineOverhead ?? 1;
  const state: InternalState = {
    lines: [],
    totalLines: 0,
    totalBytes: 0,
    truncated: false,
    timedOut: false,
    limitReached: false,
    killedByByteCap: false,
    stderr: '',
    stopped: false,
  };

  return new Promise<StreamRunResult>((resolve, reject) => {
    if (options.signal?.aborted === true) {
      reject(new Error('Operation aborted'));
      return;
    }
    const child = spawn(binary, [...args], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const reader = createInterface({ input: child.stdout });
    let timer: NodeJS.Timeout | undefined;
    let settled = false;

    const stop = (): void => {
      state.stopped = true;
      if (!child.killed) {
        child.kill();
      }
    };

    const onAbort = (): void => {
      stop();
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error('Operation aborted'));
    };

    const cleanup = (): void => {
      reader.close();
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      options.signal?.removeEventListener('abort', onAbort);
    };

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        lines: state.lines,
        totalLines: state.totalLines,
        totalBytes: state.totalBytes,
        truncated: state.truncated,
        timedOut: state.timedOut,
        limitReached: state.limitReached,
        killedByByteCap: state.killedByByteCap,
        stderr: state.stderr.trim(),
        exitCode: child.exitCode,
      });
    };

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    timer = setTimeout(() => {
      state.timedOut = true;
      state.truncated = true;
      stop();
      finish();
    }, options.timeoutMs);
    timer.unref?.();

    child.stderr?.on('data', (chunk: Buffer) => {
      state.stderr += chunk.toString('utf-8');
    });

    reader.on('line', (raw: string) => {
      if (state.stopped) {
        return;
      }
      const line = raw.replace(/\r$/, '');
      state.totalLines += 1;
      state.totalBytes += Buffer.byteLength(line, 'utf-8') + perLine;
      if (state.lines.length < keepLines && state.totalBytes <= (options.maxBytes ?? Number.POSITIVE_INFINITY)) {
        state.lines.push(line);
      }
      if (state.totalLines >= (options.maxLines ?? Number.POSITIVE_INFINITY)) {
        state.limitReached = true;
        state.truncated = true;
        stop();
        finish();
        return;
      }
      if (options.maxBytes !== undefined && state.totalBytes > options.maxBytes) {
        state.killedByByteCap = true;
        state.truncated = true;
        stop();
        finish();
      }
    });

    child.on('error', (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });

    child.on('close', () => {
      if (!settled && !state.truncated && state.totalLines > state.lines.length) {
        state.truncated = true;
      }
      finish();
    });
  });
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** Run a binary to completion with a deadline. */
export async function runBinary(binary: string, args: readonly string[], options: { cwd: string; signal?: AbortSignal; timeoutMs?: number; env?: NodeJS.ProcessEnv }): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(binary, [...args], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'], ...(options.env === undefined ? {} : { env: options.env }) });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    const onAbort = (): void => {
      child.kill();
    };
    if (options.signal) {
      if (options.signal.aborted) {
        child.kill();
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, options.timeoutMs);
      timer.unref?.();
    }
    child.on('error', (error) => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      options.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      options.signal?.removeEventListener('abort', onAbort);
      if (timedOut) {
        reject(new Error('Timed out'));
        return;
      }
      if (options.signal?.aborted === true) {
        reject(new Error('Operation aborted'));
        return;
      }
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}
