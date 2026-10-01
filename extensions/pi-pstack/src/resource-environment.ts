import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';

const authoritativeResources = new Map([['origin', fileURLToPath(new URL('../host/skills/origin/SKILL.md', import.meta.url))]]);

function exclusions(frontmatter: Record<string, unknown>, path: string): string[] {
  const disabled = frontmatter['disabled-environments'];
  if (disabled === undefined) return [];
  if (!Array.isArray(disabled) || !disabled.every((item): item is string => typeof item === 'string')) throw new Error(`Invalid disabled-environments in ${path}`);
  return disabled;
}

export function availableInEnvironment(path: string, environment: 'local' | 'cloud'): boolean {
  const { frontmatter } = parseFrontmatter<Record<string, unknown>>(readFileSync(path, 'utf8'));
  const declared = exclusions(frontmatter, path);
  const name = frontmatter.name ?? (basename(path) === 'SKILL.md' ? basename(dirname(path)) : basename(path, '.md'));
  const authoritative = typeof name === 'string' ? authoritativeResources.get(name) : undefined;
  const inherited = authoritative ? exclusions(parseFrontmatter<Record<string, unknown>>(readFileSync(authoritative, 'utf8')).frontmatter, authoritative) : [];
  return ![...declared, ...inherited].includes(environment);
}
