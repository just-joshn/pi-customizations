import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import type { JsonValue, Usage } from '@earendil-works/pi-ai';
import type { AgentSession, AgentSessionEvent, AgentSessionEventListener, AgentToolResult, AgentToolUpdateCallback, createEventBus, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { DeferredWakes } from './deferred-wakes.ts';
import { depthMessage } from './subagents/admission.ts';
import { currentDepth, depthStore } from './subagents/context.ts';
import { SessionDepthPolicy } from './subagents/depth-policy.ts';
import { validateId } from './subagents/identifiers.ts';
import { AgentInvocations } from './subagents/invocations.ts';
import { memoryEnabled } from './subagents/memory.ts';
import { childStatsEvents } from './subagents/nested-depth.ts';
import { asShellHandoff, shellHandoffEvent } from './shell-ownership.ts';
import { groupSpawned, ProcessGroups, processGroupEvent } from './subagents/process-groups.ts';
import { AgentPreconditionError } from './subagents/precondition-error.ts';
import type { ContinuationState } from './subagents/continuation.ts';
import { ResumeError, resumeMessages } from './subagents/resume-errors.ts';
import { SubagentStats, type SubagentStatsDelta } from './subagents/stats.ts';
import { settleWithin, stillStoppingMessage, stopPendingDetails } from './subagents/stop-deadline.ts';
import { registerStopControl } from './subagents/stop-control.ts';
import { stopPendingEvent, stopPendingFor } from './subagents/stop-pending.ts';
import { applyToolPolicy } from './subagents/tool-pool.ts';
import { countToolStats } from './subagents/tool-stats.ts';
import { turnLimit } from './subagents/turn-limit.ts';
import { launchSignal, overdueAfterMs, workerControl } from './worker-control.ts';
import { restoreTaskRecords, type TaskParameters, type TaskRecord, taskEntryType, taskOutputLimit, taskSummary } from './worker-records.ts';
import { type AgentLaunch, openWorkerSession, sumUsage } from './worker-support.ts';

type ChildChannel = Readonly<{ events: ReturnType<typeof createEventBus>; groups: ProcessGroups }>;
type Worker = ChildChannel & { readonly id: string; readonly session: AgentSession; readonly completion: Promise<TaskRecord>; readonly stop: ReturnType<typeof workerControl>['stop']; readonly drain: () => Promise<string[]> };
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
  private settledHooks = new Map<string, (record: TaskRecord) => Promise<Partial<TaskRecord>>>();
  private claimedUsage = new WeakSet<TaskRecord>();
  private stoppedNotifications = new WeakSet<Worker>();
  private lifecycle: Lifecycle = { kind: 'stopped' };
  private stopping: ReadonlySet<string> = new Set();
  private keepalive: ReadonlySet<string> = new Set();
  private selfStopPending = false;
  private closing = new WeakMap<AgentSession, Promise<void>>();
  private readonly completions: DeferredWakes;
  depth = currentDepth();
  private agentId: string | undefined;
  private ownWorktree: string | undefined;
  allowedAgentTypes: readonly string[] | undefined;
  private readonly invocations = new AgentInvocations();
  private appendedPrompt: string | undefined;
  private inheritedDefinitions: string | undefined;
  private readonly depthPolicy = new SessionDepthPolicy();
  readonly stats = new SubagentStats();
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

  /** Whether this agent handed surviving background shells to an ancestor, so its workspace must stay. */
  keepsAlive(id: string): boolean {
    return this.keepalive.has(id);
  }

  stopPending(): boolean {
    return this.selfStopPending;
  }

  continuationState(id: string): ContinuationState {
    return { inFlight: this.starting.has(id), stopping: this.stopping.has(id), resumerStopping: this.selfStopPending };
  }

  settleCompleted(id: string, output: string): void {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown task in this branch: ${id}`);
    const { abort: _abort, ...settled } = { ...record, status: 'settled' as const, output: output.slice(0, taskOutputLimit) };
    this.records.set(id, settled);
    this.pi.appendEntry(taskEntryType, structuredClone(settled));
  }

  registerLifecycle(): void {
    const detachControl = registerStopControl(this.pi, (reference) => this.stop(reference));
    this.pi.events.on(stopPendingEvent, (payload) => {
      if (stopPendingFor(payload, this.agentId)) this.selfStopPending = true;
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
    this.pi.on('session_shutdown', async () => {
      detachControl();
      await this.stopAll();
    });
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
        for (const worker of current) {
          worker.events.emit(stopPendingEvent, { agentId: worker.id });
          worker.stop('shutdown');
        }
        const outcomes = await Promise.allSettled([
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

  private async shutdownWorker(worker: Worker): Promise<void> {
    const outcome = await settleWithin(worker.completion, overdueAfterMs);
    if (!outcome.settled) {
      worker.groups.killAll();
      throw new Error(stillStoppingMessage(worker.id));
    }
    const failures = await worker.drain();
    try {
      await this.close(worker.session);
    } catch (error) {
      failures.push(String(error));
    }
    if (failures.length) throw new AggregateError(failures, failures.join('; '));
  }

  private async restore(ctx: ExtensionContext): Promise<void> {
    const completion = this.stopAll();
    const owner = this.generation;
    try {
      await completion;
    } finally {
      if (owner === this.generation) {
        const branch = ctx.sessionManager.getBranch();
        this.invocations.restore(branch);
        const appended = branch.findLast((entry) => entry.type === 'custom' && entry.customType === 'pstack-append-subagent-system-prompt');
        this.appendedPrompt = appended?.type === 'custom' && typeof appended.data === 'string' ? appended.data : undefined;
        const definitions = branch.findLast((entry) => entry.type === 'custom' && entry.customType === 'pstack-agent-definition-overrides');
        this.inheritedDefinitions = definitions?.type === 'custom' && typeof definitions.data === 'string' ? definitions.data : undefined;
        const identity = branch.findLast((entry) => entry.type === 'custom' && entry.customType === 'pstack-agent-identity');
        this.agentId = identity?.type === 'custom' && typeof identity.data === 'string' ? identity.data : undefined;
        const worktree = branch.findLast((entry) => entry.type === 'custom' && entry.customType === 'pstack-agent-worktree');
        this.ownWorktree = worktree?.type === 'custom' && typeof worktree.data === 'string' ? worktree.data : undefined;
        const depthEntry = branch.findLast((entry) => entry.type === 'custom' && entry.customType === 'pstack-agent-depth');
        this.depth = depthEntry?.type === 'custom' && typeof depthEntry.data === 'number' && Number.isSafeInteger(depthEntry.data) && depthEntry.data > 0 ? depthEntry.data : 0;
        const scope = branch.findLast((entry) => entry.type === 'custom' && entry.customType === 'pstack-agent-allowed-types');
        const data = scope?.type === 'custom' ? scope.data : null;
        const valid = Array.isArray(data) && data.every((name) => typeof name === 'string');
        this.allowedAgentTypes = data === null || data === undefined ? undefined : valid ? ([...data] as string[]) : [];
        if (data !== null && data !== undefined && !valid) this.pi.events.emit('pstack:subagent-log', 'Invalid native agent type scope; no child types are permitted.');
        this.records = restoreTaskRecords(branch);
        this.failedUsage = new Map();
        this.completions.clear();
        this.lifecycle = { kind: 'active' };
      }
    }
  }

  private priorTask(params: TaskParameters): TaskRecord | undefined {
    if (params.resume !== undefined) validateId(params.resume);
    if (this.lifecycle.kind !== 'active') throw new Error('Parent session is not active. Wait for session startup or tree restoration before starting a task.');
    if (params.environment === 'cloud') throw new Error('Cursor cloud execution is unavailable in Pi. Explicitly choose environment local only when local execution satisfies the task.');
    const prior = params.resume ? this.records.get(params.resume) : undefined;
    if (params.resume && !prior) throw new Error(`Unknown task in this branch: ${params.resume}`);
    return prior;
  }

  private checkStartup(owner: number, signal: AbortSignal | undefined, background: boolean): AbortSignal | undefined {
    if (this.generation !== owner) throw new Error('Task startup was cancelled.');
    return launchSignal(signal, background);
  }

  async start(callId: string, params: TaskParameters, signal: AbortSignal | undefined, ctx: ExtensionContext, onUpdate: TaskUpdate | undefined, launch?: AgentLaunch): Promise<AgentToolResult<TaskRecord>> {
    signal = launchSignal(signal, params.run_in_background !== false);
    const prior = this.priorTask(params);
    this.checkDepth(prior, ctx);
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
      if (launch) this.invocations.mark(this.pi, launch.definition.agentType, id);
      const opened = await this.openChild({ id, params, prior, ctx, ...(launch ? { launch } : {}) });
      session = opened.session;
      this.publishMemory(launch, id);
      if (launch) applyToolPolicy(session, launch.definition, { isContinuation: prior !== undefined, isAsync: params.run_in_background !== false, report: (diagnostic) => this.pi.events.emit('pstack:subagent-zero-tools', diagnostic) });
      signal = this.checkStartup(owner, signal, params.run_in_background !== false);
      await session.bindExtensions({ mode: 'print' });
      signal = this.checkStartup(owner, signal, params.run_in_background !== false);
      const previous = this.workers.get(id);
      if (previous) await this.close(previous.session);
      signal = this.checkStartup(owner, signal, params.run_in_background !== false);
      const worker = this.launch(opened, params, signal, owner, () => ctx.isIdle(), onUpdate, launch);
      this.publishStart(opened.record, prior, launch);
      launch?.onStarted?.();
      const record = params.run_in_background === false ? await this.foreground(callId, worker) : this.records.get(id);
      if (!record) throw new Error(`Failed to create task record for ${id}`);
      return this.result(record, owner);
    } catch (error) {
      this.settledHooks.delete(id);
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

  private publishStart(record: TaskRecord, prior: TaskRecord | undefined, launch: AgentLaunch | undefined): void {
    if (prior) return;
    if (!launch) {
      this.stats.spawn(record.depth ?? this.depth + 1);
      this.pi.events.emit('pstack:subagent-stats', this.stats.snapshot());
    }
    this.pi.events.emit('pstack:subagent-started', { agentId: record.id, spawnDepth: record.depth, agent_depth: record.depth });
  }

  private settleLegacy(record: TaskRecord): void {
    if (record.status === 'running') return;
    this.stats.settle(record.status, record.abort?.telemetry);
    this.pi.events.emit('pstack:subagent-stats', this.stats.snapshot());
  }

  private checkDepth(prior: TaskRecord | undefined, ctx: ExtensionContext): void {
    if (prior) return;
    const cap = this.maximumDepth(ctx);
    if (this.depth < cap) return;
    this.stats.refuse('depth_limit');
    this.pi.events.emit('pstack:subagent-stats', this.stats.snapshot());
    this.pi.events.emit('pstack:subagent-refused', { code: 'subagent_depth_cap', reason: 'depth_limit' });
    throw new AgentPreconditionError({ code: 'subagent_depth_cap', message: depthMessage(this.depth, cap) });
  }

  maximumDepth(ctx: ExtensionContext, env: NodeJS.ProcessEnv = process.env): number {
    return this.depthPolicy.cap({ sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, env });
  }

  agentDefinitions(): string | undefined {
    const configured = this.pi.getFlag('agents');
    return typeof configured === 'string' ? configured : this.inheritedDefinitions;
  }

  private async openChild(input: Parameters<typeof openWorkerSession>[0]): Promise<Awaited<ReturnType<typeof openWorkerSession>> & ChildChannel> {
    const depth = input.prior?.depth ?? this.depth + 1;
    const owner = this.generation;
    const channel = this.childChannel(input.id, owner);
    const opened = await depthStore.run(depth, () =>
      openWorkerSession({
        ...input,
        depth,
        events: channel.events,
        onProcessGroup: (pid) => channel.groups.add({ pid }),
        ...(this.ownWorktree ? { inheritedWorktree: this.ownWorktree } : {}),
        log: (message) => this.pi.events.emit('pstack:subagent-log', message),
        appendedPrompt: this.childPrompt(),
        agentDefinitions: this.agentDefinitions(),
      }),
    );
    return { ...opened, ...channel };
  }

  private childChannel(id: string, owner: number): ChildChannel {
    const events = childStatsEvents((change) => this.observeStats(owner, change));
    const groups = new ProcessGroups(id, (spawned) => this.pi.events.emit(processGroupEvent, spawned));
    events.on(processGroupEvent, (payload) => {
      const spawned = groupSpawned(payload);
      if (spawned) groups.add(spawned);
    });
    events.on(shellHandoffEvent, (payload) => {
      const handoff = asShellHandoff(payload);
      if (!handoff) return;
      this.pi.events.emit(shellHandoffEvent, handoff);
      if (handoff.claimed()) this.keepalive = new Set([...this.keepalive, id]);
    });
    return { events, groups };
  }

  private observeStats(owner: number, change: SubagentStatsDelta): void {
    if (owner !== this.generation) return;
    this.stats.merge(change);
    this.pi.events.emit('pstack:subagent-stats', this.stats.snapshot());
  }

  private publishMemory(launch: AgentLaunch | undefined, id: string): void {
    if (!launch?.definition.memory) return;
    this.pi.events.emit('pstack:agent-memory-loaded', { agentId: id, agentType: launch.definition.agentType, scope: launch.definition.memory, source: 'subagent', enabled: memoryEnabled(launch.definition, process.env) });
  }

  private childPrompt(): string | undefined {
    const configured = this.pi.getFlag('append-subagent-system-prompt');
    return typeof configured === 'string' ? configured : this.appendedPrompt;
  }

  private async foreground(callId: string, worker: Worker): Promise<TaskRecord> {
    const record = await worker.completion;
    if (record.status === 'settled') return record;
    const usage = this.claimUsage(record);
    if (usage) this.failedUsage.set(callId, usage);
    throw new Error(taskSummary(record));
  }

  private launch(opened: Awaited<ReturnType<WorkerRuntime['openChild']>>, params: TaskParameters, signal: AbortSignal | undefined, owner: number, parentIdle: () => boolean, onUpdate: TaskUpdate | undefined, agent?: AgentLaunch): Worker {
    const { session, modelsUsed } = opened;
    const usage = this.records.get(opened.record.id)?.usage;
    const record: TaskRecord = { ...opened.record, ...(usage ? { usage } : {}) };
    this.records.set(record.id, record);
    this.pi.appendEntry(taskEntryType, structuredClone(record));
    const progress = params.run_in_background === false && onUpdate ? this.progressObserver(record.id, owner, onUpdate) : undefined;
    const limit = agent?.definition.maxTurns
      ? turnLimit(
          agent.definition.agentType,
          agent.definition.maxTurns,
          (message) => this.pi.events.emit('pstack:subagent-log', message),
          () => control.stop(),
        )
      : undefined;
    const observe: AgentSessionEventListener | undefined =
      progress || limit
        ? (event) => {
            progress?.(event);
            limit?.(event);
          }
        : undefined;
    const control = workerControl(session, signal, observe, {
      foreground: params.run_in_background === false,
      onAbort: (info) => this.pi.events.emit('pstack:subagent-abort', { agent_id: record.id, ...info }),
      taskId: record.id,
      log: (message) => this.pi.events.emit('pstack:subagent-log', message),
      killGroups: () => opened.groups.killAll(),
    });
    const completion = this.complete({ session, record, modelsUsed }, params, owner, control, parentIdle, !agent && !params.resume);
    const worker: Worker = { id: record.id, session, completion, stop: control.stop, drain: control.drain, events: opened.events, groups: opened.groups };
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

  private async complete(worker: Awaited<ReturnType<typeof openWorkerSession>>, params: TaskParameters, owner: number, control: ReturnType<typeof workerControl>, parentIdle: () => boolean, legacy: boolean): Promise<TaskRecord> {
    const { session, record, modelsUsed } = worker;
    const initialCount = session.messages.length;
    const startedAt = Date.now();
    let outcome = await this.run(session, params.prompt);
    try {
      await this.close(session);
    } catch (error) {
      outcome = { status: 'failed' as const, output: `${outcome.output}\nWorker shutdown failed: ${String(error)}` };
    } finally {
      control.unsubscribe();
    }
    const abortFailures = await control.drain();
    if (abortFailures.length) outcome = { status: 'failed', output: `${outcome.output}\n${abortFailures.join('\n')}` };
    const status = control.stopped() ? 'interrupted' : outcome.status;
    const pendingUsage = owner === this.generation ? this.records.get(record.id)?.usage : this.claimedUsage.has(record) ? undefined : record.usage;
    const usage = sumUsage(session.messages.slice(initialCount), pendingUsage);
    const { totalToolUseCount: toolUseCount, toolStats } = countToolStats(session.messages.slice(initialCount));
    if (session.model) modelsUsed.record(`${session.model.provider}/${session.model.id}`);
    const modelReference = session.model ? `${session.model.provider}/${session.model.id}:${session.thinkingLevel}` : record.modelReference;
    let finished: TaskRecord = {
      ...record,
      status,
      output: outcome.output.slice(0, taskOutputLimit),
      usage,
      toolUseCount,
      durationMs: Date.now() - startedAt,
      modelReference,
      modelsUsed: modelsUsed.snapshot(),
      ...(control.abortInfo() ? { abort: control.abortInfo() } : {}),
      ...(toolStats ? { toolStats } : {}),
    };
    try {
      await writeFile(finished.outputFile, outcome.output);
    } catch (error) {
      finished = { ...finished, status: 'failed', output: `${finished.output}\nCould not save full output: ${String(error)}` };
    }
    finished = await this.settleResources(finished);
    if (owner !== this.generation) return finished;
    if (legacy) this.settleLegacy(finished);
    this.records.set(record.id, finished);
    this.persistFinished(finished);
    if (params.run_in_background !== false && !control.stopped()) {
      this.completions.send(record.id, parentIdle(), { customType: 'pstack-task-completion', content: taskSummary(finished), display: true, details: structuredClone(finished) });
    }
    return finished;
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

  private persistFinished(record: TaskRecord): void {
    try {
      this.pi.appendEntry(taskEntryType, structuredClone(record));
    } catch (error) {
      if (!record.worktreeCleanlyRemoved) throw error;
      this.pi.events.emit('pstack:subagent-log', `Failed to clear worktree metadata: ${String(error)}`);
    }
  }

  private async settleResources(record: TaskRecord): Promise<TaskRecord> {
    const hook = this.settledHooks.get(record.id);
    this.settledHooks.delete(record.id);
    try {
      const patch = await hook?.(record);
      if (!patch) return record;
      const merged = { ...record, ...patch };
      if (!merged.worktreeCleanlyRemoved) return merged;
      const { worktreePath: _path, worktreeBranch: _branch, ...removed } = merged;
      return removed;
    } catch (error) {
      return { ...record, output: `${record.output}\nWorktree cleanup failed: ${String(error)}` };
    }
  }

  async stop(reference: string) {
    const target = this.find(reference);
    const worker = target && this.workers.get(target.id);
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
    if (!outcome.settled) {
      const details = stopPendingDetails(target);
      return { content: [{ type: 'text' as const, text: details.message }], details, structuredContent: details, isError: false };
    }
    const record = outcome.value;
    if (wasRunning && owner === this.generation) this.notifyStopped(worker, record);
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

  private markStopping(id: string, worker: Worker): void {
    if (this.stopping.has(id)) return;
    this.stopping = new Set([...this.stopping, id]);
    worker.events.emit(stopPendingEvent, { agentId: id });
    const clear = () => {
      this.stopping = new Set([...this.stopping].filter((stopping) => stopping !== id));
    };
    void worker.completion.then(clear, clear);
  }

  private notifyStopped(worker: Worker, record: TaskRecord): void {
    if (this.stoppedNotifications.has(worker)) return;
    this.stoppedNotifications.add(worker);
    const details = { task_id: record.id, status: 'stopped', task_type: 'local_agent', summary: record.description ?? record.persona };
    this.pi.sendMessage({ customType: 'task_notification', content: `Task ${record.id} stopped.`, display: true, details }, { triggerTurn: false });
  }

  async message(id: string, message: string, mode: 'steer' | 'followUp' | undefined) {
    const worker = this.workers.get(id);
    if (this.stopping.has(id)) throw new ResumeError('still_stopping', resumeMessages.targetStopping(id));
    if (!worker || this.records.get(id)?.status !== 'running') throw new Error('Task is not running. Use Task with resume.');
    if (mode === 'steer') await worker.session.steer(message);
    else await worker.session.followUp(message);
    const details = { task_id: id };
    return { content: [{ type: 'text' as const, text: `Message queued for ${id}` }], details, structuredContent: details as unknown as JsonValue };
  }
}
