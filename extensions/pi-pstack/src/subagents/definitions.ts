import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { builtinAgents } from './builtins.ts';

export type AgentSource = 'built-in' | 'plugin' | 'userSettings' | 'projectSettings' | 'localSettings' | 'flagSettings' | 'policySettings';

export type AgentDefinition = Readonly<{
  agentType: string;
  whenToUse: string;
  systemPrompt: string;
  source: AgentSource;
  baseDir: string;
  filePath?: string;
  filename?: string;
  tools?: readonly string[];
  disallowedTools?: readonly string[];
  skills?: readonly string[];
  model?: string;
  effort?: string | number;
  permissionMode?: string;
  maxTurns?: number;
  background?: true;
  omitClaudeMd?: boolean;
  memory?: 'user' | 'project' | 'local';
  isolation?: 'worktree' | 'remote';
  color?: string;
  initialPrompt?: string;
}>;

export type Discovery = Readonly<{ allAgents: readonly AgentDefinition[]; activeAgents: readonly AgentDefinition[]; logs: readonly string[]; warnings: readonly string[] }>;

export type DiscoveryOptions = Readonly<{
  root: string;
  userDirs?: readonly string[];
  additionalDirs?: readonly string[];
  flagAgents?: readonly AgentDefinition[];
  policyAgents?: readonly AgentDefinition[];
  pluginAgents?: readonly AgentDefinition[];
  env?: NodeJS.ProcessEnv;
  safeMode?: boolean;
}>;

const precedence: readonly AgentSource[] = ['built-in', 'plugin', 'userSettings', 'projectSettings', 'localSettings', 'flagSettings', 'policySettings'];
const permissionModes = ['acceptEdits', 'auto', 'bypassPermissions', 'default', 'dontAsk', 'plan'];
const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const maxFileBytes = 1048576;

const cache = new Map<string, Discovery>();

export function clearAgentCache(): void {
  cache.clear();
}

export function sanitizeDisplay(text: string): string {
  return [...text]
    .filter((char) => char.charCodeAt(0) > 0x1f && char.charCodeAt(0) !== 0x7f)
    .join('')
    .slice(0, 200);
}

function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim());
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  return undefined;
}

export type ParsedAgent = { agent?: AgentDefinition; warnings: string[]; error?: string };

export function parseAgentFile(path: string, text: string, source: AgentSource, baseDir: string): ParsedAgent {
  const warnings: string[] = [];
  let parsed: ReturnType<typeof parseFrontmatter<Record<string, unknown>>>;
  try {
    parsed = parseFrontmatter<Record<string, unknown>>(text);
  } catch (error) {
    return { warnings, error: `Agent file ${path} has invalid frontmatter: ${String(error)}` };
  }
  const { frontmatter: fm, body } = parsed;
  const name = fm.name;
  if (typeof name !== 'string' || !name.trim()) return { warnings, error: `Agent file ${path} is missing a name` };
  if (name.startsWith('-') || name.normalize('NFKC').includes(':')) return { warnings, error: `Agent file ${path} has an invalid name '${name}'` };
  if (typeof fm.description !== 'string' || !fm.description.trim()) return { warnings, error: `Agent file ${path} is missing a description` };

  let tools = stringList(fm.tools);
  let skills = stringList(fm.skills);
  const hadSkillTool = tools?.includes('Skill') === true;
  if (hadSkillTool) {
    warnings.push(`Agent file ${path}: 'Skill' in tools is deprecated; use the skills field instead.`);
    tools = tools?.filter((tool) => tool !== 'Skill');
    skills = skills ?? [];
  }

  const agent: { -readonly [K in keyof AgentDefinition]: AgentDefinition[K] } = {
    agentType: name.trim(),
    whenToUse: fm.description.replace(/\\n/g, '\n'),
    systemPrompt: body.trim(),
    source,
    baseDir,
    filePath: path,
    filename: basename(path, '.md'),
  };
  if (tools) agent.tools = tools;
  const disallowed = stringList(fm.disallowedTools);
  if (disallowed) agent.disallowedTools = disallowed;
  if (skills) agent.skills = skills;
  if (typeof fm.model === 'string') {
    const model = fm.model.trim();
    if (model) agent.model = model.toLowerCase() === 'inherit' ? 'inherit' : model;
  }
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
  if (typeof fm.color === 'string') agent.color = fm.color;
  if (typeof fm.initialPrompt === 'string' && fm.initialPrompt.trim()) agent.initialPrompt = fm.initialPrompt.trim();
  if (fm.omitClaudeMd === true) agent.omitClaudeMd = true;
  return { agent, warnings };
}

function markdownFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) found.push(path);
  }
  return found.toSorted();
}

function loadDirectory(dir: string, source: AgentSource, warnings: string[]): AgentDefinition[] {
  let files: string[];
  try {
    if (!statSync(dir).isDirectory()) return [];
    files = markdownFiles(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const agents: AgentDefinition[] = [];
  for (const file of files) {
    if (statSync(file).size > maxFileBytes) continue;
    const parsed = parseAgentFile(file, readFileSync(file, 'utf8'), source, dir);
    warnings.push(...parsed.warnings);
    if (parsed.error) warnings.push(parsed.error);
    if (parsed.agent) agents.push(parsed.agent);
  }
  return agents;
}

export function defaultUserDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const agentDir = env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
  return [join(agentDir, 'agents'), join(homedir(), '.claude', 'agents')];
}

function projectDirs(root: string): string[] {
  return [join(root, '.pi', 'agents'), join(root, '.claude', 'agents')];
}

function duplicateLogs(agents: readonly AgentDefinition[]): string[] {
  const groups = new Map<string, AgentDefinition[]>();
  for (const agent of agents) {
    const key = `${agent.source}\0${agent.baseDir}\0${agent.agentType}`;
    groups.set(key, [...(groups.get(key) ?? []), agent]);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const first = group[0];
      const paths = group.map((agent) => agent.filePath ?? agent.baseDir);
      return `[agents] Duplicate agent name '${sanitizeDisplay(first?.agentType ?? '')}' (${first?.source}): ${paths.join(', ')} — active: ${paths[0]}`;
    });
}

export function discoverAgents(options: DiscoveryOptions): Discovery {
  const root = resolve(options.root);
  const cached = cache.get(root);
  if (cached) return cached;
  const env = options.env ?? process.env;
  const warnings: string[] = [];
  const logs: string[] = [];
  let candidates: AgentDefinition[] = [...builtinAgents(env)];
  if (!options.safeMode) {
    try {
      candidates = [
        ...candidates,
        ...(options.pluginAgents ?? []),
        ...(options.userDirs ?? defaultUserDirs(env)).flatMap((dir) => loadDirectory(dir, 'userSettings', warnings)),
        ...(options.additionalDirs ?? []).flatMap((dir) => loadDirectory(dir, 'projectSettings', warnings)),
        ...projectDirs(root).flatMap((dir) => loadDirectory(dir, 'projectSettings', warnings)),
        ...(options.flagAgents ?? []),
        ...(options.policyAgents ?? []),
      ];
    } catch (error) {
      logs.push(`Error loading agent definitions: ${String(error)}`);
      candidates = [...builtinAgents(env)];
    }
  } else warnings.push('Safe mode: all customizations are disabled (CLAUDE.md, skills, plugins, hooks, MCP, agents, and more)');
  logs.push(...duplicateLogs(candidates));
  const winners = new Map<string, AgentDefinition>();
  for (const source of precedence) for (const agent of candidates) if (agent.source === source) winners.set(agent.agentType, agent);
  const result: Discovery = {
    allAgents: candidates,
    activeAgents: [...winners.values()].toSorted((left, right) => left.agentType.toLowerCase().localeCompare(right.agentType.toLowerCase())),
    logs,
    warnings,
  };
  cache.set(root, result);
  return result;
}
