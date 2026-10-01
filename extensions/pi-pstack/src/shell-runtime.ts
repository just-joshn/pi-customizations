import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { DeferredWakes } from './deferred-wakes.ts';
import { processGroupEvent } from './subagents/process-groups.ts';

export type ShellStatus = { kind: 'running' } | { kind: 'exited'; code: number | null; signal: NodeJS.Signals | null } | { kind: 'stopped' };
export type ShellRecord = Readonly<{
  id: string;
  title: string;
  command: string;
  pid: number;
  cwd: string;
  pattern: string | undefined;
  outputFile: string;
  startedAt: string;
  status: ShellStatus;
  matches: number;
}>;
export type ShellParameters = { command: string; title: string; notify_on_output?: string };
type Shell = { record: ShellRecord; child: ChildProcess; exited: Promise<void>; wakePending: boolean; parentIdle: () => boolean };

const lineLimit = 2000;
const stopGraceMs = 2000;

function parsePattern(pattern: string | undefined): RegExp | undefined {
  if (pattern === undefined) return undefined;
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new Error(`notify_on_output is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireText(value: string, name: string): void {
  if (!value.trim()) throw new Error(`BackgroundShell ${name} must not be blank.`);
}

async function outputDirectory(ctx: ExtensionContext): Promise<string> {
  const manager = ctx.sessionManager;
  if (!manager.getSessionFile()) return mkdtemp(join(tmpdir(), 'pstack-shells-'));
  const dir = join(manager.getSessionDir(), 'pstack-shells', manager.getSessionId());
  await mkdir(dir, { recursive: true });
  return dir;
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    // macOS answers EPERM when the only member left in the group is an unreaped zombie
    // leader; a group holding a live member accepts the signal. Neither code can be a
    // process this call could have reached, so there is nothing left to signal.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH' && code !== 'EPERM') throw error;
  }
}

async function settlesWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(resolve, ms, false);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function describe(record: ShellRecord): string {
  return `Background shell ${record.id} (${record.title})`;
}

export class ShellRuntime {
  private shells = new Map<string, Shell>();
  private readonly wakes: DeferredWakes;
  constructor(private readonly pi: ExtensionAPI) {
    this.wakes = new DeferredWakes(pi);
  }

  async start(params: ShellParameters, ctx: ExtensionContext): Promise<ShellRecord> {
    requireText(params.command, 'command');
    requireText(params.title, 'title');
    const pattern = parsePattern(params.notify_on_output);
    const id = randomUUID();
    const outputFile = join(await outputDirectory(ctx), `${id}.log`);
    await writeFile(outputFile, '');
    const child = spawn('bash', ['-c', params.command], { cwd: ctx.cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    await once(child, 'spawn');
    if (child.pid) this.pi.events.emit(processGroupEvent, { pid: child.pid });
    const record: ShellRecord = {
      id,
      title: params.title,
      command: params.command,
      pid: child.pid ?? 0,
      cwd: ctx.cwd,
      pattern: params.notify_on_output,
      outputFile,
      startedAt: new Date().toISOString(),
      status: { kind: 'running' },
      matches: 0,
    };
    const exited = this.watch(record, child, pattern);
    this.shells.set(id, { record, child, exited, wakePending: false, parentIdle: () => ctx.isIdle() });
    return record;
  }

  list(): ShellRecord[] {
    return [...this.shells.values()].map((shell) => shell.record).toReversed();
  }

  async stop(id: string): Promise<ShellRecord> {
    const shell = this.shells.get(id);
    if (!shell) throw new Error(`Unknown background shell: ${id}`);
    if (shell.record.status.kind === 'running') {
      this.update(id, { status: { kind: 'stopped' } });
      this.wakes.drop(`output:${id}`);
      signalGroup(shell.record.pid, 'SIGTERM');
      if (!(await settlesWithin(shell.exited, stopGraceMs))) signalGroup(shell.record.pid, 'SIGKILL');
    }
    // A descendant that left the process group keeps the inherited pipes open, so Node
    // never emits close and the exit watch never settles. The record already holds the
    // outcome, so wait a bounded time for the exit instead of blocking the caller forever.
    await settlesWithin(shell.exited, stopGraceMs);
    const updated = this.shells.get(id);
    if (!updated) throw new Error(`Unknown background shell: ${id}`);
    return updated.record;
  }

  async stopAll(): Promise<void> {
    this.wakes.clear();
    await Promise.all([...this.shells.keys()].map((id) => this.stop(id)));
  }

  /**
   * Drops records left by an earlier session. Shutdown keeps them so a caller can still read what
   * was stopped, but they point at the previous session's log paths and hold its child processes,
   * so the next session must start from an empty list.
   */
  forgetPreviousSession(): void {
    this.shells.clear();
  }

  delivered(id: string): void {
    const shell = this.shells.get(id);
    if (shell) this.shells.set(id, { ...shell, wakePending: false });
  }

  private update(id: string, patch: Partial<ShellRecord>): ShellRecord {
    const shell = this.shells.get(id);
    if (!shell) throw new Error(`Unknown background shell: ${id}`);
    const record: ShellRecord = { ...shell.record, ...patch };
    this.shells.set(id, { ...shell, record });
    return record;
  }

  private async watch(record: ShellRecord, child: ChildProcess, pattern: RegExp | undefined): Promise<void> {
    let io = Promise.resolve();
    let writeFailure: string | undefined;
    const closed = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => child.once('close', (code, signal) => resolve([code, signal])));
    const deliver = (text: string, lines: string[]) => {
      io = io
        .then(() => appendFile(record.outputFile, text))
        .catch((error) => {
          writeFailure = String(error);
        })
        .then(() => {
          for (const line of lines) this.line(record.id, pattern, line);
        });
    };
    for (const stream of [child.stdout, child.stderr]) {
      if (stream) readLines(stream, deliver);
    }
    const [code, signal] = await closed;
    await io;
    this.exit(record.id, code, signal, writeFailure);
  }

  private line(id: string, pattern: RegExp | undefined, line: string): void {
    const shell = this.shells.get(id);
    if (!pattern || shell?.record.status.kind !== 'running' || !pattern.test(line)) return;
    const record = this.update(id, { matches: shell.record.matches + 1 });
    if (shell.wakePending) return;
    const current = this.shells.get(id);
    if (current) this.shells.set(id, { ...current, wakePending: true });
    const content = `${describe(record)} matched ${record.pattern}.\nOutput file: ${record.outputFile}\nLine: ${line.slice(0, lineLimit)}`;
    this.wakes.send(`output:${id}`, shell.parentIdle(), { customType: 'pstack-shell-output', display: true, details: record, content });
  }

  private exit(id: string, code: number | null, signal: NodeJS.Signals | null, writeFailure: string | undefined): void {
    const shell = this.shells.get(id);
    if (shell?.record.status.kind !== 'running') return;
    const record = this.update(id, { status: { kind: 'exited', code, signal } });
    const outcome = signal ? `signal ${signal}` : `exit code ${code}`;
    const failure = writeFailure ? `\nOutput file write failed: ${writeFailure}` : '';
    const content = `${describe(record)} exited with ${outcome}.\nOutput file: ${record.outputFile}${failure}`;
    const quiet = record.matches > 0 && code === 0;
    const message = { customType: 'pstack-shell-exit', display: true, details: record, content };
    if (!quiet || writeFailure) this.wakes.send(`exit:${id}`, shell.parentIdle(), message);
  }
}

function readLines(stream: Readable, deliver: (text: string, lines: string[]) => void): void {
  let tail = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    const parts = (tail + chunk).split('\n');
    tail = parts.pop() ?? '';
    deliver(
      chunk,
      parts.map((part) => part.replace(/\r$/, '')),
    );
  });
  stream.on('end', () => {
    if (tail) deliver('', [tail.replace(/\r$/, '')]);
    tail = '';
  });
}
