import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { availableInEnvironment } from './resource-environment.ts';

export type Skills = ReadonlyMap<string, { path: string; body: string; description: string }>;

export async function loadAllSkills(root: string, environment: 'local' | 'cloud'): Promise<Skills> {
  const skillsDir = join(root, 'skills');
  const hostSkillsDir = join(root, 'host/skills');
  const [bundled, host] = await Promise.all([names(skillsDir), names(hostSkillsDir)]);
  const entries = await Promise.all([
    ...bundled.filter((name) => availableInEnvironment(join(skillsDir, name, 'SKILL.md'), environment)).map((name) => loadSkill(join(skillsDir, name))),
    ...host.filter((name) => availableInEnvironment(join(hostSkillsDir, name, 'SKILL.md'), environment)).map((name) => loadSkill(join(hostSkillsDir, name))),
  ]);
  const map = new Map<string, { path: string; body: string; description: string }>();
  for (const entry of entries) {
    const name = entry.path.split('/').at(-2);
    if (name === undefined) throw new Error(`Cannot derive a skill name from ${entry.path}`);
    const existing = map.get(name);
    if (existing) throw new Error(`Duplicate skill name ${name} at ${existing.path} and ${entry.path}`);
    map.set(name, entry);
  }
  return map;
}

async function names(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).toSorted();
}

async function loadSkill(directory: string) {
  const path = join(directory, 'SKILL.md');
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(await readFile(path, 'utf8'));
  if (typeof frontmatter['description'] !== 'string') throw new Error(`Missing description in ${path}`);
  return { path, body, description: frontmatter['description'] };
}