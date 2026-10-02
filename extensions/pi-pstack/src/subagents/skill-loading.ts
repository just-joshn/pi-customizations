import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { type AgentSession, parseFrontmatter, type Skill } from '@earendil-works/pi-coding-agent';

export const noParentSkillsMessage = 'subagent requested skills but the parent session has no loaded skills';
export const skillCopyFailure = 'failed to copy parent skills onto subagent session';

function find(skills: readonly Skill[], requested: string): Skill | undefined {
  const exact = skills.find((skill) => skill.name === requested);
  if (exact) return exact;
  const aliases = skills.filter((skill) => basename(skill.baseDir) === requested);
  return aliases.length === 1 ? aliases[0] : undefined;
}

async function body(skill: Skill): Promise<string> {
  return parseFrontmatter(await readFile(skill.filePath, 'utf8')).body;
}

export async function preloadSkills(session: AgentSession, skills: readonly Skill[], requested: readonly string[], agent: string, log: (message: string) => void): Promise<void> {
  if (requested.length === 0) return;
  if (skills.length === 0) {
    log(`[Agent: ${agent}] ${noParentSkillsMessage}`);
    return;
  }
  for (const name of requested) {
    const skill = find(skills, name);
    if (!skill) {
      log(`[Agent: ${agent}] Skill '${name}' was not found`);
      continue;
    }
    try {
      const content = `Skill ${skill.name}.\nBase directory ${skill.baseDir}.\n\n${await body(skill)}`;
      await session.sendCustomMessage({ customType: 'pstack-skill-preload', content, display: false, details: { requested: name, name: skill.name, filePath: skill.filePath } }, { triggerTurn: false });
      log(`[Agent: ${agent}] Preloaded skill '${skill.name}'`);
    } catch (error) {
      log(`[Agent: ${agent}] ${skillCopyFailure}: ${String(error)}`);
    }
  }
}
