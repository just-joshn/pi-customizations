import { randomUUID } from 'node:crypto';

import type { JsonValue } from '@earendil-works/pi-ai';
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { TaskRecord } from '../worker-records.ts';
import type { WorkerRuntime } from '../worker-runtime.ts';
import type { AgentLaunch } from '../worker-support.ts';
import { decideAdmission } from './admission.ts';
import { type AgentDefinition, discoverAgents } from './definitions.ts';
import { concurrencyCap, depthCap, sessionSpawnCap } from './limits.ts';
import { chooseChildModel } from './models.ts';
import { type AgentResult, AgentResultSchema, asyncLaunched, completed, resultText } from './results.ts';
import { buildAgentSchema, ListAgentsSchema, SendMessageSchema } from './schema.ts';
import { SubagentStats } from './stats.ts';
import type { AdmissionSnapshot, LaunchPlan, SpawnRequest } from './types.ts';
import { createWorktree, finalizeWorktree, repositoryRoot, type WorktreeOutcome } from './worktree.ts';

type AgentParams = { description: string; prompt: string; subagent_type?: string; model?: string; run_in_background?: boolean; isolation?: 'worktree' | 'remote' };
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
  };
}

function wrap<T>(details: T, text: string): AgentToolResult<T> {
  return { content: [{ type: 'text', text }], details, structuredContent: details as unknown as JsonValue };
}

class AgentLauncher {
  readonly stats = new SubagentStats();
  private spawned = 0;

  constructor(
    private readonly runtime: WorkerRuntime,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  private snapshot(ctx: ExtensionContext, agents: AdmissionSnapshot['agents']): AdmissionSnapshot {
    const sessionCap = sessionSpawnCap(this.env);
    return {
      agents,
      forkAvailable: false,
      depth: this.runtime.depth,
      depthCap: depthCap(this.env),
      running: this.runtime.runningCount(),
      concurrencyCap: concurrencyCap(this.env),
      concurrencyBypass: false,
      ...(sessionCap !== undefined ? { sessionSpawnCap: sessionCap } : {}),
      spawnedThisSession: this.spawned,
      spentUsd: 0,
      hasProject: Boolean(ctx.cwd),
      stopPending: false,
    };
  }

  admit(params: AgentParams, ctx: ExtensionContext): Admitted {
    const found = discoverAgents({ root: ctx.cwd, env: this.env });
    const decision = decideAdmission(this.snapshot(ctx, found.activeAgents), toRequest(params));
    if (!decision.ok) {
      if (decision.counter) this.stats.refuse(decision.counter);
      throw new Error(decision.refusal.message);
    }
    const { plan } = decision;
    const definition = found.activeAgents.find((agent) => agent.agentType === plan.agentType);
    if (!definition) throw new Error(`Agent type '${plan.agentType}' not found.`);
    const available = ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`);
    const choice = chooseChildModel({ ...(plan.model !== undefined ? { toolModel: plan.model } : {}), ...(definition.model !== undefined ? { definitionModel: definition.model } : {}), fork: false, env: this.env, available });
    return { plan, definition, model: choice.request, background: plan.background || definition.background === true };
  }

  private async isolate(admitted: Admitted, ctx: ExtensionContext): Promise<{ cwd?: string; outcome: () => WorktreeOutcome | undefined; settle?: () => Promise<void> }> {
    const requested = admitted.plan.isolation ?? admitted.definition.isolation;
    const wantsWorktree = requested === 'worktree' || (requested === 'remote' && (await repositoryRoot(ctx.cwd)) !== undefined);
    if (!wantsWorktree) return { outcome: () => undefined };
    const id = randomUUID().slice(0, 8);
    const worktree = await createWorktree(ctx.cwd, id);
    let outcome: WorktreeOutcome | undefined;
    return {
      cwd: worktree.path,
      outcome: () => outcome,
      settle: async () => {
        outcome = await finalizeWorktree(worktree);
      },
    };
  }

  async launch(callId: string, params: AgentParams, signal: AbortSignal | undefined, onUpdate: Update, ctx: ExtensionContext): Promise<AgentToolResult<AgentResult>> {
    const admitted = this.admit(params, ctx);
    const { plan, definition, model, background } = admitted;
    const isolation = await this.isolate(admitted, ctx);
    this.spawned += 1;
    this.stats.spawn(plan.depth);
    const taskParams = { prompt: plan.prompt, ...(model ? { model } : {}), ...(isolation.cwd ? { cwd: isolation.cwd } : {}), ...(background ? {} : { run_in_background: false }) };
    const launch = { definition, description: plan.description, depth: plan.depth, ...(isolation.settle ? { onSettled: isolation.settle } : {}) };
    const started = await this.runtime.start(callId, taskParams, signal, ctx, onUpdate, launch).catch(async (error) => {
      await isolation.settle?.().catch(() => undefined);
      throw error;
    });
    const record = started.details;
    if (!background) this.stats.settle(record.status === 'running' ? 'settled' : record.status);
    const kept = isolation.outcome();
    const worktree = kept?.kept ? { worktreePath: kept.path, worktreeBranch: kept.branch } : {};
    const result = background ? asyncLaunched(record, plan) : completed({ ...record, ...(started.usage ? { usage: started.usage } : {}) }, plan, worktree);
    return { ...wrap(result, resultText(result)), ...(started.usage ? { usage: started.usage } : {}) };
  }
}

function registerAgent(pi: ExtensionAPI, launcher: AgentLauncher, env: NodeJS.ProcessEnv): void {
  pi.registerTool({
    name: 'Agent',
    label: 'Agent',
    description: 'Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.',
    promptSnippet: 'Launch a new agent',
    parameters: buildAgentSchema({ forceModel: Boolean(env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE ?? env.PI_SUBAGENT_MODEL_FORCE) }),
    outputSchema: AgentResultSchema,
    exposure: 'direct',
    executionMode: 'parallel',
    annotations: { openWorldHint: true },
    execute: (id, params, signal, onUpdate, ctx) => launcher.launch(id, params as AgentParams, signal, onUpdate as Update, ctx),
  });
}

function resumeLaunch(record: TaskRecord, ctx: ExtensionContext, env: NodeJS.ProcessEnv): AgentLaunch | undefined {
  const definition = discoverAgents({ root: ctx.cwd, env }).activeAgents.find((agent) => agent.agentType === record.persona);
  return definition ? { definition, description: record.description ?? '', depth: record.depth ?? 1 } : undefined;
}

function registerSendMessage(pi: ExtensionAPI, runtime: WorkerRuntime, env: NodeJS.ProcessEnv): void {
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
      const live = record.status === 'running';
      if (live) await runtime.message(record.id, params.message, 'followUp');
      else await runtime.start(id, { prompt: params.message, resume: record.id }, signal, ctx, undefined, resumeLaunch(record, ctx, env));
      const details = { success: true, message: live ? `Message queued for ${record.id}` : `Agent ${record.id} resumed in the background` };
      return wrap(details, details.message);
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
  const launcher = new AgentLauncher(runtime, env);
  if (runtime.depth >= depthCap(env)) return launcher.stats;
  registerAgent(pi, launcher, env);
  registerSendMessage(pi, runtime, env);
  registerListAgents(pi, runtime);
  return launcher.stats;
}
