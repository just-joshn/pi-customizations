import type { AgentDefinition } from './agent-definition.ts';

const background = (action: 'List' | 'Stop'): string => `BackgroundShell${action}`;
const aliases: ReadonlyMap<string, readonly string[]> = new Map([
  ['grep', ['grep']],
  ['rg', ['grep']],
  ['glob', ['find']],
  ['view', ['read']],
  ['read', ['read']],
  ['bash', ['bash']],
  ['edit', ['edit']],
  ['write', ['write']],
  ['read_bash', [background('List')]],
  ['list_bash', [background('List')]],
  ['stop_bash', [background('Stop')]],
  ['task', ['task']],
  ['read_agent', ['read_agent']],
  ['write_agent', ['write_agent']],
  ['list_agents', ['list_agents']],
]);
const contextTools: readonly string[] = ['session_artifacts', 'get_context_remaining', 'session_history', 'new_context'];

export type ToolPlan = Readonly<{ declared: readonly string[]; effective: readonly string[]; unmatched: readonly string[] }>;
export type ToolInputs = Readonly<{ definition: Pick<AgentDefinition, 'tools'>; parentTools: readonly string[]; available: readonly string[]; contextManagement: boolean }>;

function matches(rule: string, available: readonly string[]): readonly string[] {
  if (available.includes(rule)) return [rule];
  const named = aliases.get(rule.toLowerCase());
  if (named) return named.filter((name) => available.includes(name));
  const server = rule.endsWith('/*') ? rule.slice(0, -2) : undefined;
  if (server !== undefined) return available.filter((name) => name.startsWith(`mcp__${server.replaceAll('-', '_')}__`) || name.startsWith(`mcp__${server}__`));
  return [];
}

export function planTools(input: ToolInputs): ToolPlan {
  const { definition, parentTools, available, contextManagement } = input;
  const reachable = available.filter((name) => parentTools.includes(name));
  if (definition.tools.kind === 'all') {
    const effective = reachable.filter((name) => contextManagement || !contextTools.includes(name));
    return { declared: ['*'], effective, unmatched: [] };
  }
  const resolved = definition.tools.names.map((rule) => [rule, matches(rule, reachable)] as const);
  const effective = [...new Set(resolved.flatMap(([, names]) => names))].filter((name) => contextManagement || !contextTools.includes(name));
  return { declared: definition.tools.names, effective, unmatched: resolved.filter(([, names]) => names.length === 0).map(([rule]) => rule) };
}

export function zeroToolsMessage(agent: string, plan: ToolPlan): string | undefined {
  if (plan.effective.length > 0 || plan.declared.length === 0 || plan.declared.includes('*')) return undefined;
  return `Agent '${agent}' would be spawned with zero tools; refusing. None of its declared tools [${plan.declared.join(', ')}] exist in this session.`;
}
