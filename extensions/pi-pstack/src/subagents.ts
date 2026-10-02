import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { type ExtensionAPI, type ExtensionContext, getAgentDir } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import type { AgentNode } from './subagents/agent-node.ts';
import { agentEntryType } from './subagents/agent-node.ts';
import { AgentSelection } from './subagents/agent-selection.ts';
import { listAgentsTool, readAgentTool, taskTool, writeAgentTool } from './subagents/agent-tools.ts';
import { type ChildContextEntry, readChildContext } from './subagents/child-session.ts';
import { boardPath, contextBoardTool } from './subagents/context-board.ts';
import { modelPreferencesBlock, subagentUsageBlock, taskToolDescription } from './subagents/delegation-guidance.ts';
import { type EventEnvelope, EventLog, eventChannel, eventEntryType, eventsLogIncludesSubagents } from './subagents/events.ts';
import { SubagentFactory } from './subagents/factory.ts';
import { fileTrackingGate } from './subagents/file-tracking.ts';
import { sendInboxTool } from './subagents/inbox.ts';
import { LimiterProvider, parentLimiter } from './subagents/limiter-provider.ts';
import { launchRemOnShutdown } from './subagents/rem-launcher.ts';
import { SubagentRpc, serveRpc } from './subagents/rpc.ts';
import { SubagentScheduler } from './subagents/scheduler.ts';
import { SettingsStore } from './subagents/settings-store.ts';
import type { SidekickManager } from './subagents/sidekicks/manager.ts';
import { createSidekickManager } from './subagents/sidekicks/wiring.ts';
import { executionSubagent, type Specialized, searchSubagent, specializedEnabled, specializedTool } from './subagents/specialized-tools.ts';
import { fleetPrompt, registerSubagentCommands } from './subagents/subagent-commands.ts';
import { parseSubagentHooks, runHooks } from './subagents/subagent-hooks.ts';
import { TaskRegistry } from './subagents/task-registry.ts';
import { WorkflowRuntime, workflowsEnabled } from './subagents/workflows/runtime.ts';
import { workflowEntryType } from './subagents/workflows/store.ts';
import { workflowTools } from './subagents/workflows/tools.ts';

export type SubagentSystem = Readonly<{
  factory: SubagentFactory;
  scheduler: SubagentScheduler;
  settings: SettingsStore;
  registry: TaskRegistry;
  events: EventLog;
  selection: AgentSelection;
  rpc: SubagentRpc;
  sidekicks: SidekickManager;
  sidekickScheduler: SubagentScheduler;
  workflows: () => WorkflowRuntime;
}>;

const defaultWaitSeconds = 300;
const sidekickEntryType = 'copilot-sidekick';

function persistTo(env: NodeJS.ProcessEnv, sessionId: () => string): (envelope: EventEnvelope) => void {
  const directory = env.COPILOT_EVENTS_LOG_DIRECTORY;
  if (!directory) return () => {};
  return (envelope) => {
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, `${sessionId()}.jsonl`), `${JSON.stringify(envelope)}\n`);
  };
}

export function waitSeconds(env: NodeJS.ProcessEnv): number {
  const raw = env.COPILOT_TASK_WAIT_TIMEOUT_SECONDS;
  const parsed = raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : defaultWaitSeconds;
}

class Session {
  id = 'session';
  latest: ExtensionContext | undefined;
  child: ChildContextEntry | undefined;
  closed = false;
  fileTracking = false;

  begin(ctx: ExtensionContext, log: (message: string) => void): void {
    this.closed = false;
    this.id = ctx.sessionManager.getSessionId();
    this.latest = ctx;
    this.child = readChildContext(ctx.sessionManager.getEntries());
    const gate = fileTrackingGate(this.child?.depth ?? 0, Boolean(ctx.sessionManager.getSessionFile()));
    this.fileTracking = gate.enabled;
    if (gate.refusal) log(gate.refusal);
  }

