// A cloud agent's Pi process runs detached from the chat that started it, as a Cursor cloud agent keeps running after
// its parent closes. It is a one-shot `pi --mode json` run whose events go to a file, wrapped in a shell that records the
// exit code, so any later Pi process can tell how it ended. A handle built on the pid and that file gives the chat the
// same interface as an RPC child: done, stop, kill, pid.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { PACKAGE_ROOT } from '../paths.ts';
import { alive } from '../process-lock.ts';
import { type AssistantRecord, addUsage, type ChildHandle, type ChildOutcome, KILL_GRACE_MS, parseEvent, readAssistant, signalGroup, type Usage, usageOf, zeroUsage } from '../task/runner.ts';
import { dockerPrefix } from './docker.ts';

const POLL_MS = 300;
// The wrapper releases the run's container machine before it records the exit code, so a machine never outlives its last
// run and a resume that sees the exit code never races the stop. The release helper records the exit code itself; when
// it cannot run, the wrapper stops the machine itself and records the code.
const WRAPPER = [
  'exec 0<"$PSTACK_PROMPT"',
  '"$@" >"$PSTACK_EVENTS" 2>"$PSTACK_ERRORS"',
  'code=$?',
  'if [ -n "$PSTACK_MACHINE_CONTAINER" ]; then "$PSTACK_RELEASE_RUNTIME" "$PSTACK_RELEASE_SCRIPT" $$ "$code" >/dev/null 2>>"$PSTACK_ERRORS" || docker $PSTACK_DOCKER_PREFIX stop --time 5 "$PSTACK_MACHINE_CONTAINER" >/dev/null 2>&1; fi',
  '[ -e "$PSTACK_EXIT" ] || { printf %s "$code" >"$PSTACK_EXIT.tmp" && mv "$PSTACK_EXIT.tmp" "$PSTACK_EXIT"; }',
].join('; ');
const RELEASE_RUNTIME = /^(node|bun)(\.exe)?$/i.test(basename(process.execPath)) ? process.execPath : 'node';
const RELEASE_SCRIPT = join(PACKAGE_ROOT, 'dist/release-machine.js');

/** One detached run of a cloud agent: its process group and the files it writes. */
export interface DetachedRun {
  pid: number;
  events: string;
  errors: string;
  exit: string;
  startedAt: string;
}

export interface DetachedLaunch {
  command: readonly string[];
  args: readonly string[];
  /** The first prompt, sent on stdin so no argv parsing (`@file`, `-`) touches it. */
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Holds this run's prompt, events, stderr, and exit files. */
  runDir: string;
  /** The container machine the run's wrapper releases when the run ends, and the workspace's run locks that say who else uses it. */
  machine?: { container: string; path: string; locks: string } | undefined;
}

/** Starts the run in its own process group with no tie to this process: it survives this process exiting. */
export function spawnDetached(launch: DetachedLaunch): DetachedRun {
  mkdirSync(launch.runDir, { recursive: true, mode: 0o700 });
  const files = { prompt: join(launch.runDir, 'prompt.txt'), events: join(launch.runDir, 'events.jsonl'), errors: join(launch.runDir, 'stderr.txt'), exit: join(launch.runDir, 'exit-code') };
  writeFileSync(files.prompt, launch.prompt, { mode: 0o600 });
  const [command, ...prefix] = launch.command;
  if (command === undefined) throw new Error('spawnDetached needs a command');
  const child = spawn('/bin/sh', ['-c', WRAPPER, 'pstack-cloud-agent', command, ...prefix, ...launch.args], {
    cwd: launch.cwd,
    env: {
      ...launch.env,
      PSTACK_PROMPT: files.prompt,
      PSTACK_EVENTS: files.events,
      PSTACK_ERRORS: files.errors,
      PSTACK_EXIT: files.exit,
      PSTACK_MACHINE_CONTAINER: launch.machine?.container ?? '',
      PSTACK_MACHINE_PATH: launch.machine?.path ?? '',
      PSTACK_LOCKS: launch.machine?.locks ?? '',
      PSTACK_RELEASE_RUNTIME: RELEASE_RUNTIME,
      PSTACK_RELEASE_SCRIPT: RELEASE_SCRIPT,
      PSTACK_DOCKER_PREFIX: dockerPrefix(launch.env).join(' '),
    },
    detached: true,
    stdio: 'ignore',
  });
  if (child.pid === undefined) throw new Error('Could not start the cloud agent process.');
  child.unref();
  return { pid: child.pid, events: files.events, errors: files.errors, exit: files.exit, startedAt: new Date().toISOString() };
}

/** The exit code the wrapper recorded, or undefined while the run has not recorded one. */
export function exitCodeOf(run: Pick<DetachedRun, 'exit'>): number | undefined {
  if (!existsSync(run.exit)) return undefined;
  const code = Number.parseInt(readFileSync(run.exit, 'utf8'), 10);
  return Number.isInteger(code) ? code : undefined;
}

