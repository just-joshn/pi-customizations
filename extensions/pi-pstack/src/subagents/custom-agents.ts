import { basename } from 'node:path';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { type AgentDefinition, type AgentSourceKind, allTools, customPromptParts, namedTools, type PromptParts, type ToolSelection } from './agent-definition.ts';
import { type McpServerSpec, parseMcpServers } from './mcp-specs.ts';
import type { EffortLevel, ModelPolicy } from './settings.ts';

export type ParsedCustomAgent = Readonly<{ agent?: AgentDefinition; warnings: readonly string[]; error?: string }>;
export type CustomAgentOrigin = Readonly<{ source: AgentSourceKind; path: string; plugin?: string }>;

const namePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const keyAliases: Readonly<Record<string, string>> = {
  'display-name': 'displayName',
  'model-policy': 'modelPolicy',
  'reasoning-effort': 'reasoningEffort',
  effort: 'reasoningEffort',
  'user-invocable': 'userInvocable',
  'disable-model-invocation': 'disableModelInvocation',
  'mcp-servers': 'mcpServers',
  'include-custom-instructions': 'includeCustomInstructions',
  'prompt-parts': 'promptParts',
};
const efforts: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh'];
const policies: readonly ModelPolicy[] = ['preferred', 'required'];
const promptPartFlags = Object.entries(customPromptParts)
  .filter(([, value]) => typeof value === 'boolean')
  .map(([key]) => key);

function normalizeKeys(frontmatter: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(frontmatter).map(([key, value]) => [keyAliases[key] ?? key, value]));
}

function flag(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function strings(value: unknown): readonly string[] | undefined {
  if (Array.isArray(value))
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  return undefined;
}

function toolSelection(value: unknown): ToolSelection | undefined {
  const names = strings(value);
  if (names === undefined) return undefined;
  return names.some((name) => name === '*' || name.toLowerCase() === 'all') ? allTools : namedTools(names);
}

function modelField(value: unknown): string | readonly string[] | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  const list = strings(value);
  return list && list.length > 0 ? list : undefined;
}

function serverSpecs(value: unknown, name: string, warn: (message: string) => void): readonly McpServerSpec[] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return parseMcpServers(value, name, warn);
  return parseMcpServers(
    Object.entries(value).map(([server, config]) => ({ [server]: config })),
    name,
    warn,
  );
}

function partsOf(frontmatter: Readonly<Record<string, unknown>>, path: string, warnings: string[]): PromptParts {
  const overrides = typeof frontmatter['promptParts'] === 'object' && frontmatter['promptParts'] !== null && !Array.isArray(frontmatter['promptParts']) ? Object.entries(frontmatter['promptParts']) : [];
  const valid = overrides.flatMap(([key, value]) => {
    const parsed = flag(value);
    if (promptPartFlags.includes(key) && parsed !== undefined) return [[key, parsed] as const];
    warnings.push(`Agent file ${path} has invalid promptParts entry '${key}' and it was ignored`);
    return [];
  });
  const instructions = flag(frontmatter['includeCustomInstructions']);
  return { ...customPromptParts, ...(instructions !== undefined ? { includeCustomInstructions: instructions } : {}), ...Object.fromEntries(valid) };
}

function enumField<T extends string>(frontmatter: Readonly<Record<string, unknown>>, key: string, allowed: readonly T[], path: string, warnings: string[]): T | undefined {
  const raw = frontmatter[key];
  if (raw === undefined) return undefined;
  const value = allowed.find((candidate) => candidate === (typeof raw === 'string' ? raw.trim().toLowerCase() : raw));
  if (value === undefined) warnings.push(`Agent file ${path} has invalid ${key} '${String(raw)}'. Valid options: ${allowed.join(', ')}`);
  return value;
}

function identity(frontmatter: Readonly<Record<string, unknown>>, path: string): { name: string; description: string } | string {
  const raw = typeof frontmatter['name'] === 'string' && frontmatter['name'].trim() ? frontmatter['name'].trim() : basename(path).replace(/\.agent\.md$|\.md$/, '');
  if (!namePattern.test(raw)) return `Failed to parse agent from ${path}: invalid name '${raw}'`;
  const description = typeof frontmatter['description'] === 'string' ? frontmatter['description'].trim() : '';
  if (!description) return `Failed to parse agent from ${path}: missing required "description" in frontmatter`;
  return { name: raw, description };
}

function parseDocument(text: string, path: string, warnings: string[]): { frontmatter: Readonly<Record<string, unknown>>; body: string } {
  try {
    const parsed = parseFrontmatter<Record<string, unknown>>(text);
    return { frontmatter: normalizeKeys(parsed.frontmatter ?? {}), body: parsed.body };
  } catch (error) {
    warnings.push(`YAML frontmatter in ${path} failed to parse and was ignored: ${error instanceof Error ? error.message : String(error)}`);
    return { frontmatter: {}, body: text };
  }
}

export function parseCustomAgent(text: string, origin: CustomAgentOrigin): ParsedCustomAgent {
  const warnings: string[] = [];
  const { frontmatter, body } = parseDocument(text, origin.path, warnings);
  const named = identity(frontmatter, origin.path);
  if (typeof named === 'string') return { warnings, error: named };
  const model = modelField(frontmatter['model']);
  const models = strings(frontmatter['models']);
  const modelPolicy = enumField(frontmatter, 'modelPolicy', policies, origin.path, warnings);
  const reasoningEffort = enumField(frontmatter, 'reasoningEffort', efforts, origin.path, warnings);
  const skills = strings(frontmatter['skills']);
  const mcpServers = serverSpecs(frontmatter['mcpServers'], named.name, (message) => warnings.push(message));
  const invocable = flag(frontmatter['userInvocable']);
  const legacyInfer = flag(frontmatter['infer']);
  const agent: AgentDefinition = {
    name: named.name,
    displayName: typeof frontmatter['displayName'] === 'string' && frontmatter['displayName'].trim() ? frontmatter['displayName'].trim() : named.name,
    description: named.description,
    ...(model !== undefined ? { model } : {}),
    ...(models !== undefined && models.length > 0 ? { models } : {}),
    ...(modelPolicy !== undefined ? { modelPolicy } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    tools: toolSelection(frontmatter['tools']) ?? allTools,
    promptParts: partsOf(frontmatter, origin.path, warnings),
    prompt: body.trim(),
    userInvocable: invocable ?? true,
    disableModelInvocation: flag(frontmatter['disableModelInvocation']) ?? legacyInfer === false,
    ...(mcpServers !== undefined && mcpServers.length > 0 ? { mcpServers } : {}),
    ...(skills !== undefined && skills.length > 0 ? { skills } : {}),
    source: origin.source,
    path: origin.path,
    ...(origin.plugin !== undefined ? { plugin: origin.plugin } : {}),
    promptOverridable: true,
    disableable: true,
  };
  return { agent, warnings };
}