  track(ctx: ExtensionContext): void {
    this.latest = ctx;
  }

  close(): void {
    this.closed = true;
    this.latest = undefined;
  }
}

const Declaration = Type.Object({ name: Type.String({ minLength: 1 }), description: Type.String({ minLength: 1 }), run: Type.Function([Type.Unknown(), Type.Unknown()], Type.Unknown()) });

type WorkflowStack = Readonly<{ pi: ExtensionAPI; env: NodeJS.ProcessEnv; factory: SubagentFactory; settings: SettingsStore; events: EventLog; session: Session; log: (message: string) => void }>;

function buildWorkflows(stack: WorkflowStack): WorkflowRuntime {
  const runtime = new WorkflowRuntime({
    pi: stack.pi,
    events: stack.events,
    factory: stack.factory,
    env: () => stack.env,
    settings: stack.settings,
    log: stack.log,
    persist: (change) => stack.pi.appendEntry(workflowEntryType, change),
  });
  stack.pi.events.on('copilot:register-workflow', (payload) => {
    if (!Check(Declaration, payload)) return;
    const declaration = { ...payload, run: async (context: unknown, args: unknown) => payload.run(context, args) };
    if (runtime.register(declaration) !== true) stack.log(`Workflow '${String((payload as { name?: unknown }).name)}' was dropped because dynamic workflows are disabled.`);
  });
  stack.pi.on('session_start', (_event, ctx) => runtime.restore(ctx.sessionManager.getBranch()));
  stack.pi.on('session_tree', (_event, ctx) => runtime.restore(ctx.sessionManager.getBranch()));
  stack.pi.on('session_shutdown', () => runtime.haltAll());
  return runtime;
}

type SidekickStack = Readonly<{ pi: ExtensionAPI; env: NodeJS.ProcessEnv; events: EventLog; settings: SettingsStore; limiters: LimiterProvider; session: Session; log: (message: string) => void; holder: { sidekicks?: SidekickManager } }>;

function buildSidekicks(stack: SidekickStack): { sidekicks: SidekickManager; sidekickScheduler: SubagentScheduler } {
  const { pi, env, events, settings, limiters, session, log, holder } = stack;
  const registry = new TaskRegistry({ persist: (node) => pi.appendEntry(sidekickEntryType, structuredClone(node)) });
  const scheduler = new SubagentScheduler({ pi, events, registry, limiter: () => limiters.get(), onInbox: (agentId, message) => holder.sidekicks?.inbox(agentId, message), entryType: sidekickEntryType, quiet: true, log });
  const factory = new SubagentFactory({ scope: () => session.child, pi, scheduler, settings, env, log, limiters });
  const sidekicks = createSidekickManager({ pi, env, factory, scheduler, events, cwd: () => session.latest?.cwd ?? process.cwd(), log });
  return { sidekicks, sidekickScheduler: scheduler };
}