/** Whether the run still holds its process: no exit code yet and its group leader alive. */
export const runActive = (run: Pick<DetachedRun, 'pid' | 'exit'>): boolean => exitCodeOf(run) === undefined && alive(run.pid);

interface Reading {
  offset: number;
  decoder: StringDecoder;
  buffer: string;
  last: AssistantRecord | undefined;
  usage: Usage;
  settled: boolean;
}

/** Reads the events written since the last call and folds them into `reading`. */
function readNew(run: DetachedRun, reading: Reading, onEvent: ((event: { type: string } & Record<string, unknown>) => void) | undefined): void {
  if (!existsSync(run.events)) return;
  const size = statSync(run.events).size;
  if (size <= reading.offset) return;
  const length = size - reading.offset;
  const chunk = Buffer.alloc(length);
  const fd = openSync(run.events, 'r');
  try {
    readSync(fd, chunk, 0, length, reading.offset);
  } finally {
    closeSync(fd);
  }
  reading.offset = size;
  reading.buffer += reading.decoder.write(chunk);
  for (let index = reading.buffer.indexOf('\n'); index !== -1; index = reading.buffer.indexOf('\n')) {
    const line = reading.buffer.slice(0, index).trim();
    reading.buffer = reading.buffer.slice(index + 1);
    const event = line === '' ? undefined : parseEvent(line);
    if (event === undefined) continue;
    onEvent?.(event);
    const usage = usageOf(event);
    if (usage !== undefined) reading.usage = addUsage(reading.usage, usage);
    reading.last = readAssistant(event) ?? reading.last;
    if (event.type === 'agent_settled') reading.settled = true;
  }
}

function stderrTail(run: DetachedRun): string {
  if (!existsSync(run.errors)) return '';
  return readFileSync(run.errors, 'utf8').slice(-8_192);
}

/** How a finished run ended, from its events, exit code, and whether this process stopped or killed it. */
export function detachedOutcome(run: DetachedRun, reading: Pick<Reading, 'last' | 'usage' | 'settled'>, ended: { stopped: boolean; aborted: boolean }): ChildOutcome {
  const stderr = stderrTail(run);
  const base = { finalText: reading.last?.text ?? '', usage: reading.usage, stderr };
  if (ended.aborted) return { ...base, failure: 'Subagent was aborted' };
  if (ended.stopped) return { ...base, failure: 'Subagent was stopped with stop_agent' };
  const code = exitCodeOf(run);
  if (reading.last?.stopReason === 'error' || reading.last?.stopReason === 'aborted') return { ...base, failure: reading.last.errorMessage ?? `subagent stopped: ${reading.last.stopReason}` };
  if (code === undefined) return { ...base, failure: 'The agent process ended without recording an exit code: it was killed, or its host shut down.' };
  if (code !== 0) return { ...base, failure: `pi exited with code ${code}: ${stderr.trim().split('\n').at(-1) ?? ''}`.trim() };
  if (!reading.settled) return { ...base, failure: 'The agent exited before its run settled.' };
  return base;
}

/**
 * Follows a detached run: `onEvent` sees each event as it is written, and `done` resolves once the run ends. Following
 * the same run again from another process (after a restart) reads its events from the start.
 */
export function followDetached(run: DetachedRun, onEvent?: (event: { type: string } & Record<string, unknown>) => void, afterStop?: () => Promise<void>): ChildHandle {
  const reading: Reading = { offset: 0, decoder: new StringDecoder('utf8'), buffer: '', last: undefined, usage: zeroUsage(), settled: false };
  const ended = { stopped: false, aborted: false };
  let resolveDone: (outcome: ChildOutcome) => void = () => undefined;
  const done = new Promise<ChildOutcome>((resolve) => {
    resolveDone = resolve;
  });
  const tick = () => {
    readNew(run, reading, onEvent);
    if (runActive(run)) return;
    clearInterval(timer);
    readNew(run, reading, onEvent);
    resolveDone(detachedOutcome(run, reading, ended));
  };
  // The timer keeps this process alive while it follows the run, as an RPC child's pipes do; detach() lets it go.
  const timer = setInterval(tick, POLL_MS);
  queueMicrotask(tick);
  const terminate = () => {
    signalGroup(run.pid, 'SIGTERM');
    setTimeout(() => signalGroup(run.pid, 'SIGKILL'), KILL_GRACE_MS).unref();
  };
  return {
    done,
    pid: run.pid,
    kill: () => {
      ended.aborted = true;
      terminate();
    },
    stop: () => {
      if (ended.stopped || ended.aborted) return;
      ended.stopped = true;
      terminate();
      void done.then(() => afterStop?.()).catch(() => undefined);
    },
    detach: () => clearInterval(timer),
  };
}
