import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_DIR_NAME, getAgentDir, stripFrontmatter } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';

export const PACKAGE_SKILLS_DIR = fileURLToPath(new URL('../../skills', import.meta.url));
const AGENTS_DIR_NAME = '.agents';
const SKILL_FILE = 'SKILL.md';

/** A skill name is one path segment, so a frontmatter entry cannot reach outside a skills directory. */
const SkillName = z.string().regex(/^[\w][\w.-]*$/);

/** Where a skill may live, in the order they are searched: the project's, the user's, then this package's. */
const skillRoots = (cwd: string): string[] => [
  path.join(cwd, CONFIG_DIR_NAME, 'skills'),
  path.join(cwd, AGENTS_DIR_NAME, 'skills'),
  path.join(getAgentDir(), 'skills'),
  path.join(os.homedir(), AGENTS_DIR_NAME, 'skills'),
  PACKAGE_SKILLS_DIR,
];

function readSkill(root: string, name: string): string | undefined {
  const file = path.join(root, name, SKILL_FILE);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return undefined;
  return stripFrontmatter(fs.readFileSync(file, 'utf-8')).trim();
}

function findSkill(name: string, cwd: string): string | undefined {
  if (!SkillName.safeParse(name).success) return undefined;
  for (const root of skillRoots(cwd)) {
    const body = readSkill(root, name);
    if (body !== undefined) return body;
  }
  return undefined;
}

/** The system prompt of an agent with the skills it names appended. A skill that cannot be found is left out. */
export function withPreloadedSkills(systemPrompt: string, skills: readonly string[] | undefined, cwd: string): string {
  const loaded = (skills ?? []).flatMap((name) => {
    const body = findSkill(name, cwd);
    return body === undefined ? [] : [`Loaded agent skill: ${name}\n\n${body}`];
  });
  return loaded.length === 0 ? systemPrompt : [systemPrompt.trim(), ...loaded].filter(Boolean).join('\n\n');
}
