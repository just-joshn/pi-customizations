import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import type { JsonValue, Usage } from '@earendil-works/pi-ai';
import { type AgentSession, type AgentSessionRuntime, type AgentToolResult, createEventBus, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readCloudOutcome } from './cloud-worker.ts';
import { DeferredWakes } from './deferred-wakes.ts';
import { asShellHandoff, shellHandoffEvent } from './shell-ownership.ts';
import { closeRuntime } from './subagents/close-session.ts';
import { CloudTasks, type CloudWorker } from './subagents/cloud-tasks.ts';
import { type StoppedBy, taskNotification } from './subagents/completion-notice.ts';
import { currentDepth, depthStore } from './subagents/context.ts';
import { finishedRecord } from './subagents/finished-record.ts';
import { validateId } from './subagents/identifiers.ts';
import { depthMessage } from './subagents/limiter.ts';
import { reconcileOrphans } from './subagents/orphan-recovery.ts';
import { AgentPreconditionError } from './subagents/precondition-error.ts';
import { groupSpawned, ProcessGroups, processGroupEvent } from './subagents/process-groups.ts';
import { RemoteTasks } from './subagents/remote-tasks.ts';
import { restoredContext } from './subagents/restored-context.ts';
import { ResumeError, resumeMessages } from './subagents/resume-errors.ts';
import { defaultMaxDepth } from './subagents/settings.ts';
import { SettingsStore } from './subagents/settings-store.ts';
import { registerStopControl } from './subagents/stop-control.ts';
import { settleWithin, stillStoppingMessage, stopPendingDetails } from './subagents/stop-deadline.ts';
import { stopPendingEvent } from './subagents/stop-pending.ts';
import { progressObserver, type TaskUpdate } from './subagents/task-progress.ts';
import { launchSignal, overdueAfterMs, waitFor, workerControl } from './worker-control.ts';
import { restoreTaskRecords, type TaskParameters, type TaskRecord, taskCleanupErrorType, taskCleanupUsageType, taskEntryType, taskOutputLimit, taskOwner, taskOwnerEntryType, taskSummary } from './worker-records.ts';
import { openWorkerSession, workerDirs } from './worker-support.ts';

export type { TaskProgressSnapshot, TaskToolDetails } from './subagents/task-progress.ts';

type OpenedWorker = Awaited<ReturnType<typeof openWorkerSession>>;
type ChildChannel = Readonly<{ events: ReturnType<typeof createEventBus>; groups: ProcessGroups }>;
type Worker = ChildChannel & {
  readonly id: string;
  readonly runtime: AgentSessionRuntime;
  readonly session: AgentSession;
  readonly completion: Promise<TaskRecord>;
  readonly stop: ReturnType<typeof workerControl>['stop'];
  readonly drain: () => Promise<string[]>;
};
type StartupOutcome = { error: unknown } | undefined;
type StartRequest = Readonly<{ callId: string; id: string; params: TaskParameters; prior: TaskRecord | undefined; signal: AbortSignal | undefined; ctx: ExtensionContext; owner: number }>;

class StartupCleanupError extends AggregateError {
  readonly cleanup: unknown;

