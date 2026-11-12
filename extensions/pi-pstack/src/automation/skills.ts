// Finds a skill the way Pi's own discovery does, so a Benny config can name a skill the project owns. A name is the
// Agent Skills name syntax, which has no path separator, so it cannot leave the directory it is looked up in.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { PACKAGE_ROOT } from '../paths.ts';

export interface SkillLocations {
  projectRoot: string;
  home?: string;
  packageRoot?: string;
}

export type ResolvedSkill = { ok: true; path: string } | { ok: false; problem: string };

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DEPTH = 3;

export const isSkillName = (value: string) => value.length <= 64 && SKILL_NAME.test(value);

/** `.agents/skills` from the project root up to the repository root (or the filesystem root when there is none). */
function agentsDirs(projectRoot: string): string[] {
  const dirs: string[] = [];
  for (let dir = resolve(projectRoot); ; dir = dirname(dir)) {
    dirs.push(join(dir, '.agents', 'skills'));
    if (existsSync(join(dir, '.git')) || dirname(dir) === dir) return dirs;
  }
}

/** Every directory Pi scans for skills, in precedence order. */
export function skillDirectories(locations: SkillLocations): string[] {
  const home = locations.home ?? homedir();
  const agentDir = process.env['PI_CODING_AGENT_DIR'] ?? join(home, '.pi', 'agent');
  return [join(resolve(locations.projectRoot), '.pi', 'skills'), ...agentsDirs(locations.projectRoot), join(agentDir, 'skills'), join(home, '.agents', 'skills'), join(locations.packageRoot ?? PACKAGE_ROOT, 'generated', 'skills')];
}

/** `<dir>/**\/<name>/SKILL.md`. A directory that holds a SKILL.md is a skill, and its children are not searched. */
function find(dir: string, name: string, depth: number): string | undefined {
  const direct = join(dir, name, 'SKILL.md');
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  if (depth === 0 || !existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules' || existsSync(join(dir, entry.name, 'SKILL.md'))) continue;
    const found = find(join(dir, entry.name), name, depth - 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function resolveSkill(name: string, locations: SkillLocations): ResolvedSkill {
  if (!isSkillName(name)) return { ok: false, problem: `${JSON.stringify(name)} is not a skill name` };
  const directories = skillDirectories(locations);
  for (const dir of directories) {
    const found = find(dir, name, MAX_DEPTH);
    if (found !== undefined) return { ok: true, path: found };
  }
  return { ok: false, problem: `skill ${name} is not in any Pi skill location (${directories.join(', ')})` };
}
