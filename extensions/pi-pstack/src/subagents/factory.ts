import { randomUUID } from 'node:crypto';

import type { Model } from '@earendil-works/pi-ai';
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from '@earendil-works/pi-coding-agent';
import type { AgentDefinition } from './agent-definition.ts';
import type { AgentNode } from './agent-node.ts';
import { personaTaskAgents } from '../persona-agents.ts';
import { type AgentGates, offeredAgents, type RegistryInputs, resolveAgentType } from './agent-registry.ts';
import type { ChildContextEntry } from './child-session.ts';
import { parsePatterns } from './content-exclusion.ts';
import { buildChildPlan, type ChildLimits, type ChildPlan } from './context-builder.ts';
import { DiscoveryCache } from './custom-discovery.ts';
import { gatherEnvironment, systemProbe } from './environment-facts.ts';
import { featureEnabled, rubberDuckRollout, subconsciousEnabled } from './feature-flags.ts';
import { type HostEffect, runHostEffect, type SubagentHost } from './host-effects.ts';
import type { LimiterProvider } from './limiter-provider.ts';
import type { ParentServer } from './mcp-inheritance.ts';
import { gatherParentServers, serversForChild } from './mcp-inheritance.ts';
import { type ModelOption, type ModelSelection, selectModel } from './model-selection.ts';
import type { Launched, SubagentScheduler } from './scheduler.ts';
import type { ContextTier, EffortLevel, ModelPolicy, ReferenceSettings } from './settings.ts';
import type { SettingsStore } from './settings-store.ts';
import { parseSubagentHooks, runHooks } from './subagent-hooks.ts';
import { planTools, zeroToolsMessage } from './tool-mapping.ts';
import { rewindingStartMessage } from './tool-results.ts';

export type TaskCall = Readonly<{
  agent_type: string;
  name: string;
  description: string;
  prompt: string;
  mode?: 'sync' | 'background';
  model?: string;
  modelPolicy?: ModelPolicy;
  effortLevel?: EffortLevel;
  context_tier?: ContextTier;
}>;
export type Created = Readonly<{ launched: Launched; node: AgentNode }>;
export type CreateExtras = Readonly<{ limits?: ChildLimits; workflowRunId?: string; definition?: AgentDefinition }>;
export type FactoryDeps = Readonly<{
  scope: () => ChildContextEntry | undefined;
  pi: ExtensionAPI;
  scheduler: SubagentScheduler;
  settings: SettingsStore;
  env: NodeJS.ProcessEnv;
  log: (message: string) => void;
  discovery?: DiscoveryCache;
  limiters: LimiterProvider;
}>;

const toolNames = { grep: 'grep', glob: 'find', shell: 'bash', view: 'read' };
const writeTools = ['edit', 'write'];

export function modelOption(model: Model<never> | Pick<Model<never>, 'provider' | 'id' | 'cost' | 'contextWindow'>): ModelOption {
  return { reference: `${model.provider}/${model.id}`, provider: model.provider, id: model.id, cost: model.cost.input + model.cost.output, contextWindow: model.contextWindow };
}

/** Turns an agent type and a prompt into a running child: gates, type, limits, model, plan, then the scheduler launches it. */
export class SubagentFactory {
  private readonly deps: FactoryDeps;
  private readonly rootAgentId = randomUUID();
  private readonly discovery: DiscoveryCache;
  private offeredCache: readonly AgentDefinition[] | undefined;

  constructor(deps: FactoryDeps) {
    this.deps = deps;
    this.discovery = deps.discovery ?? new DiscoveryCache();
  }

  get scheduler() {
    return this.deps.scheduler;
  }

  isChild(): boolean {
    return this.deps.scope() !== undefined;
  }

  clearDiscovery(): void {
    this.discovery.clear();
  }

  resetLimiters(): void {
    this.deps.limiters.reset();
  }

  gates(settings: ReferenceSettings): AgentGates {
    return { rubberDuck: settings.builtInAgents.rubberDuck || rubberDuckRollout(this.deps.env), subconscious: subconsciousEnabled(this.deps.env) };
  }

  registryInputs(ctx: ExtensionContext, settings: ReferenceSettings): RegistryInputs {
    const found = this.discovery.get({ cwd: ctx.cwd, agentDir: getAgentDir() });
    for (const message of found.diagnostics) this.deps.log(message);
    return {
      custom: [...personaTaskAgents(), ...found.agents],
      policy: {},
      disabled: settings.subagents.disabledSubagents,
      gates: this.gates(settings),
    };
  }

