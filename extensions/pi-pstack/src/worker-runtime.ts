import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Usage } from '@earendil-works/pi-ai';
import type { AgentSession, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { restoreTaskRecords, taskEntryType, taskOutputLimit, taskSummary, type TaskRecord, type TaskParameters } from './worker-records.ts';
import { openWorkerSession, sumUsage } from './worker-support.ts';

type Worker = { record: TaskRecord; session: AgentSession; completion: Promise<void>; stop: () => void };
type Lifecycle = { kind: 'active' } | { kind: 'stopped' } | { kind: 'stopping'; completion: Promise<void> };

export class WorkerRuntime {
  private records = new Map<string, TaskRecord>();
  private workers = new Map<string, Worker>();
  private starting = new Map<string, Promise<void>>();
  private generation = 0;
  private failedUsage = new Map<string, Usage>();
  private lifecycle: Lifecycle = { kind: 'stopped' };
  private closing = new WeakMap<AgentSession, Promise<void>>();
  constructor(private readonly pi: ExtensionAPI) {}

  registerLifecycle(): void {
    this.pi.on('tool_result', event => {
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
      try { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); }
      finally { session.dispose(); }
    })();
    this.closing.set(session, operation);
    return operation;
  }

  private claimUsage(record: TaskRecord): Usage | undefined {
    if (!record.usage) return undefined;
    const { usage, ...claimed } = record;
    if (this.records.get(record.id) === record) {
      this.records.set(record.id, claimed);
      const worker = this.workers.get(record.id);
      if (worker) worker.record = claimed;
      this.pi.appendEntry(taskEntryType, claimed);
    }
    return usage;
  }

  private stopAll(): Promise<void> {
    this.generation++;
    if (this.lifecycle.kind === 'stopping') return this.lifecycle.completion;
    if (this.lifecycle.kind === 'stopped') return Promise.resolve();
    const current = [...this.workers.values()];
    this.workers = new Map();
    const completion = Promise.resolve().then(async () => {
      for (const worker of current) worker.stop();
      await Promise.allSettled([
        ...this.starting.values(),
        ...current.map(async worker => { await worker.session.abort(); await worker.completion; await this.close(worker.session); }),
      ]);
    }).finally(() => { this.lifecycle = { kind: 'stopped' }; });
    this.lifecycle = { kind: 'stopping', completion };
    return completion;
  }

  private async restore(ctx: ExtensionContext): Promise<void> {
    const completion = this.stopAll();
    const owner = this.generation;
    await completion;
    if (owner !== this.generation) return;
    this.records = restoreTaskRecords(ctx.sessionManager.getBranch());
    this.failedUsage = new Map();
    this.lifecycle = { kind: 'active' };
  }

  private priorTask(params: TaskParameters): TaskRecord | undefined {
    if (this.lifecycle.kind !== 'active') throw new Error('Parent session is not active. Wait for session startup or tree restoration before starting a task.');
    if (params.environment === 'cloud') throw new Error('Reference cloud execution is unavailable in Pi. Explicitly choose environment local only when local execution satisfies the task.');
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
    if (this.starting.has(id) || this.workers.get(id)?.record.status === 'running') throw new Error(`Task ${id} is running. Use TaskMessage to queue input.`);
    let finishStarting = () => {};
    this.starting.set(id, new Promise<void>(resolveStart => { finishStarting = resolveStart; }));
    const owner = this.generation;
    let session: AgentSession | undefined;
    try {
      const opened = await openWorkerSession({ id, params, prior, ctx });
      session = opened.session;
      this.checkStartup(owner, signal);
      await session.bindExtensions({ mode: 'print' });
      this.checkStartup(owner, signal);
      const previous = this.workers.get(id);
      if (previous) await this.close(previous.session);
      this.checkStartup(owner, signal);
      const worker = this.launch(opened, params, signal, owner);
      if (params.run_in_background === false) await this.foreground(callId, worker);
      return this.result(worker.record);
    } catch (error) { if (session) await this.close(session); throw error; }
    finally { this.starting.delete(id); finishStarting(); }
  }

  private async foreground(callId: string, worker: Worker): Promise<void> {
    await worker.completion;
    if (worker.record.status === 'settled') return;
    const usage = this.claimUsage(worker.record);
    if (usage) this.failedUsage.set(callId, usage);
    throw new Error(taskSummary(worker.record));
  }

  private launch(opened: Awaited<ReturnType<typeof openWorkerSession>>, params: TaskParameters, signal: AbortSignal | undefined, owner: number): Worker {
    const { session, record } = opened;
    this.records.set(record.id, record);
    this.pi.appendEntry(taskEntryType, record);
    let stopped = false;
    const stop = () => { stopped = true; void session.abort(); };
    const unsubscribe = session.subscribe(event => {
      if (stopped && event.type === 'agent_start') void session.abort();
    });
    signal?.addEventListener('abort', stop, { once: true });
    const worker: Worker = { record, session, completion: Promise.resolve(), stop };
    this.workers.set(record.id, worker);
    worker.completion = this.complete(worker, params, owner, {
      stopped: () => stopped,
      unsubscribe: () => { signal?.removeEventListener('abort', stop); unsubscribe(); },
    });
    return worker;
  }

  private async run(session: AgentSession, prompt: string): Promise<{ status: TaskRecord['status']; output: string }> {
    try {
      await session.prompt(prompt);
      await session.waitForIdle();
      const last = session.messages.findLast(message => message.role === 'assistant');
      const output = session.getLastAssistantText() ?? '';
      if (last?.role === 'assistant' && (last.stopReason === 'error' || last.stopReason === 'aborted')) {
        return { status: last.stopReason === 'aborted' ? 'interrupted' : 'failed', output: last.errorMessage ?? output };
      }
      return { status: 'settled', output };
    } catch (error) { return { status: 'failed', output: error instanceof Error ? error.message : String(error) }; }
  }

  private async complete(worker: Worker, params: TaskParameters, owner: number, control: { stopped: () => boolean; unsubscribe: () => void }): Promise<void> {
    const { session, record } = worker;
    const initialCount = session.messages.length;
    let outcome;
    try { outcome = await this.run(session, params.prompt); }
    finally { control.unsubscribe(); }
    try { await this.close(session); }
    catch (error) { outcome = { status: 'failed' as const, output: `${outcome.output}\nWorker shutdown failed: ${String(error)}` }; }
    const status = control.stopped() ? 'interrupted' : outcome.status;
    const usage = sumUsage(session.messages.slice(initialCount), worker.record.usage);
    let finished: TaskRecord = { ...record, status, output: outcome.output.slice(0, taskOutputLimit), usage };
    try { await writeFile(finished.outputFile, outcome.output); }
    catch (error) { finished = { ...finished, status: 'failed', output: `${finished.output}\nCould not save full output: ${String(error)}` }; }
    worker.record = finished;
    if (owner !== this.generation) return;
    this.records.set(record.id, finished);
    this.pi.appendEntry(taskEntryType, finished);
    if (params.run_in_background !== false && !control.stopped()) {
      this.pi.sendMessage({ customType: 'pstack-task-completion', content: taskSummary(finished), display: true, details: finished }, { triggerTurn: true, deliverAs: 'followUp' });
    }
  }

  private result(record: TaskRecord) {
    const usage = this.claimUsage(record);
    const current = this.records.get(record.id) ?? record;
    return { content: [{ type: 'text' as const, text: taskSummary(current) }], details: current, usage };
  }

  async output(id: string, block: boolean | undefined, signal: AbortSignal | undefined) {
    const worker = this.workers.get(id);
    if (block && worker) {
      if (signal?.aborted) throw new Error('Wait cancelled.');
      await new Promise<void>((resolveWait, reject) => {
        const abort = () => reject(new Error('Wait cancelled.'));
        signal?.addEventListener('abort', abort, { once: true });
        worker.completion.then(resolveWait, reject).finally(() => signal?.removeEventListener('abort', abort));
      });
    }
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown task in this branch: ${id}`);
    return this.result(record);
  }

  async stop(id: string) {
    const worker = this.workers.get(id);
    if (!worker) throw new Error(`No live task: ${id}`);
    worker.stop(); await worker.completion; await this.close(worker.session);
    return this.result(worker.record);
  }

  async message(id: string, message: string, mode: 'steer' | 'followUp' | undefined) {
    const worker = this.workers.get(id);
    if (!worker || worker.record.status !== 'running') throw new Error('Task is not running. Use Task with resume.');
    if (mode === 'steer') await worker.session.steer(message);
    else await worker.session.followUp(message);
    return { content: [{ type: 'text' as const, text: `Message queued for ${id}` }], details: { task_id: id } };
  }
}
