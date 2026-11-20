/**
 * Agent discovery and configuration
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';

export type AgentScope = 'user' | 'project' | 'both';

/** Where an agent came from. Package agents ship in this extension's `agents` directory. */
export type AgentSource = 'package' | 'user' | 'project';

const PACKAGE_AGENTS_DIR = fileURLToPath(new URL('./agents', import.meta.url));

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[] | undefined;
  model?: string | undefined;
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
});

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
  const { name, description, tools, model } = parsed.data;
  return { name, description, tools: parseToolList(tools), model: typeof model === 'string' ? model : undefined, systemPrompt: body, source, filePath };
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
