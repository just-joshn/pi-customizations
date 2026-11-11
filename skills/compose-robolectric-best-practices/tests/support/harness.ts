import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { CodeBlock, Problem } from 'skill-gate';
import { withLock } from './lock.ts';

export const HARNESS_DIR = resolve(import.meta.dirname, '../../harness');

export type Mode = 'run' | 'compile-only';

export interface KotlinBlock {
  rel: string;
  block: CodeBlock;
  mode: Mode;
}

interface Placed extends KotlinBlock {
  pkg: string;
  file: string;
  packageLine: { kind: 'own' } | { kind: 'inserted'; at: number };
}

const PACKAGE_LINE = /^package[ \t]+[\w.]+[ \t]*$/m;
const PREAMBLE_LINE = /^\s*(@file:.*|\/\/.*)?$/;

function readableSlug(rel: string): string {
  return rel
    .replace(/\.md$/, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();
}

function uniqueBlockId(rel: string): string {
  return `${readableSlug(rel)}_${createHash('sha256').update(rel).digest('hex').slice(0, 6)}`;
}

function fileAnnotationsEnd(lines: readonly string[]): number {
  let end = 0;
  let depth = 0;
  for (const [index, line] of lines.entries()) {
    const inAnnotation = depth > 0 || line.trim().startsWith('@file:');
    if (!inAnnotation && !PREAMBLE_LINE.test(line)) break;
    depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
    if (inAnnotation && depth === 0) end = index + 1;
  }
  return end;
}

function place(entry: KotlinBlock): Placed {
  const id = uniqueBlockId(entry.rel);
  const preambleEnd = fileAnnotationsEnd(entry.block.code.split('\n'));
  return {
    ...entry,
    pkg: `skill.${entry.mode === 'run' ? 'run' : 'compileonly'}.${id}.l${entry.block.line}`,
    file: `${id}_L${entry.block.line}.kt`,
    packageLine: PACKAGE_LINE.test(entry.block.code) ? { kind: 'own' } : { kind: 'inserted', at: preambleEnd + 1 },
  };
}

function source(placed: Placed): string {
  const { code } = placed.block;
  if (placed.packageLine.kind === 'own') return code.replace(PACKAGE_LINE, `package ${placed.pkg}`);
  const { at } = placed.packageLine;
  const lines = code.split('\n');
  return [...lines.slice(0, at - 1), `package ${placed.pkg}`, ...lines.slice(at - 1), ''].join('\n');
}

function markdownLine(placed: Placed, kotlinLine: number): number {
  const shifted = placed.packageLine.kind === 'inserted' && kotlinLine > placed.packageLine.at;
  return placed.block.line + kotlinLine - (shifted ? 1 : 0);
}

const DIAGNOSTIC = /^([ew]): file:\/\/(.+?\.kt):(\d+):\d+ (.*)$/;

function compileProblems(output: string, byFile: Map<string, Placed>): Problem[] {
  const problems: Problem[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(DIAGNOSTIC);
    if (!match) continue;
    const [, kind = '', path = '', kotlinLine = '0', message = ''] = match;
    const placed = byFile.get(path.split('/').pop() ?? '');
    const text = `${kind === 'w' ? 'warning' : 'error'}: ${message}`;
    problems.push(placed ? { kind: 'line', rel: placed.rel, line: markdownLine(placed, Number(kotlinLine)), message: text } : { kind: 'skill', message: `${path} ${text}` });
  }
  return problems;
}

interface TestCase {
  className: string;
  name: string;
  outcome: { kind: 'passed' } | { kind: 'skipped' } | { kind: 'failed'; message: string };
}

function outcome(body: string): TestCase['outcome'] {
  const failure = body.match(/<(?:failure|error) message="([^"]*)"/);
  if (failure) return { kind: 'failed', message: unescapeXml(failure[1] ?? '').split('\n')[0] ?? '' };
  return body.includes('<skipped') ? { kind: 'skipped' } : { kind: 'passed' };
}

