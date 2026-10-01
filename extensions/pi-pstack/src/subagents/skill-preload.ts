import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { type AgentSession, parseFrontmatter, type Skill } from '@earendil-works/pi-coding-agent';
import type { AgentDefinition } from './definitions.ts';

function carried(session: AgentSession, requested: string, filePath?: string): boolean {
  return session.messages.some((message) => {
    if (message.role !== 'custom' || message.customType !== 'pstack-skill-preload') return false;
    const details: unknown = message.details;
    return typeof details === 'object' && details !== null && (('requested' in details && details.requested === requested) || (filePath !== undefined && 'filePath' in details && details.filePath === filePath));
  });
}

export async function preloadSkills(session: AgentSession, skills: readonly Skill[], definition: AgentDefinition, log: (message: string) => void): Promise<void> {
  for (const requested of definition.skills ?? []) {
    if (carried(session, requested)) continue;
    const exact = skills.find((skill) => skill.name === requested);
    const aliases = skills.filter((skill) => basename(skill.baseDir) === requested);
    const skill = exact ?? (aliases.length === 1 ? aliases[0] : undefined);
    const warning = `[Agent: ${definition.agentType}] Warning: Skill '${requested}' specified in frontmatter`;
    if (!skill) {
      log(`${warning} was not found`);
      continue;
    }
    if (carried(session, requested, skill.filePath)) continue;
    let body: string;
    try {
      body = parseFrontmatter(await readFile(skill.filePath, 'utf8')).body;
    } catch (error) {
      log(`${warning} could not be read: ${String(error)}`);
      continue;
    }
    try {
      await session.sendCustomMessage(
        { customType: 'pstack-skill-preload', content: `Skill ${skill.name}.\nBase directory ${skill.baseDir}.\n\n${body}`, display: false, details: { requested, name: skill.name, filePath: skill.filePath } },
        { triggerTurn: false },
      );
    } catch (error) {
      log(`${warning} could not be preloaded: ${String(error)}`);
      continue;
    }
    log(`[Agent: ${definition.agentType}] Preloaded skill '${skill.name}'`);
  }
}
