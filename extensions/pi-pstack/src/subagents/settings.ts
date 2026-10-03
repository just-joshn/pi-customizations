import { type Static, type TSchema, Type } from 'typebox';
import { Check } from 'typebox/value';

export const defaultMaxDepth = 4;
export const defaultWorkflowRuns = 4;

export const PolicySchema = Type.Union([Type.Literal('preferred'), Type.Literal('required')]);
export const EffortSchema = Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high'), Type.Literal('xhigh')]);
export const TierSchema = Type.Union([Type.Literal('inherit'), Type.Literal('default'), Type.Literal('long_context')]);
const Limit = Type.Integer({ minimum: 1, maximum: 128 });
const RunCap = Type.Integer({ minimum: 1, maximum: 16 });
const Names = Type.Array(Type.String({ minLength: 1 }));

export type ModelPolicy = Static<typeof PolicySchema>;
export type EffortLevel = Static<typeof EffortSchema>;
export type ContextTier = Static<typeof TierSchema>;
export type SubagentSettingsEntry = Readonly<{ model?: string; modelPolicy?: ModelPolicy; effortLevel?: EffortLevel; contextTier?: ContextTier; autoInvoke?: boolean }>;
export type WorkflowLimits = Readonly<{ maxConcurrentSubagents?: number; maxTotalSubagents?: number; timeoutSeconds?: number; maxAiCredits?: number }>;
export const defaultWorkflowLimits: WorkflowLimits = { maxConcurrentSubagents: 4, maxTotalSubagents: 20, timeoutSeconds: 1800, maxAiCredits: 5 };
export type ReferenceSettings = Readonly<{
  subagents: Readonly<{ agents: Readonly<Record<string, SubagentSettingsEntry>>; disabledSubagents: readonly string[]; maxConcurrency?: number; maxDepth?: number; contextManagementTools: boolean }>;
  builtInAgents: Readonly<{ rubberDuck: boolean; rubberDuckAutoInvoke: boolean }>;
  workflows: Readonly<{ maxConcurrentRuns: number; logPhaseNames: boolean; defaultLimits: WorkflowLimits }>;
}>;
export type ParsedSettings = Readonly<{ settings: ReferenceSettings; warnings: readonly string[] }>;

type Source = Readonly<Record<string, unknown>>;

function asSource(value: unknown): Source {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}

function field<T extends TSchema>(owner: string, source: Source, key: string, schema: T, warnings: string[]): Static<T> | undefined {
  if (!(key in source)) return undefined;
  const value: unknown = source[key];
  if (Check(schema, value)) return value;
  warnings.push(`${owner}.${key} is invalid and was ignored`);
  return undefined;
}

function entryOf(owner: string, raw: unknown, warnings: string[]): SubagentSettingsEntry {
  const source = asSource(raw);
  const model = field(owner, source, 'model', Type.String({ minLength: 1 }), warnings);
  const modelPolicy = field(owner, source, 'modelPolicy', PolicySchema, warnings);
  const effortLevel = field(owner, source, 'effortLevel', EffortSchema, warnings);
  const contextTier = field(owner, source, 'contextTier', TierSchema, warnings);
  const autoInvoke = field(owner, source, 'autoInvoke', Type.Boolean(), warnings);
  return {
    ...(model !== undefined ? { model } : {}),
    ...(modelPolicy !== undefined ? { modelPolicy } : {}),
    ...(effortLevel !== undefined ? { effortLevel } : {}),
    ...(contextTier !== undefined ? { contextTier } : {}),
    ...(autoInvoke !== undefined ? { autoInvoke } : {}),
  };
}

function subagentsOf(raw: unknown, legacy: unknown, warnings: string[]): ReferenceSettings['subagents'] {
  const source: Source = { ...asSource(legacy), ...asSource(raw) };
  const agents = Object.entries(asSource(source.agents)).map(([name, entry]) => [name, entryOf(`subagents.agents.${name}`, entry, warnings)] as const);
  const maxConcurrency = field('subagents', source, 'maxConcurrency', Limit, warnings);
  const maxDepth = field('subagents', source, 'maxDepth', Limit, warnings);
  return {
    agents: Object.fromEntries(agents),
    disabledSubagents: field('subagents', source, 'disabledSubagents', Names, warnings) ?? [],
    ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    contextManagementTools: field('subagents', source, 'contextManagementTools', Type.Boolean(), warnings) ?? false,
  };
}

function limitsOf(raw: unknown, warnings: string[]): WorkflowLimits {
  const source = asSource(raw);
  const count = Type.Integer({ minimum: 1 });
  const number = Type.Number({ exclusiveMinimum: 0 });
  const maxConcurrentSubagents = field('workflows.defaultLimits', source, 'maxConcurrentSubagents', count, warnings);
  const maxTotalSubagents = field('workflows.defaultLimits', source, 'maxTotalSubagents', count, warnings);
  const timeoutSeconds = field('workflows.defaultLimits', source, 'timeoutSeconds', number, warnings);
  const maxAiCredits = field('workflows.defaultLimits', source, 'maxAiCredits', number, warnings);
  return {
    ...(maxConcurrentSubagents !== undefined ? { maxConcurrentSubagents } : {}),
    ...(maxTotalSubagents !== undefined ? { maxTotalSubagents } : {}),
    ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
    ...(maxAiCredits !== undefined ? { maxAiCredits } : {}),
  };
}

export function parseReferenceSettings(raw: unknown): ParsedSettings {
  const source = asSource(raw);
  const warnings: string[] = [];
  const builtIn = asSource(source.builtInAgents);
  const workflows = asSource(source.workflows);
  const settings: ReferenceSettings = {
    subagents: subagentsOf(source.subagents, source.sub_agents, warnings),
    builtInAgents: {
      rubberDuck: field('builtInAgents', builtIn, 'rubberDuck', Type.Boolean(), warnings) ?? true,
      rubberDuckAutoInvoke: field('builtInAgents', builtIn, 'rubberDuckAutoInvoke', Type.Boolean(), warnings) ?? true,
    },
    workflows: {
      maxConcurrentRuns: field('workflows', workflows, 'maxConcurrentRuns', RunCap, warnings) ?? defaultWorkflowRuns,
      logPhaseNames: field('workflows', workflows, 'logPhaseNames', Type.Boolean(), warnings) ?? false,
      defaultLimits: limitsOf(workflows.defaultLimits, warnings),
    },
  };
  return { settings, warnings };
}

export function defaultMaxConcurrency(parallelism: number): number {
  return Math.min(32, Math.max(4, Math.trunc(parallelism)));
}
