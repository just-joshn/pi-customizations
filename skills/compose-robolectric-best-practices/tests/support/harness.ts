import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { CodeBlock } from './markdown.ts';

export const HARNESS_DIR = resolve(import.meta.dirname, '../../harness');

// `kotlin` blocks compile and their tests run. `kotlin compile-only` blocks compile but never run (anti-patterns).
export type Mode = 'run' | 'compileonly';

export interface KotlinBlock {
  rel: string;
  block: CodeBlock;
  mode: Mode;
}

interface Placed extends KotlinBlock {
  pkg: string;
  file: string;
  // Lines added above the block's first line, to map Kotlin line numbers back to Markdown.
  offset: number;
}

const PACKAGE_LINE = /^package[ \t]+[\w.]+[ \t]*$/m;

function place(entry: KotlinBlock): Placed {
  const slug = entry.rel
    .replace(/\.md$/, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();
  const pkg = `skill.${entry.mode}.${slug}.l${entry.block.line}`;
  return { ...entry, pkg, file: `${slug}_L${entry.block.line}.kt`, offset: PACKAGE_LINE.test(entry.block.code) ? 0 : 1 };
}

function source(placed: Placed): string {
  const { code } = placed.block;
  return PACKAGE_LINE.test(code) ? code.replace(PACKAGE_LINE, `package ${placed.pkg}`) : `package ${placed.pkg}\n${code}\n`;
}

// Markdown line of a Kotlin line: the fence is on block.line, so Kotlin line 1 of the block is block.line + 1.
function markdownLine(placed: Placed, kotlinLine: number): number {
  return placed.block.line + kotlinLine - placed.offset;
}

const DIAGNOSTIC = /^([ew]): file:\/\/(.+?\.kt):(\d+):\d+ (.*)$/;

function compileProblems(output: string, byFile: Map<string, Placed>): string[] {
  const problems: string[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(DIAGNOSTIC);
    if (!match) continue;
    const [, kind = '', path = '', kotlinLine = '0', message = ''] = match;
    const placed = byFile.get(path.split('/').pop() ?? '');
    const where = placed ? `${placed.rel}:${markdownLine(placed, Number(kotlinLine))}` : path;
    problems.push(`${where} ${kind === 'w' ? 'warning' : 'error'}: ${message}`);
  }
  return problems;
}

interface TestCase {
  className: string;
  name: string;
  failure: string | undefined;
}

function testCases(resultsDir: string): TestCase[] {
  if (!existsSync(resultsDir)) return [];
  return readdirSync(resultsDir)
    .filter((name) => name.endsWith('.xml'))
    .flatMap((name) => {
      const xml = readFileSync(join(resultsDir, name), 'utf8');
      return [...xml.matchAll(/<testcase name="([^"]*)" classname="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)].map((match) => {
        const failure = (match[4] ?? '').match(/<(?:failure|error) message="([^"]*)"/);
        return { name: match[1] ?? '', className: match[2] ?? '', failure: failure ? unescapeXml(failure[1] ?? '').split('\n')[0] : undefined };
      });
    });
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&amp;/g, '&');
}

function gradleFailure(output: string): string {
  const what = output.match(/\* What went wrong:\n([\s\S]*?)\n\* Try:/);
  return (what?.[1] ?? output.slice(-2000)).trim();
}

const DECLARES_TEST = /@Test\b/;

// Compiles every block and runs the `run` blocks' tests in one Gradle build. `label` names a reusable
// copy of the harness under the temp dir, so concurrent callers with different labels never share a build.
export function compileAndRun(label: string, blocks: readonly KotlinBlock[]): string[] {
  const workDir = join(tmpdir(), 'compose-robolectric-skill', label);
  const projectDir = join(workDir, 'harness');
  const blocksDir = join(workDir, 'blocks');
  mkdirSync(projectDir, { recursive: true });
  cpSync(HARNESS_DIR, projectDir, { recursive: true, filter: (from) => !/[/\\](build|\.gradle|\.kotlin)$/.test(from) });
  rmSync(blocksDir, { recursive: true, force: true });
  mkdirSync(blocksDir, { recursive: true });

  const placed = blocks.map(place);
  const byFile = new Map(placed.map((p) => [p.file, p]));
  for (const p of placed) writeFileSync(join(blocksDir, p.file), source(p));

  const run = spawnSync(join(projectDir, 'gradlew'), ['-p', projectDir, ':blocks:testDebugUnitTest', `-PblocksDir=${blocksDir}`, '--console=plain', '--continue'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${run.stdout}\n${run.stderr}`;

  const problems = compileProblems(output, byFile);
  if (problems.length > 0) return problems;

  const cases = testCases(join(projectDir, 'blocks/build/test-results/testDebugUnitTest'));
  for (const p of placed) {
    const own = cases.filter((c) => c.className.startsWith(`${p.pkg}.`));
    for (const c of own) {
      if (c.failure !== undefined) problems.push(`${p.rel}:${p.block.line} test ${c.className.slice(p.pkg.length + 1)}.${c.name} failed: ${c.failure}`);
    }
    if (p.mode === 'run' && DECLARES_TEST.test(p.block.code) && own.length === 0) problems.push(`${p.rel}:${p.block.line} declares @Test but no test ran`);
  }
  if (run.status !== 0 && problems.length === 0) problems.push(`gradle failed: ${gradleFailure(output)}`);
  return problems;
}
