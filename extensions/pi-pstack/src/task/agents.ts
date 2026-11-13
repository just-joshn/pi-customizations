import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { AGENTS_DIR } from '../paths.ts';

/** A subagent type Task can launch: a built-in type or an agent file this package ships. */
export interface AgentDefinition {
  type: string;
  description: string;
  /** explore's default when the call names no model: the parent model's -fast variant, standing in for Cursor's fast explore models. */
  defaultsToFastModel?: boolean;
  readonly: boolean;
  /** False for a type that never launches subagents of its own, such as Cursor's built-in explore. */
  spawns?: boolean;
  /** Pi tools this type turns on beyond Pi's defaults, such as explore's search tools. */
  tools?: readonly string[];
  /** When present, the type can use only these native tools, even if another extension activates more. */
  onlyTools?: readonly string[];
  /** What the child reads after the shared subagent reminder: a built-in type's instructions, or an agent file's framing and body. */
  reminder: string;
  file?: string;
}

export const GENERAL_PURPOSE: AgentDefinition = {
  type: 'generalPurpose',
  description: "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. Use when searching for a keyword or file and not confident you'll find the match quickly.",
  readonly: false,
  reminder: '',
};

// Cursor desktop 3.27.22 built-in explore; its first sentence names Pi instead of Cursor.
export const EXPLORE: AgentDefinition = {
  type: 'explore',
  defaultsToFastModel: true,
  description:
    'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
  readonly: false,
  spawns: false,
  tools: ['grep', 'find', 'ls'],
  reminder: [
    'You are a file search specialist for Pi, an application to write code with AI. You excel at thoroughly navigating and exploring codebases.',
    '',
    'Your strengths:',
    '- Rapidly finding files using glob patterns',
    '- Searching code and text with powerful regex patterns',
    '- Reading and analyzing file contents',
    '',
    'Guidelines:',
    '- Adapt your search approach based on the thoroughness level specified by the caller',
    '- Return file paths as absolute paths in your final response',
    '- For clear communication, avoid using emojis',
    '- Communicate your final report directly as a regular message',
    '',
    'NOTE: You are meant to be a fast agent that returns output as quickly as possible. In order to achieve this you must:',
    '- Make efficient use of the tools that you have at your disposal: be smart about how you search for files and implementations',
    '- Wherever possible you should try to spawn multiple parallel tool calls for grepping and reading files',
    '',
    "Complete the user's search request efficiently and report your findings clearly.",
  ].join('\n'),
};

export const SHELL: AgentDefinition = {
  type: 'shell',
  description: 'Command execution specialist for running bash commands. Use this for git operations, command execution, and other terminal tasks.',
  readonly: false,
  spawns: false,
  onlyTools: ['bash', 'bash_background'],
  reminder: [
    'You are a command execution specialist. Your role is to execute shell commands efficiently and safely.',
    '',
    'Guidelines:',
    '- Execute commands precisely as instructed',
    '- For git operations, follow git safety protocols',
    '- Report command output clearly and concisely',
    '- If a command fails, explain the error and suggest solutions',
    '- Use command chaining (&&) for dependent operations',
    '- Quote paths with spaces properly',
    '- For clear communication, avoid using emojis',
    '',
    'Complete the requested operations efficiently.',
  ].join('\n'),
};

/**
 * An agent file as Cursor loads a plugin's agents: YAML front matter, the name from `name` or the file name, readonly
 * only from `permissionMode`, and the parent model in the foreground, since Cursor strips `model` and `tools` and drops
 * `is_background` for plugin agents. A file that fails to parse or has no body is skipped.
 */
function parseAgentFile(file: string): AgentDefinition | undefined {
  let parsed: ReturnType<typeof parseFrontmatter>;
  try {
    parsed = parseFrontmatter(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
  const { frontmatter, body } = parsed;
  const prompt = body.trim();
  if (prompt === '') return undefined;
  const name = frontmatter['name'];
  const type = typeof name === 'string' ? name : basename(file, extname(file)).replace(/[\s_]+/g, '-');
  const description = typeof frontmatter['description'] === 'string' ? frontmatter['description'] : '';
  const permissionMode = frontmatter['permissionMode'] ?? frontmatter['permissionmode'];
  const framing = [`You are operating as the "${type}" custom subagent. DO NOT create unnecessary markdown files unless explicitly requested by the user.`, ...(description === '' ? [] : [description])].join('\n');
  return {
    type,
    description,
    readonly: typeof permissionMode === 'string' && permissionMode.trim().toLowerCase() === 'readonly',
    reminder: `${framing}\n\n${prompt}`,
    file,
  };
}

/** Built-in types first, then every `*.md` agent file in `dir` sorted by file name. The first type with a name wins. */
export function loadAgentDefinitions(dir: string = AGENTS_DIR): AgentDefinition[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .toSorted();
  const agents = [GENERAL_PURPOSE, EXPLORE, SHELL];
  for (const agent of files.map((name) => parseAgentFile(join(dir, name)))) if (agent !== undefined && !agents.some((known) => known.type === agent.type)) agents.push(agent);
  return agents;
}

/** Cursor's subagent type key: case, hyphens, underscores, and a trailing agent, mode, type, or subagent do not matter. */
export function normalizedType(type: string): string {
  const key = type
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, '')
    .replace(/(?<=.)(subagenttype|subagent|agent|mode|type)+$/, '');
  return key === 'mediareview' ? 'videoreview' : key;
}

export function findAgent(agents: readonly AgentDefinition[], type: string | undefined): AgentDefinition {
  const wanted = type === undefined || type.trim() === '' ? GENERAL_PURPOSE.type : type;
  const key = normalizedType(wanted);
  const agent = agents.find((candidate) => normalizedType(candidate.type) === key);
  if (agent) return agent;
  throw new Error(`Unknown subagent_type "${wanted}". Available subagent types: ${agents.map((candidate) => candidate.type).join(', ')}.`);
}
