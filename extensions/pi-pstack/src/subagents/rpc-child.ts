import { type ChildProcess, spawn } from 'node:child_process';

import type { PiCommand } from './pi-command.ts';

export type RpcRecord = Readonly<{ type: string }> & Readonly<Record<string, unknown>>;
export type ChildExit = Readonly<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>;
export type ChildStart = Readonly<{ command: PiCommand; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }>;

type Pending = { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
const requestDeadlineMs = 60000;

function parseRecord(line: string): RpcRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null && typeof (parsed as { type?: unknown }).type === 'string' ? (parsed as RpcRecord) : undefined;
  } catch {
    return undefined;
  }
}

/** A pi process in RPC mode: strict LF-framed JSONL, id-correlated commands, and every other record fanned out to listeners. */
export class RpcChild {
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(record: RpcRecord) => void>();
  private buffer = '';
  private sequence = 0;
  private stderr = '';
  readonly closed: Promise<ChildExit>;

  private constructor(private readonly process: ChildProcess) {
    process.stdout?.setEncoding('utf8');
    process.stdout?.on('data', (chunk: string) => this.receive(chunk));
    process.stderr?.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });
    process.stdin?.on('error', () => undefined);
    this.closed = new Promise((resolve) => {
      let settled = false;
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        const exit = { code, signal, stderr: this.stderr };
        this.rejectAll(new Error(`pi exited ${code ?? signal}: ${this.stderr.slice(-400)}`));
        resolve(exit);
      };
      process.once('close', finish);
      process.once('error', (error) => {
        this.stderr += String(error);
        finish(null, null);
      });
    });
  }

  static start({ command, args, cwd, env }: ChildStart): RpcChild {
    return new RpcChild(spawn(command.command, [...command.args, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }));
  }

  get pid(): number | undefined {
    return this.process.pid;
  }

  get exited(): boolean {
    return this.process.exitCode !== null || this.process.signalCode !== null;
  }

  onRecord(listener: (record: RpcRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(command: Readonly<Record<string, unknown>>, deadlineMs = requestDeadlineMs): Promise<unknown> {
    if (this.exited) return Promise.reject(new Error('pi process has exited'));
    const id = `pstack-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timed out: ${String(command.type)}`));
      }, deadlineMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin?.write(`${JSON.stringify({ id, ...command })}\n`, (error) => {
        if (error) this.fail(id, error);
      });
    });
  }

  respond(id: string, response: Readonly<Record<string, unknown>>): void {
    if (!this.exited) this.process.stdin?.write(`${JSON.stringify({ type: 'extension_ui_response', id, ...response })}\n`);
  }

  end(): void {
    this.process.stdin?.end();
  }

  kill(signal: NodeJS.Signals): void {
    if (!this.exited) this.process.kill(signal);
  }

  private fail(id: string, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(error);
  }

  private rejectAll(error: Error): void {
    for (const id of [...this.pending.keys()]) this.fail(id, error);
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let boundary = this.buffer.indexOf('\n');
    while (boundary >= 0) {
      const line = this.buffer.slice(0, boundary).replace(/\r$/, '');
      this.buffer = this.buffer.slice(boundary + 1);
      const record = line ? parseRecord(line) : undefined;
      if (record) this.dispatch(record);
      boundary = this.buffer.indexOf('\n');
    }
  }

  private dispatch(record: RpcRecord): void {
    if (record.type !== 'response') {
      for (const listener of this.listeners) listener(record);
      return;
    }
    const id = typeof record.id === 'string' ? record.id : undefined;
    const pending = id === undefined ? undefined : this.pending.get(id);
    if (!id || !pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (record.success === true) pending.resolve(record.data);
    else pending.reject(new Error(typeof record.error === 'string' ? record.error : 'RPC command failed'));
  }
}
