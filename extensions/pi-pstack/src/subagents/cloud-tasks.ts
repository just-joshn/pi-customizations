import { writeFile } from 'node:fs/promises';

import type { Usage } from '@earendil-works/pi-ai';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { DetachedRpcHandle } from '../../scripts/detached-rpc-client.mjs';
import { cloudControl, openCloudHandle, openCloudWorker, readCloudOutcome } from '../cloud-worker.ts';
import { type TaskParameters, type TaskRecord, taskOutputLimit } from '../worker-records.ts';
import { sumUsage } from '../worker-support.ts';

const pollMs = 150;

export type CloudWorker = Readonly<{ handle: DetachedRpcHandle; completion: Promise<TaskRecord>; stop: () => void; drain: () => Promise<string[]>; disconnect: () => void }>;

export type CloudHost = Readonly<{
  generation: () => number;
  current: (id: string) => TaskRecord | undefined;
  commit: (record: TaskRecord) => void;
  pendingUsage: (owner: number, record: TaskRecord) => Usage | undefined;
  notify: (record: TaskRecord, parentIdle: boolean) => void;
}>;

type Launch = Readonly<{ id: string; params: TaskParameters; prior: TaskRecord | undefined; ctx: ExtensionContext; owner: number; checkStartup: () => void }>;

/** Tasks that run in a detached Pi root, either on a remote VM or beside this session. Records live in WorkerRuntime. */
export class CloudTasks {
  private workers = new Map<string, CloudWorker>();

  constructor(private readonly host: CloudHost) {}

  has(id: string): boolean {
    return this.workers.has(id);
  }

  get(id: string): CloudWorker | undefined {
    return this.workers.get(id);
  }

  /** Opens the worker, sends the first prompt, and leaves the failed record behind when the prompt is refused. */
  async launch({ id, params, prior, ctx, owner, checkStartup }: Launch, parentIdle: () => boolean): Promise<CloudWorker> {
    const opened = await openCloudWorker({ id, params, prior, ctx });
    try {
      checkStartup();
      const usage = this.host.current(id)?.usage;
      const record = { ...opened.record, ...(usage ? { usage } : {}) };
      this.host.commit(record);
      const worker = this.attach(record, owner, parentIdle, params.run_in_background !== false);
      const response = await opened.handle.send({ type: 'prompt', message: params.prompt }, record.detached?.invocation);
      if (!response.success) throw new Error(response.error);
      return worker;
    } catch (error) {
      await this.failStartup(id, opened.handle, error);
      throw error;
    }
  }

  attach(record: TaskRecord, owner: number, parentIdle: () => boolean, background = true): CloudWorker {
    if (!record.detached) throw new Error('Cloud task is missing its durable handle.');
    const handle = openCloudHandle(record);
    const control = cloudControl(handle);
    const worker: CloudWorker = { handle, completion: this.complete(record, owner, parentIdle, background, control), ...control };
    this.workers = new Map(this.workers).set(record.id, worker);
    return worker;
  }

  /** Detaches every worker this session does not own, and stops the ones it does. */
  shutdown(owned: boolean, claim: (record: TaskRecord) => void): Promise<unknown>[] {
    const current = [...this.workers.values()];
    this.workers = new Map();
    if (!owned) {
      for (const worker of current) worker.disconnect();
      return [];
    }
    return current.map(async (worker) => {
      worker.stop();
      claim(await worker.completion);
      const failures = await worker.drain();
      if (failures.length) throw new AggregateError(failures, failures.join('; '));
    });
  }

  private async failStartup(id: string, handle: DetachedRpcHandle, error: unknown): Promise<void> {
    const record = this.host.current(id);
    if (record?.detached?.directory === handle.directory) {
      this.workers.get(id)?.disconnect();
      this.workers = new Map([...this.workers].filter(([key]) => key !== id));
      this.host.commit({ ...record, status: 'failed', output: String(error) });
    }
    await handle.close();
  }

  private async complete(record: TaskRecord, owner: number, parentIdle: () => boolean, background: boolean, control: ReturnType<typeof cloudControl>): Promise<TaskRecord> {
    while (!control.signal.aborted) {
      const outcome = await readCloudOutcome(record).catch((error) => ({ status: 'failed' as const, output: String(error), usage: sumUsage([]) }));
      if (outcome) return this.finish(record, owner, parentIdle, background, control, outcome);
      await pause(control.signal);
    }
    return record;
  }

  private async finish(record: TaskRecord, owner: number, parentIdle: () => boolean, background: boolean, control: ReturnType<typeof cloudControl>, outcome: NonNullable<Awaited<ReturnType<typeof readCloudOutcome>>>): Promise<TaskRecord> {
    const failures = await control.drain();
    const usage = sumUsage([{ role: 'toolResult', usage: outcome.usage }], this.host.pendingUsage(owner, record));
    let finished: TaskRecord = { ...record, status: failures.length ? 'failed' : outcome.status, output: (outcome.output + (failures.length ? `\n${failures.join('\n')}` : '')).slice(0, taskOutputLimit), usage };
    try {
      await writeFile(record.outputFile, outcome.output);
    } catch (error) {
      finished = { ...finished, status: 'failed', output: `${finished.output}\nCould not save full output: ${String(error)}` };
    }
    if (owner !== this.host.generation()) return finished;
    this.host.commit(finished);
    if (background && !control.stopped()) this.host.notify(finished, parentIdle());
    return finished;
  }
}

function pause(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, pollMs);
    signal.addEventListener('abort', done, { once: true });
  });
}
