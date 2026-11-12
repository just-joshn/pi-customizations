import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { getSupportedThinkingLevels, type ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { ModelRegistry } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

export const ROLE_NAMES = [
  'feature, refactoring', 'bug-fix', 'perf-issue', 'hillclimb', 'judgment and prose', 'hardest tasks',
  'how explorer', 'how explainer', 'why investigators', 'why synthesizer', 'reflect tooling',
  'reflect judgment, divergent, synthesizer', 'arena runners', 'arena cross-judge pool',
  'swarm workers', 'architect runners', 'interrogate reviewers',
] as const;
export type Role = typeof ROLE_NAMES[number];
export const PANEL_ROLES: readonly Role[] = ['arena runners', 'arena cross-judge pool', 'architect runners', 'interrogate reviewers'];
export const BUDGET_EFFORT = { unlimited: 'max', large: 'xhigh', medium: 'high', small: 'medium' } as const;
const LEVELS: readonly ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const spec = Type.String({ pattern: '^(inherit-parent|auto|[^\\s/:]+/[^\\s]+)$' });
const roleProperties = Object.fromEntries(ROLE_NAMES.map((role) => [role, Type.Optional(PANEL_ROLES.includes(role) ? Type.Array(spec, { minItems: 1 }) : spec)]));
export const ModelsSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  budget: Type.Union([Type.Literal('unlimited'), Type.Literal('large'), Type.Literal('medium'), Type.Literal('small')]),
  budgetLine: Type.Optional(Type.String()),
  roles: Type.Object(roleProperties, { additionalProperties: false }),
}, { additionalProperties: false });
export type ModelsConfig = Omit<Static<typeof ModelsSchema>, 'roles'> & { roles: Partial<Record<Role, string | string[]>> };
export type Registry = Pick<ModelRegistry, 'getAvailable'>;
export interface ResolvedModel { provider: string; id: string; thinkingLevel: ModelThinkingLevel }
export interface RoleResolution { models: ResolvedModel[]; limitations: string[] }

export function parseModelsConfig(input: unknown): ModelsConfig {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (!Value.Check(ModelsSchema, value)) throw new Error('Invalid pstack models.json configuration');
  const config = value as ModelsConfig;
  for (const choice of Object.values(config.roles).flat()) {
    if (choice === 'auto' || choice === 'inherit-parent') continue;
    const suffix = choice.slice(choice.lastIndexOf(':') + 1);
    if (choice.includes(':') && !LEVELS.includes(suffix as ModelThinkingLevel)) throw new Error(`Invalid thinking level in ${choice}`);
  }
  return config;
}

export function loadModelsConfig(path = join(homedir(), '.pi/agent/pstack/models.json')): ModelsConfig {
  try {
    return parseModelsConfig(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, budget: 'large', roles: {} };
    throw error;
  }
}

export function modelFamily(id: string): string {
  return id.replace(/^claude-.*$/, 'claude')
    .replace(/^(?:cursor-grok|composer)(?:[-.].*)?$/, 'grok')
    .replace(/^(gpt|grok|glm|deepseek|gemini)(?:[-.].*)?$/, '$1');
}

