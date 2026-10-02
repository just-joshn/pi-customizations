import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { duplicateLogs, resolvePrecedence } from './agent-precedence.ts';
import { defaultUserDirs, markdownAgentFiles, policyAgentDirs, projectAgentDirs } from './agent-sources.ts';
import { builtinAgents } from './builtins.ts';
import { type AgentColor, parseAgentColor } from './colors.ts';
import { safeModeEnabled } from './gates.ts';
import { type HookTable, parseAgentHooks } from './hook-table.ts';
import { type McpServerSpec, parseMcpServers } from './mcp-specs.ts';
import { toolList } from './tool-specs.ts';

export type AgentSource = 'built-in' | 'plugin' | 'userSettings' | 'projectSettings' | 'flagSettings' | 'policySettings';

export type AgentDefinition = Readonly<{
  agentType: string;
  whenToUse: string;
  systemPrompt: string;
  source: AgentSource;
  baseDir: string;
  filePath?: string;
  filename?: string;
  fromAdditionalDirectory?: true;
  plugin?: string;
  registeredAtRunTime?: true;
  loadDefinition?: () => Promise<AgentDefinition | undefined>;
  tools?: readonly string[];
  disallowedTools?: readonly string[];
  skills?: readonly string[];
  model?: string;
  effort?: string | number;
  permissionMode?: string;
  mcpServers?: readonly McpServerSpec[];
  requiredMcpServers?: readonly string[];
  hooks?: HookTable;
  maxTurns?: number;
  background?: true;
  omitClaudeMd?: boolean;
  memory?: 'user' | 'project' | 'local';
  isolation?: 'worktree' | 'remote';
  color?: AgentColor;
  initialPrompt?: string;
  criticalSystemReminder_EXPERIMENTAL?: string;
  observer?: string;
  observerMessage?: string;
  observeSubagents?: false;
  cacheTtl?: '1h';
}>;

export type Discovery = Readonly<{ allAgents: readonly AgentDefinition[]; activeAgents: readonly AgentDefinition[]; logs: readonly string[]; warnings: readonly string[] }>;

export type DiscoveryOptions = Readonly<{
  root: string;
  userDirs?: readonly string[];
  additionalDirs?: readonly string[];
  policyDirs?: readonly string[];
  flagAgents?: readonly AgentDefinition[];
  pluginAgents?: readonly AgentDefinition[] | ((warnings: string[]) => readonly AgentDefinition[]);
  env?: NodeJS.ProcessEnv;
  safeMode?: boolean;
}>;

export const permissionModes = ['acceptEdits', 'auto', 'bypassPermissions', 'default', 'dontAsk', 'plan'];
const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];

const cache = new Map<string, Discovery>();

export function clearAgentCache(): void {
  cache.clear();
}

export { sanitizeDisplay } from './agent-precedence.ts';
export { defaultUserDirs } from './agent-sources.ts';

function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim());
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  return undefined;
}

function normalizedModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const model = value.trim();
  if (!model) return undefined;
  return model.toLowerCase() === 'inherit' ? 'inherit' : model;
}

export type ParsedAgent = { agent?: AgentDefinition; warnings: string[]; error?: string };

type Mutable = { -readonly [K in keyof AgentDefinition]: AgentDefinition[K] };

function lifecycleFields(fm: Record<string, unknown>, path: string, warnings: string[]): Partial<Mutable> {
  const agent: Partial<Mutable> = {};
  if (fm.background !== undefined) {
    if (fm.background === true || fm.background === 'true') agent.background = true;
    else if (fm.background !== false && fm.background !== 'false') warnings.push(`Agent file ${path} has invalid background value '${String(fm.background)}'. Must be 'true', 'false', or omitted.`);
  }
  if (fm.maxTurns !== undefined) {
    const turns = typeof fm.maxTurns === 'number' ? fm.maxTurns : Number.NaN;
    if (Number.isInteger(turns) && turns > 0) agent.maxTurns = turns;
    else warnings.push(`Agent file ${path} has invalid maxTurns '${String(fm.maxTurns)}'. Must be a positive integer.`);
  }
  if (fm.memory !== undefined) {
    if (fm.memory === 'user' || fm.memory === 'project' || fm.memory === 'local') agent.memory = fm.memory;
    else warnings.push(`Agent file ${path} has invalid memory value '${String(fm.memory)}'. Valid options: user, project, local`);
  }
  if (fm.isolation !== undefined) {
    if (fm.isolation === 'worktree' || fm.isolation === 'remote') agent.isolation = fm.isolation;
    else warnings.push(`Agent file ${path} has invalid isolation value '${String(fm.isolation)}'. Valid options: worktree, remote`);
  }
  return agent;
}

