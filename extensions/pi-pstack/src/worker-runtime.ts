import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import type { JsonValue, Usage } from '@earendil-works/pi-ai';
import type { AgentSession, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type DetachedRpcHandle, openDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { cloudControl, openCloudWorker, readCloudOutcome } from './cloud-worker.ts';
import { DeferredWakes } from './deferred-wakes.ts';
import { workerControl } from './worker-control.ts';
import { restoreTaskRecords, type TaskParameters, type TaskRecord, taskCleanupErrorType, taskCleanupUsageType, taskEntryType, taskOutputLimit, taskOwner, taskOwnerEntryType, taskSummary } from './worker-records.ts';
import { openWorkerSession, sumUsage } from './worker-support.ts';

type LocalWorker = { kind: 'local'; readonly session: AgentSession; readonly completion: Promise<TaskRecord>; readonly stop: () => void; readonly drain: () => Promise<string[]> };
type CloudWorker = { kind: 'cloud'; readonly handle: DetachedRpcHandle; readonly completion: Promise<TaskRecord>; readonly stop: () => void; readonly drain: () => Promise<string[]>; readonly disconnect: () => void };
type Worker = LocalWorker | CloudWorker;
type StartupOutcome = { error: unknown } | undefined;
type Lifecycle = { kind: 'active' } | { kind: 'stopped' } | { kind: 'stopping'; completion: Promise<void> };

export class WorkerRuntime {
  private records = new Map<string, TaskRecord>();
  private workers = new Map<string, Worker>();
  private starting = new Map<string, Promise<StartupOutcome>>();
  private generation = 0;
  private owned = false;
  private failedUsage = new Map<string, Usage>();
  private claimedUsage = new WeakSet<TaskRecord>();
  private lifecycle: Lifecycle = { kind: 'stopped' };
  private closing = new WeakMap<AgentSession, Promise<void>>();
  private readonly completions: DeferredWakes;
  constructor(private readonly pi: ExtensionAPI) {
    this.completions = new DeferredWakes(pi);
  }

  registerLifecycle(): void {
    if (process.env.PI_PSTACK_WORKER_OWNER)
      this.pi.registerCommand('pstack-worker-finalize', {
        handler: async () => {
          try {
            await this.stopAll();
          } catch (error) {
            this.pi.appendEntry(taskCleanupErrorType, { error: String(error) });
          }
        },
      });
    this.pi.on('tool_result', (event) => {
      if (event.toolName !== 'Task') return;
      const usage = this.failedUsage.get(event.toolCallId);
      if (!usage) return;
      this.failedUsage.delete(event.toolCallId);
      return { usage };
    });
    this.pi.on('session_start', async (_event, ctx) => this.restore(ctx));
    this.pi.on('session_tree', async (_event, ctx) => this.restore(ctx));
    this.pi.on('session_shutdown', () => this.stopAll());
  }

  private close(session: AgentSession): Promise<void> {
    const pending = this.closing.get(session);
    if (pending) return pending;
    const operation = (async () => {
      const failures: unknown[] = [];
      const unsubscribe = session.extensionRunner.onError((error) => failures.push(error.error));
      try {
        await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      } catch (error) {
        failures.push(error);
      } finally {
        unsubscribe();
        try {
          session.dispose();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, failures.map(String).join('; '));
    })();
    this.closing.set(session, operation);
    return operation;
  }

  private claimUsage(record: TaskRecord): Usage | undefined {
    if (!record.usage || this.claimedUsage.has(record)) return undefined;
    this.claimedUsage.add(record);
    const { usage, ...claimed } = record;
    if (this.records.get(record.id) === record) {
      this.records.set(record.id, claimed);
      this.pi.appendEntry(taskEntryType, structuredClone(claimed));
    }
    return usage;
  }

  private stopAll(): Promise<void> {
    this.generation++;
    this.completions.clear();
    if (this.lifecycle.kind === 'stopping') return this.lifecycle.completion;
    if (this.lifecycle.kind === 'stopped') return Promise.resolve();
    for (const worker of this.workers.values()) if (worker.kind === 'cloud' && !this.owned) worker.disconnect();
    const current = [...this.workers.values()].filter((worker) => this.owned || worker.kind === 'local');
    const starting = [...this.starting.values()];
    this.workers = new Map();
    const completion = Promise.resolve()
      .then(async () => {
        for (const worker of current) worker.stop();
        const outcomes = await Promise.allSettled([
          ...starting.map((operation) =>
            operation.then((outcome) => {
              if (outcome) throw outcome.error;
            }),
          ),
          ...current.map(async (worker) => {
            const record = await worker.completion;
            if (this.owned && record.usage && !this.claimedUsage.has(record)) {
              const usage = this.claimUsage(record);
              if (usage) this.pi.appendEntry(taskCleanupUsageType, { taskId: record.id, usage });
            }
            const failures = await worker.drain();
            if (worker.kind === 'local') {
              try {
                await this.close(worker.session);
              } catch (error) {
                failures.push(String(error));
              }
            }
            if (failures.length) throw new AggregateError(failures, failures.join('; '));
          }),
        ]);
        const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
        if (failures.length)
          throw new AggregateError(
            failures.map((outcome) => outcome.reason),
            `Worker cleanup failed: ${failures.map((outcome) => String(outcome.reason)).join('; ')}`,
          );
      })
      .finally(() => {
        this.lifecycle = { kind: 'stopped' };
      });
    this.lifecycle = { kind: 'stopping', completion };
    return completion;
  }

  private async restore(ctx: ExtensionContext): Promise<void> {
    const completion = this.stopAll();
    const owner = this.generation;
    try {
      await completion;
    } finally {
      if (owner === this.generation) {
        this.owned = Boolean(process.env.PI_PSTACK_WORKER_OWNER || taskOwner(ctx.sessionManager.getEntries()));
        if (process.env.PI_PSTACK_WORKER_OWNER && taskOwner(ctx.sessionManager.getEntries()) !== process.env.PI_PSTACK_WORKER_OWNER) this.pi.appendEntry(taskOwnerEntryType, { id: process.env.PI_PSTACK_WORKER_OWNER });
        this.records = restoreTaskRecords(ctx.sessionManager.getBranch());
        this.failedUsage = new Map();
        this.completions.clear();
        this.lifecycle = { kind: 'active' };
        for (const record of this.records.values()) if (record.detached && record.status === 'running') this.attachCloud(record, owner, () => ctx.isIdle());
      }
    }
  }

  private priorTask(params: TaskParameters): TaskRecord | undefined {
    if (this.lifecycle.kind !== 'active') throw new Error('Parent session is not active. Wait for session startup or tree restoration before starting a task.');
    const prior = params.resume ? this.records.get(params.resume) : undefined;
    if (params.resume && !prior) throw new Error(`Unknown task in this branch: ${params.resume}`);
    return prior;
  }

  private checkStartup(owner: number, signal: AbortSignal | undefined): void {
    if (this.generation !== owner || signal?.aborted) throw new Error('Task startup was cancelled.');
  }

  async start(callId: string, params: TaskParameters, signal: AbortSignal | undefined, ctx: ExtensionContext) {
    const prior = this.priorTask(params);
    const id = prior?.id ?? randomUUID();
    if (this.starting.has(id) || (this.workers.has(id) && this.records.get(id)?.status === 'running')) throw new Error(`Task ${id} is running. Use TaskMessage to queue input.`);
    let finishStarting = (_outcome: StartupOutcome) => {};
    let startupOutcome: StartupOutcome;
    this.starting.set(
      id,
      new Promise<StartupOutcome>((resolveStart) => {
        finishStarting = resolveStart;
      }),
    );
    const owner = this.generation;
    let session: AgentSession | undefined;
    let cloud: DetachedRpcHandle | undefined;
    try {
      if (params.environment === 'cloud' || prior?.detached) {
        if (prior?.detached && params.environment === 'local') throw new Error('Resume must preserve the task execution environment.');
        const opened = await openCloudWorker({ id, params, prior, ctx });
        cloud = opened.handle;
        this.checkStartup(owner, signal);
        const usage = this.records.get(id)?.usage;
        const record = { ...opened.record, ...(usage ? { usage } : {}) };
        this.records.set(id, record);
        this.pi.appendEntry(taskEntryType, structuredClone(record));
        const handle = cloud;
        const worker = this.attachCloud(record, owner, () => ctx.isIdle(), params.run_in_background !== false);
        cloud = undefined;
        const response = await handle.send({ type: 'prompt', message: params.prompt }, record.detached?.invocation);
        if (!response.success) throw new Error(response.error);
        return this.result(params.run_in_background === false ? await this.foreground(callId, worker, signal) : (this.records.get(id) ?? record));
      }
      const opened = await openWorkerSession({ id, params, prior, ctx });
      session = opened.session;
      this.checkStartup(owner, signal);
      await session.bindExtensions({ mode: 'print' });
      this.checkStartup(owner, signal);
      const previous = this.workers.get(id);
      if (previous?.kind === 'local') await this.close(previous.session);
      this.checkStartup(owner, signal);
      const worker = this.launch(opened, params, signal, owner, () => ctx.isIdle());
      const record = params.run_in_background === false ? await this.foreground(callId, worker) : this.records.get(id);
      if (!record) throw new Error(`Failed to create task record for ${id}`);
      return this.result(record);
    } catch (error) {
      try {
        if (session) await this.close(session);
        if (cloud) await cloud.close();
      } catch (cleanup) {
        startupOutcome = { error: cleanup };
        throw new AggregateError([error, cleanup], `${String(error)}; Worker cleanup failed: ${String(cleanup)}`);
      }
      throw error;
    } finally {
      this.starting.delete(id);
      finishStarting(startupOutcome);
    }
  }

  private attachCloud(record: TaskRecord, owner: number, parentIdle: () => boolean, background = true): CloudWorker {
    if (!record.detached) throw new Error('Cloud task is missing its durable handle.');
    const handle = openDetachedRpc(record.detached.directory);
    const control = cloudControl(handle);
    const completion = this.completeCloud(record, owner, parentIdle, background, control);
    const worker: CloudWorker = { kind: 'cloud', handle, completion, ...control };
    this.workers.set(record.id, worker);
    return worker;
  }

  private async completeCloud(record: TaskRecord, owner: number, parentIdle: () => boolean, background: boolean, control: ReturnType<typeof cloudControl>): Promise<TaskRecord> {
    while (!control.signal.aborted) {
      let outcome: Awaited<ReturnType<typeof readCloudOutcome>>;
      try {
        outcome = await readCloudOutcome(record);
      } catch (error) {
        outcome = { status: 'failed', output: String(error), usage: sumUsage([]) };
      }
      if (outcome) {
        const failures = await control.drain();
        const pending = owner === this.generation ? this.records.get(record.id)?.usage : this.claimedUsage.has(record) ? undefined : record.usage;
        const usage = sumUsage([{ role: 'toolResult', usage: outcome.usage }], pending);
        let finished: TaskRecord = { ...record, status: failures.length ? 'failed' : outcome.status, output: (outcome.output + (failures.length ? `\n${failures.join('\n')}` : '')).slice(0, taskOutputLimit), usage };
        try {
          await writeFile(record.outputFile, outcome.output);
        } catch (error) {
          finished = { ...finished, status: 'failed', output: `${finished.output}\nCould not save full output: ${String(error)}` };
        }
        if (owner !== this.generation) return finished;
        this.records.set(record.id, finished);
        this.pi.appendEntry(taskEntryType, structuredClone(finished));
        if (background && !control.stopped()) this.completions.send(record.id, parentIdle(), { customType: 'pstack-task-completion', content: taskSummary(finished), display: true, details: structuredClone(finished) });
        return finished;
      }
      await new Promise<void>((resolve) => {
        const abort = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          control.signal.removeEventListener('abort', abort);
          resolve();
        }, 150);
        control.signal.addEventListener('abort', abort, { once: true });
      });
    }
    return record;
  }

  private async foreground(callId: string, worker: Worker, signal?: AbortSignal): Promise<TaskRecord> {
    const record = signal
      ? await new Promise<TaskRecord>((resolve, reject) => {
          if (signal.aborted) {
            reject(new Error('Wait cancelled. Cloud task continues.'));
            return;
          }
          const abort = () => reject(new Error('Wait cancelled. Cloud task continues.'));
          signal.addEventListener('abort', abort, { once: true });
          void worker.completion.then(
            (result) => {
              signal.removeEventListener('abort', abort);
              resolve(result);
            },
            (error) => {
              signal.removeEventListener('abort', abort);
              reject(error);
            },
          );
        })
      : await worker.completion;
    if (record.status === 'settled') return record;
    const usage = this.claimUsage(record);
    if (usage) this.failedUsage.set(callId, usage);
    throw new Error(taskSummary(record));
  }

  private launch(opened: Awaited<ReturnType<typeof openWorkerSession>>, params: TaskParameters, signal: AbortSignal | undefined, owner: number, parentIdle: () => boolean): Worker {
    const { session } = opened;
    const usage = this.records.get(opened.record.id)?.usage;
    const record: TaskRecord = { ...opened.record, ...(usage ? { usage } : {}) };
    this.records.set(record.id, record);
    this.pi.appendEntry(taskEntryType, structuredClone(record));
    const control = workerControl(session, signal);
    const completion = this.complete({ session, record }, params, owner, control, parentIdle);
    const worker: LocalWorker = { kind: 'local', session, completion, stop: control.stop, drain: control.drain };
    this.workers.set(record.id, worker);
    return worker;
  }

  private async run(session: AgentSession, prompt: string): Promise<{ status: TaskRecord['status']; output: string }> {
    try {
      await session.prompt(prompt);
      await session.waitForIdle();
      const last = session.messages.findLast((message) => message.role === 'assistant');
      const output = session.getLastAssistantText() ?? '';
      if (last?.role === 'assistant' && (last.stopReason === 'error' || last.stopReason === 'aborted')) {
        return { status: last.stopReason === 'aborted' ? 'interrupted' : 'failed', output: last.errorMessage ?? output };
      }
      return { status: 'settled', output };
    } catch (error) {
      return { status: 'failed', output: error instanceof Error ? error.message : String(error) };
    }
  }

  private async complete(worker: Awaited<ReturnType<typeof openWorkerSession>>, params: TaskParameters, owner: number, control: ReturnType<typeof workerControl>, parentIdle: () => boolean): Promise<TaskRecord> {
    const { session, record } = worker;
    const initialCount = session.messages.length;
    let outcome: Awaited<ReturnType<WorkerRuntime['run']>>;
    try {
      outcome = await this.run(session, params.prompt);
    } finally {
      control.unsubscribe();
    }
    try {
      await this.close(session);
    } catch (error) {
      outcome = { status: 'failed' as const, output: `${outcome.output}\nWorker shutdown failed: ${String(error)}` };
    }
    const abortFailures = await control.drain();
    if (abortFailures.length) outcome = { status: 'failed', output: `${outcome.output}\n${abortFailures.join('\n')}` };
    const status = control.stopped() ? 'interrupted' : outcome.status;
    const pendingUsage = owner === this.generation ? this.records.get(record.id)?.usage : this.claimedUsage.has(record) ? undefined : record.usage;
    const usage = sumUsage(session.messages.slice(initialCount), pendingUsage);
    let finished: TaskRecord = { ...record, status, output: outcome.output.slice(0, taskOutputLimit), usage };
    try {
      await writeFile(finished.outputFile, outcome.output);
    } catch (error) {
      finished = { ...finished, status: 'failed', output: `${finished.output}\nCould not save full output: ${String(error)}` };
    }
    if (owner !== this.generation) return finished;
    this.records.set(record.id, finished);
    this.pi.appendEntry(taskEntryType, structuredClone(finished));
    if (params.run_in_background !== false && !control.stopped()) {
      this.completions.send(record.id, parentIdle(), { customType: 'pstack-task-completion', content: taskSummary(finished), display: true, details: structuredClone(finished) });
    }
    return finished;
  }

  private result(record: TaskRecord) {
    this.completions.drop(record.id);
    const usage = this.claimUsage(record);
    const current = this.records.get(record.id) ?? record;
    return {
      content: [{ type: 'text' as const, text: taskSummary(current) }],
      details: structuredClone(current),
      structuredContent: structuredClone(current) as unknown as JsonValue,
      isError: current.status === 'failed',
      usage: usage ? structuredClone(usage) : undefined,
    };
  }

  async output(id: string, block: boolean | undefined, signal: AbortSignal | undefined) {
    const worker = this.workers.get(id);
    if (block && worker) {
      if (signal?.aborted) throw new Error('Wait cancelled.');
      await new Promise<void>((resolveWait, reject) => {
        const abort = () => reject(new Error('Wait cancelled.'));
        signal?.addEventListener('abort', abort, { once: true });
        void worker.completion.then(
          () => {
            signal?.removeEventListener('abort', abort);
            resolveWait();
          },
          (error) => {
            signal?.removeEventListener('abort', abort);
            reject(error);
          },
        );
      });
    }
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown task in this branch: ${id}`);
    return this.result(record);
  }

  async stop(id: string) {
    const worker = this.workers.get(id);
    if (!worker) throw new Error(`No live task: ${id}`);
    worker.stop();
    const record = await worker.completion;
    return this.result(record);
  }

  async message(id: string, message: string, mode: 'steer' | 'followUp' | undefined) {
    const worker = this.workers.get(id);
    if (!worker || this.records.get(id)?.status !== 'running') throw new Error('Task is not running. Use Task with resume.');
    if (worker.kind === 'cloud') {
      const response = await worker.handle.send({ type: mode === 'steer' ? 'steer' : 'follow_up', message });
      if (!response.success) throw new Error(response.error);
    } else if (mode === 'steer') await worker.session.steer(message);
    else await worker.session.followUp(message);
    const details = { task_id: id };
    return { content: [{ type: 'text' as const, text: `Message queued for ${id}` }], details, structuredContent: details as unknown as JsonValue };
  }
}