function testCases(resultsDir: string): TestCase[] {
  if (!existsSync(resultsDir)) return [];
  return readdirSync(resultsDir)
    .filter((name) => name.endsWith('.xml'))
    .flatMap((name) => {
      const xml = readFileSync(join(resultsDir, name), 'utf8');
      return [...xml.matchAll(/<testcase name="([^"]*)" classname="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)].map((match) => ({ name: match[1] ?? '', className: match[2] ?? '', outcome: outcome(match[4] ?? '') }));
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

export function compileAndRun({ label, blocks }: { label: string; blocks: readonly KotlinBlock[] }): Problem[] {
  const workDir = join(tmpdir(), 'compose-robolectric-skill', label);
  const lockFile = join(workDir, 'gate.lock');
  mkdirSync(workDir, { recursive: true });
  return withLock({
    lockFile,
    busy: () => [{ kind: 'skill', message: `another gate run is using ${workDir}; wait for it, or delete ${lockFile} if no run is active` }],
    run: () => buildAndRun({ workDir, blocks }),
  });
}

function testProblems(placed: readonly Placed[], cases: readonly TestCase[]): { failed: Problem[]; neverRan: Problem[] } {
  const own = (p: Placed) => cases.filter((c) => c.className.startsWith(`${p.pkg}.`));
  return {
    failed: placed.flatMap((p) =>
      own(p).flatMap((c): Problem[] => (c.outcome.kind === 'failed' ? [{ kind: 'line', rel: p.rel, line: p.block.line, message: `test ${c.className.slice(p.pkg.length + 1)}.${c.name} failed: ${c.outcome.message}` }] : [])),
    ),
    neverRan: placed
      .filter((p) => p.mode === 'run' && DECLARES_TEST.test(p.block.code) && own(p).every((c) => c.outcome.kind === 'skipped'))
      .map((p): Problem => ({ kind: 'line', rel: p.rel, line: p.block.line, message: 'declares @Test but no test ran' })),
  };
}

function buildAndRun({ workDir, blocks }: { workDir: string; blocks: readonly KotlinBlock[] }): Problem[] {
  const projectDir = join(workDir, 'harness');
  const blocksDir = join(workDir, 'blocks');
  const resultsDir = join(projectDir, 'blocks/build/test-results/testDebugUnitTest');
  mkdirSync(projectDir, { recursive: true });
  rmSync(resultsDir, { recursive: true, force: true });
  cpSync(HARNESS_DIR, projectDir, { recursive: true, filter: (from) => !/[/\\](build|\.gradle|\.kotlin)$/.test(from) });
  rmSync(blocksDir, { recursive: true, force: true });
  mkdirSync(blocksDir, { recursive: true });

  const placed = blocks.map(place);
  for (const p of placed) writeFileSync(join(blocksDir, p.file), source(p));

  // Roborazzi captures nothing unless record mode is on, so screenshot examples would silently do nothing.
  const run = spawnSync(join(projectDir, 'gradlew'), ['-p', projectDir, ':blocks:testDebugUnitTest', `-PblocksDir=${blocksDir}`, '-Proborazzi.test.record=true', '--console=plain', '--continue'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${run.stdout}\n${run.stderr}`;

  const compile = compileProblems(output, new Map(placed.map((p) => [p.file, p])));
  if (compile.length > 0) return compile;
  const { failed, neverRan } = testProblems(placed, testCases(resultsDir));
  if (run.status !== 0 && failed.length === 0) return [{ kind: 'skill', message: `gradle failed: ${gradleFailure(output)}` }];
  return [...failed, ...neverRan];
}

export function hasAndroidSdk(env: Readonly<Record<string, string | undefined>>): boolean {
  return [env['ANDROID_HOME'], env['ANDROID_SDK_ROOT']].some((path) => path !== undefined && path !== '');
}