function behaviorFields(fm: Record<string, unknown>, path: string, warnings: string[]): Partial<Mutable> {
  const agent: Partial<Mutable> = {};
  if (fm.effort !== undefined) {
    const raw = typeof fm.effort === 'string' ? fm.effort.trim().toLowerCase() : fm.effort;
    if (typeof raw === 'number' && Number.isInteger(raw)) agent.effort = raw;
    else if (typeof raw === 'string' && efforts.includes(raw)) agent.effort = raw;
    else warnings.push(`Agent file ${path} has invalid effort '${String(fm.effort)}'. Valid options: ${efforts.join(', ')} or an integer`);
  }
  if (fm.permissionMode !== undefined) {
    const mode = fm.permissionMode === 'manual' ? 'default' : fm.permissionMode;
    if (typeof mode === 'string' && permissionModes.includes(mode)) agent.permissionMode = mode;
    else warnings.push(`Agent file ${path} has invalid permissionMode '${String(fm.permissionMode)}'. Valid options: ${permissionModes.join(', ')}`);
  }
  for (const key of ['observer', 'observerMessage'] as const) {
    const value = fm[key];
    if (typeof value === 'string' && value.trim()) agent[key] = value.trim();
  }
  if (fm.observeSubagents === false || fm.observeSubagents === 'false') agent.observeSubagents = false;
  if (fm.cacheTtl === '1h') agent.cacheTtl = fm.cacheTtl;
  return agent;
}

type Identity = { agentType: string; whenToUse: string } | { warnings: string[]; error?: string };

function identity(fm: Record<string, unknown>, path: string): Identity {
  const { name, description } = fm;
  if (typeof name !== 'string' || !name.trim()) return { warnings: [] };
  const failed = (warning: string, reason: string) => ({ warnings: [warning], error: `Failed to parse agent from ${path}: ${reason}` });
  if (name.trim().startsWith('-')) return failed(`Agent file ${path} has invalid name '${name}': names must not start with '-'`, 'Invalid "name": names must not start with "-"');
  if (name.normalize('NFKC').includes(':'))
    return failed(`Agent file ${path} has invalid name '${name}': names must not contain ':' (reserved for plugin namespacing)`, 'Invalid "name": names must not contain ":" (reserved for plugin namespacing)');
  if (typeof description !== 'string' || !description.trim()) return failed(`Agent file ${path} is missing required 'description' in frontmatter`, 'Missing required "description" field in frontmatter');
  return { agentType: name.trim(), whenToUse: description.replace(/\\n/g, '\n') };
}

function toolFields(fm: Record<string, unknown>, path: string, warnings: string[]): Partial<Mutable> {
  let tools = toolList(fm.tools);
  const disallowed = toolList(fm.disallowedTools);
  let skills = stringList(fm.skills);
  if (tools?.includes('Skill') === true) {
    warnings.push(`Agent file ${path}: 'Skill' in tools is deprecated; use the skills field instead.`);
    tools = tools.filter((tool) => tool !== 'Skill');
    skills = skills ?? [];
  }
  return { ...(tools ? { tools } : {}), ...(disallowed ? { disallowedTools: disallowed } : {}), ...(skills ? { skills } : {}) };
}

function frontmatterOf(text: string, path: string, warnings: string[]): { fm: Record<string, unknown>; body: string } {
  try {
    const parsed = parseFrontmatter<Record<string, unknown>>(text);
    return { fm: parsed.frontmatter ?? {}, body: parsed.body };
  } catch (error) {
    warnings.push(`YAML frontmatter in ${path} failed to parse and was ignored: ${error instanceof Error ? error.message : String(error)}`);
    return { fm: {}, body: text };
  }
}

