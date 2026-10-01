import { existsSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';

import type { TaskRecord } from '../worker-records.ts';
import { abortInfo } from './abort-reasons.ts';
import { assistantText, foldTurn, initialTurn, type SessionStats, settledPatch, type TurnState } from './child-turn.ts';
import { type RelayDeps, relayUiRequest } from './permission-relay.ts';
import { type ChildStart, RpcChild, type RpcRecord } from './rpc-child.ts';

export type ChildKind = 'remote' | 'teammate';

export type ChildHost = Readonly<{
  commit: (record: TaskRecord) => void;
  settle: (record: TaskRecord, output: string, notify: { send: boolean; parentIdle: () => boolean }) => void;
  current: (id: string) => TaskRecord | undefined;
}>;

export type ChildLaunch = Readonly<{
  kind: ChildKind;
  record: TaskRecord;
  placement: Readonly<{ planMode?: boolean; pane?: string; team?: string }>;
  start: ChildStart;
  permission: RelayDeps;
  parentIdle: () => boolean;
  closePane?: () => Promise<void>;
  cleanup?: (record: TaskRecord) => Promise<Partial<TaskRecord>>;
}>;

type Turn = { state: TurnState; startedAt: number; settled: Promise<void>; markSettled: () => void };
const escalationMs = 3000;

function newTurn(): Turn {
  let markSettled = () => {};
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve;
  });
  return { state: initialTurn, startedAt: Date.now(), settled, markSettled };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** One pi RPC process serving one task. A remote task ends its process after each turn; a teammate keeps it for follow-ups. */
export class ChildTask {
  private child: RpcChild | undefined;
  private turn: Turn | undefined;
  private stopRequested = false;
  private completion: Promise<TaskRecord>;
  private permission: RelayDeps;
  private parentIdle: () => boolean;

  constructor(
    private readonly launch: ChildLaunch,
    private readonly host: ChildHost,
  ) {
    this.completion = Promise.resolve(launch.record);
    this.permission = launch.permission;
    this.parentIdle = launch.parentIdle;
  }

  get id(): string {
    return this.launch.record.id;
  }

  get kind(): ChildKind {
    return this.launch.kind;
  }

  get done(): Promise<TaskRecord> {
    return this.completion;
  }

  get alive(): boolean {
    return this.child !== undefined && !this.child.exited;
  }

  rebind(ask: RelayDeps['ask'], parentIdle: () => boolean): void {
    this.permission = { ...this.permission, ask };
    this.parentIdle = parentIdle;
  }

  async open(resumeSession?: string): Promise<{ sessionId: string; sessionFile: string }> {
    const { start } = this.launch;
    const cwd = existsSync(start.cwd) ? start.cwd : process.cwd();
    const child = RpcChild.start({ ...start, cwd, args: [...start.args, ...(resumeSession ? ['--session', resumeSession] : [])] });
    this.child = child;
    child.onRecord((record) => this.observe(child, record));
    try {
      const state = asRecord(await child.send({ type: 'get_state' }));
      if (typeof state.sessionId !== 'string' || typeof state.sessionFile !== 'string') throw new Error('pi did not report a persisted session');
      return { sessionId: state.sessionId, sessionFile: state.sessionFile };
    } catch (error) {
      child.kill('SIGKILL');
      throw new Error(`Failed to create remote pi session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private observe(child: RpcChild, record: RpcRecord): void {
    if (record.type === 'extension_ui_request') {
      void relayUiRequest(child, record, this.permission);
      return;
    }
    const turn = this.turn;
    if (!turn) return;
    if (record.type === 'agent_settled') turn.markSettled();
    turn.state = foldTurn(turn.state, record);
    const text = assistantText(record);
    if (text) void appendFile(this.launch.record.outputFile, `${text}\n`).catch(() => undefined);
  }

  begin(prompt: string): Promise<TaskRecord> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('Task has no running pi process.'));
    const turn = newTurn();
    this.turn = turn;
    this.stopRequested = false;
    this.completion = this.finish(child, turn);
    child.send({ type: 'prompt', message: prompt }).catch((error: unknown) => {
      turn.state = { ...turn.state, failure: error instanceof Error ? error.message : String(error) };
      turn.markSettled();
    });
    return this.completion;
  }

  private async collect(child: RpcChild, turn: Turn): Promise<{ output: string; stats?: SessionStats }> {
    await Promise.race([turn.settled, child.closed]);
    if (child.exited) return { output: '' };
    const text = asRecord(await child.send({ type: 'get_last_assistant_text' }).catch(() => undefined)).text;
    const stats = await child.send({ type: 'get_session_stats' }).catch(() => undefined);
    return { output: typeof text === 'string' ? text : '', ...(stats ? { stats: asRecord(stats) as SessionStats } : {}) };
  }

  private async finish(child: RpcChild, turn: Turn): Promise<TaskRecord> {
    const { output, stats } = await this.collect(child, turn);
    const died = child.exited && !turn.state.aborted && !this.stopRequested;
    const state = died && !turn.state.failure ? { ...turn.state, failure: `pi exited before the task finished: ${(await child.closed).stderr.slice(-400)}` } : turn.state;
    const current = this.host.current(this.id) ?? this.launch.record;
    let record: TaskRecord = { ...current, ...settledPatch({ state, output, stopped: this.stopRequested, startedAt: turn.startedAt, ...(stats ? { stats } : {}) }) };
    if (this.stopRequested) record = { ...record, abort: abortInfo('remote-cancel', false) };
    if (this.kind === 'remote') await this.terminate(child);
    record = { ...record, ...(await this.launch.cleanup?.(record).catch(() => ({}))) };
    this.host.settle(record, record.output, { send: !this.stopRequested, parentIdle: this.parentIdle });
    return record;
  }

  steer(message: string, mode: 'steer' | 'followUp'): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error('Task has no running pi process.'));
    return this.child.send({ type: mode === 'steer' ? 'steer' : 'follow_up', message });
  }

  private async terminate(child: RpcChild): Promise<void> {
    child.end();
    const exited = await Promise.race([child.closed.then(() => true), new Promise<boolean>((resolve) => setTimeout(resolve, escalationMs, false))]);
    if (!exited) {
      child.kill('SIGTERM');
      await Promise.race([child.closed, new Promise((resolve) => setTimeout(resolve, escalationMs))]);
      child.kill('SIGKILL');
    }
    await child.closed;
  }

  async stop(): Promise<TaskRecord> {
    const child = this.child;
    this.stopRequested = true;
    if (child && !child.exited) {
      if (this.turn) await child.send({ type: 'abort' }, 5000).catch(() => undefined);
      await this.terminate(child);
    }
    const record = await this.completion;
    await this.launch.closePane?.().catch(() => undefined);
    return record;
  }
}
