import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { hostEnv } from '../host-env.ts';

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

const SOCKET_NAME = 'tmux.sock';

/**
 * Each run gets its own tmux server, started with this process's environment, so the child inherits the dispatching
 * Pi's agent dir, credentials, and PATH. A shared server would hand it the environment that server started with.
 * tmux reaches the socket by a relative path from the run directory, which keeps it under the Unix socket path limit.
 */
function tmuxArgs(dir: string, args: string[], extraEnv: Readonly<Record<string, string>> = {}): [string, string[], { cwd: string; env: NodeJS.ProcessEnv }] {
  const { TMUX: _tmux, TMUX_PANE: _pane, ...env } = hostEnv();
  return ['tmux', ['-S', SOCKET_NAME, ...args], { cwd: dir, env: { ...env, ...extraEnv } }];
}

function tmuxOk(dir: string, args: string[]): boolean {
  const [command, argv, options] = tmuxArgs(dir, args);
  return spawnSync(command, argv, { ...options, stdio: 'ignore' }).status === 0;
}

/** A server that is already gone makes this fail, which is expected. */
const tmuxKillServer = (dir: string): void => {
  tmuxOk(dir, ['kill-server']);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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
  const exitTmp = `${files.exitFile}.tmp`;
  const script = ['#!/bin/bash', `${argv} > ${shellQuote(files.outFile)} 2> ${shellQuote(files.errFile)}`, `echo $? > ${shellQuote(exitTmp)} && mv ${shellQuote(exitTmp)} ${shellQuote(files.exitFile)}`];
  fs.writeFileSync(files.wrapper, `${script.join('\n')}\n`, { mode: WRAPPER_MODE });
  return files;
}

interface WaitContext {
  exitFile: string;
  dir: string;
  session: string;
  pump: () => void;
  aborted: () => boolean;
}

/** Polls until the exit file appears. Resolves false when the session vanished without writing one. */
async function waitForExit({ exitFile, dir, session, pump, aborted }: WaitContext): Promise<boolean> {
  while (!fs.existsSync(exitFile)) {
    pump();
    const alive = tmuxOk(dir, ['has-session', '-t', `=${session}`]);
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
export async function runPiInTmux(options: { command: string; args: string[]; cwd: string; signal?: AbortSignal | undefined; extraEnv?: Readonly<Record<string, string>> | undefined; onStdoutChunk: (chunk: string) => void; onStderrChunk: (chunk: string) => void }): Promise<ProcessOutcome> {
  const session = `pi-subagent-${process.pid}-${Date.now().toString(BASE36)}-${Math.random().toString(BASE36).slice(2, SESSION_SUFFIX_END)}`;
  const files = prepareRunFiles(options.command, options.args);

  try {
    const [command, argv, spawnOptions] = tmuxArgs(files.dir, ['new-session', '-d', '-s', session, '-c', options.cwd, 'bash', files.wrapper], options.extraEnv);
    execFileSync(command, argv, { ...spawnOptions, stdio: 'ignore' });
  } catch (error) {
    fs.rmSync(files.dir, { recursive: true, force: true });
    return { code: null, signal: null, spawnError: error instanceof Error ? error : new Error(String(error)) };
  }

  let wasAborted = false;
  const abort = () => {
    wasAborted = true;
    tmuxKillServer(files.dir);
  };
  options.signal?.addEventListener('abort', abort, { once: true });

  const pumpOut = createPump(files.outFile, options.onStdoutChunk);
  const pumpErr = createPump(files.errFile, options.onStderrChunk);
  const pump = () => {
    pumpOut();
    pumpErr();
  };

  try {
    const exited = await waitForExit({ exitFile: files.exitFile, dir: files.dir, session, pump, aborted: () => wasAborted });
    if (!exited) return { code: null, signal: wasAborted ? 'SIGTERM' : null };
    pump();
    return readOutcome(files.exitFile, wasAborted);
  } finally {
    options.signal?.removeEventListener('abort', abort);
    tmuxKillServer(files.dir);
    fs.rmSync(files.dir, { recursive: true, force: true });
  }
}
