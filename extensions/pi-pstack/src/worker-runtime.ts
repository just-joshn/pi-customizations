import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Usage } from '@earendil-works/pi-ai';
import type { AgentSession, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { restoreTaskRecords, taskEntryType, taskOutputLimit, taskSummary, type TaskRecord, type TaskParameters } from './worker-records.ts';
import { openWorkerSession, sumUsage } from './worker-support.ts';
import { workerControl } from './worker-control.ts';

type Worker = { readonly session: AgentSession; readonly completion: Promise<TaskRecord>; readonly stop: () => void; readonly drain: () => Promise<string[]> };
type StartupOutcome = { error: unknown } | undefined;
type Lifecycle = { kind: 'active' } | { kind: 'stopped' } | { kind: 'stopping'; completion: Promise<void> };

export class WorkerRuntime {
  private records = new Map<string, TaskRecord>();
  private workers = new Map<string, Worker>();
  private starting = new Map<string, Promise<StartupOutcome>>();
  private generation = 0;
  private failedUsage = new Map<string, Usage>();
  private claimedUsage = new WeakSet<TaskRecord>();
  private unreadCompletions = new Map<string, TaskRecord>();
  private parentEndedCleanly = false;
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
    this.pi.on('agent_end', event => {
      const last = event.messages.findLast(message => message.role === 'assistant');
      this.parentEndedCleanly = !(last?.role === 'assistant' && last.stopReason === 'aborted');
      if (this.parentEndedCleanly) this.deliverUnread();
    });
    this.pi.on('agent_settled', () => { if (this.parentEndedCleanly) this.deliverUnread(); });
    this.pi.on('session_start', async (_event, ctx) => this.restore(ctx));
    this.pi.on('session_tree', async (_event, ctx) => this.restore(ctx));
    this.pi.on('session_shutdown', () => this.stopAll());
  }

  private close(session: AgentSession): Promise<void> {
    const pending = this.closing.get(session);
    if (pending) return pending;
    const operation = (async () => {
      const failures: unknown[] = [];
      const unsubscribe = session.extensionRunner.onError(error => failures.push(error.error));
      try { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); }
      catch (error) { failures.push(error); }
      finally {
        unsubscribe();
        try { session.dispose(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, failures.map(String).join('; '));
    })();
    this.closing.set(session, operation);
    return operation;
  }

  private deliverUnread(): void {
    const unread = [...this.unreadCompletions.values()];
    this.unreadCompletions = new Map();
    for (const record of unread) this.deliverCompletion(record);
  }

  private deliverCompletion(record: TaskRecord): void {
    this.pi.sendMessage({ customType: 'pstack-task-completion', content: taskSummary(record), display: true, details: structuredClone(record) }, { triggerTurn: true, deliverAs: 'followUp' });
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
    if (this.lifecycle.kind === 'stopping') return this.lifecycle.completion;
    if (this.lifecycle.kind === 'stopped') return Promise.resolve();
    const current = [...this.workers.values()];
    const starting = [...this.starting.values()];
    this.workers = new Map();
    const completion = Promise.resolve().then(async () => {
      for (const worker of current) worker.stop();
      const outcomes = await Promise.allSettled([
        ...starting.map(operation => operation.then(outcome => { if (outcome) throw outcome.error; })),
        ...current.map(async worker => {
          await worker.completion;
          const failures = await worker.drain();
          try { await this.close(worker.session); } catch (error) { failures.push(String(error)); }
          if (failures.length) throw new AggregateError(failures, failures.join('; '));
        }),
      ]);
      const failures = outcomes.filter(outcome => outcome.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map(outcome => outcome.reason), `Worker cleanup failed: ${failures.map(outcome => String(outcome.reason)).join('; ')}`);
    }).finally(() => { this.lifecycle = { kind: 'stopped' }; });
    this.lifecycle = { kind: 'stopping', completion };
    return completion;
  }

  private async restore(ctx: ExtensionContext): Promise<void> {
    const completion = this.stopAll();
    const owner = this.generation;
    try { await completion; }
    finally {
      if (owner === this.generation) {
        this.records = restoreTaskRecords(ctx.sessionManager.getBranch());
        this.failedUsage = new Map();
        this.unreadCompletions = new Map();
        this.lifecycle = { kind: 'active' };
      }
    }
  }

  private priorTask(params: TaskParameters): TaskRecord | undefined {
    if (this.lifecycle.kind !== 'active') throw new Error('Parent session is not active. Wait for session startup or tree restoration before starting a task.');
    if (params.environment === 'cloud') throw new Error('Cursor cloud execution is unavailable in Pi. Explicitly choose environment local only when local execution satisfies the task.');
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
    if (this.starting.has(id) || this.workers.has(id) && this.records.get(id)?.status === 'running') throw new Error(`Task ${id} is running. Use TaskMessage to queue input.`);
    let finishStarting = (_outcome: StartupOutcome) => {};
    let startupOutcome: StartupOutcome;
    this.starting.set(id, new Promise<StartupOutcome>(resolveStart => { finishStarting = resolveStart; }));
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
      const worker = this.launch(opened, params, signal, owner, () => ctx.isIdle());
      const record = params.run_in_background === false ? await this.foreground(callId, worker) : this.records.get(id)!;
      return this.result(record);
    } catch (error) {
      try { if (session) await this.close(session); }
      catch (cleanup) {
        startupOutcome = { error: cleanup };
        throw new AggregateError([error, cleanup], `${String(error)}; Worker cleanup failed: ${String(cleanup)}`);
      }
      throw error;
    }
    finally { this.starting.delete(id); finishStarting(startupOutcome); }
  }

  private async foreground(callId: string, worker: Worker): Promise<TaskRecord> {
    const record = await worker.completion;
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
    const worker: Worker = { session, completion, stop: control.stop, drain: control.drain };
    this.workers.set(record.id, worker);
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

  private async complete(worker: Awaited<ReturnType<typeof openWorkerSession>>, params: TaskParameters, owner: number, control: ReturnType<typeof workerControl>, parentIdle: () => boolean): Promise<TaskRecord> {
    const { session, record } = worker;
    const initialCount = session.messages.length;
    let outcome: Awaited<ReturnType<WorkerRuntime['run']>>;
    try { outcome = await this.run(session, params.prompt); }
    finally { control.unsubscribe(); }
    try { await this.close(session); }
    catch (error) { outcome = { status: 'failed' as const, output: `${outcome.output}\nWorker shutdown failed: ${String(error)}` }; }
    const abortFailures = await control.drain();
    if (abortFailures.length) outcome = { status: 'failed', output: `${outcome.output}\n${abortFailures.join('\n')}` };
    const status = control.stopped() ? 'interrupted' : outcome.status;
    const pendingUsage = owner === this.generation ? this.records.get(record.id)?.usage : this.claimedUsage.has(record) ? undefined : record.usage;
    const usage = sumUsage(session.messages.slice(initialCount), pendingUsage);
    let finished: TaskRecord = { ...record, status, output: outcome.output.slice(0, taskOutputLimit), usage };
    try { await writeFile(finished.outputFile, outcome.output); }
    catch (error) { finished = { ...finished, status: 'failed', output: `${finished.output}\nCould not save full output: ${String(error)}` }; }
    if (owner !== this.generation) return finished;
    this.records.set(record.id, finished);
    this.pi.appendEntry(taskEntryType, structuredClone(finished));
    if (params.run_in_background !== false && !control.stopped()) {
      if (parentIdle()) this.deliverCompletion(finished);
      else this.unreadCompletions = new Map([...this.unreadCompletions, [record.id, finished]]);
    }
    return finished;
  }

  private result(record: TaskRecord) {
    this.unreadCompletions = new Map([...this.unreadCompletions].filter(([id]) => id !== record.id));
    const usage = this.claimUsage(record);
    const current = this.records.get(record.id) ?? record;
    return { content: [{ type: 'text' as const, text: taskSummary(current) }], details: structuredClone(current), usage: usage ? structuredClone(usage) : undefined };
  }

  async output(id: string, block: boolean | undefined, signal: AbortSignal | undefined) {
    const worker = this.workers.get(id);
    if (block && worker) {
      if (signal?.aborted) throw new Error('Wait cancelled.');
      await new Promise<void>((resolveWait, reject) => {
        const abort = () => reject(new Error('Wait cancelled.'));
        signal?.addEventListener('abort', abort, { once: true });
        void worker.completion.then(() => { signal?.removeEventListener('abort', abort); resolveWait(); }, error => { signal?.removeEventListener('abort', abort); reject(error); });
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
    if (mode === 'steer') await worker.session.steer(message);
    else await worker.session.followUp(message);
    return { content: [{ type: 'text' as const, text: `Message queued for ${id}` }], details: { task_id: id } };
  }
}
