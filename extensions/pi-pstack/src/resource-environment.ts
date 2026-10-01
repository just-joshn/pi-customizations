import { readFileSync } from 'node:fs';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';

export function availableInEnvironment(path: string, environment: 'local' | 'cloud'): boolean {
  const { frontmatter } = parseFrontmatter<Record<string, unknown>>(readFileSync(path, 'utf8'));
  const disabled = frontmatter['disabled-environments'];
  if (disabled === undefined) return true;
  if (!Array.isArray(disabled) || !disabled.every((item): item is string => typeof item === 'string')) throw new Error(`Invalid disabled-environments in ${path}`);
  return !disabled.includes(environment);
}
