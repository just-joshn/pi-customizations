/**
 * Agent discovery and configuration
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { type MemoryScope, MemoryScopeSchema } from './memory.ts';

export type AgentScope = 'user' | 'project' | 'both';

/** Where an agent came from. Package agents ship in this extension's `agents` directory. */
export type AgentSource = 'package' | 'user' | 'project';

const PACKAGE_AGENTS_DIR = fileURLToPath(new URL('./agents', import.meta.url));

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[] | undefined;
  /** Built-in tools the child must not get, whatever `tools` says. */
  disallowedTools?: string[] | undefined;
  /** The child starts without the project context files Pi would load from its directory. */
  omitContextFiles?: boolean | undefined;
  /** Skills whose bodies are added to the child's system prompt. */
  skills?: string[] | undefined;
  /** The child is stopped after this many assistant turns. */
  maxTurns?: number | undefined;
  model?: string | undefined;
  /** Where the agent keeps a persistent memory directory between runs. */
  memory?: MemoryScope | undefined;
  /** The agent runs in its own git worktree. */
  isolation?: 'worktree' | undefined;
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
}

/**
 * Normalize a frontmatter `tools` value to a list of tool names.
 *
 * Both spellings are valid YAML and both are in use:
 *
 *     tools: read, bash        # string
 *     tools: [read, bash]      # array
 *
 * so accept either. Anything else (a number, a map, a nested list) yields no
 * tools rather than throwing: this runs inside agent discovery, where a single
 * bad file must not take down every other agent in the same directory.
 */
function parseToolList(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const tools = raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim())
    .filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

/**
 * Frontmatter values are `unknown` because `parseFrontmatter` runs a real YAML parser, so any scalar or collection can
 * appear. `name` and `description` are required strings, and `tools` and `model` may be absent or of any type: the agent
 * is built from them by hand, since a non-string `model` is dropped and `tools` is normalized rather than rejected.
 */
const AgentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  tools: z.unknown().optional(),
  model: z.unknown().optional(),
  disallowedTools: z.unknown().optional(),
  omitContextFiles: z.unknown().optional(),
  skills: z.unknown().optional(),
  maxTurns: z.unknown().optional(),
  memory: z.unknown().optional(),
  isolation: z.unknown().optional(),
});

const MAX_PRELOADED_SKILLS = 32;
const WILDCARD_TOOL = '*';

/** A frontmatter `disallowedTools` list, where `*` names nothing in particular and so is dropped. */
function parseDisallowedTools(value: unknown): string[] | undefined {
  const tools = parseToolList(value)?.filter((tool) => tool !== WILDCARD_TOOL);
  return tools && tools.length > 0 ? tools : undefined;
}

function parseSkillList(value: unknown): string[] | undefined {
  const names = parseToolList(value);
  return names ? [...new Set(names)].slice(0, MAX_PRELOADED_SKILLS) : undefined;
}

const PositiveInteger = z.number().int().positive();
const parseMemory = (value: unknown): MemoryScope | undefined => MemoryScopeSchema.safeParse(value).data;
const parseIsolation = (value: unknown): 'worktree' | undefined => z.literal('worktree').safeParse(value).data;
const parseMaxTurns = (value: unknown): number | undefined => PositiveInteger.safeParse(value).data;

function readAgentFile(dir: string, entry: fs.Dirent, source: AgentSource): AgentConfig | undefined {
  if (!entry.name.endsWith('.md')) return undefined;
  if (!entry.isFile() && !entry.isSymbolicLink()) return undefined;

  const filePath = path.join(dir, entry.name);
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }

  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
  const parsed = AgentFrontmatterSchema.safeParse(frontmatter);
  if (!parsed.success) return undefined;
  const { name, description, tools, model, disallowedTools, omitContextFiles, skills, maxTurns, memory, isolation } = parsed.data;
  return {
    name,
    description,
    tools: parseToolList(tools),
    disallowedTools: parseDisallowedTools(disallowedTools),
    omitContextFiles: omitContextFiles === true,
    skills: parseSkillList(skills),
    maxTurns: parseMaxTurns(maxTurns),
    memory: parseMemory(memory),
    isolation: parseIsolation(isolation),
    model: typeof model === 'string' ? model : undefined,
    systemPrompt: body,
    source,
    filePath,
  };
}

function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
  if (!fs.existsSync(dir)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const agent = readAgentFile(dir, entry, source);
    return agent ? [agent] : [];
  });
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, CONFIG_DIR_NAME, 'agents');
    if (isDirectory(candidate)) return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
  const userDir = path.join(getAgentDir(), 'agents');
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);

  // Only the user and both scopes read user agents. Any other value is read as the project scope, as it always was.
  const userAgents = scope === 'user' || scope === 'both' ? loadAgentsFromDir(userDir, 'user') : [];
  const projectAgents = scope === 'user' || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, 'project');

  // Later entries win: user agents override the agents this package ships, and project agents override both.
  const packageAgents = loadAgentsFromDir(PACKAGE_AGENTS_DIR, 'package');
  const agentMap = new Map([...packageAgents, ...userAgents, ...projectAgents].map((agent) => [agent.name, agent] as const));

  return { agents: Array.from(agentMap.values()), projectAgentsDir };
}