function buildCore(pi: ExtensionAPI, env: NodeJS.ProcessEnv, session: Session): SubagentSystem {
  const log = (message: string) => {
    if (!session.closed) pi.events.emit('pstack:subagent-log', message);
  };
  const toFile = persistTo(env, () => session.id);
  const events = new EventLog({
    emit: (envelope) => pi.events.emit(eventChannel, envelope),
    persist: (envelope) => {
      pi.appendEntry(eventEntryType, envelope);
      toFile(envelope);
    },
  });
  const registry = new TaskRegistry({ persist: (node) => pi.appendEntry(agentEntryType, structuredClone(node)) });
  const settings = new SettingsStore(() => pi.getSettings());
  const limiters = new LimiterProvider(settings, () => (session.child ? parentLimiter(pi.events) : undefined));
  const onSettled = async (node: AgentNode) => {
    const hooks = parseSubagentHooks(settings.read().raw).stop;
    const report = await runHooks(hooks, { agentId: node.id, agentType: node.agentType, sessionId: session.id, cwd: node.cwd, timestamp: new Date().toISOString(), transcriptPath: node.sessionFile });
    for (const failure of report.failures) log(`subagentStop hook failed: ${failure}`);
  };
  const holder: { sidekicks?: SidekickManager } = {};
  const scheduler = new SubagentScheduler({ pi, events, registry, limiter: () => limiters.get(), onSettled, includeHookEvents: () => eventsLogIncludesSubagents(env), extraWork: () => holder.sidekicks?.hasActiveWork() ?? false, log });
  const factory = new SubagentFactory({ scope: () => session.child, pi, scheduler, settings, env, log, limiters });
  const { sidekicks, sidekickScheduler } = buildSidekicks({ pi, env, events, settings, limiters, session, log, holder });
  holder.sidekicks = sidekicks;
  const workflows = buildWorkflows({ pi, env, factory, settings, events, session, log });
  const selection = new AgentSelection(events);
  const rpc = new SubagentRpc({
    factory,
    scheduler,
    settings,
    registry,
    selection,
    workflows: () => workflows,
    context: () => session.latest,
    toolNames: () => pi.getAllTools().map((tool) => tool.name),
    startFleet: (goal) => pi.sendUserMessage(fleetPrompt(goal)),
    reload: () => factory.clearDiscovery(),
  });
  return { factory, scheduler, settings, registry, events, selection, rpc, sidekicks, sidekickScheduler, workflows: () => workflows };
}

function registerSidekickTriggers(pi: ExtensionAPI, system: SubagentSystem, factory: SubagentFactory, log: (message: string) => void): void {
  pi.on('input', (event, ctx) => {
    if (event.source === 'extension' || factory.isChild()) return;
    void system.sidekicks.trigger('user.message', event.text, ctx).catch((error: unknown) => log(`Sidekick trigger failed: ${String(error)}`));
  });
  pi.on('session_compact', (_event, ctx) => {
    if (factory.isChild()) return;
    void system.sidekicks.trigger('session.context_changed', 'The session context changed.', ctx).catch((error: unknown) => log(`Sidekick trigger failed: ${String(error)}`));
  });
  pi.on('model_select', () => {
    void system.sidekicks.cancelAll().catch((error: unknown) => log(`Sidekick cancel failed: ${String(error)}`));
  });
  pi.on('agent_end', (event) => {
    if (event.messages.findLast((message) => message.role === 'assistant')?.stopReason === 'aborted') void system.sidekicks.cancelAll().catch((error: unknown) => log(`Sidekick cancel failed: ${String(error)}`));
  });
}

function registerSettleWiring(pi: ExtensionAPI, env: NodeJS.ProcessEnv, scheduler: SubagentScheduler, log: (message: string) => void): void {
  pi.on('session_before_tree', () => scheduler.beginRewind());
  pi.on('agent_before_settle', async (_event, ctx) => {
    if (ctx.hasUI || !scheduler.hasActiveWork()) return;
    log('Run complete; waiting for background tasks to finish; exiting');
    await scheduler.waitForWork(waitSeconds(env) * 1000);
  });
}

function registerLifecycle(pi: ExtensionAPI, env: NodeJS.ProcessEnv, system: SubagentSystem, session: Session, limiters: () => void): void {
  const { factory, scheduler } = system;
  const log = (message: string) => {
    if (!session.closed) pi.events.emit('pstack:subagent-log', message);
  };
  pi.on('session_start', (_event, ctx) => {
    limiters();
    factory.invalidateToolConfig();
    scheduler.restore(ctx);
    system.sidekickScheduler.restore(ctx);
    session.begin(ctx, log);
    pi.registerTool(taskTool(factory, scheduler, taskToolDescription(factory.offered(ctx))));
  });
  pi.on('resources_discover', () => factory.clearDiscovery());
  pi.on('session_tree', (_event, ctx) => {
    session.track(ctx);
    scheduler.restore(ctx);
    system.sidekickScheduler.restore(ctx);
  });
  registerSidekickTriggers(pi, system, factory, log);
  registerSettleWiring(pi, env, scheduler, log);
  pi.on('tool_execution_start', (event) => {
    if (!session.fileTracking || event.parentToolCallId !== undefined) return;
    if ((event.toolName === 'edit' || event.toolName === 'write') && typeof (event.args as { path?: unknown } | undefined)?.path === 'string')
      pi.appendEntry('copilot-file-change', { path: (event.args as { path: string }).path, at: Date.now() });
  });
  pi.on('session_shutdown', async (_event, ctx) => {
    session.close();
    await system.sidekicks.cancelAll();
    await system.sidekickScheduler.shutdown();
    await scheduler.shutdown();
    launchRemOnShutdown({ env, cwd: ctx.cwd, boardFile: boardPath(getAgentDir(), ctx.cwd) });
  });
}

