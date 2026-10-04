import { randomUUID } from 'node:crypto';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Check } from 'typebox/value';
import type { Branch } from '../agent-node.ts';
import type { EventLog } from '../events.ts';
import type { Created, SubagentFactory } from '../factory.ts';
import type { WorkflowLimits } from '../settings.ts';
import { checkLimits, effectiveLimits, overCredits } from './limits.ts';
import { Slots } from './slots.ts';
import { type Change, WorkflowStore } from './store.ts';
import { type AgentOutcome, type RunRecord, type WorkflowAgentOptions, type WorkflowDeclaration, WorkflowPause } from './types.ts';

export function workflowsEnabled(env: NodeJS.ProcessEnv): boolean {
  const on = ['1', 'true', 'yes', 'on'].includes(env['COPILOT_DYNAMIC_WORKFLOWS']?.trim().toLowerCase() ?? '');
  return (
    on ||
    ['dynamic_workflows', 'EXTENSIONS'].some((flag) =>
      (env['COPILOT_CLI_ENABLED_FEATURE_FLAGS'] ?? env['COPILOT_EXPERIMENTS'] ?? '')
        .toLowerCase()
        .split(',')
        .map((entry) => entry.trim())
        .includes(flag.toLowerCase()),
    )
  );
}

export type WorkflowPorts = Readonly<{
  pi: ExtensionAPI;
  events: EventLog;
  factory: SubagentFactory;
  env: () => NodeJS.ProcessEnv;
  settings: { read: () => { settings: { workflows: { maxConcurrentRuns: number; defaultLimits: WorkflowLimits } } } };
  log: (message: string) => void;
  persist: (change: Change) => void;
  now?: () => number;
}>;

/** One credit request per workflow subagent, matching the per-request credit model of the report. */
const agentCredits = 1;

/** A schema reply that failed to parse or match; agentOnce retries it once. */
class SchemaMiss extends Error {}

export class WorkflowRuntime {
  private readonly ports: WorkflowPorts;
  private readonly store: WorkflowStore;
  private declarations: ReadonlyMap<string, WorkflowDeclaration> = new Map();
  private readonly cancelled = new Map<string, AbortController>();
  private readonly slots = new Map<string, Slots>();

  constructor(ports: WorkflowPorts) {
    this.ports = ports;
    this.store = new WorkflowStore(ports.persist);
  }

  /** Rebuilds the runs of the active branch. A run a previous process left open settles as interrupted, except the runs this process is executing. */
  restore(branch: Branch): void {
    this.store.restore(branch);
    for (const run of this.store.interruptOpen(new Set(this.cancelled.keys()))) this.emit('workflow.run_settled', run);
  }

  private now(): number {
    return this.ports.now?.() ?? Date.now();
  }

  runs(): readonly RunRecord[] {
    return this.store.list();
  }

  get(id: string): RunRecord | undefined {
    return this.store.get(id);
  }

  journal(id: string): Record<string, unknown> {
    return { ...this.store.journalOf(id) };
  }

  appendLog(id: string, message: string): void {
    this.store.log(id, message);
  }

  putJournal(id: string, key: string, value: unknown): void {
    this.store.putJournal(id, key, value);
  }

  progress(id: string): { phases: readonly string[]; consumption: RunRecord['consumption'] } | undefined {
    const run = this.store.get(id);
    return run ? { phases: run.phases, consumption: run.consumption } : undefined;
  }

  /** One workflow-scoped subagent, reachable for out-of-process SDK clients through session.workflow.agent. */
  runAgent(id: string, prompt: string, options: WorkflowAgentOptions, ctx: ExtensionContext): Promise<AgentOutcome> {
    const run = this.store.get(id);
    if (!run) throw new Error(`Unknown workflow run: ${id}`);
    return this.agentOnce(id, run.ownerEpoch, prompt, options, this.cancelled.get(id)?.signal ?? new AbortController().signal, ctx);
  }

  /** Declarations are silently dropped while dynamic workflows are disabled. */
  register(declaration: WorkflowDeclaration): boolean {
    if (!workflowsEnabled(this.ports.env())) return false;
    this.declarations = new Map([...this.declarations, [declaration.name, declaration]]);
    return true;
  }

  private declared(name: string): WorkflowDeclaration {
    const found = this.declarations.get(name);
    if (!found) throw new Error(`Unknown workflow: ${name}. Registered workflows: ${[...this.declarations.keys()].join(', ') || 'none'}`);
    return found;
  }

  private emit(type: 'workflow.run_started' | 'workflow.run_updated' | 'workflow.run_settled', run: RunRecord): void {
    this.ports.events.emit(type, { runId: run.id, status: run.status, consumption: run.consumption });
  }

