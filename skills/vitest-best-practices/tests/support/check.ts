import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { type ParsedMarkdown, parseMarkdown } from './markdown.ts';
import { typecheckBlocks } from './typecheck.ts';

export interface TypecheckException {
  file: string;
  blockContains: string;
  codes: number[];
  reason: string;
}

const SKILL_ROOT = resolve(import.meta.dirname, '../..');

const NOT_SKILL_CONTENT = new Set(['tests', 'node_modules']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return NOT_SKILL_CONTENT.has(entry) ? [] : walk(path);
    return path.endsWith('.md') ? [path] : [];
  });
}

export function referenceFiles(skillDir: string): string[] {
  return walk(skillDir)
    .map((file) => relative(skillDir, file))
    .sort();
}

const parsed = new Map<string, ParsedMarkdown>();
function parse(path: string): ParsedMarkdown {
  const cached = parsed.get(path);
  if (cached) return cached;
  const result = parseMarkdown(readFileSync(path, 'utf8'));
  parsed.set(path, result);
  return result;
}

function localTargets(skillDir: string, rel: string): string[] {
  return parse(join(skillDir, rel))
    .links.filter((href) => !/^[a-z]+:/i.test(href) && !href.startsWith('#'))
    .map((href) => relative(skillDir, resolve(dirname(join(skillDir, rel)), decodeURI(href.split('#')[0] ?? ''))));
}

/** Paths written in SKILL.md's decision tree, which lives in a plain code fence. */
function treePaths(skillDir: string, entry: string): string[] {
  return parse(join(skillDir, entry))
    .blocks.filter((block) => block.lang === '')
    .flatMap((block) => [...block.code.matchAll(/[\w-]+\/[\w*-]+\.md/g)].map((match) => match[0]));
}

function frontmatterProblems(skillDir: string, entry: string): string[] {
  let frontmatter: Record<string, unknown> | undefined;
  try {
    frontmatter = parseYaml(parse(join(skillDir, entry)).frontmatter ?? '');
  } catch (error) {
    return [`frontmatter is not valid YAML: ${String(error).split('\n')[0]}`];
  }
  const problems: string[] = [];
  const name = frontmatter?.['name'];
  const description = frontmatter?.['description'];
  if (name !== 'vitest-best-practices') problems.push(`frontmatter name is ${String(name)}`);
  if (typeof description !== 'string' || description.length < 50) problems.push('frontmatter description is missing or too short');
  return problems;
}

/** `entry` is the router file; the test fixture uses another name so Pi never discovers it as a skill. */
export function checkSkill(skillDir: string, entry = 'SKILL.md'): string[] {
  const problems = frontmatterProblems(skillDir, entry);
  const linked = new Set(localTargets(skillDir, entry));
  for (const rel of referenceFiles(skillDir)) {
    if (rel !== entry && !linked.has(rel)) problems.push(`${rel} is not linked from ${entry}`);
  }
  for (const path of treePaths(skillDir, entry)) {
    if (!existsSync(join(skillDir, path))) problems.push(`decision tree path does not exist: ${path}`);
  }
  return problems;
}

export function checkFile(skillDir: string, rel: string, exceptions: readonly TypecheckException[] = []): string[] {
  const problems = localTargets(skillDir, rel)
    .filter((target) => !existsSync(join(skillDir, target)))
    .map((target) => `${rel}: broken link ${target}`);
  for (const problem of typecheckBlocks(SKILL_ROOT, rel, parse(join(skillDir, rel)).blocks)) {
    const excused = exceptions.some((e) => e.file === rel && problem.block.code.includes(e.blockContains) && e.codes.includes(problem.code));
    if (!excused) problems.push(problem.message);
  }
  return problems;
}

export function staleExceptions(skillDir: string, exceptions: readonly TypecheckException[]): TypecheckException[] {
  return exceptions.filter((e) => {
    const inBlock = typecheckBlocks(SKILL_ROOT, e.file, parse(join(skillDir, e.file)).blocks).filter((problem) => problem.block.code.includes(e.blockContains));
    return !e.codes.every((code) => inBlock.some((problem) => problem.code === code));
  });
}
