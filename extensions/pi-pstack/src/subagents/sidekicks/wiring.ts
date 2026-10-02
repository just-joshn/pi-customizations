import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { type AgentDefinition, builtInPromptParts, namedTools } from '../agent-definition.ts';
import type { Exec } from '../environment-facts.ts';
import type { EventLog } from '../events.ts';
import type { SubagentFactory } from '../factory.ts';
import type { SubagentScheduler } from '../scheduler.ts';
import { type LaunchFacts, SidekickManager } from './manager.ts';
import { loadSidekicks, type SidekickSpec } from './spec.ts';

export function sidekickDefinition(spec: SidekickSpec): AgentDefinition {
  return {
    name: spec.name,
    displayName: spec.name,
    description: spec.description,
    tools: namedTools(spec.tools),
    promptParts: { ...builtInPromptParts, includeOutputChannelInstructions: true, includeDynamicContextBoard: true },
    prompt: spec.prompt,
    userInvocable: false,
    disableModelInvocation: true,
    source: 'built-in',
    promptOverridable: true,
    disableable: false,
  };
}

export async function repositoryFacts(exec: Exec, cwd: string): Promise<LaunchFacts> {
  const result = await exec('git', ['remote', 'get-url', 'origin'], { cwd }).catch(() => undefined);
  return result?.code === 0 ? { 'git-repo': true, 'github-remote': result.stdout.includes('github.com') } : { 'git-repo': false, 'github-remote': false };
}

export type SidekickParts = Readonly<{ pi: ExtensionAPI; env: NodeJS.ProcessEnv; factory: SubagentFactory; scheduler: SubagentScheduler; events: EventLog; cwd: () => string; log: (message: string) => void }>;

export function createSidekickManager(parts: SidekickParts): SidekickManager {
  const { pi, scheduler, factory, events } = parts;
  const loaded = loadSidekicks();
  for (const error of loaded.errors) parts.log(error);
  return new SidekickManager(loaded.specs, parts.env, {
    launch: async (spec, text, ctx) => {
      const call = { agent_type: spec.name, name: spec.name, description: spec.description, prompt: text, mode: 'background' as const };
      return (await factory.create(call, `sidekick-${spec.name}`, undefined, ctx, { definition: sidekickDefinition(spec) })).node.id;
    },
    send: async (agentId, text, ctx) => {
      await scheduler.write(agentId, text, ctx);
    },
    cancel: async (agentId) => {
      await scheduler.cancel(agentId);
    },
    state: (agentId) => {
      const status = scheduler.list().find((node) => node.id === agentId)?.status;
      return status === 'running' || status === 'idle' ? status : undefined;
    },
    facts: () => repositoryFacts((command, args, options) => pi.exec(command, args, options), parts.cwd()),
    deliver: (spec, message, truncated) => {
      events.emit('system.notification', { kind: 'new_inbox_message', summary: `Sidekick ${spec.name} sent a message.`, sidekick: spec.name });
      const note = truncated ? `${message}\n[message cut at ${spec.inlineForwardMaxChars} characters]` : message;
      pi.sendMessage({ customType: 'sidekick_inbox', content: `Message from the ${spec.name} sidekick:\n${note}`, display: true, details: { sidekick: spec.name, truncated } }, { triggerTurn: false, deliverAs: 'nextTurn' });
    },
    log: parts.log,
  });
}