  async start(name: string, args: unknown, ctx: ExtensionContext, via: 'tool' | 'rpc', overrides: Partial<WorkflowLimits> = {}): Promise<RunRecord> {
    const declaration = this.declared(name);
    if (declaration.arguments && !Check(declaration.arguments, args)) throw new Error(`Invalid arguments for workflow ${name}.`);
    if (this.store.list().some((run) => run.name === name && ['pending', 'running', 'paused'].includes(run.status))) throw new Error(`Workflow ${name} already has an active run. Resume or cancel it first.`);
    const { maxConcurrentRuns, defaultLimits } = this.ports.settings.read().settings.workflows;
    if (this.store.list().filter((run) => ['pending', 'running', 'paused'].includes(run.status)).length >= maxConcurrentRuns) throw new Error(`The active workflow run cap (${maxConcurrentRuns}) is reached.`);
    if (
      via === 'tool' &&
      ctx.hasUI &&
      !(await ctx.ui.confirm(`Run workflow ${name}?`, `${declaration.description}\nEffective limits: ${JSON.stringify(effectiveLimits({ declaration, ...(Object.keys(overrides).length ? { overrides } : {}), defaults: defaultLimits }))}`))
    )
      throw new Error('The user declined to run this workflow.');
    const now = this.now();
    const created = this.store.create(name, declaration, args, overrides, defaultLimits, now);
    return this.launch(created.id, ctx);
  }

  private async launch(id: string, ctx: ExtensionContext): Promise<RunRecord> {
    const epoch = this.store.get(id)?.ownerEpoch ?? 0;
    const claimed = this.store.claim(id, epoch + 1, this.now());
    if (!claimed) throw new Error(`Run ${id} could not be claimed.`);
    this.emit('workflow.run_started', claimed);
    const controller = new AbortController();
    this.cancelled.set(id, controller);
    const slots = new Slots(claimed.effectiveLimits.maxConcurrentSubagents);
    this.slots.set(id, slots);
    try {
      return await this.execute(claimed, epoch + 1, controller.signal, ctx);
    } finally {
      this.cancelled.delete(id);
      slots.close();
    }
  }

  private context(run: RunRecord, epoch: number, signal: AbortSignal, ctx: ExtensionContext) {
    return {
      resumed: run.attempt > 1,
      phase: (name: string) => {
        this.store.log(run.id, `Phase ${name}.`, name);
        this.emit('workflow.run_updated', this.store.get(run.id) ?? run);
      },
      log: (message: string) => this.store.log(run.id, message),
      step: async <T>(key: string, work: () => Promise<T>): Promise<T> => {
        const journaled = this.store.journalOf(run.id)[key];
        if (journaled !== undefined) return journaled as T;
        const value = await work();
        this.store.putJournal(run.id, key, value);
        return value;
      },
      agent: (prompt: string, options: WorkflowAgentOptions = {}) => this.agentOnce(run.id, epoch, prompt, options, signal, ctx),
      parallel: async <T>(jobs: readonly (() => Promise<T>)[]): Promise<readonly T[]> => Promise.all(jobs.map((job) => job())),
      pause: (key: string): never => {
        throw new WorkflowPause(key);
      },
    };
  }

  private async execute(run: RunRecord, epoch: number, signal: AbortSignal, ctx: ExtensionContext): Promise<RunRecord> {
    const declaration = this.declared(run.name);
    const workflowContext = this.context(run, epoch, signal, ctx);
    try {
      const result = await declaration.run(workflowContext, run.arguments);
      return this.settle(run.id, epoch, { status: 'completed', result });
    } catch (error) {
      return this.fail(run.id, epoch, error);
    }
  }

  private settle(id: string, epoch: number, patch: Partial<Omit<RunRecord, 'id'>>): RunRecord {
    const before = this.store.get(id);
    if (!before) throw new Error(`Unknown workflow run: ${id}`);
    if (before.ownerEpoch !== epoch) throw new Error(`Execution token for run ${id} is stale.`);
    if (before.status !== 'running') return before;
    const settled = this.store.settle(id, epoch, patch);
    if (settled === undefined) return before;
    this.emit('workflow.run_settled', settled);
    if (settled.status !== 'paused') this.ports.events.emit('system.notification', { kind: 'workflow_completed', runId: settled.id, summary: `Workflow ${settled.name} ${settled.status === 'completed' ? 'completed' : settled.status}.` });
    return settled;
  }

