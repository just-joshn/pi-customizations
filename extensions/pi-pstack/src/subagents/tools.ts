import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { JsonValue } from '@earendil-works/pi-ai';
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { launchSignal } from '../worker-control.ts';
import type { TaskRecord } from '../worker-records.ts';
import type { WorkerRuntime } from '../worker-runtime.ts';
import { concurrencyMessage, decideAdmission } from './admission.ts';
import { AdmissionSlots } from './admission-slots.ts';
import { type ContinueOutcome, continueAgent } from './agent-continue.ts';
import { type AgentDefinition, type Discovery, discoverAgents } from './definitions.ts';
import { agentGuidance } from './guidance.ts';
import { parseJsonAgents } from './json-definitions.ts';
import { concurrencyCap, sessionSpawnCap } from './limits.ts';
import { chooseChildModel } from './models.ts';
import { checkOptionPortability } from './option-portability.ts';
import { AgentPreconditionError, AgentTypeError } from './precondition-error.ts';
import { type AgentResult, AgentResultSchema, asyncLaunched, completed, resultText } from './results.ts';
import { registerResumeCommand } from './resume-command.ts';
import { resumeLaunch } from './resume-launch.ts';
import { buildAgentSchema, ListAgentsSchema, SendMessageSchema } from './schema.ts';
import type { SubagentStats } from './stats.ts';
import { ToolOfferScope } from './tool-offer-scope.ts';
import { withMaxTurns } from './turn-limit.ts';
import type { AdmissionSnapshot, LaunchPlan, SpawnRequest } from './types.ts';
import { type AgentWorktree, createWorktree, finalizeWorktree, repositoryRoot, type WorktreeOutcome } from './worktree.ts';

type AgentParams = { description: string; prompt: string; subagent_type?: string; model?: string; run_in_background?: boolean; isolation?: 'worktree' | 'remote'; name?: string; max_turns?: number };
type Update = Parameters<WorkerRuntime['start']>[4];
type Admitted = Readonly<{ plan: LaunchPlan; definition: AgentDefinition; model: string | undefined; background: boolean }>;

function toRequest(params: AgentParams): SpawnRequest {
  return {
    description: params.description,
    prompt: params.prompt,
    ...(params.subagent_type !== undefined ? { subagentType: params.subagent_type } : {}),
    ...(params.model !== undefined ? { model: params.model } : {}),
    ...(params.run_in_background !== undefined ? { runInBackground: params.run_in_background } : {}),
    ...(params.isolation !== undefined ? { isolation: params.isolation } : {}),
    ...(params.name !== undefined ? { name: params.name } : {}),
  };
}

function wrap<T>(details: T, text: string): AgentToolResult<T> {
  return { content: [{ type: 'text', text }], details, structuredContent: details as unknown as JsonValue };
}

class AgentLauncher {
  get stats(): SubagentStats {
    return this.runtime.stats;
  }
  private spawned = 0;
  private readonly slots = new AdmissionSlots();
  private readonly reportedDiscoveries = new WeakSet<Discovery>();

  constructor(
    private readonly runtime: WorkerRuntime,
    private readonly env: NodeJS.ProcessEnv,
    private readonly pi: ExtensionAPI,
  ) {
    this.publishStats();
  }

  private publishStats(): void {
    this.pi.events.emit('pstack:subagent-stats', this.stats.snapshot());
  }

  private snapshot(ctx: ExtensionContext, agents: AdmissionSnapshot['agents']): AdmissionSnapshot {
    const sessionCap = sessionSpawnCap(this.env);
    return {
      agents,
      forkAvailable: false,
      ...(this.runtime.allowedAgentTypes !== undefined ? { allowedAgentTypes: this.runtime.allowedAgentTypes } : {}),
      depth: this.runtime.depth,
      depthCap: this.runtime.maximumDepth(ctx, this.env),
      running: this.runtime.runningCount() + this.slots.pending,
      concurrencyCap: concurrencyCap(this.env),
      concurrencyBypass: false,
      ...(sessionCap !== undefined ? { sessionSpawnCap: sessionCap } : {}),
      spawnedThisSession: this.spawned + this.slots.pending,
      spentUsd: 0,
      hasProject: Boolean(ctx.cwd),
      stopPending: this.runtime.stopPending(),
    };
  }

