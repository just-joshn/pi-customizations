import { existsSync, linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';

const RULE_SECTION_LIMIT = 8_000;
const LEGACY_RULE_NAME = 'pstack-models.mdc';

export function readRule(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

/**
 * Earlier versions kept the rule as `pstack-models.mdc` with frontmatter. Moves its body to the plain Markdown rule
 * once, when only the old file exists, and keeps the old file as `pstack-models.mdc.migrated`.
 */
const errno = (error: unknown) => (typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined);

export function migrateLegacyRule(path: string): void {
  const legacy = join(dirname(path), LEGACY_RULE_NAME);
  const migrated = `${legacy}.migrated`;
  let text: string;
  try {
    text = readFileSync(legacy, 'utf8');
  } catch (error) {
    if (errno(error) === 'ENOENT') return;
    throw error;
  }
  const { body } = parseFrontmatter(text);
  try {
    writeFileSync(path, `${body.trim()}\n`, { flag: 'wx' });
  } catch (error) {
    if (errno(error) === 'EEXIST') return;
    throw error;
  }
  try {
    linkSync(legacy, migrated);
  } catch (error) {
    const code = errno(error);
    if (code === 'EEXIST' || code === 'ENOENT') return;
    throw error;
  }
  try {
    unlinkSync(legacy);
  } catch (error) {
    if (errno(error) !== 'ENOENT') throw error;
  }
}

/** The rule inline and bounded. A stray frontmatter block is not part of the rule. */
export function modelsSection(ruleText: string | undefined, path: string): string {
  if (ruleText === undefined) return `No pstack model rule exists at ${path}. Every role uses its skill default until /setup-pstack writes one.`;
  const body = parseFrontmatter(ruleText).body.trim();
  if (body.length <= RULE_SECTION_LIMIT) return `Path: ${path}\n${body}`;
  return `Path: ${path}\n${body.slice(0, RULE_SECTION_LIMIT)}\n[truncated: the rule is ${body.length} characters; read ${path} for the rest]`;
}