function registerPromptSections(pi: ExtensionAPI, system: SubagentSystem): void {
  const { factory, selection, settings } = system;
  pi.on('before_agent_start', (event, ctx) => {
    const offered = factory.offered(ctx);
    if (selection.refresh(offered)) pi.events.emit('pstack:subagent-log', 'The selected agent is no longer available and was cleared.');
    const { settings: loaded } = settings.read();
    const current = selection.getCurrent();
    if (current) event.systemPromptOptions.sections.selected_agent = current.prompt;
    else delete event.systemPromptOptions.sections.selected_agent;
    event.systemPromptOptions.sections.subagent_usage = subagentUsageBlock({
      rubberDuck: offered.some((agent) => agent.name === 'rubber-duck') && loaded.builtInAgents.rubberDuckAutoInvoke,
      securityReview: offered.some((agent) => agent.name === 'security-review'),
    });
    const preferences = modelPreferencesBlock(loaded.subagents.agents);
    if (preferences) event.systemPromptOptions.sections.subagent_model_preferences = preferences;
    else delete event.systemPromptOptions.sections.subagent_model_preferences;
  });
}

export function createSubagentSystem(pi: ExtensionAPI, env: NodeJS.ProcessEnv): SubagentSystem {
  const session = new Session();
  const system = buildCore(pi, env, session);
  serveRpc(pi, system.rpc);
  registerSubagentCommands(pi, { factory: system.factory, scheduler: system.scheduler, settings: system.settings, workflows: system.workflows });
  registerLifecycle(pi, env, system, session, () => system.factory.resetLimiters());
  registerPromptSections(pi, system);
  return system;
}

function isChildSession(system: SubagentSystem): boolean {
  return system.factory.isChild();
}

function registerSpecialized(pi: ExtensionAPI, system: SubagentSystem, env: NodeJS.ProcessEnv): void {
  const specs: readonly Specialized[] = [executionSubagent, searchSubagent];
  for (const spec of specs) if (specializedEnabled(env, spec)) pi.registerTool(specializedTool(spec, system.factory, env));
}

export function registerSubagents(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): SubagentSystem {
  const system = createSubagentSystem(pi, env);
  pi.registerTool(taskTool(system.factory, system.scheduler, taskToolDescription([])));
  pi.registerTool(readAgentTool(system.scheduler));
  pi.registerTool(writeAgentTool(system.scheduler));
  pi.registerTool(listAgentsTool(system.scheduler));
  pi.registerTool(
    contextBoardTool(
      (cwd) => boardPath(getAgentDir(), cwd),
      (ctx) => {
        if (!isChildSession(system)) void system.sidekicks.trigger('session.memory_changed', 'The context board changed.', ctx);
      },
    ),
  );
  pi.registerTool(
    sendInboxTool(
      (channel, data) => pi.events.emit(channel, data),
      () => isChildSession(system),
    ),
  );
  registerSpecialized(pi, system, env);
  if (workflowsEnabled(env)) for (const tool of workflowTools(system.workflows())) pi.registerTool(tool);
  return system;
}