  reserveResume(): () => void {
    const cap = concurrencyCap(this.env);
    if (this.runtime.runningCount() + this.slots.pending >= cap) throw new AgentPreconditionError({ code: 'subagent_concurrency_limit', message: concurrencyMessage(cap) });
    return this.slots.reserve();
  }

  continue(request: Parameters<typeof continueAgent>[1], ctx: ExtensionContext): Promise<ContinueOutcome> {
    const deps = {
      runtime: this.runtime,
      reserve: () => this.reserveResume(),
      launchFor: (record: TaskRecord) => resumeLaunch(record, ctx, { env: this.env, flags: this.runtime.agentDefinitions(), keepsAlive: (id) => this.runtime.keepsAlive(id) }),
    };
    return continueAgent(deps, request, ctx);
  }

  admit(params: AgentParams, ctx: ExtensionContext): Admitted {
    const flags = this.runtime.agentDefinitions();
    const flagAgents = typeof flags === 'string' ? parseJsonAgents(flags, ctx.cwd, (message) => this.pi.events.emit('pstack:subagent-log', message)) : [];
    const found = discoverAgents({ root: ctx.cwd, env: this.env, flagAgents });
    if (!this.reportedDiscoveries.has(found)) {
      for (const message of [...found.logs, ...found.warnings]) this.pi.events.emit('pstack:subagent-log', message);
      this.reportedDiscoveries.add(found);
    }
    const decision = decideAdmission(this.snapshot(ctx, found.activeAgents), toRequest(params));
    if (!decision.ok) {
      if (decision.counter) {
        this.stats.refuse(decision.counter);
        this.publishStats();
      }
      this.pi.events.emit('pstack:subagent-refused', { code: decision.refusal.code, ...(decision.counter ? { reason: decision.counter } : {}) });
      const { code, message } = decision.refusal;
      switch (code) {
        case 'subagent_type_not_found':
        case 'subagent_type_ambiguous':
        case 'subagent_type_missing':
          throw new AgentTypeError({ code, message });
        default:
          throw new AgentPreconditionError(decision.refusal);
      }
    }
    const { plan } = decision;
    if (params.subagent_type && params.subagent_type !== plan.agentType) this.pi.events.emit('pstack:subagent-type-normalized', { requested: params.subagent_type, resolved: plan.agentType });
    const selected = found.activeAgents.find((agent) => agent.agentType === plan.agentType);
    if (!selected) throw new Error(`Agent type '${plan.agentType}' not found.`);
    const definition = withMaxTurns(selected, params.max_turns);
    checkOptionPortability(definition, (message) => this.pi.events.emit('pstack:subagent-log', message));
    const available = ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`);
    const choice = chooseChildModel({ ...(plan.model !== undefined ? { toolModel: plan.model } : {}), ...(definition.model !== undefined ? { definitionModel: definition.model } : {}), fork: false, env: this.env, available });
    if (choice.ignoredOverride) this.pi.events.emit('pstack:subagent-log', `"${choice.ignoredOverride}" ignored: CLAUDE_CODE_SUBAGENT_MODEL_FORCE is set`);
    if (choice.steppedFrom || choice.dropped)
      this.pi.events.emit('pstack:subagent-model-resolve', {
        requested: choice.steppedFrom ?? choice.dropped,
        resolved: choice.request ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined),
        steppedFamily: Boolean(choice.steppedFrom),
        droppedOverride: Boolean(choice.dropped),
      });
    return { plan, definition, model: choice.request, background: plan.background || definition.background === true };
  }

  private async isolate(admitted: Admitted, ctx: ExtensionContext): Promise<{ cwd?: string; worktree?: AgentWorktree; outcome: () => WorktreeOutcome | undefined; settle?: () => Promise<Partial<TaskRecord>> }> {
    const requested = admitted.plan.isolation ?? admitted.definition.isolation;
    const wantsWorktree = requested === 'worktree' || (requested === 'remote' && (await repositoryRoot(ctx.cwd)) !== undefined);
    if (!wantsWorktree) return { outcome: () => undefined };
    const id = randomUUID().slice(0, 8);
    const worktree = await createWorktree(ctx.cwd, id);
    let outcome: WorktreeOutcome | undefined;
    return {
      cwd: worktree.path,
      worktree,
      outcome: () => outcome,
      settle: async () => {
        outcome ??= await finalizeWorktree(worktree);
        return outcome.kept ? { worktreeCleanlyRemoved: false, worktreePath: outcome.path, worktreeBranch: outcome.branch } : { worktreeCleanlyRemoved: true };
      },
    };
  }

  async launch(callId: string, params: AgentParams, signal: AbortSignal | undefined, onUpdate: Update, ctx: ExtensionContext): Promise<AgentToolResult<AgentResult>> {
    const admitted = this.admit(params, ctx);
    signal = launchSignal(signal, admitted.background);
    const release = this.slots.reserve();
    try {
      return await this.dispatch(callId, admitted, signal, onUpdate, ctx, release);
    } finally {
      release();
    }
  }

  private async dispatch(callId: string, admitted: Admitted, signal: AbortSignal | undefined, onUpdate: Update, ctx: ExtensionContext, release: () => void): Promise<AgentToolResult<AgentResult>> {
    const { plan, definition, model, background } = admitted;
    const isolation = await this.isolate(admitted, ctx);
    const prompt = plan.prompt;
    const taskParams = { prompt, ...(model ? { model } : {}), ...(isolation.cwd ? { cwd: isolation.cwd } : {}), ...(background ? {} : { run_in_background: false }) };
    const launch = {
      definition,
      description: plan.description,
      depth: plan.depth,
      ...(plan.name ? { name: plan.name } : {}),
      onStarted: () => {
        release();
        this.spawned += 1;
        this.stats.spawn(plan.depth);
        this.publishStats();
      },
      ...(isolation.worktree ? { worktree: isolation.worktree } : {}),
      onSettled: async (record: TaskRecord) => {
        if (record.status !== 'running') this.stats.settle(record.status, record.abort?.telemetry);
        this.publishStats();
        if (isolation.worktree && this.runtime.keepsAlive(record.id)) return { worktreeCleanlyRemoved: false, worktreePath: isolation.worktree.path, worktreeBranch: isolation.worktree.branch };
        return (await isolation.settle?.()) ?? {};
      },
    };
    const started = await this.runtime.start(callId, taskParams, signal, ctx, onUpdate, launch).catch(async (error) => {
      await isolation.settle?.().catch(() => undefined);
      throw error;
    });
    const record = started.details;
    const kept = isolation.outcome();
    const worktree = kept?.kept ? { worktreePath: kept.path, worktreeBranch: kept.branch } : {};
    const requestedIsolation = plan.isolation ?? definition.isolation;
    const isolationResult = requestedIsolation ? { requestedIsolation, effectiveIsolation: isolation.cwd ? ('worktree' as const) : ('local' as const) } : {};
    const result = background
      ? asyncLaunched(record, plan, isolationResult)
      : completed({ ...record, output: await readFile(record.outputFile, 'utf8'), ...(started.usage ? { usage: started.usage } : {}) }, plan, { ...worktree, ...isolationResult });
    return { ...wrap(result, resultText(result)), ...(started.usage ? { usage: started.usage } : {}) };
  }
}

function registerAgent(pi: ExtensionAPI, launcher: AgentLauncher, env: NodeJS.ProcessEnv): void {
  pi.registerTool({
    name: 'Agent',
    label: 'Agent',
    description: agentGuidance,
    promptSnippet: 'Launch a new agent',
    parameters: buildAgentSchema({ addressable: true, forceModel: Boolean(env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE ?? env.PI_SUBAGENT_MODEL_FORCE) }),
    outputSchema: AgentResultSchema,
    exposure: 'direct',
    executionMode: 'parallel',
    annotations: { openWorldHint: true },
    execute: (id, params, signal, onUpdate, ctx) => launcher.launch(id, params as AgentParams, signal, onUpdate as Update, ctx),
  });
}

function registerSendMessage(pi: ExtensionAPI, runtime: WorkerRuntime, launcher: AgentLauncher): void {
  pi.registerTool({
    name: 'SendMessage',
    label: 'Send message',
    description: 'Send a message to a running agent, or resume a finished agent by ID or name.',
    promptSnippet: 'Message or resume an agent by ID or name',
    parameters: SendMessageSchema,
    outputSchema: Type.Object({ success: Type.Boolean(), message: Type.String() }),
    exposure: 'direct',
    annotations: { openWorldHint: false },
    executionMode: 'parallel',
    execute: async (id, params, signal, _onUpdate, ctx) => {
      const record = runtime.find(params.to);
      if (!record) throw new Error(`No agent found with ID or name: ${params.to}`);
      const { success, message } = await launcher.continue({ callId: id, record, message: params.message, userInitiated: false, signal }, ctx);
      return wrap({ success, message }, message);
    },
  });
}

function registerListAgents(pi: ExtensionAPI, runtime: WorkerRuntime): void {
  pi.registerTool({
    name: 'ListAgents',
    label: 'List agents',
    description: 'List agents launched in this session with their status.',
    promptSnippet: 'List launched agents',
    parameters: ListAgentsSchema,
    outputSchema: Type.Object({ agents: Type.Array(Type.Object({ agentId: Type.String(), name: Type.Optional(Type.String()), agentType: Type.String(), status: Type.String(), description: Type.Optional(Type.String()) })) }),
    exposure: 'direct',
    annotations: { readOnlyHint: true },
    executionMode: 'parallel',
    execute: async () => {
      const agents = runtime
        .list()
        .map((record) => ({ agentId: record.id, ...(record.agentName ? { name: record.agentName } : {}), agentType: record.persona, status: record.status, ...(record.description ? { description: record.description } : {}) }));
      return wrap({ agents }, JSON.stringify({ agents }));
    },
  });
}

export function registerAgentTools(pi: ExtensionAPI, runtime: WorkerRuntime, env: NodeJS.ProcessEnv = process.env): SubagentStats {
  const launcher = new AgentLauncher(runtime, env, pi);
  const offers = new ToolOfferScope(pi);
  pi.on('agent_end', () => offers.restore());
  pi.on('session_tree', () => offers.restore());
  pi.on('before_agent_start', (_event, ctx) => {
    offers.restore();
    if (env.CLAUDE_CODE_SIMPLE) {
      offers.mask((names) => names.filter((name) => name === 'read'));
      return;
    }
    if (runtime.depth >= runtime.maximumDepth(ctx, env)) {
      offers.mask((names) => names.filter((name) => name !== 'Agent' && name !== 'Task'));
      return;
    }
    const allowed = runtime.allowedAgentTypes;
    if (allowed !== undefined && !allowed.includes('general-purpose')) offers.mask((names) => names.filter((name) => name !== 'Agent'));
  });
  registerAgent(pi, launcher, env);
  registerSendMessage(pi, runtime, launcher);
  registerResumeCommand(pi, runtime, (request, ctx) => launcher.continue(request, ctx));
  registerListAgents(pi, runtime);
  return launcher.stats;
}
