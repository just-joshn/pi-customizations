import { hostname } from 'node:os';

import type { TaskRecord } from '../worker-records.ts';
import { type ChildHost, type ChildKind, type ChildLaunch, ChildTask } from './child-task.ts';
import type { RelayDeps } from './permission-relay.ts';

export function sessionUrl(sessionId: string): string {
  return `pi-session://${hostname()}/${sessionId}`;
}

export type ChildListing = Readonly<{ id: string; kind: ChildKind; alive: boolean }>;

/** The roster of pi RPC child processes (remote destinations and teammates). Records live in WorkerRuntime; processes live here. */
export class RemoteTasks {
  private readonly tasks = new Map<string, ChildTask>();

  constructor(private readonly host: ChildHost) {}

  has(id: string): boolean {
    return this.tasks.has(id);
  }

  list(): readonly ChildListing[] {
    return [...this.tasks.values()].map((task) => ({ id: task.id, kind: task.kind, alive: task.alive }));
  }

  completion(id: string): Promise<TaskRecord> | undefined {
    return this.tasks.get(id)?.done;
  }

  async launch(launch: ChildLaunch, prompt: string): Promise<TaskRecord> {
    const task = new ChildTask(launch, this.host);
    const { sessionId, sessionFile } = await task.open();
    const record: TaskRecord = { ...launch.record, sessionFile, destination: { kind: launch.kind, sessionUrl: sessionUrl(sessionId), sessionId, ...launch.placement } };
    this.tasks.set(record.id, task);
    this.host.commit(record);
    void task.begin(prompt);
    return record;
  }

  async resume(id: string, prompt: string, ask: RelayDeps['ask'], parentIdle: () => boolean): Promise<void> {
    const task = this.tasks.get(id);
    const record = this.host.current(id);
    if (!task || !record) throw new Error(`Unknown remote task: ${id}`);
    task.rebind(ask, parentIdle);
    if (!task.alive) await task.open(record.sessionFile);
    const { abort: _abort, ...running } = record;
    this.host.commit({ ...running, status: 'running', startedAt: Date.now(), output: '' });
    void task.begin(prompt);
  }

  message(id: string, text: string, mode: 'steer' | 'followUp'): Promise<unknown> {
    const task = this.tasks.get(id);
    if (!task) return Promise.reject(new Error(`Unknown remote task: ${id}`));
    return task.steer(text, mode);
  }

  stop(id: string): Promise<TaskRecord> {
    const task = this.tasks.get(id);
    if (!task) return Promise.reject(new Error(`Unknown remote task: ${id}`));
    return task.stop();
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.tasks.values()].map((task) => task.stop()));
    this.tasks.clear();
  }
}
