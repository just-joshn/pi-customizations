import { type AgentSession, createEventBus, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { DeferredWakes } from '../deferred-wakes.ts';
import { overdueAfterMs, workerControl } from '../worker-control.ts';
import { type AgentNode, agentEntryType, repairInterrupted, restoreNodes } from './agent-node.ts';
import { completedData, failedData, initialNode, measure, startedData, viewOf } from './agent-records.ts';
import { EventBridge, textOf } from './child-events.ts';
import { type OpenedChild, type OpenInput, openChildSession } from './child-session.ts';
import { closeSession } from './close-session.ts';
import { noticeFor } from './completion-wake.ts';
import type { ChildPlan } from './context-builder.ts';
import { asEnvelope, type EventLog, eventChannel } from './events.ts';
import { inboxChannel, inboxMessage } from './inbox.ts';
import { isLinkAcquire, type LimiterLike, linkChannel } from './limiter-provider.ts';
import { ProcessGroups } from './process-groups.ts';
import { settleWithin } from './stop-deadline.ts';
import type { TaskRegistry } from './task-registry.ts';
import { acceptsMessages } from './task-status.ts';
import { retiredText, rewindingDeliverMessage, writeAgentRefusal } from './tool-results.ts';
import { TurnLimit } from './turn-limit.ts';

export type LaunchInput = Readonly<{
  plan: ChildPlan;
  ctx: ExtensionContext;
  signal: AbortSignal | undefined;
  toolCallId: string;
  description: string;
  name: string;
  depth: number;
  parentAgentId: string;
  parentTools: readonly string[];
  contextManagement: boolean;
  release: () => void;
  workflowRunId?: string;
}>;
export type Launched = Readonly<{ id: string; settled: Promise<AgentNode>; promoted: Promise<void> }>;
export type SchedulerDeps = Readonly<{
  pi: ExtensionAPI;
  events: EventLog;
  registry: TaskRegistry;
  limiter: (cwd: string) => LimiterLike;
  open?: (input: OpenInput) => Promise<OpenedChild>;
  now?: () => number;
  maxIdle?: number;
  onSettled?: (node: AgentNode) => Promise<void>;
  onInbox?: (agentId: string, message: string) => void;
  extraWork?: () => boolean;
  entryType?: string;
  quiet?: boolean;
  log: (message: string) => void;
}>;
export type ReadOptions = Readonly<{ wait: boolean; timeoutSeconds: number }>;
type Outcome = Readonly<{ kind: 'done'; text: string }> | Readonly<{ kind: 'failed'; error: string }> | Readonly<{ kind: 'cancelled' }>;

const defaultMaxIdle = 8;

function lastReport(messages: AgentSession['messages']): string {
  for (const message of messages.toReversed()) {
    if (message.role !== 'assistant') continue;
    const text = textOf(message.content);
    if (text) return text;
  }
  return '';
}

class LiveChild {
  lease: (() => void) | undefined;
  limited = false;
  settled: Promise<unknown> = Promise.resolve();
  readonly promote: () => void;
  readonly promoted: Promise<void>;

  constructor(
    readonly id: string,
    readonly session: AgentSession,
    readonly control: ReturnType<typeof workerControl>,
    readonly groups: ProcessGroups,
    readonly ctx: ExtensionContext,
    readonly limit: TurnLimit | undefined,
    lease: () => void,
  ) {
    this.lease = lease;
    let resolve = () => {};
    this.promoted = new Promise<void>((done) => {
      resolve = done;
    });
    this.promote = resolve;
  }

  markLimited(): void {
    this.limited = true;
  }

  releaseSlot(): void {
    this.lease?.();
    this.lease = undefined;
  }
}

export class SubagentScheduler {
  private readonly live = new Map<string, LiveChild>();
  private readonly wakes: DeferredWakes;
  private rewinding = false;
  private disposing = false;

  constructor(private readonly deps: SchedulerDeps) {
    this.wakes = new DeferredWakes(deps.pi);
    deps.registry.subscribe((change) => {
      const hidden = deps.registry.get(change.id)?.workflowRunId !== undefined;
      if (!hidden) deps.events.emit('session.background_tasks_changed', {}, { ephemeral: true });
    });
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  blocksStart(): boolean {
    return this.rewinding || this.disposing;
  }

  hasActiveWork(): boolean {
    return this.deps.registry.count('running') > 0;
  }

  async launch(input: LaunchInput): Promise<Launched> {
    const { plan, ctx } = input;
    const node = {
      ...initialNode(plan, { toolCallId: input.toolCallId, description: input.description, name: input.name, depth: input.depth, now: this.now() }),
      ...(input.workflowRunId !== undefined ? { workflowRunId: input.workflowRunId } : {}),
    };
    this.deps.events.emit('subagent.started', startedData(node), { agentId: node.id });
    this.deps.registry.register(node);
    this.deps.events.emit('subagent.configured', { model: node.model, ...(node.effort ? { reasoningEffort: node.effort } : {}), contextTier: node.contextTier, multiTurn: true as const });
    this.deps.events.emit('subagent.selected', { agentName: node.agentType, agentDisplayName: node.agentDisplayName, tools: plan.tools.declared });
    const live = await this.open(input).catch((error: unknown) => this.abandon(node, input, error));
    this.deps.registry.patch(node.id, { sessionFile: live.sessionFile });
    const settled = this.run(live.child, plan.userMessage, ctx);
    live.child.settled = settled;
    return { id: node.id, settled, promoted: live.child.promoted };
  }

  private async open(input: LaunchInput): Promise<{ child: LiveChild; sessionFile: string }> {
    const { plan, ctx } = input;
    const events = createEventBus();
    events.on(eventChannel, (payload) => {
      const envelope = asEnvelope(payload);
      if (envelope) this.deps.events.relay(envelope, plan.agentId);
    });
    events.on(inboxChannel, (payload) => {
      const message = inboxMessage(payload);
      if (message !== undefined) this.deps.onInbox?.(plan.agentId, message);
    });
    events.on(linkChannel, (payload) => {
      if (isLinkAcquire(payload)) payload.reply(this.deps.limiter(ctx.cwd).tryAcquire(payload.request));
    });
    const groups = new ProcessGroups(plan.agentId, () => {});
    const opened = await (this.deps.open ?? openChildSession)({
      plan,
      ctx,
      events,
      depth: input.depth,
      parentTools: input.parentTools,
      contextManagement: input.contextManagement,
      parentAgentId: input.parentAgentId,
      onProcessGroup: (pid) => groups.add({ pid }),
      log: this.deps.log,
    });
    const bridge = new EventBridge();
    const limit = plan.limits.maxAgentTurns ? new TurnLimit(plan.limits.maxAgentTurns, plan.limits.lastTurnWarning) : undefined;
    const holder: { child?: LiveChild } = {};
    const observe = (event: Parameters<Parameters<AgentSession['subscribe']>[0]>[0]) => this.observe(plan.agentId, bridge, event, holder.child);
    const control = workerControl(opened.session, plan.mode === 'sync' ? input.signal : undefined, observe, {
      foreground: plan.mode === 'sync',
      taskId: plan.agentId,
      log: this.deps.log,
      killGroups: () => groups.killAll(),
    });
    const child = new LiveChild(plan.agentId, opened.session, control, groups, ctx, limit, input.release);
    holder.child = child;
    this.live.set(plan.agentId, child);
    if (plan.mode === 'sync' && this.deps.registry.get(plan.agentId)?.mode === 'background') child.promote();
    this.deps.events.emit('system.message', { content: plan.prompt.text }, { agentId: plan.agentId });
    this.deps.events.emit('session.model_change', { newModel: opened.modelReference }, { agentId: plan.agentId });
    return { child, sessionFile: opened.sessionFile };
  }

  private observe(agentId: string, bridge: EventBridge, event: Parameters<Parameters<AgentSession['subscribe']>[0]>[0], child: LiveChild | undefined): void {
    const mapped = bridge.translate(event);
    if (mapped) this.deps.events.emit(mapped.type, mapped.data, { agentId, ...(mapped.ephemeral ? { ephemeral: true } : {}) });
    if (event.type === 'tool_execution_end' && event.parentToolCallId === undefined) this.deps.registry.mutateProgress(agentId, { kind: 'tool_call' });
    if (event.type === 'turn_end' && child?.limit) this.enforce(child, child.limit.onTurnEnd(event.toolResults.length));
  }

  private enforce(child: LiveChild, verdict: ReturnType<TurnLimit['onTurnEnd']>): void {
    if (verdict === 'warn') void child.session.steer(child.limit?.warning ?? '');
    if (verdict === 'stop') {
      child.markLimited();
      child.control.stop('turn-abort');
    }
  }

  private abandon(node: AgentNode, input: LaunchInput, error: unknown): never {
    input.release();
    const failed = this.deps.registry.transition(node.id, 'failed', { error: error instanceof Error ? error.message : String(error), endedAt: this.now() });
    this.deps.events.emit('subagent.failed', failedData(failed));
    throw error;
  }

  private async run(child: LiveChild, text: string, ctx: ExtensionContext): Promise<AgentNode> {
    const outcome = await this.turn(child, text);
    return this.settle(child, outcome, ctx);
  }

  private async turn(child: LiveChild, text: string): Promise<Outcome> {
    try {
      await child.session.prompt(text);
      await child.session.waitForIdle();
    } catch (error) {
      return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
    if (child.limited) return { kind: 'done', text: `${lastReport(child.session.messages)}\n\n${child.limit?.note() ?? ''}`.trim() };
    if (child.control.stopped()) return { kind: 'cancelled' };
    const last = child.session.messages.findLast((message) => message.role === 'assistant');
    if (last?.role === 'assistant' && last.stopReason === 'aborted') return { kind: 'cancelled' };
    if (last?.role === 'assistant' && last.stopReason === 'error') return { kind: 'failed', error: last.errorMessage ?? 'The agent stopped with an error.' };
    return { kind: 'done', text: child.session.getLastAssistantText() ?? '' };
  }

  private async settle(child: LiveChild, outcome: Outcome, ctx: ExtensionContext): Promise<AgentNode> {
    const before = this.deps.registry.get(child.id);
    if (!before) throw new Error(`Agent not found: ${child.id}`);
    const measured = measure(child.session.messages);
    const fields = { endedAt: this.now(), totalToolCalls: measured.toolCalls, totalTokens: measured.tokens };
    const node = this.finish(before, outcome, fields, child.limited);
    child.releaseSlot();
    if (node.status === 'idle') this.retireOverflow();
    else await this.dispose(child);
    if (node.status === 'failed') this.deps.events.emit('subagent.failed', failedData(node));
    else this.deps.events.emit('subagent.completed', completedData(node));
    this.announce(node, ctx);
    await this.deps.onSettled?.(node).catch((error: unknown) => this.deps.log(`subagentStop hook failed: ${String(error)}`));
    return node;
  }

  private finish(before: AgentNode, outcome: Outcome, fields: Pick<AgentNode, 'endedAt' | 'totalToolCalls' | 'totalTokens'>, terminal: boolean): AgentNode {
    const { registry } = this.deps;
    switch (outcome.kind) {
      case 'done':
        return registry.transition(before.id, before.mode === 'background' && !terminal ? 'idle' : 'completed', { ...fields, turns: [...before.turns, outcome.text] });
      case 'failed':
        return registry.transition(before.id, 'failed', { ...fields, error: outcome.error });
      case 'cancelled':
        return registry.transition(before.id, 'cancelled', { ...fields, cancelled: true });
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }

  private announce(node: AgentNode, ctx: ExtensionContext): void {
    const notice = noticeFor(node);
    if (!notice || this.disposing || this.deps.quiet) return;
    this.deps.events.emit('system.notification', notice.data);
    this.wakes.send(node.id, ctx.isIdle(), notice.wake);
  }

  private async dispose(child: LiveChild): Promise<void> {
    this.live.delete(child.id);
    child.control.unsubscribe();
    await child.control.drain();
    await closeSession(child.session).catch((error: unknown) => this.deps.log(`Subagent session close failed: ${String(error)}`));
  }

  private retireOverflow(): void {
    const idle = this.deps.registry.list().filter((node) => node.status === 'idle' && node.retired !== true && this.live.has(node.id));
    const excess = idle.length - (this.deps.maxIdle ?? defaultMaxIdle);
    const oldest = idle.toSorted((left, right) => (left.endedAt ?? 0) - (right.endedAt ?? 0)).slice(0, Math.max(0, excess));
    for (const node of oldest) {
      this.deps.registry.patch(node.id, { retired: true });
      const child = this.live.get(node.id);
      if (child) void this.dispose(child);
    }
  }

  private visible(id: string): AgentNode {
    const node = this.deps.registry.get(id);
    if (!node) throw new Error(`Agent not found: ${id}`);
    if (node.workflowRunId !== undefined) throw new Error(`Agent ${id} is managed by workflow run ${node.workflowRunId}.`);
    return node;
  }

  async write(id: string, message: string, ctx: ExtensionContext): Promise<AgentNode> {
    if (this.blocksStart()) throw new Error(rewindingDeliverMessage);
    const node = this.visible(id);
    if (node.retired === true) throw new Error(retiredText);
    if (!acceptsMessages(node)) throw new Error(writeAgentRefusal(viewOf(node, this.now())));
    const child = this.live.get(id);
    if (!child) throw new Error(retiredText);
    if (node.status === 'running') {
      await child.session.followUp(message);
      return node;
    }
    const acquired = this.deps.limiter(ctx.cwd).tryAcquire({ kind: 'resume' });
    if (!acquired.ok) throw new Error(acquired.message);
    child.lease = acquired.release;
    const running = this.deps.registry.transition(id, 'running', {});
    child.settled = this.run(child, message, ctx);
    return running;
  }

  async read(id: string, options: ReadOptions, signal: AbortSignal | undefined): Promise<AgentNode> {
    const node = this.visible(id);
    const child = this.live.get(id);
    if (options.wait && node.status === 'running' && child) {
      const deadline = new Promise<void>((resolve) => setTimeout(resolve, options.timeoutSeconds * 1000));
      const aborted = new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      await Promise.race([child.settled, deadline, aborted]);
      this.wakes.drop(id);
    }
    return this.deps.registry.get(id) ?? node;
  }

  list(): readonly AgentNode[] {
    return this.deps.registry.list().filter((node) => node.workflowRunId === undefined);
  }

  get(id: string): AgentNode {
    const node = this.deps.registry.get(id);
    if (!node) throw new Error(`Agent not found: ${id}`);
    return node;
  }

  currentPromotable(): AgentNode | undefined {
    return this.list().find((node) => node.mode === 'sync' && node.status === 'running');
  }

  promoteCurrent(): AgentNode | undefined {
    const target = this.currentPromotable();
    if (!target) return undefined;
    const promoted = this.deps.registry.promote(target.id);
    this.live.get(target.id)?.promote();
    return promoted;
  }

  async cancel(id: string, reason: 'user-cancel' | 'shutdown' = 'user-cancel'): Promise<AgentNode> {
    const node = this.visible(id);
    const child = this.live.get(id);
    if (!child) return node;
    child.control.stop(reason);
    await settleWithin(child.settled, overdueAfterMs);
    return this.deps.registry.get(id) ?? node;
  }

  waitForWork(timeoutMs: number): Promise<boolean> {
    if (!this.hasActiveWork()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), timeoutMs);
      const finish = (drained: boolean) => {
        clearTimeout(timer);
        stop();
        resolve(drained);
      };
      const stop = this.deps.registry.subscribe(() => {
        if (!this.hasActiveWork()) finish(true);
      });
    });
  }

  async cancelAll(includeIdle: boolean): Promise<readonly AgentNode[]> {
    const targets = this.list().filter((node) => node.status === 'running' || (includeIdle && node.status === 'idle'));
    return Promise.all(targets.map((node) => (node.status === 'idle' ? this.cancelIdle(node) : this.cancel(node.id))));
  }

  private async cancelIdle(node: AgentNode): Promise<AgentNode> {
    const child = this.live.get(node.id);
    const cancelled = this.deps.registry.transition(node.id, 'cancelled', { cancelled: true, endedAt: this.now() });
    if (child) await this.dispose(child);
    this.deps.events.emit('subagent.completed', completedData(cancelled));
    return cancelled;
  }

  restore(ctx: ExtensionContext): void {
    const branch = ctx.sessionManager.getBranch();
    this.rewinding = false;
    this.disposing = false;
    this.wakes.clear();
    this.reconcile(restoreNodes(branch, this.deps.entryType));
  }

  private reconcile(nodes: ReadonlyMap<string, AgentNode>): void {
    const { nodes: repaired, closed, dangling } = repairInterrupted(nodes, this.now());
    this.deps.registry.replace(repaired);
    for (const id of [...closed, ...dangling]) {
      const node = repaired.get(id);
      if (node) this.deps.pi.appendEntry(this.deps.entryType ?? agentEntryType, node);
    }
    if (closed.length > 0 || dangling.length > 0) this.deps.log(`Closed interrupted sub-agent records on resume: closed ${closed.length}, dangling ${dangling.length}`);
  }

  beginRewind(): { cancel: boolean } {
    if (this.hasActiveWork() || this.deps.extraWork?.()) return { cancel: true };
    this.rewinding = true;
    return { cancel: false };
  }

  async shutdown(): Promise<void> {
    this.disposing = true;
    this.wakes.clear();
    await Promise.allSettled([...this.live.values()].map((child) => this.stopAndClose(child)));
    this.reconcile(new Map(this.deps.registry.list().map((node) => [node.id, node])));
  }

  private async stopAndClose(child: LiveChild): Promise<void> {
    child.control.stop('shutdown');
    await settleWithin(child.settled, overdueAfterMs);
    await this.dispose(child);
  }
}
