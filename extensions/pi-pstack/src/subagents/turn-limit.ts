import type { AgentSessionEventListener } from '@earendil-works/pi-coding-agent';
import type { AgentDefinition } from './definitions.ts';

export function withMaxTurns(definition: AgentDefinition, value: unknown): AgentDefinition {
  if (value === undefined) return definition;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error('max_turns must be a positive integer.');
  return { ...definition, maxTurns: value };
}

export function turnLimit(agentType: string, maxTurns: number, log: (message: string) => void, stop: () => void): AgentSessionEventListener {
  let turns = 0;
  let reached = false;
  return (event) => {
    if (event.type !== 'turn_end' || reached) return;
    turns += 1;
    if (turns < maxTurns || !event.toolResults?.length) return;
    reached = true;
    log(`[Agent: ${agentType}] Reached max turns limit (${maxTurns})`);
    stop();
  };
}