export function resolveRole(role: string, registry: Registry, parent: ResolvedModel, config = loadModelsConfig()): RoleResolution {
  if (!ROLE_NAMES.includes(role as Role)) throw new Error(`Unknown pstack model role: ${role}`);
  const available = registry.getAvailable();
  const limitations: string[] = [];
  const defaultSpec = (family: 'claude' | 'grok'): string => {
    const ids = family === 'claude' ? ['claude-opus-5-5'] : ['grok-4.7-fast', 'grok-4.7'];
    const model = ids.map((id) => available.find((entry) => entry.id === id)).find((entry) => entry !== undefined)
      ?? available.find((entry) => modelFamily(entry.id) === family);
    if (model) return `${model.provider}/${model.id}`;
    limitations.push(`${family} skill default is unavailable; using parent`);
    return 'inherit-parent';
  };
  let selected = config.roles[role as Role];
  if (selected === undefined) {
    if (PANEL_ROLES.includes(role as Role)) selected = [defaultSpec('claude'), defaultSpec('grok')];
    else selected = defaultSpec(['judgment and prose', 'hardest tasks', 'how explainer', 'why synthesizer', 'reflect judgment, divergent, synthesizer'].includes(role) ? 'claude' : 'grok');
  }
  const choices = typeof selected === 'string' ? [selected] : [...selected];
  if (role === 'arena cross-judge pool') {
    for (const id of ['claude-opus-5-5', 'grok-4.7-fast', 'grok-4.7']) {
      const model = available.find((entry) => entry.id === id);
      if (model) choices.push(`${model.provider}/${model.id}`);
    }
  }
  const models: ResolvedModel[] = [];
  for (const choice of choices) {
    const inherited = choice === 'inherit-parent' || choice === 'auto';
    if (role === 'arena cross-judge pool' && inherited) continue;
    const levelMatch = /:(off|minimal|low|medium|high|xhigh|max)$/.exec(choice);
    const reference = inherited ? `${parent.provider}/${parent.id}` : levelMatch ? choice.slice(0, -levelMatch[0].length) : choice;
    const slash = reference.indexOf('/');
    const provider = reference.slice(0, slash);
    const id = reference.slice(slash + 1);
    const target = inherited ? parent.thinkingLevel : (levelMatch?.[1] as ModelThinkingLevel | undefined) ?? BUDGET_EFFORT[config.budget];
    const candidates = available.filter((model) => model.provider === provider && (inherited ? model.id === id : modelFamily(model.id) === modelFamily(id)));
    const preferred = [id, modelFamily(id) === 'claude' ? 'claude-opus-5-5' : 'grok-4.7-fast', 'grok-4.7'];
    const rank = (candidate: string) => {
      const index = preferred.indexOf(candidate);
      return index === -1 ? preferred.length : index;
    };
    candidates.sort((a, b) => rank(a.id) - rank(b.id));
    const minimum = target === 'off' || target === 'minimal' ? LEVELS.indexOf(target) : LEVELS.indexOf('low');
    const search = (pool: typeof candidates): ResolvedModel | undefined => {
      for (let index = LEVELS.indexOf(target); index >= minimum; index--) {
        const level = LEVELS[index]!;
        const model = pool.find((entry) => getSupportedThinkingLevels(entry).includes(level));
        if (model) return { provider: model.provider, id: model.id, thinkingLevel: level };
      }
      return undefined;
    };
    // The requested model keeps the role: its own nearest level wins over another model of the family at the target.
    const exact = candidates.filter((model) => model.id === id);
    let resolved = search(exact);
    if (!resolved) {
      for (let index = LEVELS.indexOf(target) + 1; index < LEVELS.length && !resolved; index++) {
        const model = exact.find((entry) => getSupportedThinkingLevels(entry).includes(LEVELS[index]!));
        if (model) resolved = { provider: model.provider, id: model.id, thinkingLevel: LEVELS[index]! };
      }
    }
    resolved ??= search(candidates);
    if (!resolved) {
      limitations.push(`${choice} is unavailable at or below ${target}; role needs a model choice`);
      continue;
    }
    if (resolved.id !== id || resolved.thinkingLevel !== target) {
      const why = exact.length === 0 ? `${provider}/${id} is not available` : resolved.id !== id ? `${id} has no usable thinking level near ${target}` : `${id} supports ${getSupportedThinkingLevels(exact[0]!).join(', ')}, not ${target}`;
      limitations.push(`${choice} resolved to ${resolved.provider}/${resolved.id}:${resolved.thinkingLevel} (${why})`);
    }
    if (role === 'arena cross-judge pool' && modelFamily(resolved.id) === modelFamily(parent.id)) continue;
    models.push(resolved);
    if (role === 'arena cross-judge pool') break;
  }
  if (role === 'arena cross-judge pool' && models.length === 0) limitations.push('No independent cross-judge family is available');
  if (PANEL_ROLES.includes(role as Role) && role !== 'arena cross-judge pool') {
    const families = new Set(models.map((model) => modelFamily(model.id))).size;
    if (families < choices.length) limitations.push(`panel has ${choices.length} entries but ${families} ${families === 1 ? 'family' : 'families'}`);
  }
  return { models, limitations };
}
