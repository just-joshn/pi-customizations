import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { AGENTS_DIR } from '../paths.ts';

/** A subagent type from an agent file: name, description, model, readonly, is_background, prompt body. */
export interface AgentDefinition {
  type: string;
  description: string;
  model?: string;
  readonly: boolean;
  background: boolean;
  /** False for a type that never launches subagents of its own, such as Cursor's built-in explore. */
  spawns?: boolean;
  /** Pi tools this type turns on beyond Pi's defaults, such as explore's search tools. */
  tools?: readonly string[];
  prompt: string;
  file?: string;
}

export const GENERAL_PURPOSE: AgentDefinition = {
  type: 'generalPurpose',
  description: "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. Use when searching for a keyword or file and not confident you'll find the match quickly.",
  readonly: false,
  background: false,
  prompt: '',
};

/**
 * Cursor's built-in codebase explorer: a file-search specialist that the caller tells how thorough to be, and that has
 * no Task tool of its own. Cursor documents that it uses a faster model by default; here that is the parent's -fast variant.
 */
export const EXPLORE: AgentDefinition = {
  type: 'explore',
  model: 'fast',
  description:
    'Fast agent specialized for exploring codebases. Use it to find files by pattern (such as "src/components/**/*.tsx"), search code for keywords (such as "API endpoints"), or answer questions about the codebase (such as "how do API endpoints work?"). When you call it, name the thoroughness you want: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for a comprehensive search across many locations and naming conventions.',
  readonly: false,
  background: false,
  spawns: false,
  tools: ['grep', 'find', 'ls'],
  prompt: [
    'You are a file search specialist. You navigate and explore codebases thoroughly.',
    '',
    'You are good at:',
    '- finding files fast with glob patterns (find)',
    '- searching code and text with regular expressions (grep)',
    '- reading and analyzing file contents (read)',
    '',
    'Guidelines:',
    '- Match how hard you search to the thoroughness the caller asked for.',
    '- Give file paths as absolute paths in your final response.',
    '- Do not use emojis.',
    '- Send your final report directly as a regular message.',
    '',
    'You are meant to be fast and to return as soon as you can. Use your tools efficiently: think about where the files and implementations are likely to be, and run several grep and read calls in parallel wherever you can.',
    '',
    "Complete the caller's search request efficiently and report your findings clearly.",
  ].join('\n'),
};

function parseAgentFile(file: string): AgentDefinition {
  const { frontmatter, body } = parseFrontmatter(readFileSync(file, 'utf8'));
  const name = frontmatter['name'];
  const description = frontmatter['description'];
  const model = frontmatter['model'];
  const permissionMode = frontmatter['permissionMode'] ?? frontmatter['permissionmode'];
  return {
    type: typeof name === 'string' && name.trim() !== '' ? name.trim() : basename(file, '.md'),
    description: typeof description === 'string' ? description.trim() : '',
    ...(typeof model === 'string' && model.trim() !== '' ? { model: model.trim() } : {}),
    readonly: frontmatter['readonly'] === true || (typeof permissionMode === 'string' && permissionMode.trim().toLowerCase() === 'readonly'),
    background: frontmatter['is_background'] === true || frontmatter['background'] === true,
    prompt: body.trim(),
    file,
  };
}

/** The built-in types (generalPurpose, explore) first, as Cursor lists them, then every `*.md` agent file in `dir` sorted by file name. */
export function loadAgentDefinitions(dir: string = AGENTS_DIR): AgentDefinition[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .toSorted();
  return [GENERAL_PURPOSE, EXPLORE, ...files.map((name) => parseAgentFile(join(dir, name)))];
}

export function findAgent(agents: readonly AgentDefinition[], type: string | undefined): AgentDefinition {
  const wanted = type ?? GENERAL_PURPOSE.type;
  const agent = agents.find((candidate) => candidate.type === wanted);
  if (agent) return agent;
  throw new Error(`Unknown subagent_type "${wanted}". Available subagent types: ${agents.map((candidate) => candidate.type).join(', ')}.`);
}