  offered(ctx: ExtensionContext): readonly AgentDefinition[] {
    if (this.offeredCache) return this.offeredCache;
    const { settings } = this.deps.settings.read();
    this.offeredCache = offeredAgents(this.registryInputs(ctx, settings));
    return this.offeredCache;
  }

  /** The invalidateAgentToolConfig creation effect: the offered surface and the rubber-duck gate are recomputed after it. */
  invalidateToolConfig(): void {
    this.offeredCache = undefined;
    this.clearDiscovery();
  }

  /** The tools a child may take from its parent. A definition the host supplies, such as a sidekick's, grants the tools it names. */
  private grantedTools(definition: AgentDefinition | undefined): readonly string[] {
    const active = this.deps.pi.getActiveTools();
    return definition?.tools.kind === 'named' ? [...active, ...definition.tools.names] : active;
  }

  /** A child writes only while the parent still has a write tool active, so a parent in plan mode keeps its children read-only. */
  private parentCanWrite(): boolean {
    const active = this.deps.pi.getActiveTools();
    return writeTools.some((name) => active.includes(name));
  }

  host(ctx: ExtensionContext, settings: ReferenceSettings): SubagentHost {
    const inputs = this.registryInputs(ctx, settings);
    return {
      blocksStart: () => this.deps.scheduler.blocksStart(),
      toolsAvailable: () => this.deps.pi.getActiveTools().length > 0,
      selectedModel: () => (ctx.model ? modelOption(ctx.model) : undefined),
      rubberDuckRollout: () => this.gates(settings).rubberDuck,
      subconscious: () => this.gates(settings).subconscious,
      availableCustomAgents: () => inputs.custom.map((agent) => agent.name),
      customPrompt: (name) => inputs.custom.find((agent) => agent.name === name)?.prompt,
      hasActiveBackgroundWork: () => this.deps.scheduler.hasActiveWork(),
      transformSection: (_section, text) => text,
    };
  }

  private effect(host: SubagentHost, action: string): void {
    const request: HostEffect = { kind: 'start_subagent', action };
    runHostEffect(host, request);
  }

