import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { agentEntryType } from './subagents/agent-node.ts';
import { listAgentsTool, readAgentTool, taskTool, writeAgentTool } from './subagents/agent-tools.ts';
import { modelPreferencesBlock, subagentUsageBlock, taskToolDescription } from './subagents/delegation-guidance.ts';
import { type EventEnvelope, EventLog, eventChannel, eventEntryType } from './subagents/events.ts';
import { SubagentFactory } from './subagents/factory.ts';
import { LimiterProvider } from './subagents/limiter-provider.ts';
import { SubagentScheduler } from './subagents/scheduler.ts';
import { SettingsStore } from './subagents/settings-store.ts';
import { TaskRegistry } from './subagents/task-registry.ts';

export type SubagentSystem = Readonly<{ factory: SubagentFactory; scheduler: SubagentScheduler; settings: SettingsStore; registry: TaskRegistry; events: EventLog }>;

function persistTo(env: NodeJS.ProcessEnv, sessionId: () => string): (envelope: EventEnvelope) => void {
  const directory = env.COPILOT_EVENTS_LOG_DIRECTORY;
  if (!directory) return () => {};
  return (envelope) => {
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, `${sessionId()}.jsonl`), `${JSON.stringify(envelope)}\n`);
  };
}

export function createSubagentSystem(pi: ExtensionAPI, env: NodeJS.ProcessEnv): SubagentSystem {
  let sessionId = 'session';
  const log = (message: string) => pi.events.emit('pstack:subagent-log', message);
  const toFile = persistTo(env, () => sessionId);
  const events = new EventLog({
    emit: (envelope) => pi.events.emit(eventChannel, envelope),
    persist: (envelope) => {
      pi.appendEntry(eventEntryType, envelope);
      toFile(envelope);
    },
  });
  const registry = new TaskRegistry({ persist: (node) => pi.appendEntry(agentEntryType, structuredClone(node)) });
  const settings = new SettingsStore();
  const limiters = new LimiterProvider(settings);
  const scheduler = new SubagentScheduler({ pi, events, registry, limiter: (cwd) => limiters.get(cwd), log });
  const factory = new SubagentFactory({ pi, scheduler, settings, env, log, limiters });
  const refresh = (ctx: ExtensionContext) => {
    sessionId = ctx.sessionManager.getSessionId();
    pi.registerTool(taskTool(factory, scheduler, taskToolDescription(factory.offered(ctx))));
  };
  pi.on('session_start', (_event, ctx) => {
    limiters.reset();
    factory.clearDiscovery();
    scheduler.restore(ctx);
    refresh(ctx);
  });
  pi.on('resources_discover', () => factory.clearDiscovery());
  pi.on('session_tree', (_event, ctx) => scheduler.restore(ctx));
  pi.on('session_before_tree', () => scheduler.beginRewind());
  pi.on('session_shutdown', () => scheduler.shutdown());
  pi.on('before_agent_start', (event, ctx) => {
    const offered = factory.offered(ctx);
    const { settings: loaded } = settings.read(ctx.cwd);
    event.systemPromptOptions.sections.subagent_usage = subagentUsageBlock({
      rubberDuck: offered.some((agent) => agent.name === 'rubber-duck') && loaded.builtInAgents.rubberDuckAutoInvoke,
      securityReview: offered.some((agent) => agent.name === 'security-review'),
    });
    const preferences = modelPreferencesBlock(loaded.subagents.agents);
    if (preferences) event.systemPromptOptions.sections.subagent_model_preferences = preferences;
    else delete event.systemPromptOptions.sections.subagent_model_preferences;
  });
  return { factory, scheduler, settings, registry, events };
}

export function registerSubagents(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): SubagentSystem {
  const system = createSubagentSystem(pi, env);
  pi.registerTool(taskTool(system.factory, system.scheduler, taskToolDescription([])));
  pi.registerTool(readAgentTool(system.scheduler));
  pi.registerTool(writeAgentTool(system.scheduler));
  pi.registerTool(listAgentsTool(system.scheduler));
  return system;
}
