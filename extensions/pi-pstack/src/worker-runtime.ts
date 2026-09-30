import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import type { JsonValue, Usage } from '@earendil-works/pi-ai';
import type { AgentSession, AgentSessionEvent, AgentSessionEventListener, AgentToolResult, AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { DeferredWakes } from './deferred-wakes.ts';
import { currentDepth, depthStore } from './subagents/context.ts';
import { workerControl } from './worker-control.ts';
import { restoreTaskRecords, type TaskParameters, type TaskRecord, taskEntryType, taskOutputLimit, taskSummary } from './worker-records.ts';
import { type AgentLaunch, openWorkerSession, sumUsage } from './worker-support.ts';

type Worker = { readonly session: AgentSession; readonly completion: Promise<TaskRecord>; readonly stop: () => void; readonly drain: () => Promise<string[]> };
type StartupOutcome = { error: unknown } | undefined;
type Lifecycle = { kind: 'active' } | { kind: 'stopped' } | { kind: 'stopping'; completion: Promise<void> };
type SafeToolName = string & { readonly __brand: 'SafeToolName' };
type TaskActivity =
  | Readonly<{ kind: 'tool-started'; tool: SafeToolName }>
  | Readonly<{ kind: 'tool-finished'; tool: SafeToolName; failed: boolean }>
  | Readonly<{ kind: 'retry-started'; attempt: number; maxAttempts: number }>
  | Readonly<{ kind: 'retry-finished'; attempt: number; recovered: boolean }>;
export type TaskProgressSnapshot = Readonly<{
  kind: 'progress';
  task_id: TaskRecord['id'];
  status: 'running';
  active_tools: readonly SafeToolName[];
  latest: TaskActivity;
}>;
export type TaskToolDetails = TaskRecord | TaskProgressSnapshot;
type TaskUpdate = AgentToolUpdateCallback<TaskToolDetails>;
type ProgressTransition = Readonly<{ activeCalls: ReadonlyMap<string, SafeToolName>; latest: TaskActivity }>;
const toolNamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/;

function safeToolName(name: string): SafeToolName {
  return (toolNamePattern.test(name) ? name : 'extension tool') as SafeToolName;
}

function projectProgressEvent(activeCalls: ReadonlyMap<string, SafeToolName>, event: AgentSessionEvent): ProgressTransition | undefined {
  if ((event.type === 'tool_execution_start' || event.type === 'tool_execution_end') && event.parentToolCallId !== undefined) return undefined;
  switch (event.type) {
    case 'tool_execution_start': {
      const tool = safeToolName(event.toolName);
      const next = new Map(activeCalls);
      next.set(event.toolCallId, tool);
      return { activeCalls: next, latest: Object.freeze({ kind: 'tool-started', tool }) };
    }
    case 'tool_execution_end': {
      const tool = activeCalls.get(event.toolCallId) ?? safeToolName(event.toolName);
      const next = new Map(activeCalls);
      next.delete(event.toolCallId);
      return { activeCalls: next, latest: Object.freeze({ kind: 'tool-finished', tool, failed: event.isError }) };
    }
    case 'auto_retry_start':
      return { activeCalls, latest: Object.freeze({ kind: 'retry-started', attempt: event.attempt, maxAttempts: event.maxAttempts }) };
    case 'auto_retry_end':
      return { activeCalls, latest: Object.freeze({ kind: 'retry-finished', attempt: event.attempt, recovered: event.success }) };
    default:
      return undefined;
  }
}

function progressText(snapshot: TaskProgressSnapshot): string {
  const active = snapshot.active_tools.length ? snapshot.active_tools.join(', ') : 'none';
  const latest = snapshot.latest;
  const description =
    latest.kind === 'tool-started'
      ? `${latest.tool} started`
      : latest.kind === 'tool-finished'
        ? `${latest.tool} ${latest.failed ? 'failed' : 'finished'}`
        : latest.kind === 'retry-started'
          ? `retry ${latest.attempt}/${latest.maxAttempts} started`
          : `retry ${latest.attempt} ${latest.recovered ? 'recovered' : 'failed'}`;
  return `Task ${snapshot.task_id} running. Active tools: ${active}. Latest: ${description}.`;
}

export class WorkerRuntime {
  private records = new Map<string, TaskRecord>();
  private workers = new Map<string, Worker>();
  private starting = new Map<string, Promise<StartupOutcome>>();
  private generation = 0;
  private failedUsage = new Map<string, Usage>();
  private settledHooks = new Map<string, (record: TaskRecord) => Promise<void>>();
  private claimedUsage = new WeakSet<TaskRecord>();
  private lifecycle: Lifecycle = { kind: 'stopped' };
  private closing = new WeakMap<AgentSession, Promise<void>>();
  private readonly completions: DeferredWakes;
  readonly depth = currentDepth();
  constructor(private readonly pi: ExtensionAPI) {
    this.completions = new DeferredWakes(pi);
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

  registerLifecycle(): void {
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
    const current = [...this.workers.values()];
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
            await worker.completion;
            const failures = await worker.drain();
            try {
              await this.close(worker.session);
            } catch (error) {
              failures.push(String(error));
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
        this.records = restoreTaskRecords(ctx.sessionManager.getBranch());
        this.failedUsage = new Map();
        this.completions.clear();
        this.lifecycle = { kind: 'active' };
      }
    }
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

  async start(callId: string, params: TaskParameters, signal: AbortSignal | undefined, ctx: ExtensionContext, onUpdate: TaskUpdate | undefined, launch?: AgentLaunch): Promise<AgentToolResult<TaskRecord>> {
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
    try {
      if (launch?.onSettled) this.settledHooks.set(id, launch.onSettled);
      const opened = await depthStore.run(this.depth + 1, () => openWorkerSession({ id, params, prior, ctx, ...(launch ? { launch } : {}) }));
      session = opened.session;
      this.checkStartup(owner, signal);
      await session.bindExtensions({ mode: 'print' });
      this.checkStartup(owner, signal);
      const previous = this.workers.get(id);
      if (previous) await this.close(previous.session);
      this.checkStartup(owner, signal);
      const worker = this.launch(opened, params, signal, owner, () => ctx.isIdle(), onUpdate);
      const record = params.run_in_background === false ? await this.foreground(callId, worker) : this.records.get(id);
      if (!record) throw new Error(`Failed to create task record for ${id}`);
      return this.result(record);
    } catch (error) {
      try {
        if (session) await this.close(session);
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

  private async foreground(callId: string, worker: Worker): Promise<TaskRecord> {
    const record = await worker.completion;
    if (record.status === 'settled') return record;
    const usage = this.claimUsage(record);
    if (usage) this.failedUsage.set(callId, usage);
    throw new Error(taskSummary(record));
  }

  private launch(opened: Awaited<ReturnType<typeof openWorkerSession>>, params: TaskParameters, signal: AbortSignal | undefined, owner: number, parentIdle: () => boolean, onUpdate: TaskUpdate | undefined): Worker {
    const { session } = opened;
    const usage = this.records.get(opened.record.id)?.usage;
    const record: TaskRecord = { ...opened.record, ...(usage ? { usage } : {}) };
    this.records.set(record.id, record);
    this.pi.appendEntry(taskEntryType, structuredClone(record));
    const observe = params.run_in_background === false && onUpdate ? this.progressObserver(record.id, owner, onUpdate) : undefined;
    const control = workerControl(session, signal, observe, { taskId: record.id, log: (message) => this.pi.events.emit('pstack:subagent-log', message) });
    const completion = this.complete({ session, record }, params, owner, control, parentIdle);
    const worker: Worker = { session, completion, stop: control.stop, drain: control.drain };
    this.workers.set(record.id, worker);
    return worker;
  }

  private progressObserver(taskId: TaskRecord['id'], owner: number, onUpdate: TaskUpdate): AgentSessionEventListener {
    let activeCalls: ReadonlyMap<string, SafeToolName> = new Map();
    return (event) => {
      if (owner !== this.generation) return;
      const transition = projectProgressEvent(activeCalls, event);
      if (!transition) return;
      activeCalls = transition.activeCalls;
      const snapshot: TaskProgressSnapshot = Object.freeze({
        kind: 'progress',
        task_id: taskId,
        status: 'running',
        active_tools: Object.freeze([...activeCalls.values()]),
        latest: transition.latest,
      });
      onUpdate({ content: [{ type: 'text', text: progressText(snapshot) }], details: snapshot });
    };
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
    const startedAt = Date.now();
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
    const toolUseCount = session.messages.slice(initialCount).reduce((count, message) => count + (message.role === 'assistant' ? message.content.filter((block) => block.type === 'toolCall').length : 0), 0);
    let finished: TaskRecord = { ...record, status, output: outcome.output.slice(0, taskOutputLimit), usage, toolUseCount, durationMs: Date.now() - startedAt };
    try {
      await writeFile(finished.outputFile, outcome.output);
    } catch (error) {
      finished = { ...finished, status: 'failed', output: `${finished.output}\nCould not save full output: ${String(error)}` };
    }
    const settledHook = this.settledHooks.get(record.id);
    this.settledHooks.delete(record.id);
    await settledHook?.(finished).catch((error) => {
      finished = { ...finished, output: `${finished.output}\nWorktree cleanup failed: ${String(error)}` };
    });
    if (owner !== this.generation) return finished;
    this.records.set(record.id, finished);
    this.pi.appendEntry(taskEntryType, structuredClone(finished));
    if (params.run_in_background !== false && !control.stopped()) {
      this.completions.send(record.id, parentIdle(), { customType: 'pstack-task-completion', content: taskSummary(finished), display: true, details: structuredClone(finished) });
    }
    return finished;
  }

  private result(record: TaskRecord): AgentToolResult<TaskRecord> {
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
    if (mode === 'steer') await worker.session.steer(message);
    else await worker.session.followUp(message);
    const details = { task_id: id };
    return { content: [{ type: 'text' as const, text: `Message queued for ${id}` }], details, structuredContent: details as unknown as JsonValue };
  }
}
