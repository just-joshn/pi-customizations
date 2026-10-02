import { randomUUID } from 'node:crypto';

import type { Model } from '@earendil-works/pi-ai';
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from '@earendil-works/pi-coding-agent';
import type { AgentDefinition } from './agent-definition.ts';
import type { AgentNode } from './agent-node.ts';
import { type AgentGates, offeredAgents, type RegistryInputs, resolveAgentType } from './agent-registry.ts';
import { buildChildPlan, type ChildPlan } from './context-builder.ts';
import { DiscoveryCache } from './custom-discovery.ts';
import { gatherEnvironment } from './environment-facts.ts';
import { rubberDuckRollout, subconsciousEnabled } from './feature-flags.ts';
import { type HostEffect, runHostEffect, type SubagentHost } from './host-effects.ts';
import type { LimiterProvider } from './limiter-provider.ts';
import { type ModelOption, type ModelSelection, selectModel } from './model-selection.ts';
import type { Launched, SubagentScheduler } from './scheduler.ts';
import type { ContextTier, CopilotSettings } from './settings.ts';
import type { SettingsStore } from './settings-store.ts';
import { currentScope } from './subagent-context.ts';
import { parseSubagentHooks, runHooks } from './subagent-hooks.ts';
import { planTools, zeroToolsMessage } from './tool-mapping.ts';
import { rewindingStartMessage } from './tool-results.ts';

export type TaskCall = Readonly<{ agent_type: string; name: string; description: string; prompt: string; mode?: 'sync' | 'background'; model?: string; context_tier?: ContextTier }>;
export type Created = Readonly<{ launched: Launched; node: AgentNode }>;
export type FactoryDeps = Readonly<{ pi: ExtensionAPI; scheduler: SubagentScheduler; settings: SettingsStore; env: NodeJS.ProcessEnv; log: (message: string) => void; discovery?: DiscoveryCache; limiters: LimiterProvider }>;

const toolNames = { grep: 'grep', glob: 'find', shell: 'bash', view: 'read' };

export function modelOption(model: Model<never> | Pick<Model<never>, 'provider' | 'id' | 'cost' | 'contextWindow'>): ModelOption {
  return { reference: `${model.provider}/${model.id}`, provider: model.provider, id: model.id, cost: model.cost.input + model.cost.output, contextWindow: model.contextWindow };
}

/** Turns an agent type and a prompt into a running child: gates, type, limits, model, plan, then the scheduler launches it. */
export class SubagentFactory {
  private readonly rootAgentId = randomUUID();
  private readonly discovery: DiscoveryCache;

  constructor(private readonly deps: FactoryDeps) {
    this.discovery = deps.discovery ?? new DiscoveryCache();
  }

  clearDiscovery(): void {
    this.discovery.clear();
  }

  gates(settings: CopilotSettings): AgentGates {
    return { rubberDuck: settings.builtInAgents.rubberDuck || rubberDuckRollout(this.deps.env), subconscious: subconsciousEnabled(this.deps.env) };
  }

  registryInputs(ctx: ExtensionContext, settings: CopilotSettings): RegistryInputs {
    const found = this.discovery.get({ cwd: ctx.cwd, agentDir: getAgentDir() });
    for (const message of found.diagnostics) this.deps.log(message);
    return { custom: found.agents, policy: {}, disabled: settings.subagents.disabledSubagents, gates: this.gates(settings) };
  }

  offered(ctx: ExtensionContext): readonly AgentDefinition[] {
    const { settings } = this.deps.settings.read(ctx.cwd);
    return offeredAgents(this.registryInputs(ctx, settings));
  }

  host(ctx: ExtensionContext, settings: CopilotSettings): SubagentHost {
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

  async create(call: TaskCall, toolCallId: string, signal: AbortSignal | undefined, ctx: ExtensionContext): Promise<Created> {
    if (this.deps.scheduler.blocksStart()) throw new Error(rewindingStartMessage);
    const { settings, raw } = this.deps.settings.read(ctx.cwd);
    const host = this.host(ctx, settings);
    for (const action of ['checkStartAllowed', 'prepareTools']) this.effect(host, action);
    const inputs = this.registryInputs(ctx, settings);
    const resolved = resolveAgentType(call.agent_type, inputs);
    if (!resolved.ok) throw new Error(resolved.message);
    const scope = currentScope();
    const depth = scope?.depth ?? 0;
    const lease = this.deps.limiters.get(ctx.cwd).tryAcquire({ kind: 'spawn', depth });
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
      });
      const launched = await this.deps.scheduler.launch({
        plan,
        ctx,
        signal,
        toolCallId,
        description: call.description,
        name: call.name,
        depth: depth + 1,
        parentAgentId: scope?.agentId ?? this.rootAgentId,
        parentTools: this.deps.pi.getActiveTools(),
        contextManagement: settings.subagents.contextManagementTools,
        release: lease.release,
      });
      const node = this.deps.scheduler.get(launched.id);
      return { launched, node };
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  private choose(call: TaskCall, definition: AgentDefinition, settings: CopilotSettings, ctx: ExtensionContext): ModelSelection {
    if (!ctx.model) throw new Error('No parent model is selected. Select a Pi model before starting a subagent.');
    const result = selectModel({
      agent: definition,
      ...(call.model !== undefined ? { taskModel: call.model } : {}),
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
    settings: CopilotSettings;
    raw: unknown;
    ctx: ExtensionContext;
    depth: number;
    parentAgentId: string;
    parentRegistryId: string | undefined;
    rootSessionId: string;
  }): Promise<ChildPlan> {
    const { call, definition, settings, ctx } = input;
    const selection = this.choose(call, definition, settings, ctx);
    const tools = planTools({ definition, parentTools: this.deps.pi.getActiveTools(), available: this.deps.pi.getAllTools().map((tool) => tool.name), contextManagement: settings.subagents.contextManagementTools });
    const refusal = zeroToolsMessage(definition.name, tools);
    if (refusal) throw new Error(refusal);
    const agentId = randomUUID();
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
      environment: gatherEnvironment(ctx.cwd),
      now: new Date(),
      headless: call.mode === 'background' || !ctx.hasUI,
      ...(hookContext ? { hookContext } : {}),
    });
  }
}
