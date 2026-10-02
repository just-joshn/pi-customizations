import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { AgentDefinition } from './agent-definition.ts';
import type { ContextTier, Reference AssistantSettings, EffortLevel, ModelPolicy } from './settings.ts';

export type PreferenceCommand =
  | Readonly<{ kind: 'show' }>
  | Readonly<{ kind: 'model'; agent: string; model: string; policy: ModelPolicy }>
  | Readonly<{ kind: 'effort'; agent: string; level: EffortLevel }>
  | Readonly<{ kind: 'tier'; agent: string; tier: ContextTier }>
  | Readonly<{ kind: 'disable' | 'enable' | 'reset'; agent: string }>
  | Readonly<{ kind: 'rubber-duck'; enabled: boolean }>;
export type Parsed = PreferenceCommand | Readonly<{ error: string }>;

export const usage = [
  '/subagents                                     show the preferences',
  '/subagents model <type> <model> [required|preferred]',
  '/subagents effort <type> <low|medium|high|xhigh>',
  '/subagents tier <type> <inherit|default|long_context>',
  '/subagents disable <type> | enable <type> | reset <type>',
  '/subagents rubber-duck <on|off>',
].join('\n');

const efforts: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh'];
const tiers: readonly ContextTier[] = ['inherit', 'default', 'long_context'];
const policies: readonly ModelPolicy[] = ['preferred', 'required'];

function choose<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

export function parsePreferenceCommand(args: string): Parsed {
  const [action, agent, third, fourth] = args.trim().split(/\s+/);
  if (!action) return { kind: 'show' };
  if (action === 'rubber-duck') return third === undefined && (agent === 'on' || agent === 'off') ? { kind: 'rubber-duck', enabled: agent === 'on' } : { error: `Usage: /subagents rubber-duck <on|off>` };
  if (!agent) return { error: `Usage:\n${usage}` };
  if (action === 'disable' || action === 'enable' || action === 'reset') return { kind: action, agent };
  if (action === 'model' && third) {
    const policy = fourth === undefined ? 'preferred' : choose(fourth, policies);
    return policy ? { kind: 'model', agent, model: third, policy } : { error: `The model policy must be ${policies.join(' or ')}.` };
  }
  const level = action === 'effort' ? choose(third, efforts) : undefined;
  if (level) return { kind: 'effort', agent, level };
  const tier = action === 'tier' ? choose(third, tiers) : undefined;
  if (tier) return { kind: 'tier', agent, tier };
  return { error: `Usage:\n${usage}` };
}

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}

function setEntry(settings: Json, agent: string, fields: Json | undefined): Json {
  const subagents = record(settings.subagents);
  const agents = Object.fromEntries(Object.entries(record(subagents.agents)).filter(([name]) => name !== agent));
  const entry = fields === undefined ? undefined : { ...record(record(subagents.agents)[agent]), ...fields };
  return { ...settings, subagents: { ...subagents, agents: entry === undefined ? agents : { ...agents, [agent]: entry } } };
}

function setDisabled(settings: Json, agent: string, disabled: boolean): Json {
  const subagents = record(settings.subagents);
  const current = Array.isArray(subagents.disabledSubagents) ? subagents.disabledSubagents.filter((name): name is string => typeof name === 'string') : [];
  const next = disabled ? [...new Set([...current, agent])] : current.filter((name) => name !== agent);
  return { ...settings, subagents: { ...subagents, disabledSubagents: next } };
}

export function applyPreference(settings: Json, command: Exclude<PreferenceCommand, { kind: 'show' }>): Json {
  switch (command.kind) {
    case 'model':
      return setEntry(settings, command.agent, { model: command.model, modelPolicy: command.policy });
    case 'effort':
      return setEntry(settings, command.agent, { effortLevel: command.level });
    case 'tier':
      return setEntry(settings, command.agent, { contextTier: command.tier });
    case 'reset':
      return setEntry(settings, command.agent, undefined);
    case 'disable':
      return setDisabled(settings, command.agent, true);
    case 'enable':
      return setDisabled(settings, command.agent, false);
    case 'rubber-duck':
      return { ...settings, builtInAgents: { ...record(settings.builtInAgents), rubberDuck: command.enabled } };
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

export function persistPreference(file: string, command: Exclude<PreferenceCommand, { kind: 'show' }>): void {
  let current: Json = {};
  try {
    current = record(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    current = {};
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(applyPreference(current, command), null, 2)}\n`);
}

export function renderPreferences(settings: Reference AssistantSettings, agents: readonly AgentDefinition[]): string {
  const lines = agents.map((agent) => {
    const entry = settings.subagents.agents[agent.name];
    const parts = [entry?.model ? `model ${entry.model} (${entry.modelPolicy ?? 'preferred'})` : 'model default', `effort ${entry?.effortLevel ?? agent.reasoningEffort ?? 'default'}`, `tier ${entry?.contextTier ?? 'inherit'}`];
    return `${settings.subagents.disabledSubagents.includes(agent.name) ? '[disabled] ' : ''}${agent.name}: ${parts.join(', ')}`;
  });
  return `Subagent preferences\n${lines.join('\n')}\nrubber-duck: ${settings.builtInAgents.rubberDuck ? 'on' : 'off'}`;
}
