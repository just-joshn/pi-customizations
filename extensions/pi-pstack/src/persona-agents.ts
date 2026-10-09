import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { type AgentDefinition, allTools, customPromptParts } from './subagents/agent-definition.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

/** File-backed Task personas that the lowercase `task` tool must also resolve. */
const bridged = [
  { name: 'poteto-agent', file: 'upstream/agents/poteto-agent.md' },
  { name: 'comment-sicko', file: 'upstream/agents/comment-sicko.md' },
  { name: 'Comment Sicko', file: 'upstream/agents/comment-sicko.md' },
  { name: 'ci-watcher', file: 'upstream-team-kit/agents/ci-watcher.md' },
  {
    name: 'thermo-nuclear-code-quality-review',
    file: 'upstream-team-kit/agents/thermo-nuclear-code-quality-review.md',
  },
] as const;

function loadAgent(name: string, file: string): AgentDefinition {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(text);
  const description =
    typeof frontmatter['description'] === 'string' && frontmatter['description'].trim()
      ? frontmatter['description'].trim()
      : name;
  return {
    name,
    displayName: name,
    description,
    tools: allTools,
    promptParts: customPromptParts,
    prompt: body.trim(),
    userInvocable: true,
    disableModelInvocation: false,
    source: 'plugin',
    path,
    plugin: 'pstack',
    promptOverridable: true,
    disableable: true,
  };
}

let cached: readonly AgentDefinition[] | undefined;

/** Plugin personas offered through lowercase `task` `agent_type` (and listed in its description). */
export function personaTaskAgents(): readonly AgentDefinition[] {
  if (!cached) cached = bridged.map(({ name, file }) => loadAgent(name, file));
  return cached;
}
