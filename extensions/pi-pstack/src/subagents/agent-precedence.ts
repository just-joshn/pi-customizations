import { baseDirDepth } from './agent-sources.ts';
import type { AgentDefinition, AgentSource } from './definitions.ts';

export function sanitizeDisplay(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function tier(candidates: readonly AgentDefinition[], source: AgentSource): AgentDefinition[] {
  return candidates.filter((agent) => agent.source === source);
}

function projectTier(candidates: readonly AgentDefinition[]): AgentDefinition[] {
  const project = tier(candidates, 'projectSettings');
  const current = project.filter((agent) => !agent.fromAdditionalDirectory).toSorted((left, right) => baseDirDepth(left.baseDir) - baseDirDepth(right.baseDir));
  return [...project.filter((agent) => agent.fromAdditionalDirectory), ...current];
}

export function resolvePrecedence(candidates: readonly AgentDefinition[]): AgentDefinition[] {
  const ordered = [tier(candidates, 'built-in'), tier(candidates, 'plugin'), tier(candidates, 'userSettings'), projectTier(candidates), tier(candidates, 'flagSettings'), tier(candidates, 'policySettings')];
  const winners = new Map<string, AgentDefinition>();
  for (const agent of ordered.flat()) winners.set(agent.agentType, agent);
  return [...winners.values()].toSorted((left, right) => left.agentType.localeCompare(right.agentType));
}

function location(agent: AgentDefinition): string {
  if (agent.filePath) return agent.filePath;
  if (agent.source === 'plugin' && agent.plugin) return `plugin '${agent.plugin}'`;
  if (agent.baseDir && agent.filename) return `${agent.baseDir}/${agent.filename}.md`;
  return agent.source;
}

export function duplicateLogs(candidates: readonly AgentDefinition[], active: readonly AgentDefinition[]): string[] {
  const winners = new Set(active);
  const groups = new Map<string, AgentDefinition[]>();
  for (const agent of candidates) {
    if (agent.source === 'built-in') continue;
    const key = `${agent.source}\0${agent.baseDir}\0${agent.agentType}`;
    groups.set(key, [...(groups.get(key) ?? []), agent]);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.toSorted((left, right) => Number(winners.has(right)) - Number(winners.has(left))))
    .toSorted((left, right) => (left[0]?.agentType ?? '').localeCompare(right[0]?.agentType ?? ''))
    .map((group) => {
      const locations = group.map((agent) => sanitizeDisplay(location(agent)));
      const first = group[0];
      const suffix = first && winners.has(first) ? ` — active: ${locations[0]}` : '';
      return `[agents] Duplicate agent name '${sanitizeDisplay(first?.agentType ?? '')}' (${first?.source}): ${locations.join(', ')}${suffix}`;
    });
}