function presentationFields(fm: Record<string, unknown>): Partial<Mutable> {
  const color = parseAgentColor(fm.color);
  const model = normalizedModel(fm.model);
  return {
    ...(color ? { color } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(typeof fm.initialPrompt === 'string' && fm.initialPrompt.trim() ? { initialPrompt: fm.initialPrompt.trim() } : {}),
    ...(typeof fm.criticalSystemReminder_EXPERIMENTAL === 'string' && fm.criticalSystemReminder_EXPERIMENTAL.trim() ? { criticalSystemReminder_EXPERIMENTAL: fm.criticalSystemReminder_EXPERIMENTAL.trim() } : {}),
    ...(fm.omitClaudeMd === true || fm.omitClaudeMd === 'true' ? { omitClaudeMd: true } : {}),
  };
}

function executableFields(fm: Record<string, unknown>, agentType: string, warnings: string[]): Partial<Mutable> | { error: string } {
  const parsed = parseAgentHooks(fm, agentType);
  warnings.push(...parsed.notes.map((note) => `Agent '${agentType}': ${note}`));
  if (parsed.unloadable) return { error: `Agent not loaded: ${parsed.unloadable}` };
  const mcpServers = parseMcpServers(fm.mcpServers, agentType, (message) => warnings.push(message));
  return { ...(parsed.hooks ? { hooks: parsed.hooks } : {}), ...(mcpServers?.length ? { mcpServers } : {}) };
}

export function parseAgentFile(path: string, text: string, source: AgentSource, baseDir: string): ParsedAgent {
  const warnings: string[] = [];
  const { fm, body } = frontmatterOf(text, path, warnings);
  const id = identity(fm, path);
  if (!('agentType' in id)) return { warnings: [...warnings, ...id.warnings], ...(id.error ? { error: id.error } : {}) };
  const executable = executableFields(fm, id.agentType, warnings);
  if ('error' in executable) return { warnings, error: `${executable.error} (${path})` };
  let tools: Partial<Mutable>;
  try {
    tools = toolFields(fm, path, warnings);
  } catch (error) {
    return { warnings: [...warnings, `Error parsing agent from ${path}: ${error instanceof Error ? error.message : String(error)}`], error: `Failed to parse agent from ${path}: Unknown parsing error` };
  }
  const agent: AgentDefinition = {
    ...executable,
    ...lifecycleFields(fm, path, warnings),
    ...behaviorFields(fm, path, warnings),
    ...presentationFields(fm),
    ...tools,
    ...id,
    systemPrompt: body.trim(),
    source,
    baseDir,
    filePath: path,
    filename: basename(path, '.md'),
  };
  return { agent, warnings };
}

function loadDirectory(dir: string, source: AgentSource, warnings: string[], provenance: Partial<AgentDefinition> = {}): AgentDefinition[] {
  return markdownAgentFiles(dir, warnings).flatMap((file) => {
    const parsed = parseAgentFile(file, readFileSync(file, 'utf8'), source, dir);
    warnings.push(...parsed.warnings, ...(parsed.error ? [parsed.error] : []));
    return parsed.agent ? [{ ...parsed.agent, ...provenance }] : [];
  });
}

function customCandidates(options: DiscoveryOptions, root: string, env: NodeJS.ProcessEnv, warnings: string[]): AgentDefinition[] {
  return [
    ...(typeof options.pluginAgents === 'function' ? options.pluginAgents(warnings) : (options.pluginAgents ?? [])),
    ...(options.userDirs ?? defaultUserDirs(env)).flatMap((dir) => loadDirectory(dir, 'userSettings', warnings)),
    ...(options.additionalDirs ?? []).flatMap((dir) => loadDirectory(dir, 'projectSettings', warnings, { fromAdditionalDirectory: true })),
    ...projectAgentDirs(root).flatMap((dir) => loadDirectory(dir, 'projectSettings', warnings)),
    ...(options.flagAgents ?? []),
    ...(options.policyDirs ?? policyAgentDirs(env)).flatMap((dir) => loadDirectory(dir, 'policySettings', warnings)),
  ];
}

function discover(options: DiscoveryOptions, root: string): Discovery {
  const env = options.env ?? process.env;
  const builtins = builtinAgents(env);
  if (options.safeMode || safeModeEnabled(env))
    return { allAgents: builtins, activeAgents: resolvePrecedence(builtins), logs: [], warnings: ['Safe mode: all customizations are disabled (CLAUDE.md, skills, plugins, hooks, MCP, agents, and more)'] };
  const warnings: string[] = [];
  try {
    const candidates = [...builtins, ...customCandidates(options, root, env, warnings)];
    const activeAgents = resolvePrecedence(candidates);
    return { allAgents: candidates, activeAgents, logs: duplicateLogs(candidates, activeAgents), warnings };
  } catch (error) {
    return { allAgents: builtins, activeAgents: resolvePrecedence(builtins), logs: [`Error loading agent definitions: ${error instanceof Error ? error.message : String(error)}`], warnings };
  }
}

export function discoverAgents(options: DiscoveryOptions): Discovery {
  const root = resolve(options.root);
  const cached = cache.get(root);
  if (cached) return cached;
  const result = discover(options, root);
  cache.set(root, result);
  return result;
}
