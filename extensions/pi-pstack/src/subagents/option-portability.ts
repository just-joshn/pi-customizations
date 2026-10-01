import type { AgentDefinition } from './definitions.ts';

export function checkOptionPortability(definition: AgentDefinition, log: (message: string) => void): void {
  if (definition.observer || definition.observerMessage) throw new Error(`Agent '${definition.agentType}' requests observer behavior, which is unavailable in Pi. Remove observer and observerMessage to run this agent.`);
  if (definition.cacheTtl) log(`Agent '${definition.agentType}' cacheTtl '${definition.cacheTtl}' ignored: Pi child sessions have no per-agent cache TTL setting.`);
}
