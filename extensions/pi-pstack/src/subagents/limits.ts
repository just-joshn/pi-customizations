import type { Refusal } from './types.ts';

export const defaultDepthCap = 3;
export const defaultConcurrencyCap = 20;
export const resultTextLimit = 100000;

export function normalizeDescription(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const namePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const reservedNames = new Set(['main', 'team-lead', 'team_lead', 'teamlead', 'user', 'system']);
const agentIdShape = /^agent-[a-z0-9]{8,}$/i;

export function validateName(name: string): Refusal | undefined {
  if (!namePattern.test(name)) {
    return { code: 'subagent_name_invalid', message: 'name must start with a letter or digit and contain only letters, digits, underscores, or hyphens (max 64 chars)' };
  }
  if (reservedNames.has(name.toLowerCase()) || agentIdShape.test(name)) {
    return { code: 'subagent_name_invalid', message: `name "${name}" is reserved for message routing` };
  }
  return undefined;
}

function positiveInteger(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}

export function depthCap(env: NodeJS.ProcessEnv, settingsValue?: number): number {
  const fromEnv = positiveInteger(env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH ?? env.PI_MAX_SUBAGENT_SPAWN_DEPTH);
  if (fromEnv !== undefined) return fromEnv;
  if (settingsValue !== undefined && Number.isInteger(settingsValue) && settingsValue >= 1) return settingsValue;
  return defaultDepthCap;
}

export function concurrencyCap(env: NodeJS.ProcessEnv): number {
  return positiveInteger(env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS ?? env.PI_MAX_CONCURRENT_SUBAGENTS) ?? defaultConcurrencyCap;
}

export function sessionSpawnCap(env: NodeJS.ProcessEnv): number | undefined {
  return positiveInteger(env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION ?? env.PI_MAX_SUBAGENTS_PER_SESSION);
}

export function capResultText(text: string): string {
  return text.length > resultTextLimit ? text.slice(0, resultTextLimit) : text;
}
