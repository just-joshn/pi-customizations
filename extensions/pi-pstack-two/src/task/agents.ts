import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { AGENTS_DIR } from '../paths.ts';

/** A subagent type in Cursor's agent-file format: name, description, model, readonly, is_background, prompt body. */
export interface AgentDefinition {
  type: string;
  description: string;
  model?: string;
  readonly: boolean;
  background: boolean;
  prompt: string;
  file?: string;
}

export const GENERAL_PURPOSE: AgentDefinition = {
  type: 'generalPurpose',
  description: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. Use when a search or task needs several steps of its own.',
  readonly: false,
  background: false,
  prompt: '',
};

function parseAgentFile(file: string): AgentDefinition {
  const { frontmatter, body } = parseFrontmatter(readFileSync(file, 'utf8'));
  const name = frontmatter['name'];
  const description = frontmatter['description'];
  const model = frontmatter['model'];
  return {
    type: typeof name === 'string' && name.trim() !== '' ? name.trim() : basename(file, '.md'),
    description: typeof description === 'string' ? description.trim() : '',
    ...(typeof model === 'string' && model.trim() !== '' ? { model: model.trim() } : {}),
    readonly: frontmatter['readonly'] === true,
    background: frontmatter['is_background'] === true,
    prompt: body.trim(),
    file,
  };
}

/** generalPurpose first, then every `*.md` agent file in `dir` sorted by file name. */
export function loadAgentDefinitions(dir: string = AGENTS_DIR): AgentDefinition[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .toSorted();
  return [GENERAL_PURPOSE, ...files.map((name) => parseAgentFile(join(dir, name)))];
}

export function findAgent(agents: readonly AgentDefinition[], type: string | undefined): AgentDefinition {
  const wanted = type ?? GENERAL_PURPOSE.type;
  const agent = agents.find((candidate) => candidate.type === wanted);
  if (agent) return agent;
  throw new Error(`Unknown subagent_type "${wanted}". Available subagent types: ${agents.map((candidate) => candidate.type).join(', ')}.`);
}
