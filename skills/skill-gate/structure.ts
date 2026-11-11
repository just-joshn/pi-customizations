import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { type ParsedMarkdown, parseMarkdown } from './markdown.ts';
import type { Problem } from './problem.ts';

const NOT_SKILL_CONTENT = new Set(['tests', 'harness', 'node_modules', 'coverage']);

export interface SkillFile {
  skillDir: string;
  rel: string;
}

function walk(dir: string, atRoot: boolean): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return atRoot && NOT_SKILL_CONTENT.has(entry) ? [] : walk(path, false);
    return path.endsWith('.md') ? [path] : [];
  });
}

export function referenceFiles(skillDir: string): string[] {
  return walk(skillDir, true)
    .map((file) => relative(skillDir, file))
    .sort();
}

export function readSkillFile({ skillDir, rel }: SkillFile): ParsedMarkdown {
  return parseMarkdown(readFileSync(join(skillDir, rel), 'utf8'));
}

function localTargets({ skillDir, rel }: SkillFile, markdown: ParsedMarkdown): string[] {
  return markdown.links.filter((href) => !/^[a-z]+:/i.test(href) && !href.startsWith('#')).map((href) => relative(skillDir, resolve(dirname(join(skillDir, rel)), decodeURI(href.split('#')[0] ?? ''))));
}

export function brokenLinks(file: SkillFile, markdown: ParsedMarkdown): Problem[] {
  return localTargets(file, markdown)
    .filter((target) => !existsSync(join(file.skillDir, target)))
    .map((target) => ({ kind: 'file', rel: file.rel, message: `broken link ${target}` }));
}

function decisionTreeFencePaths(markdown: ParsedMarkdown): string[] {
  return markdown.blocks.filter((block) => block.lang === '').flatMap((block) => [...block.code.matchAll(/[\w-]+\/[\w*-]+\.md/g)].map((match) => match[0]));
}

function frontmatterProblems(skillDir: string, markdown: ParsedMarkdown): Problem[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(markdown.frontmatter ?? '');
  } catch (error) {
    return [{ kind: 'skill', message: `frontmatter is not valid YAML: ${String(error).split('\n')[0]}` }];
  }
  if (typeof parsed !== 'object' || parsed === null) return [{ kind: 'skill', message: 'frontmatter is not a YAML mapping' }];
  const problems: Problem[] = [];
  const name = 'name' in parsed ? parsed.name : undefined;
  const description = 'description' in parsed ? parsed.description : undefined;
  if (name !== basename(skillDir)) problems.push({ kind: 'skill', message: `frontmatter name ${String(name)} does not match the directory ${basename(skillDir)}` });
  if (typeof description !== 'string' || description.length < 50) problems.push({ kind: 'skill', message: 'frontmatter description is missing or too short' });
  return problems;
}

export function checkSkill(skillDir: string): Problem[] {
  const router = readSkillFile({ skillDir, rel: 'SKILL.md' });
  const problems = frontmatterProblems(skillDir, router);
  const linked = new Set(localTargets({ skillDir, rel: 'SKILL.md' }, router));
  for (const rel of referenceFiles(skillDir)) {
    if (rel !== 'SKILL.md' && !linked.has(rel)) problems.push({ kind: 'skill', message: `${rel} is not linked from SKILL.md` });
  }
  for (const path of decisionTreeFencePaths(router)) {
    if (!existsSync(join(skillDir, path))) problems.push({ kind: 'skill', message: `decision tree path does not exist: ${path}` });
  }
  return problems;
}
