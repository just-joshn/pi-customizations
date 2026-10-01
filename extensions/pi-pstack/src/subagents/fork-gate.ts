import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AgentSummary } from './types.ts';

export const forkType = 'fork';
export const forkDenyRule = 'Agent(fork)';
const truthy = ['1', 'true', 'yes', 'on'];

export type ForkDenial = Readonly<{ rule: string; source: string }>;
export type ForkAvailability = Readonly<{ available: boolean; denied?: ForkDenial }>;

export function foldAgentType(type: string): string {
  return type.toLowerCase().replace(/[\s_-]+/g, '');
}

export function forkGateEnabled(env: NodeJS.ProcessEnv): boolean {
  return truthy.includes((env.CLAUDE_CODE_FORK_SUBAGENT ?? env.PI_FORK_SUBAGENT ?? '').trim().toLowerCase());
}

function settingsFiles(root: string, env: NodeJS.ProcessEnv): ReadonlyArray<readonly [string, string]> {
  const home = env.HOME ?? homedir();
  const piAgent = env.PI_CODING_AGENT_DIR ?? join(home, '.pi/agent');
  return [
    ['userSettings', join(home, '.claude/settings.json')],
    ['userSettings', join(piAgent, 'settings.json')],
    ['projectSettings', join(root, '.claude/settings.json')],
    ['projectSettings', join(root, '.pi/settings.json')],
    ['localSettings', join(root, '.claude/settings.local.json')],
  ];
}

function denyList(path: string): readonly unknown[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const deny = (parsed as { permissions?: { deny?: unknown } } | null)?.permissions?.deny;
    return Array.isArray(deny) ? deny : [];
  } catch {
    return [];
  }
}

export function findForkDenial(root: string, env: NodeJS.ProcessEnv): ForkDenial | undefined {
  for (const [source, path] of settingsFiles(root, env)) {
    if (denyList(path).some((rule) => typeof rule === 'string' && rule.replace(/\s+/g, '') === forkDenyRule)) return { rule: forkDenyRule, source };
  }
  return undefined;
}

export function forkAvailability(input: { env: NodeJS.ProcessEnv; root: string; agents: readonly AgentSummary[]; allowedAgentTypes: readonly string[] | undefined }): ForkAvailability {
  const { env, root, agents, allowedAgentTypes } = input;
  if (!forkGateEnabled(env) || agents.some((agent) => foldAgentType(agent.agentType) === forkType) || !(allowedAgentTypes?.includes(forkType) ?? true)) return { available: false };
  const denied = findForkDenial(root, env);
  return denied ? { available: false, denied } : { available: true };
}