  async create(call: TaskCall, toolCallId: string, signal: AbortSignal | undefined, ctx: ExtensionContext, extras: CreateExtras = {}): Promise<Created> {
    if (this.deps.scheduler.blocksStart()) throw new Error(rewindingStartMessage);
    const { settings, raw } = this.deps.settings.read();
    const host = this.host(ctx, settings);
    for (const action of ['checkStartAllowed', 'prepareTools']) this.effect(host, action);
    const inputs = this.registryInputs(ctx, settings);
    const resolved = extras.definition ? { ok: true as const, agent: extras.definition } : resolveAgentType(call.agent_type, inputs);
    if (!resolved.ok) throw new Error(resolved.message);
    const scope = this.deps.scope();
    const depth = scope?.depth ?? 0;
    const gathered = gatherParentServers(this.deps.pi);
    const inheritedServers = this.deps.scheduler.blocksStart() ? [] : serversForChild(gathered, resolved.agent);
    const lease = this.deps.limiters.get().tryAcquire({ kind: 'spawn', depth });
    if (!lease.ok) throw new Error(lease.message);
    try {
      const plan = await this.plan({
        call,
        definition: resolved.agent,
        settings,
        raw,
        ctx,
        depth,
        parentAgentId: scope?.agentId ?? this.rootAgentId,
        parentRegistryId: scope?.registryId,
        rootSessionId: scope?.rootSessionId ?? ctx.sessionManager.getSessionId(),
        extras,
      });
      const launched = await this.launch(plan, { call, ctx, signal, toolCallId, depth, scope, settings, raw, extras, inheritedServers, lease });
      return { launched, node: this.deps.scheduler.get(launched.id) };
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  private async launch(
    plan: ChildPlan,
    input: Readonly<{
      call: TaskCall;
      ctx: ExtensionContext;
      signal: AbortSignal | undefined;
      toolCallId: string;
      depth: number;
      scope: { agentId?: string; registryId?: string } | undefined;
      settings: ReferenceSettings;
      raw: unknown;
      extras: CreateExtras;
      inheritedServers: readonly ParentServer[];
      lease: { release: () => void };
    }>,
  ): Promise<Launched> {
    const launched = await this.deps.scheduler.launch({
      plan,
      ctx: input.ctx,
      signal: input.signal,
      toolCallId: input.toolCallId,
      description: input.call.description,
      name: input.call.name,
      depth: input.depth + 1,
      parentAgentId: input.scope?.agentId ?? this.rootAgentId,
      parentTools: this.grantedTools(input.extras.definition),
      contextManagement: input.settings.subagents.contextManagementTools,
      release: input.lease.release,
      ...(input.extras.workflowRunId !== undefined ? { workflowRunId: input.extras.workflowRunId } : {}),
      inheritedServers: input.inheritedServers,
      exclusionPatterns: parsePatterns(input.raw),
      aggressiveTools: featureEnabled(this.deps.env, 'copilot_cli_task_subagent_aggressive_tool_deferral'),
    });
    return launched;
  }

  private choose(call: TaskCall, definition: AgentDefinition, settings: ReferenceSettings, ctx: ExtensionContext): ModelSelection {
    if (!ctx.model) throw new Error('No parent model is selected. Select a Pi model before starting a subagent.');
    const result = selectModel({
      agent: definition,
      ...(call.model !== undefined ? { taskModel: call.model } : {}),
      ...(call.modelPolicy !== undefined ? { taskModelPolicy: call.modelPolicy } : {}),
      ...(call.effortLevel !== undefined ? { taskEffortLevel: call.effortLevel } : {}),
      ...(call.context_tier !== undefined ? { taskContextTier: call.context_tier } : {}),
      ...(settings.subagents.agents[definition.name] ? { setting: settings.subagents.agents[definition.name] } : {}),
      session: modelOption(ctx.model),
      available: ctx.modelRegistry.getAvailable().map(modelOption),
    });
    if (!result.ok) throw new Error(result.message);
    if (result.selection.overrideReason === 'required_policy_replaced_request') this.deps.log('Required model enforcement replaced requested model');
    return result.selection;
  }

  private async startHooks(raw: unknown, agentId: string, definition: AgentDefinition, ctx: ExtensionContext, rootSessionId: string): Promise<string | undefined> {
    const report = await runHooks(parseSubagentHooks(raw).start, { agentId, agentType: definition.name, sessionId: rootSessionId, cwd: ctx.cwd, timestamp: new Date().toISOString() });
    for (const failure of report.failures) this.deps.log(`subagentStart hook failed: ${failure}`);
    return report.context || undefined;
  }

  private async plan(input: {
    call: TaskCall;
    definition: AgentDefinition;
    settings: ReferenceSettings;
    raw: unknown;
    ctx: ExtensionContext;
    depth: number;
    parentAgentId: string;
    parentRegistryId: string | undefined;
    rootSessionId: string;
    extras: CreateExtras;
  }): Promise<ChildPlan> {
    const { call, definition, settings, ctx } = input;
    const selection = this.choose(call, definition, settings, ctx);
    const tools = planTools({ definition, parentTools: this.grantedTools(input.extras.definition), available: this.deps.pi.getAllTools().map((tool) => tool.name), contextManagement: settings.subagents.contextManagementTools });
    const refusal = zeroToolsMessage(definition.name, tools);
    if (refusal) throw new Error(refusal);
    const agentId = randomUUID();
    const environment = await gatherEnvironment(
      ctx.cwd,
      systemProbe((command, args, options) => this.deps.pi.exec(command, args, options)),
    );
    const hookContext = await this.startHooks(input.raw, agentId, definition, ctx, input.rootSessionId);
    return buildChildPlan({
      definition,
      selection,
      settings,
      agentId,
      registryId: randomUUID(),
      ...(input.parentRegistryId !== undefined ? { parentRegistryId: input.parentRegistryId } : {}),
      parentAgentId: input.parentAgentId,
      rootSessionId: input.rootSessionId,
      cwd: ctx.cwd,
      prompt: call.prompt,
      mode: call.mode ?? 'sync',
      tools,
      toolNames,
      environment,
      now: new Date(),
      headless: call.mode === 'background' || !ctx.hasUI,
      ...(hookContext ? { hookContext } : {}),
      ...(input.extras.limits ? { limits: input.extras.limits } : {}),
      writeGate: () => this.parentCanWrite(),
    });
  }
}
