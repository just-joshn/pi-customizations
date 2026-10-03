/**
 * Shell command runners. The shell runner merges stderr into stdout and
 * returns [exitStatus, combinedOutput]; the args runner keeps the streams
 * separate so callers can concatenate stdout plus stderr themselves.
 *
 * Both treat a missing or unstartably shell as [1, message], mirroring the
 * reference runner's exception handling.
 *
 * An optional abort signal kills the child and resolves with a non-zero status
 * plus whatever output arrived before the abort. Cancellation resolves rather
 * than rejects so an aborted operation is reported like any other failure.
 */

import { spawn } from 'node:child_process';

interface SpawnResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly combined: string;
}

function collectStream(stream: NodeJS.ReadableStream | null, ...targets: ReadonlyArray<{ readonly sink: string[]; readonly decoder: TextDecoder }>): void {
  if (stream === null) return;
  stream.on('data', (chunk: Buffer) => {
    for (const target of targets) target.sink.push(target.decoder.decode(chunk, { stream: true }));
  });
}

function drain(decoder: TextDecoder, sink: readonly string[]): string {
  return sink.join('') + decoder.decode();
}

function onAbortSignal(signal: AbortSignal | undefined, abort: () => void): () => void {
  if (signal === undefined) return () => undefined;
  if (signal.aborted) {
    abort();
    return () => undefined;
  }
  signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

/**
 * Kills the child's whole process group. A shell runs the real command as its
 * own child, so signalling only the shell leaves that command running; the
 * group signal is fatal so nothing in the group can outlive the abort.
 * Windows has no process groups here, so it keeps the direct child kill.
 */
function killProcessTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined || process.platform === 'win32') {
    child.kill();
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill();
  }
}

function toSpawnResult(child: ReturnType<typeof spawn>, signal: AbortSignal | undefined): Promise<SpawnResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const combinedChunks: string[] = [];
    const stdoutDecoder = new TextDecoder('utf-8');
    const stderrDecoder = new TextDecoder('utf-8');
    const combinedDecoder = new TextDecoder('utf-8');
    const snapshot = (code: number): SpawnResult => ({
      code,
      stdout: drain(stdoutDecoder, stdoutChunks),
      stderr: drain(stderrDecoder, stderrChunks),
      combined: drain(combinedDecoder, combinedChunks),
    });
    collectStream(child.stdout, { sink: stdoutChunks, decoder: stdoutDecoder }, { sink: combinedChunks, decoder: combinedDecoder });
    collectStream(child.stderr, { sink: stderrChunks, decoder: stderrDecoder }, { sink: combinedChunks, decoder: combinedDecoder });
    const forgetAbort = onAbortSignal(signal, () => {
      killProcessTree(child);
      resolvePromise(snapshot(1));
    });
    child.on('error', (error) => {
      forgetAbort();
      rejectPromise(error);
    });
    child.on('close', (code) => {
      forgetAbort();
      resolvePromise(snapshot(code ?? 1));
    });
  });
}

export async function runShellCommand(command: string, cwd: string | undefined, signal: AbortSignal | undefined): Promise<readonly [number, string]> {
  try {
    const child = spawn(command, { shell: true, cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const result = await toSpawnResult(child, signal);
    return [result.code, result.combined];
  } catch (error: unknown) {
    return [1, error instanceof Error ? error.message : String(error)];
  }
}

export interface ProcessOutcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Set only when the process could not be started at all. */
  readonly spawnError: string | undefined;
}

export async function runArgsCommand(args: readonly string[], cwd: string | undefined, signal: AbortSignal | undefined): Promise<ProcessOutcome> {
  const [command, ...rest] = args;
  if (command === undefined) return { code: 1, stdout: '', stderr: '', spawnError: 'no command to run' };
  try {
    const child = spawn(command, rest, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const result = await toSpawnResult(child, signal);
    return { code: result.code, stdout: result.stdout, stderr: result.stderr, spawnError: undefined };
  } catch (error: unknown) {
    return { code: 1, stdout: '', stderr: '', spawnError: error instanceof Error ? error.message : String(error) };
  }
}

export async function runStdinCommand(command: string, args: readonly string[], stdin: string, cwd: string | undefined, signal: AbortSignal | undefined): Promise<ProcessOutcome> {
  return new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    } catch (error: unknown) {
      resolvePromise({ code: 1, stdout: '', stderr: '', spawnError: error instanceof Error ? error.message : String(error) });
      return;
    }
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const stdoutDecoder = new TextDecoder('utf-8');
    const stderrDecoder = new TextDecoder('utf-8');
    const snapshot = (code: number, spawnError: string | undefined): ProcessOutcome => ({
      code,
      stdout: drain(stdoutDecoder, stdoutChunks),
      stderr: drain(stderrDecoder, stderrChunks),
      spawnError,
    });
    collectStream(child.stdout, { sink: stdoutChunks, decoder: stdoutDecoder });
    collectStream(child.stderr, { sink: stderrChunks, decoder: stderrDecoder });
    const forgetAbort = onAbortSignal(signal, () => {
      killProcessTree(child);
      resolvePromise(snapshot(1, undefined));
    });
    // A killed child closes its stdin, so the pending write must not surface as
    // an unhandled stream error.
    const input = child.stdin;
    if (input !== null) input.on('error', () => undefined);
    child.on('error', (error: Error) => {
      forgetAbort();
      resolvePromise(snapshot(1, error.message));
    });
    child.on('close', (code) => {
      forgetAbort();
      resolvePromise(snapshot(code ?? 1, undefined));
    });
    if (input !== null) input.end(stdin);
  });
}
