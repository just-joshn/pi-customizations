import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';
import type { TypecheckException } from './exceptions.ts';
import { type ParsedMarkdown, parseMarkdown } from './markdown.ts';
import { typecheckBlocks } from './typecheck.ts';

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

function read(skillDir: string, rel: string): ParsedMarkdown {
  return parseMarkdown(readFileSync(join(skillDir, rel), 'utf8'));
}

function localTargets(skillDir: string, rel: string, markdown: ParsedMarkdown): string[] {
  return markdown.links.filter((href) => !/^[a-z]+:/i.test(href) && !href.startsWith('#')).map((href) => relative(skillDir, resolve(dirname(join(skillDir, rel)), decodeURI(href.split('#')[0] ?? ''))));
}

/** Paths in SKILL.md's decision tree. The tree is a plain code fence, as in the Playwright skill it mirrors, so the link check can't see them. */
function treePaths(markdown: ParsedMarkdown): string[] {
  return markdown.blocks.filter((block) => block.lang === '').flatMap((block) => [...block.code.matchAll(/[\w-]+\/[\w*-]+\.md/g)].map((match) => match[0]));
}

function frontmatterProblems(skillDir: string, markdown: ParsedMarkdown): string[] {
  let frontmatter: Record<string, unknown> | undefined;
  try {
    frontmatter = parseYaml(markdown.frontmatter ?? '');
  } catch (error) {
    return [`frontmatter is not valid YAML: ${String(error).split('\n')[0]}`];
  }
  const problems: string[] = [];
  const name = frontmatter?.['name'];
  const description = frontmatter?.['description'];
  if (name !== basename(skillDir)) problems.push(`frontmatter name ${String(name)} does not match the directory ${basename(skillDir)}`);
  if (typeof description !== 'string' || description.length < 50) problems.push('frontmatter description is missing or too short');
  return problems;
}

/** `entry` is the router file; the test fixture uses another name so Pi never discovers it as a skill. */
export function checkSkill(skillDir: string, entry: string, exceptions: readonly TypecheckException[]): string[] {
  const router = read(skillDir, entry);
  const problems = frontmatterProblems(skillDir, router);
  const files = referenceFiles(skillDir);
  for (const exception of exceptions) {
    if (!files.includes(exception.file)) problems.push(`exception names a file that does not exist: ${exception.file}`);
  }
  const linked = new Set(localTargets(skillDir, entry, router));
  for (const rel of files) {
    if (rel !== entry && !linked.has(rel)) problems.push(`${rel} is not linked from ${entry}`);
  }
  for (const path of treePaths(router)) {
    if (!existsSync(join(skillDir, path))) problems.push(`decision tree path does not exist: ${path}`);
  }
  return problems;
}

export function checkFile(skillDir: string, rel: string, exceptions: readonly TypecheckException[]): string[] {
  const markdown = read(skillDir, rel);
  const problems = localTargets(skillDir, rel, markdown)
    .filter((target) => !existsSync(join(skillDir, target)))
    .map((target) => `${rel}: broken link ${target}`);
  const own = exceptions.filter((e) => e.file === rel);
  const excusedCodes = new Map(own.map((e) => [e, new Set<number>()]));
  for (const problem of typecheckBlocks(rel, markdown.blocks)) {
    const exception = own.find((e) => problem.block.code.includes(e.blockContains) && e.codes.includes(problem.code));
    if (exception) excusedCodes.get(exception)?.add(problem.code);
    else problems.push(problem.message);
  }
  for (const [exception, seen] of excusedCodes) {
    for (const code of exception.codes) {
      if (!seen.has(code)) problems.push(`${rel}: stale exception "${exception.blockContains}" TS${code}`);
    }
  }
  return problems;
}
