import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { AgentDefinition } from './definitions.ts';

const aliases = new Map([
  ['read', 'read'],
  ['write', 'write'],
  ['edit', 'edit'],
  ['bash', 'bash'],
  ['grep', 'grep'],
  ['glob', 'find'],
  ['find', 'find'],
  ['ls', 'ls'],
  ['agent', 'Agent'],
  ['task', 'Task'],
]);

export function canonicalTool(name: string, all: readonly string[]): string | undefined {
  const base = name.replace(/\(.*\)$/, '').trim();
  const exact = all.find((tool) => tool === base);
  if (exact) return exact;
  const aliased = aliases.get(base.toLowerCase());
  const folded = aliased ?? base.toLowerCase();
  return all.find((tool) => tool.toLowerCase() === folded.toLowerCase());
}

function denied(disallowed: readonly string[] | undefined, tool: string, all: readonly string[]): boolean {
  return (disallowed ?? []).some((rule) => {
    const base = rule.replace(/\(.*\)$/, '').trim();
    if (canonicalTool(base, all) === tool) return true;
    return base.startsWith('mcp__') && (tool === base || tool.startsWith(`${base}__`));
  });
}

export function toolAllowList(definition: AgentDefinition, all: readonly string[]): string[] {
  const requested = definition.tools;
  const base = !requested || requested.includes('*') ? [...all] : requested.flatMap((name) => canonicalTool(name, all) ?? []);
  return [...new Set(base)].filter((tool) => !denied(definition.disallowedTools, tool, all));
}

export function applyToolPolicy(session: AgentSession, definition: AgentDefinition): void {
  const allowed = toolAllowList(
    definition,
    session.getAllTools().map((tool) => tool.name),
  );
  const active = session.getActiveToolNames();
  if (allowed.length !== active.length || allowed.some((name) => !active.includes(name))) session.setActiveToolsByName(allowed);
}
