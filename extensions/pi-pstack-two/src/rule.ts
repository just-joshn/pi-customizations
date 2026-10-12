import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripFrontmatter } from '@earendil-works/pi-coding-agent';

const RULE_SECTION_LIMIT = 8_000;
const WRITE_TOOLS = new Set(['write', 'edit']);

export interface GuardContext {
  cwd: string;
  home: string;
  piRulePath: string;
}

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const caseInsensitive = process.platform === 'darwin' || process.platform === 'win32';

/** The file a path names: the realpath of its nearest existing ancestor plus the rest, so a symlinked folder matches before rules/ exists. */
function canonical(path: string): string {
  let existing = resolve(path);
  const missing: string[] = [];
  while (!existsSync(existing) && dirname(existing) !== existing) {
    missing.unshift(basename(existing));
    existing = dirname(existing);
  }
  const target = join(existsSync(existing) ? realpathSync(existing) : existing, ...missing);
  return caseInsensitive ? target.toLowerCase() : target;
}

/** Mirrors how Pi's write and edit tools resolve a path (resolveToCwd, not exported): spaces, @, ~, file://, then cwd. */
function resolveToolPath(raw: string, cwd: string, home: string): string {
  let path = raw.replace(UNICODE_SPACES, ' ');
  if (path.startsWith('@')) path = path.slice(1);
  if (path === '~' || path.startsWith('~/')) path = join(home, path.slice(1));
  if (path.startsWith('file://')) path = fileURLToPath(path);
  return canonical(isAbsolute(path) ? resolve(path) : resolve(cwd, path));
}

/** The block reason when a write or edit targets Cursor's own pstack rule, otherwise undefined. */
export function cursorRuleWriteReason(toolName: string, input: Record<string, unknown>, context: GuardContext): string | undefined {
  const raw = input['path'];
  if (!WRITE_TOOLS.has(toolName) || typeof raw !== 'string') return undefined;
  const cursorRule = canonical(join(context.home, '.cursor', 'rules', 'pstack-models.mdc'));
  if (resolveToolPath(raw, context.cwd, context.home) !== cursorRule) return undefined;
  return `pstack's model rule lives at ${context.piRulePath} in Pi. Write that file instead; ~/.cursor/rules/pstack-models.mdc belongs to Cursor.`;
}

export function readRule(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

/** The always-applied rule as Cursor would inline it: the body, without frontmatter, bounded in size. */
export function modelsSection(ruleText: string | undefined, path: string): string {
  if (ruleText === undefined) return `No pstack model rule exists at ${path}. Every role uses its skill default until /setup-pstack writes one.`;
  const body = stripFrontmatter(ruleText).trim();
  if (body.length <= RULE_SECTION_LIMIT) return `Path: ${path}\n${body}`;
  return `Path: ${path}\n${body.slice(0, RULE_SECTION_LIMIT)}\n[truncated: the rule is ${body.length} characters; read ${path} for the rest]`;
}
