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

// Only the skill root's tests/, harness/, and node_modules/ are not skill content; a nested core/tests/ is.
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

// A version a build snippet declares for a dependency or plugin. `version` is undefined when it is an
// expression the gate cannot resolve; `raw` is what the snippet wrote.
interface Declared {
  coordinate: string;
  version: string | undefined;
  raw: string;
}

// "group:artifact:version" strings; the version may be a `$name` or `${name}` template.
const COORDINATE = /["']([\w.-]+:[\w.-]+):([^"'\s]+)["']/g;
// id("x") version "v", id("x").version("v"), kotlin("x") version "v".
const PLUGIN = /\b(id|kotlin)\(\s*["']([\w.-]+)["']\s*\)\s*(?:\.version\(\s*|\s+version\s+)["']([^"']+)["']/g;
const FIELD = (name: string): RegExp => new RegExp(`\\b${name}\\s*=\\s*"([^"]+)"`);
const VERSION_TABLE = /\bversion\s*=\s*\{([^}]*)\}/;
const VERSION_REF = /\bversion\.ref\s*=\s*"([^"]+)"/;
const RICH_VERSION = /\b(ref|strictly|require|prefer)\s*=\s*"([^"]+)"/;
const KTS_VAL = /^\s*val\s+(\w+)\s*=\s*"([^"]+)"\s*$/;
const TOML_VERSION = /^\s*([\w-]+)\s*=\s*"([^"]+)"\s*$/;

function resolveVersion(raw: string, vars: ReadonlyMap<string, string>): string | undefined {
  const template = raw.match(/^\$\{?(\w+)\}?$/);
  if (template) return vars.get(template[1] ?? '');
  return /^\d/.test(raw) ? raw : undefined;
}

// Version-carrying named fields, as in a version catalog entry or Gradle's named-argument dependency form.
function fieldDeclaration(line: string, vars: ReadonlyMap<string, string>): Declared | undefined {
  const module = line.match(FIELD('module'))?.[1];
  const group = line.match(FIELD('group'))?.[1];
  const name = line.match(FIELD('name'))?.[1];
  const id = line.match(FIELD('id'))?.[1];
  const coordinate = module ?? (group && name ? `${group}:${name}` : id);
  if (coordinate === undefined) return undefined;
  const ref = line.match(VERSION_REF)?.[1];
  if (ref !== undefined) return { coordinate, version: vars.get(ref), raw: `version.ref "${ref}"` };
  const table = line.match(VERSION_TABLE)?.[1];
  if (table !== undefined) {
    const [, kind = '', value = ''] = table.match(RICH_VERSION) ?? [];
    return kind === 'ref' ? { coordinate, version: vars.get(value), raw: `version.ref "${value}"` } : { coordinate, version: resolveVersion(value, vars), raw: `{ ${table.trim()} }` };
  }
  const literal = line.match(FIELD('version'))?.[1];
  return literal === undefined ? undefined : { coordinate, version: resolveVersion(literal, vars), raw: literal };
}

function declarations(line: string, vars: ReadonlyMap<string, string> = new Map()): Declared[] {
  const strings = [...line.matchAll(COORDINATE)].map((m): Declared => ({ coordinate: m[1] ?? '', version: resolveVersion(m[2] ?? '', vars), raw: m[2] ?? '' }));
  const plugins = [...line.matchAll(PLUGIN)].map((m): Declared => {
    const coordinate = m[1] === 'kotlin' ? `org.jetbrains.kotlin.${m[2]}` : (m[2] ?? '');
    return { coordinate, version: resolveVersion(m[3] ?? '', vars), raw: m[3] ?? '' };
  });
  const field = strings.length === 0 && plugins.length === 0 ? fieldDeclaration(line, vars) : undefined;
  return [...strings, ...plugins, ...(field ? [field] : [])];
}

// Names a block can refer to: `val x = "..."` in Gradle scripts, the [versions] table in a version catalog.
function blockVariables(block: CodeBlock): Map<string, string> {
  const toml = block.lang === 'toml';
  const source = toml ? (block.code.split(/^\[/m).find((section) => section.startsWith('versions]')) ?? '') : block.code;
  return new Map(
    source.split('\n').flatMap((line) => {
      const m = line.match(toml ? TOML_VERSION : KTS_VAL);
      return m ? [[m[1] ?? '', m[2] ?? '']] : [];
    }),
  );
}

function pinsOf(text: string): Array<[string, string]> {
  return text.split('\n').flatMap((line) => declarations(line).flatMap((d): Array<[string, string]> => (d.version === undefined ? [] : [[d.coordinate, d.version]])));
}

let pins: Map<string, string> | undefined;
function harnessPins(): Map<string, string> {
  pins ??= new Map([...pinsOf(readFileSync(join(HARNESS_DIR, 'build.gradle.kts'), 'utf8')), ...pinsOf(readFileSync(join(HARNESS_DIR, 'blocks/build.gradle.kts'), 'utf8')), ...Object.entries(EXTRA_PINS)]);
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
    const vars = blockVariables(block);
    block.code.split('\n').forEach((text, index) => {
      const where = `${rel}:${block.line + 1 + index}`;
      for (const { coordinate, version, raw } of declarations(text, vars)) {
        const pinned = harnessPins().get(coordinate);
        if (version === undefined) problems.push(`${where} ${coordinate} version ${raw} is not a literal the gate can check`);
        else if (pinned === undefined) problems.push(`${where} ${coordinate}:${version} is not pinned in the harness or EXTRA_PINS`);
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
