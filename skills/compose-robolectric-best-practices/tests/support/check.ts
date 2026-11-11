import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { compileAndRun, HARNESS_DIR, type KotlinBlock, type Mode } from './harness.ts';
import { type CodeBlock, type ParsedMarkdown, parseMarkdown } from './markdown.ts';

const NOT_SKILL_CONTENT = new Set(['tests', 'harness', 'node_modules']);

// Fence languages a reference file may use. `kotlin` blocks are compiled; the rest are shown as written.
const LANGS = new Set(['kotlin', 'kts', 'toml', 'bash', 'properties', 'xml', 'yaml', 'text', '']);
const SNIPPET_MAX_LINES = 12;

// Coordinates the harness does not use but the skill may name. Every other coordinate must match the harness pin.
const EXTRA_PINS: Record<string, string> = {
  'org.jetbrains.kotlinx.kover': '0.9.11',
  'org.jetbrains.kotlinx:kover-gradle-plugin': '0.9.11',
  'com.google.dagger:hilt-android-testing': '2.60.1',
  'com.google.dagger:hilt-android': '2.60.1',
  'com.google.dagger.hilt.android': '2.60.1',
};

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

function decisionTreeFencePaths(markdown: ParsedMarkdown): string[] {
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

export function checkSkill(skillDir: string): string[] {
  const router = read(skillDir, 'SKILL.md');
  const problems = frontmatterProblems(skillDir, router);
  const linked = new Set(localTargets(skillDir, 'SKILL.md', router));
  for (const rel of referenceFiles(skillDir)) {
    if (rel !== 'SKILL.md' && !linked.has(rel)) problems.push(`${rel} is not linked from SKILL.md`);
  }
  for (const path of decisionTreeFencePaths(router)) {
    if (!existsSync(join(skillDir, path))) problems.push(`decision tree path does not exist: ${path}`);
  }
  return problems;
}

const COORDINATE = /["']([\w.-]+:[\w.-]+):(\d[\w.+-]*)["']/g;
const PLUGIN = /id\(["']([\w.-]+)["']\)\s+version\s+["'](\d[\w.+-]*)["']/g;
const TOML_MODULE = /module\s*=\s*"([\w.-]+:[\w.-]+)",\s*version\s*=\s*"(\d[\w.+-]*)"/g;

function coordinates(text: string): Array<[string, string]> {
  return [COORDINATE, PLUGIN, TOML_MODULE].flatMap((pattern) => [...text.matchAll(pattern)].map((m): [string, string] => [m[1] ?? '', m[2] ?? '']));
}

let pins: Map<string, string> | undefined;
function harnessPins(): Map<string, string> {
  pins ??= new Map([...coordinates(readFileSync(join(HARNESS_DIR, 'build.gradle.kts'), 'utf8')), ...coordinates(readFileSync(join(HARNESS_DIR, 'blocks/build.gradle.kts'), 'utf8')), ...Object.entries(EXTRA_PINS)]);
  return pins;
}

function blockMode(block: CodeBlock): Mode | 'snippet' | undefined {
  if (block.lang !== 'kotlin') return undefined;
  const info = block.info.split(/\s+/).slice(1);
  if (info.includes('snippet')) return 'snippet';
  if (info.includes('compile-only')) return 'compileonly';
  return 'run';
}

// Problems a file has on its own, without compiling: links, fence languages, snippet length, versions.
export function staticProblems(skillDir: string, rel: string): string[] {
  const markdown = read(skillDir, rel);
  const problems = localTargets(skillDir, rel, markdown)
    .filter((target) => !existsSync(join(skillDir, target)))
    .map((target) => `${rel}: broken link ${target}`);
  for (const block of markdown.blocks) {
    if (!LANGS.has(block.lang)) problems.push(`${rel}:${block.line} fence language "${block.lang}" is not one of ${[...LANGS].filter(Boolean).join(', ')}`);
    if (blockMode(block) === 'snippet' && block.code.split('\n').length > SNIPPET_MAX_LINES) problems.push(`${rel}:${block.line} snippet is longer than ${SNIPPET_MAX_LINES} lines; make it a compiled example`);
    block.code.split('\n').forEach((text, index) => {
      for (const [coordinate, version] of coordinates(text)) {
        const where = `${rel}:${block.line + 1 + index}`;
        const pinned = harnessPins().get(coordinate);
        if (pinned === undefined) problems.push(`${where} ${coordinate}:${version} is not pinned in the harness or EXTRA_PINS`);
        else if (pinned !== version) problems.push(`${where} ${coordinate}:${version} does not match the pinned ${pinned}`);
      }
    });
  }
  return problems;
}

export function kotlinBlocks(skillDir: string, rel: string): KotlinBlock[] {
  return read(skillDir, rel).blocks.flatMap((block) => {
    const mode = blockMode(block);
    return mode === 'run' || mode === 'compileonly' ? [{ rel, block, mode }] : [];
  });
}

// Static problems of every file plus one Gradle build that compiles all their Kotlin blocks and runs their tests.
export function checkFiles(skillDir: string, rels: readonly string[], label: string): string[] {
  const problems = rels.flatMap((rel) => staticProblems(skillDir, rel));
  const blocks = rels.flatMap((rel) => kotlinBlocks(skillDir, rel));
  return blocks.length === 0 ? problems : [...problems, ...compileAndRun(label, blocks)];
}
