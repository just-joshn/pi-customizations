import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ProcessOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: Error;
}

const POLL_INTERVAL_MS = 50;
const BASE36 = 36;
const SESSION_SUFFIX_END = 8;
const WRAPPER_MODE = 0o755;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function tmuxHasSession(session: string): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', `=${session}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function tmuxKillSession(session: string): void {
  try {
    execFileSync('tmux', ['kill-session', '-t', `=${session}`], { stdio: 'ignore' });
  } catch {
    /* already gone */
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function readRange(file: string, from: number, to: number): Buffer {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(to - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/** Returns a function that forwards bytes appended to `file` since its last call. */
function createPump(file: string, onChunk: (chunk: string) => void): () => void {
  let offset = 0;
  return () => {
    try {
      const { size } = fs.statSync(file);
      if (size <= offset) return;
      const buf = readRange(file, offset, size);
      offset = size;
      if (buf.length) onChunk(buf.toString('utf8'));
    } catch {
      /* file may appear after start */
    }
  };
}

interface RunFiles {
  dir: string;
  outFile: string;
  errFile: string;
  exitFile: string;
  wrapper: string;
}

/** Temp dir holding the wrapper script plus the files the child's stdout, stderr and exit code land in. */
function prepareRunFiles(command: string, args: string[]): RunFiles {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagent-tmux-'));
  const files = {
    dir,
    outFile: path.join(dir, 'stdout.log'),
    errFile: path.join(dir, 'stderr.log'),
    exitFile: path.join(dir, 'exit'),
    wrapper: path.join(dir, 'run.sh'),
  };
  fs.writeFileSync(files.outFile, '');
  fs.writeFileSync(files.errFile, '');
  const argv = [command, ...args].map(shellQuote).join(' ');
  const script = ['#!/bin/bash', `${argv} > ${shellQuote(files.outFile)} 2> ${shellQuote(files.errFile)}`, `echo $? > ${shellQuote(files.exitFile)}`];
  fs.writeFileSync(files.wrapper, `${script.join('\n')}\n`, { mode: WRAPPER_MODE });
  return files;
}

interface WaitContext {
  exitFile: string;
  session: string;
  pump: () => void;
  aborted: () => boolean;
}

/** Polls until the exit file appears. Resolves false when the session vanished without writing one. */
async function waitForExit({ exitFile, session, pump, aborted }: WaitContext): Promise<boolean> {
  while (!fs.existsSync(exitFile)) {
    pump();
    const alive = tmuxHasSession(session);
    if (!alive && aborted()) return true;
    if (!alive) {
      await sleep(POLL_INTERVAL_MS);
      pump();
      return fs.existsSync(exitFile);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return true;
}

function readOutcome(exitFile: string, wasAborted: boolean): ProcessOutcome {
  if (wasAborted && !fs.existsSync(exitFile)) return { code: null, signal: 'SIGTERM' };
  const codeText = fs.existsSync(exitFile) ? fs.readFileSync(exitFile, 'utf8').trim() : '';
  const code = codeText === '' ? null : Number(codeText);
  return { code: Number.isFinite(code) ? code : null, signal: wasAborted ? 'SIGTERM' : null };
}

/**
 * Run `command args` inside a detached tmux session. Stdout/stderr are mirrored
 * into temp files so the parent can stream JSON events the same way a pipe did.
 */
export async function runPiInTmux(options: {
  command: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal | undefined;
  onStdoutChunk: (chunk: string) => void;
  onStderrChunk: (chunk: string) => void;
  /** Test hook: called after the tmux session exists and before waiting for exit. */
  onSessionStarted?: ((session: string) => void) | undefined;
}): Promise<ProcessOutcome> {
  const session = `pi-subagent-${process.pid}-${Date.now().toString(BASE36)}-${Math.random().toString(BASE36).slice(2, SESSION_SUFFIX_END)}`;
  const files = prepareRunFiles(options.command, options.args);

  try {
    execFileSync('tmux', ['new-session', '-d', '-s', session, '-c', options.cwd, 'bash', files.wrapper], { stdio: 'ignore' });
  } catch (error) {
    fs.rmSync(files.dir, { recursive: true, force: true });
    return { code: null, signal: null, spawnError: error instanceof Error ? error : new Error(String(error)) };
  }

  options.onSessionStarted?.(session);

  let wasAborted = false;
  const abort = () => {
    if (wasAborted) return;
    wasAborted = true;
    tmuxKillSession(session);
  };
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });

  const pumpOut = createPump(files.outFile, options.onStdoutChunk);
  const pumpErr = createPump(files.errFile, options.onStderrChunk);
  const pump = () => {
    pumpOut();
    pumpErr();
  };

  try {
    const exited = await waitForExit({ exitFile: files.exitFile, session, pump, aborted: () => wasAborted });
    if (!exited) return { code: null, signal: wasAborted ? 'SIGTERM' : null };
    pump();
    return readOutcome(files.exitFile, wasAborted);
  } finally {
    options.signal?.removeEventListener('abort', abort);
    tmuxKillSession(session);
    fs.rmSync(files.dir, { recursive: true, force: true });
  }
}
