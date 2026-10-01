import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { AgentDefinition } from './definitions.ts';
import { memoryEnabled } from './memory.ts';
import { hasToolScope, hasUnsupportedToolScope } from './tool-specs.ts';

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

function serverPattern(rule: string): boolean {
  const parts = rule.trim().split('__');
  const server = parts[1];
  if (parts[0] !== 'mcp' || !server) return false;
  return (parts.length === 2 && (server === '*' || !server.includes('*'))) || (parts.length === 3 && !server.includes('*') && parts[2] === '*');
}

function unmatchedPatterns(definition: AgentDefinition, all: readonly string[]): readonly string[] {
  return (definition.tools ?? []).filter((rule) => serverPattern(rule) && matchingTools(rule, all).length === 0);
}

function matchingTools(rule: string, all: readonly string[]): readonly string[] {
  const base = rule.replace(/\(.*\)$/, '').trim();
  const exact = canonicalTool(base, all);
  if (exact) return [exact];
  if (!serverPattern(base)) return [];
  if (base.endsWith('*')) return all.filter((tool) => tool.startsWith(base.slice(0, -1)));
  return all.filter((tool) => tool.startsWith(`${base}__`));
}

export function toolAllowList(definition: AgentDefinition, all: readonly string[]): string[] {
  const requested = definition.tools;
  const base = !requested || requested.includes('*') ? [...all] : requested.flatMap((name) => matchingTools(name, all));
  const denied = new Set((definition.disallowedTools ?? []).flatMap((rule) => matchingTools(rule, all)));
  const memoryTools = memoryEnabled(definition, process.env) ? ['read', 'write', 'edit'].filter((name) => all.includes(name)) : [];
  return [...new Set([...base, ...memoryTools])].filter((tool) => !denied.has(tool));
}

export function unrecognizedTools(definition: AgentDefinition, all: readonly string[]): string[] {
  return (definition.tools ?? []).filter((name) => name !== '*' && !serverPattern(name) && matchingTools(name, all).length === 0);
}

export function zeroToolsError(definition: AgentDefinition, all: readonly string[], continuation = false): string | undefined {
  if (continuation || all.length === 0 || !definition.tools || definition.tools.includes('*') || toolAllowList(definition, all).length > 0) return undefined;
  const invalid = unrecognizedTools(definition, all);
  const unmatched = unmatchedPatterns(definition, all);
  const reasons = [invalid.length ? `unrecognized [${invalid.join(', ')}]` : undefined, unmatched.length ? `recognized but matched no tools in this session [${unmatched.join(', ')}]` : undefined].filter((reason) => reason !== undefined);
  if (reasons.length === 0) return undefined;
  return `Agent '${definition.agentType}' would be spawned with zero tools; refusing. Its tools list resolved to nothing: ${reasons.join('; ')}. Fix the agent's tools frontmatter or pass a different subagent_type.`;
}

export type ZeroToolsDiagnostic = Readonly<{
  isBuiltIn: boolean;
  invalidCount: number;
  unavailableCount: number;
  validButEmptyCount: number;
  availablePoolSize: number;
  hadWildcard: boolean;
  isContinuation: boolean;
  refused: boolean;
  isAsync: boolean;
}>;
type PolicyContext = Readonly<{ isContinuation: boolean; isAsync: boolean; report: (diagnostic: ZeroToolsDiagnostic) => void }>;

export function applyToolPolicy(session: AgentSession, definition: AgentDefinition, context?: PolicyContext): void {
  if ((definition.tools ?? []).some(hasUnsupportedToolScope) || (definition.disallowedTools ?? []).some(hasToolScope))
    throw new Error(`Agent '${definition.agentType}' cannot start: argument-scoped tool rules are not enforced by Pi. Use bare tool names only when unrestricted access is intended.`);
  const allNames = session.getAllTools().map((tool) => tool.name);
  const problem = zeroToolsError(definition, allNames, context?.isContinuation);
  const allowed = toolAllowList(definition, allNames);
  if (allowed.length === 0)
    context?.report({
      isBuiltIn: definition.source === 'built-in',
      invalidCount: unrecognizedTools(definition, allNames).length,
      unavailableCount: 0,
      validButEmptyCount: unmatchedPatterns(definition, allNames).length,
      availablePoolSize: allNames.length,
      hadWildcard: definition.tools?.includes('*') === true,
      isContinuation: context.isContinuation,
      refused: problem !== undefined,
      isAsync: context.isAsync,
    });
  if (problem) throw new Error(problem);
  const active = session.getActiveToolNames();
  if (allowed.length !== active.length || allowed.some((name) => !active.includes(name))) session.setActiveToolsByName(allowed);
}