  constructor(error: unknown, cleanup: unknown) {
    super([error, cleanup], `${String(error)}; Worker cleanup failed: ${String(cleanup)}`);
    this.cleanup = cleanup;
  }
}
type Lifecycle = { kind: 'active' } | { kind: 'stopped' } | { kind: 'stopping'; completion: Promise<void> };
export class WorkerRuntime {
  private readonly pi: ExtensionAPI;
  private records = new Map<string, TaskRecord>();
  private workers = new Map<string, Worker>();
  private starting = new Map<string, Promise<StartupOutcome>>();
  private generation = 0;
  private owned = false;
  private failedUsage = new Map<string, Usage>();
  private claimedUsage = new WeakSet<TaskRecord>();
  private stoppedNotifications = new WeakSet<Worker>();
  private lifecycle: Lifecycle = { kind: 'stopped' };
  private stopping: ReadonlySet<string> = new Set();
  private readonly completions: DeferredWakes;
  private readonly settings: SettingsStore;
  depth = currentDepth();
  agentId: string | undefined;
  readonly remote = new RemoteTasks({ commit: (record) => this.commitRemote(record), settle: (record, output, notify) => this.settleRemote(record, output, notify), current: (id) => this.records.get(id) });
  private readonly cloud = new CloudTasks({
    generation: () => this.generation,
    current: (id) => this.records.get(id),
    commit: (record) => this.commitRecord(record),
    pendingUsage: (owner, record) => this.pendingUsage(owner, record),
    notify: (record, parentIdle) => this.notifyCompletion(record, record.output, parentIdle),
  });

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
    this.completions = new DeferredWakes(pi);
    this.settings = new SettingsStore(() => pi.getSettings());
  }

  runningCount(): number {
    return [...this.records.values()].filter((record) => record.status === 'running').length;
  }

  find(reference: string): TaskRecord | undefined {
    const byId = this.records.get(reference);
    if (byId) return byId;
    const named = [...this.records.values()].filter((record) => record.agentName?.toLowerCase() === reference.toLowerCase());
    return named.findLast((record) => record.status === 'running') ?? named.at(-1);
  }

  list(): readonly TaskRecord[] {
    return [...this.records.values()];
  }

  liveMessages(id: string): AgentSession['messages'] | undefined {
    return this.workers.get(id)?.session.messages;
  }

  private commitRecord(record: TaskRecord): void {
    this.records.set(record.id, record);
    this.pi.appendEntry(taskEntryType, structuredClone(record));
  }

  private pendingUsage(owner: number, record: TaskRecord): Usage | undefined {
    return owner === this.generation ? this.records.get(record.id)?.usage : this.claimedUsage.has(record) ? undefined : record.usage;
  }

  private commitRemote(record: TaskRecord): void {
    this.commitRecord(record);
    this.pi.events.emit('pstack:subagent-started', { agentId: record.id, spawnDepth: record.depth, agent_depth: record.depth });
  }

  private settleRemote(record: TaskRecord, output: string, notify: { send: boolean; parentIdle: () => boolean }): void {
    if (this.lifecycle.kind !== 'active') return;
    this.records.set(record.id, record);
    this.persistFinished(record);
    this.pi.events.emit('pstack:subagent-settled', { agentId: record.id, status: record.status });
    if (notify.send) this.notifyCompletion(record, output, notify.parentIdle());
  }

  settleCompleted(id: string, output: string): void {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown task in this branch: ${id}`);
    const { abort: _abort, ...settled } = { ...record, status: 'settled' as const, output: output.slice(0, taskOutputLimit) };
    this.records.set(id, settled);
    this.pi.appendEntry(taskEntryType, structuredClone(settled));
  }

  registerLifecycle(): void {
    if (process.env['PI_PSTACK_WORKER_OWNER'])
      this.pi.registerCommand('pstack-worker-finalize', {
        handler: async () => {
          try {
            await this.stopAll();
          } catch (error) {
            this.pi.appendEntry(taskCleanupErrorType, { error: String(error) });
          }
        },
      });
    const detachControl = registerStopControl(this.pi, (reference) => this.stop(reference, 'user'));
    this.pi.on('tool_result', (event) => {
      if (event.toolName !== 'Task') return;
      const usage = this.failedUsage.get(event.toolCallId);
      if (!usage) return;
      this.failedUsage.delete(event.toolCallId);
      return { usage };
    });
    this.pi.on('session_start', async (_event, ctx) => this.restore(ctx, true));
    this.pi.on('session_tree', async (_event, ctx) => this.restore(ctx));
    this.pi.on('session_shutdown', async (_event, ctx) => {
      detachControl();
      try {
        await this.stopAll();
      } finally {
        await workerDirs.removeAll(ctx.sessionManager);
      }
    });
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
    const current = [...this.workers.values()];
    const starting = [...this.starting.values()];
    this.workers = new Map();
    const completion = Promise.resolve()
      .then(async () => {
        for (const worker of current) {
          worker.events.emit(stopPendingEvent, { agentId: worker.id });
          worker.stop('shutdown');
        }
        const outcomes = await Promise.allSettled([
          this.remote.shutdown(),
          ...this.cloud.shutdown(this.owned, (record) => this.claimCleanupUsage(record)),
          ...starting.map((operation) =>
            operation.then((outcome) => {
              if (outcome) throw outcome.error;
            }),
          ),
          ...current.map((worker) => this.shutdownWorker(worker)),
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

  private claimCleanupUsage(record: TaskRecord): void {
    if (!this.owned) return;
    const usage = this.claimUsage(record);
    if (usage) this.pi.appendEntry(taskCleanupUsageType, { taskId: record.id, usage });
  }

  private async shutdownWorker(worker: Worker): Promise<void> {
    const outcome = await settleWithin(worker.completion, overdueAfterMs);
    if (!outcome.settled) {
      worker.groups.killAll();
      throw new Error(stillStoppingMessage(worker.id));
    }
    this.claimCleanupUsage(outcome.value);
    const failures = await worker.drain();
    try {
      await closeRuntime(worker.runtime);
    } catch (error) {
      failures.push(String(error));
    }
    if (failures.length) throw new AggregateError(failures, failures.join('; '));
  }

  private async restore(ctx: ExtensionContext, reconcile = false): Promise<void> {
    const completion = this.stopAll();
    const owner = this.generation;
    try {
      await completion;
    } finally {
      if (owner === this.generation) {
        this.restoreOwnership(ctx);
        const branch = ctx.sessionManager.getBranch();
        const saved = restoredContext(branch);
        this.agentId = saved.agentId;
        this.depth = saved.depth;
        this.records = restoreTaskRecords(branch);
        this.failedUsage = new Map();
        this.completions.clear();
        this.lifecycle = { kind: 'active' };
        for (const record of this.records.values()) if (record.detached && record.status === 'running') this.cloud.attach(record, owner, () => ctx.isIdle());
        if (reconcile) this.recoverOrphans(ctx, branch);
      }
    }
  }

  private restoreOwnership(ctx: ExtensionContext): void {
    const marker = process.env['PI_PSTACK_WORKER_OWNER'];
    const recorded = taskOwner(ctx.sessionManager.getEntries());
    this.owned = Boolean(marker || recorded);
    if (marker && recorded !== marker) this.pi.appendEntry(taskOwnerEntryType, { id: marker });
  }

  async attach(record: TaskRecord, ctx: ExtensionContext) {
    if (this.lifecycle.kind !== 'active') throw new Error('Parent session is not active.');
    const existing = this.records.get(record.id);
    if (existing) return this.result(existing);
    if (!record.detached?.remote) throw new Error('Only a remote task can be attached from repository discovery.');
    const outcome = await readCloudOutcome(record);
    const attached: TaskRecord = outcome ? { ...record, ...outcome } : { ...record, status: 'running' };
    this.commitRecord(attached);
    if (!outcome) this.cloud.attach(attached, this.generation, () => ctx.isIdle());
    return this.result(attached);
  }

  private recoverOrphans(ctx: ExtensionContext, branch: ReturnType<ExtensionContext['sessionManager']['getBranch']>): void {
    const canRead = this.pi.getActiveTools().some((name) => ['read', 'bash'].includes(name.toLowerCase()));
    const { records } = reconcileOrphans({ pi: this.pi, ctx, branch, resume: undefined, canRead });
    this.records = new Map([...this.records, ...records]);
  }

  private priorTask(params: TaskParameters): TaskRecord | undefined {
    if (params.resume !== undefined) validateId(params.resume);
    if (this.lifecycle.kind !== 'active') throw new Error('Parent session is not active. Wait for session startup or tree restoration before starting a task.');
    const prior = params.resume ? this.records.get(params.resume) : undefined;
    if (params.resume && !prior) throw new Error(`Unknown task in this branch: ${params.resume}`);
    return prior;
  }

  private checkStartup(owner: number, signal: AbortSignal | undefined, background: boolean): AbortSignal | undefined {
    if (this.generation !== owner) throw new Error('Task startup was cancelled.');
    return launchSignal(signal, background);
  }

  async start(callId: string, params: TaskParameters, signal: AbortSignal | undefined, ctx: ExtensionContext, onUpdate: TaskUpdate | undefined): Promise<AgentToolResult<TaskRecord>> {
    signal = launchSignal(signal, params.run_in_background !== false);
    const prior = this.priorTask(params);
    this.checkDepth(prior);
    const id = prior?.id ?? randomUUID();
    if (this.starting.has(id) || (this.workers.has(id) && this.records.get(id)?.status === 'running') || (this.cloud.has(id) && this.records.get(id)?.status === 'running'))
      throw new Error(`Task ${id} is running. Use TaskMessage to queue input.`);
    let finishStarting = (_outcome: StartupOutcome) => {};
    let startupOutcome: StartupOutcome;
    this.starting.set(
      id,
      new Promise<StartupOutcome>((resolveStart) => {
        finishStarting = resolveStart;
      }),
    );
    const request = { callId, id, params, prior, signal, ctx, owner: this.generation };
    try {
      if (params.environment === 'cloud' || prior?.detached) return await this.startCloud(request);
      return await this.startLocal(request, onUpdate);
    } catch (error) {
      if (error instanceof StartupCleanupError) startupOutcome = { error: error.cleanup };
      throw error;
    } finally {
      this.starting.delete(id);
      finishStarting(startupOutcome);
    }
  }

  private async startCloud({ callId, id, params, prior, signal, ctx, owner }: StartRequest): Promise<AgentToolResult<TaskRecord>> {
    const background = params.run_in_background !== false;
    const worker = await this.cloud.launch(
      {
        id,
        params,
        prior,
        ctx,
        owner,
        checkStartup: () => {
          signal = this.checkStartup(owner, signal, background);
        },
      },
      () => ctx.isIdle(),
    );
    const record = background ? this.records.get(id) : await this.foreground(callId, worker, signal);
    if (!record) throw new Error(`Failed to create task record for ${id}`);
    return this.result(record, owner);
  }

  private async startLocal({ callId, id, params, prior, signal, ctx, owner }: StartRequest, onUpdate: TaskUpdate | undefined): Promise<AgentToolResult<TaskRecord>> {
    const background = params.run_in_background !== false;
    let runtime: AgentSessionRuntime | undefined;
    try {
      const opened = await this.openChild({ id, params, prior, ctx, toolUseId: callId });
      const { session } = opened;
      runtime = opened.runtime;
      signal = this.checkStartup(owner, signal, background);
      await session.bindExtensions({ mode: 'print' });
      signal = this.checkStartup(owner, signal, background);
      const previous = this.workers.get(id);
      if (previous) await closeRuntime(previous.runtime);
      signal = this.checkStartup(owner, signal, background);
      const worker = this.launch(opened, params, signal, owner, () => ctx.isIdle(), onUpdate);
      this.publishStart(opened.record, prior);
      const record = background ? this.records.get(id) : await this.foreground(callId, worker);
      if (!record) throw new Error(`Failed to create task record for ${id}`);
      return this.result(record, owner);
    } catch (error) {
      const opened = runtime;
      if (opened) await this.abandon(error, () => closeRuntime(opened));
      throw error;
    }
  }

  private async abandon(error: unknown, cleanup: () => Promise<void>): Promise<never> {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new StartupCleanupError(error, cleanupError);
    }
    throw error;
  }

  private publishStart(record: TaskRecord, prior: TaskRecord | undefined): void {
    if (prior) return;
    this.pi.events.emit('pstack:subagent-started', { agentId: record.id, spawnDepth: record.depth, agent_depth: record.depth });
  }

  private checkDepth(prior: TaskRecord | undefined): void {
    if (prior) return;
    const cap = this.settings.read().settings.subagents.maxDepth ?? defaultMaxDepth;
    if (this.depth < cap) return;
    this.pi.events.emit('pstack:subagent-refused', { code: 'subagent_depth_cap', reason: 'depth_limit' });
    throw new AgentPreconditionError({ code: 'subagent_depth_cap', message: depthMessage(cap) });
  }

  private async openChild(input: Omit<Parameters<typeof openWorkerSession>[0], 'exec'>): Promise<Awaited<ReturnType<typeof openWorkerSession>> & ChildChannel> {
    const depth = input.prior?.depth ?? this.depth + 1;
    const channel = this.childChannel(input.id);
    const opened = await depthStore.run(depth, () =>
      openWorkerSession({
        ...input,
        depth,
        events: channel.events,
        onProcessGroup: (pid) => channel.groups.add({ pid }),
        exec: (command, args, options) => this.pi.exec(command, args, options),
        log: (message) => this.pi.events.emit('pstack:subagent-log', message),
      }),
    );
    return { ...opened, ...channel };
  }

  private childChannel(id: string): ChildChannel {
    const events = createEventBus();
    const groups = new ProcessGroups(id, (spawned) => this.pi.events.emit(processGroupEvent, spawned));
    events.on(processGroupEvent, (payload) => {
      const spawned = groupSpawned(payload);
      if (spawned) groups.add(spawned);
    });
    events.on(shellHandoffEvent, (payload) => {
      const handoff = asShellHandoff(payload);
      if (handoff) this.pi.events.emit(shellHandoffEvent, handoff);
    });
    return { events, groups };
  }

  private async foreground(callId: string, worker: { readonly completion: Promise<TaskRecord> }, signal?: AbortSignal): Promise<TaskRecord> {
    const record = await waitFor(worker.completion, signal, 'Wait cancelled. Cloud task continues.');
    if (record.status === 'settled') return record;
    const usage = this.claimUsage(record);
    if (usage) this.failedUsage.set(callId, usage);
    throw new Error(taskSummary(record));
  }

  private launch(opened: OpenedWorker & ChildChannel, params: TaskParameters, signal: AbortSignal | undefined, owner: number, parentIdle: () => boolean, onUpdate: TaskUpdate | undefined): Worker {
    const { session, runtime } = opened;
    const usage = this.records.get(opened.record.id)?.usage;
    const record: TaskRecord = { ...opened.record, ...(usage ? { usage } : {}) };
    this.records.set(record.id, record);
    this.pi.appendEntry(taskEntryType, structuredClone(record));
    const progress = params.run_in_background === false && onUpdate ? progressObserver(record.id, () => owner === this.generation, onUpdate) : undefined;
    const control = workerControl(session, signal, (event) => progress?.(event), {
      foreground: params.run_in_background === false,
      onAbort: (info) => this.pi.events.emit('pstack:subagent-abort', { agent_id: record.id, ...info }),
      taskId: record.id,
      log: (message) => this.pi.events.emit('pstack:subagent-log', message),
      killGroups: () => opened.groups.killAll(),
    });
    const completion = this.complete({ ...opened, record }, params, owner, control, parentIdle);
    const worker: Worker = { id: record.id, runtime, session, completion, stop: control.stop, drain: control.drain, events: opened.events, groups: opened.groups };
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

  private async complete(worker: OpenedWorker, params: TaskParameters, owner: number, control: ReturnType<typeof workerControl>, parentIdle: () => boolean): Promise<TaskRecord> {
    const { session, runtime, record } = worker;
    const initialCount = session.messages.length;
    const startedAt = Date.now();
    let outcome = await this.run(session, params.prompt);
    try {
      await closeRuntime(runtime);
    } catch (error) {
      outcome = { status: 'failed' as const, output: `${outcome.output}\nWorker shutdown failed: ${String(error)}` };
    } finally {
      control.unsubscribe();
    }
    const abortFailures = await control.drain();
    if (abortFailures.length) outcome = { status: 'failed', output: `${outcome.output}\n${abortFailures.join('\n')}` };
    const { output } = outcome;
    const status = control.stopped() ? 'interrupted' : outcome.status;
    let finished = finishedRecord(worker, this.pendingUsage(owner, record), control.abortInfo(), { status, output, messages: session.messages.slice(initialCount), startedAt });
    try {
      await writeFile(finished.outputFile, output);
    } catch (error) {
      finished = { ...finished, status: 'failed', output: `${finished.output}\nCould not save full output: ${String(error)}` };
    }
    if (owner !== this.generation) return finished;
    this.records.set(record.id, finished);
    this.persistFinished(finished);
    this.pi.events.emit('pstack:subagent-settled', { agentId: record.id, status: finished.status });
    if (params.run_in_background !== false && !control.stopped()) this.notifyCompletion(finished, output, parentIdle());
    return finished;
  }

  private notifyCompletion(record: TaskRecord, output: string, parentIdle: boolean): void {
    const { message } = taskNotification(record, output);
    this.completions.send(record.id, parentIdle, message);
  }

  private result(record: TaskRecord, owner = this.generation): AgentToolResult<TaskRecord> {
    const active = owner === this.generation;
    if (active) this.completions.drop(record.id);
    const usage = active ? this.claimUsage(record) : undefined;
    const current = active ? (this.records.get(record.id) ?? record) : record;
    return {
      content: [{ type: 'text' as const, text: taskSummary(current) }],
      details: structuredClone(current),
      structuredContent: structuredClone(current) as unknown as JsonValue,
      isError: current.status === 'failed',
      ...(usage ? { usage: structuredClone(usage) } : {}),
    };
  }

  async output(id: string, block: boolean | undefined, signal: AbortSignal | undefined) {
    const worker = this.workers.get(id) ?? this.cloud.get(id) ?? (this.remote.has(id) ? { completion: this.remote.completion(id) as Promise<TaskRecord> } : undefined);
    if (block && worker) await waitFor(worker.completion, signal, 'Wait cancelled.');
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown task in this branch: ${id}`);
    return this.result(record);
  }

  private persistFinished(record: TaskRecord): void {
    this.pi.appendEntry(taskEntryType, structuredClone(record));
  }

  async stop(reference: string, stoppedBy: StoppedBy = 'parent') {
    const target = this.find(reference);
    const worker = target && this.workers.get(target.id);
    const detached = target && reference !== this.agentId ? this.cloud.get(target.id) : undefined;
    if (target && reference !== this.agentId && this.remote.has(target.id)) return this.stopRemote(target, stoppedBy);
    if (target && detached) return this.stopCloud(target, detached, stoppedBy);
    if (reference === this.agentId || !worker) {
      const message = reference === this.agentId ? `Agent ${reference} cannot stop itself; use the task UI or a main-session TaskStop.` : `No live task: ${reference}`;
      const details = { status: 'failed' as const, task_id: reference, message };
      return { content: [{ type: 'text' as const, text: details.message }], details, structuredContent: details, isError: true };
    }
    const owner = this.generation;
    const wasRunning = target?.status === 'running';
    if (wasRunning) this.markStopping(target.id, worker);
    worker.stop();
    const outcome = await settleWithin(worker.completion, overdueAfterMs);
    if (!outcome.settled) return this.stopOverdue(target);
    const record = outcome.value;
    if (wasRunning && owner === this.generation) this.notifyStopped(worker, record, stoppedBy);
    return this.stopped(record, wasRunning, owner);
  }

  private stopOverdue(target: TaskRecord) {
    const details = stopPendingDetails(target);
    return { content: [{ type: 'text' as const, text: details.message }], details, structuredContent: details, isError: false };
  }

  private stopped(record: TaskRecord, wasRunning: boolean, owner = this.generation) {
    const result = this.result(record, owner);
    const details = {
      ...result.details,
      message: wasRunning ? `Stopped task ${record.id}` : `Task ${record.id} already finished with status ${record.status}`,
      task_id: record.id,
      task_type: 'local_agent' as const,
      command: record.description ?? record.persona,
    };
    return { ...result, details, structuredContent: details as unknown as JsonValue };
  }

  private async stopRemote(target: TaskRecord, stoppedBy: StoppedBy) {
    const wasRunning = target.status === 'running';
    const record = await this.remote.stop(target.id);
    if (wasRunning) this.pi.sendMessage(taskNotification(record, '', stoppedBy).message, { triggerTurn: false });
    return this.stopped(record, wasRunning);
  }

  private async stopCloud(target: TaskRecord, worker: CloudWorker, stoppedBy: StoppedBy) {
    const owner = this.generation;
    const wasRunning = target.status === 'running';
    worker.stop();
    const outcome = await settleWithin(worker.completion, overdueAfterMs);
    if (!outcome.settled) return this.stopOverdue(target);
    if (wasRunning && owner === this.generation) this.pi.sendMessage(taskNotification(outcome.value, '', stoppedBy).message, { triggerTurn: false });
    return this.stopped(outcome.value, wasRunning, owner);
  }

  private markStopping(id: string, worker: Worker): void {
    if (this.stopping.has(id)) return;
    this.stopping = new Set([...this.stopping, id]);
    worker.events.emit(stopPendingEvent, { agentId: id });
    const clear = () => {
      this.stopping = new Set([...this.stopping].filter((stopping) => stopping !== id));
    };
    void worker.completion.then(clear, clear);
  }

  private notifyStopped(worker: Worker, record: TaskRecord, stoppedBy: StoppedBy): void {
    if (this.stoppedNotifications.has(worker)) return;
    this.stoppedNotifications.add(worker);
    const { message } = taskNotification(record, '', stoppedBy);
    this.pi.sendMessage(message, { triggerTurn: false });
  }

  async message(id: string, message: string, mode: 'steer' | 'followUp' | undefined) {
    const worker = this.workers.get(id);
    const cloud = this.cloud.get(id);
    const running = this.records.get(id)?.status === 'running';
    if (this.remote.has(id) && running) await this.remote.message(id, message, mode === 'steer' ? 'steer' : 'followUp');
    else if (cloud && running) await this.messageCloud(cloud, message, mode);
    else {
      if (this.stopping.has(id)) throw new ResumeError('still_stopping', resumeMessages.targetStopping(id));
      if (!worker || !running) throw new Error('Task is not running. Use Task with resume.');
      if (mode === 'steer') await worker.session.steer(message);
      else await worker.session.followUp(message);
    }
    const details = { task_id: id };
    return { content: [{ type: 'text' as const, text: `Message queued for ${id}` }], details, structuredContent: details as unknown as JsonValue };
  }

  private async messageCloud(worker: CloudWorker, message: string, mode: 'steer' | 'followUp' | undefined): Promise<void> {
    const response = await worker.handle.send({ type: mode === 'steer' ? 'steer' : 'follow_up', message });
    if (!response.success) throw new Error(response.error);
  }
}
