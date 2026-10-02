import type { AgentDefinition } from './agent-definition.ts';
import { builtInAgents } from './builtin-agents.ts';

export type BuiltinPolicy = Readonly<{ included?: readonly string[]; excluded?: readonly string[] }>;
export type AgentGates = Readonly<{ rubberDuck: boolean; subconscious: boolean }>;
export type RegistryInputs = Readonly<{ custom: readonly AgentDefinition[]; policy: BuiltinPolicy; disabled: readonly string[]; gates: AgentGates }>;
export type Resolution = Readonly<{ ok: true; agent: AgentDefinition }> | Readonly<{ ok: false; message: string }>;

const sourceRank: Readonly<Record<AgentDefinition['source'], number>> = { 'built-in': 0, organization: 1, plugin: 2, user: 3, project: 4, runtime: 5 };

function declared(custom: readonly AgentDefinition[]): ReadonlyMap<string, AgentDefinition> {
  const ordered = [...builtInAgents, ...custom.toSorted((left, right) => sourceRank[left.source] - sourceRank[right.source])];
  return new Map(ordered.map((agent) => [agent.name, agent]));
}

function gatedOff(agent: AgentDefinition, gates: AgentGates): boolean {
  return agent.source === 'built-in' && agent.gate !== undefined && !gates[agent.gate];
}

function policyRefusal(agent: AgentDefinition, policy: BuiltinPolicy): string | undefined {
  if (agent.source !== 'built-in') return undefined;
  if (policy.excluded?.includes(agent.name)) return `Subagent '${agent.name}' is excluded by this session's configuration.`;
  if (policy.included !== undefined && !policy.included.includes(agent.name)) return `Subagent '${agent.name}' is not included by this session's configuration.`;
  return undefined;
}

function isDisabled(agent: AgentDefinition, disabled: readonly string[]): boolean {
  return disabled.includes(agent.name) && (agent.source !== 'built-in' || agent.disableable);
}

function offered(agent: AgentDefinition, inputs: RegistryInputs): boolean {
  return !gatedOff(agent, inputs.gates) && policyRefusal(agent, inputs.policy) === undefined && !isDisabled(agent, inputs.disabled) && !agent.disableModelInvocation;
}

export function offeredAgents(inputs: RegistryInputs): readonly AgentDefinition[] {
  return [...declared(inputs.custom).values()].filter((agent) => offered(agent, inputs)).toSorted((left, right) => left.name.localeCompare(right.name));
}

export function resolveAgentType(requested: string, inputs: RegistryInputs): Resolution {
  const agent = declared(inputs.custom).get(requested);
  if (!agent || gatedOff(agent, inputs.gates)) {
    const valid = offeredAgents(inputs).map((candidate) => candidate.name);
    return { ok: false, message: `Unknown agent_type: ${requested}. Valid types are: ${valid.join(', ')}` };
  }
  const refusal = policyRefusal(agent, inputs.policy);
  if (refusal) return { ok: false, message: refusal };
  if (isDisabled(agent, inputs.disabled)) return { ok: false, message: `Subagent '${agent.name}' is disabled. Enable it in /subagents before dispatching it.` };
  if (agent.disableModelInvocation) return { ok: false, message: `Subagent '${agent.name}' cannot be invoked by the model. Ask the user to run it directly.` };
  return { ok: true, agent };
}

export function findAgent(name: string, custom: readonly AgentDefinition[]): AgentDefinition | undefined {
  return declared(custom).get(name);
}