  private fail(id: string, epoch: number, error: unknown): RunRecord {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof WorkflowPause) return this.settle(id, epoch, { status: 'paused', checkpoint: error.key });
    const limit = message.includes('maxTotalSubagents') || message.includes('timeoutSeconds') || message.includes('maxAiCredits');
    return this.settle(id, epoch, { status: 'error', failure: { type: limit ? 'workflow_limit_reached' : 'error', message } });
  }

  /** The first attempt can consume the time budget, so the same check runs again before a schema retry. */
  private requireWithinLimits(runId: string): void {
    const run = this.store.get(runId);
    if (!run) throw new Error(`Unknown workflow run: ${runId}`);
    const verdict = checkLimits(run, this.now());
    if (!verdict.ok) throw new Error(verdict.message);
  }

  private async agentOnce(runId: string, _epoch: number, prompt: string, options: WorkflowAgentOptions, signal: AbortSignal, ctx: ExtensionContext): Promise<AgentOutcome> {
    this.requireWithinLimits(runId);
    try {
      return await this.dispatch(runId, prompt, options, signal, ctx);
    } catch (error) {
      if (!(error instanceof SchemaMiss)) throw error;
    }
    this.requireWithinLimits(runId);
    return this.dispatch(runId, `${prompt}\n\nYour previous reply was not valid JSON for the requested schema. Reply again with JSON only.`, options, signal, ctx);
  }

  private slotsOf(runId: string): Slots {
    const held = this.slots.get(runId);
    if (held) return held;
    const created = new Slots(this.store.get(runId)?.effectiveLimits.maxConcurrentSubagents);
    this.slots.set(runId, created);
    return created;
  }

  private async dispatch(runId: string, prompt: string, options: WorkflowAgentOptions, signal: AbortSignal, ctx: ExtensionContext): Promise<AgentOutcome> {
    const call = {
      agent_type: 'general-purpose',
      name: 'workflow-agent',
      description: 'Workflow step',
      prompt,
      mode: 'sync' as const,
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.modelPolicy !== undefined ? { modelPolicy: options.modelPolicy } : {}),
      ...(options.effortLevel !== undefined ? { effortLevel: options.effortLevel } : {}),
      ...(options.contextTier !== undefined ? { context_tier: options.contextTier } : {}),
    };
    const release = await this.slotsOf(runId).acquire(signal);
    try {
      this.store.admitSubagent(runId);
      let created: Created;
      try {
        created = await this.ports.factory.create(call, `workflow-${randomUUID().slice(0, 8)}`, signal, ctx, { workflowRunId: runId });
      } catch (error) {
        this.store.releaseSubagent(runId);
        throw error;
      }
      const settled = await created.launched.settled;
      const run = this.store.finishSubagent(runId, agentCredits);
      const over = run ? overCredits(run) : undefined;
      if (over && !over.ok) throw new Error(over.message);
      if (settled.status === 'failed') throw new Error(settled.error ?? 'The workflow agent failed.');
      const text = settled.turns.at(-1) ?? '';
      return { text, value: options.schema ? this.parsedReply(text, options.schema) : text };
    } finally {
      release();
    }
  }

  private parsedReply(text: string, schema: NonNullable<WorkflowAgentOptions['schema']>): unknown {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.startsWith('{') || text.startsWith('[') ? text : (text.match(/\{[\s\S]*\}/)?.[0] ?? 'null'));
    } catch {
      throw new SchemaMiss(`The workflow agent reply was not valid JSON for the requested schema: ${text.slice(0, 200)}`);
    }
    if (!Check(schema, parsed)) throw new SchemaMiss(`The workflow agent reply did not match the requested schema: ${text.slice(0, 200)}`);
    return parsed;
  }

  async cancel(id: string): Promise<RunRecord> {
    this.cancelled.get(id)?.abort();
    const run = this.store.get(id);
    if (!run) throw new Error(`Unknown workflow run: ${id}`);
    if (run.status === 'running') {
      const settled = this.store.settle(id, run.ownerEpoch, { status: 'cancelled' });
      if (settled) {
        this.emit('workflow.run_settled', settled);
        return settled;
      }
    }
    if (['pending', 'paused'].includes(run.status)) {
      const settled = this.store.settle(id, run.ownerEpoch, { status: 'cancelled' }) ?? run;
      this.emit('workflow.run_settled', settled);
      return settled;
    }
    return run;
  }

  async pause(id: string): Promise<RunRecord> {
    const run = this.store.get(id);
    if (run?.status !== 'running') throw new Error(`Run ${id} is not running.`);
    this.cancelled.get(id)?.abort();
    return this.settle(id, run.ownerEpoch, { status: 'paused' });
  }

  async resume(id: string, ctx: ExtensionContext, overrides: Partial<WorkflowLimits> = {}): Promise<RunRecord> {
    const run = this.store.get(id);
    if (!run) throw new Error(`Unknown workflow run: ${id}`);
    if (run.status !== 'paused' && !(run.status === 'error' && (run.failure?.type === 'workflow_limit_reached' || run.failure?.type === 'interrupted'))) throw new Error(`Run ${id} cannot be resumed from ${run.status}.`);
    this.declared(run.name);
    const raised = Object.keys(overrides).length > 0 ? { effectiveLimits: { ...run.effectiveLimits, ...overrides } } : {};
    const restarted = this.store.settle(id, run.ownerEpoch, { status: 'pending', attempt: run.attempt + 1, ...raised }) ?? run;
    return this.launch(restarted.id, ctx);
  }

  async haltAll(): Promise<void> {
    for (const run of this.store.list().filter((entry) => entry.status === 'running')) {
      this.cancelled.get(run.id)?.abort();
      this.settle(run.id, run.ownerEpoch, { status: 'halted' });
    }
  }
}

export function publicWorkflow(run: RunRecord) {
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    attempt: run.attempt,
    consumption: run.consumption,
    phases: run.phases,
    ...(run.checkpoint !== undefined ? { checkpoint: run.checkpoint } : {}),
    ...(run.failure !== undefined ? { failure: run.failure } : {}),
    ...(run.result !== undefined ? { result: run.result } : {}),
  };
}
