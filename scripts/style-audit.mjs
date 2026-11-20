#!/usr/bin/env node
/**
 * Fail-closed style audit for the repository.
 * Line rules (file size, nesting, suppressions) run here.
 * AST rules (immutability, function size, console.log, magic numbers,
 * empty blocks, input validation) run through Biome with scripts/style/rules.jsonc.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIOME_CONFIG = path.join(ROOT, 'scripts', 'style', 'rules.jsonc');
const EXCEPTIONS_DIR = path.join(ROOT, 'scripts', 'style', 'behavior-exceptions');
const FILE_LINES_LIMIT = 800;
const MAX_NESTING = 4;
const SPACES_PER_LEVEL = 2;
const BIOME_OUTPUT_BYTES = 268_435_456;
const EXIT_FAILED = 1;
const EXIT_CLEAN = 0;
const ARGV_USER_START = 2;
const POSIX_SEP = '/';
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'coverage', '.vitest', 'dist', '.git', 'worktrees', 'results']);
const IGNORED_BIOME_CATEGORIES = new Set(['suppressions/unused']);
const AUDITED_RULES = /^\s*(\/\/|\/\*|\*).*biome-ignore.*(noMagicNumbers|noExcessiveLinesPerFunction|noConsole|noEmptyBlockStatements|noUselessCatch|useErrorMessage|noFloatingPromises|noMisusedPromises|plugin)/;

/** @typedef {{ file: string, rule: string, detail: string, source?: string }} Violation */
/** @typedef {{ file: string, rule: string, line: string, reason: string }} BehaviorException */

const CliArgv = z.array(z.string());

const BehaviorExceptions = z.array(
  z.object({
    file: z.string().min(1),
    rule: z.string().min(1),
    line: z.string().min(1),
    reason: z.string().min(1),
  }),
);

const BiomeReport = z.object({
  diagnostics: z.array(
    z.object({
      category: z.string(),
      message: z.string(),
      location: z.object({
        path: z.string(),
        start: z.object({ line: z.number(), column: z.number() }),
      }),
    }),
  ),
});

/** @param {string} filePath */
const rel = (filePath) => path.relative(ROOT, filePath).split(path.sep).join(POSIX_SEP);

/** @param {string} line */
const indentDepth = (line) => {
  if (!line.trim()) return 0;
  if (line.startsWith('\t')) return (line.match(/^\t*/) ?? [''])[0].length;
  return Math.floor((line.match(/^ */) ?? [''])[0].length / SPACES_PER_LEVEL);
};

/** @param {string} target @returns {string[]} */
const walkCode = (target) => {
  const stat = fs.statSync(target);
  if (stat.isFile()) return CODE_EXTS.has(path.extname(target)) ? [target] : [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((ent) => {
    if (SKIP_DIRS.has(ent.name)) return [];
    const full = path.join(target, ent.name);
    if (ent.isDirectory()) return walkCode(full);
    return CODE_EXTS.has(path.extname(ent.name)) ? [full] : [];
  });
};

/** @param {string} file @param {string[]} lines @returns {Violation[]} */
const fileSizeViolations = (file, lines) => (lines.length < FILE_LINES_LIMIT ? [] : [{ file, rule: 'file-size', detail: `${lines.length} lines, must be under ${FILE_LINES_LIMIT}` }]);

/** @param {string} file @param {string[]} lines @returns {Violation[]} */
const nestingViolations = (file, lines) => lines.flatMap((line, i) => (indentDepth(line) > MAX_NESTING ? [{ file, rule: 'nesting', detail: `line ${i + 1}: depth ${indentDepth(line)} > ${MAX_NESTING}` }] : []));

/** @param {string} file @param {string[]} lines @returns {Violation[]} */
const suppressionViolations = (file, lines) => lines.flatMap((line, i) => (AUDITED_RULES.test(line) ? [{ file, rule: 'suppression', detail: `line ${i + 1}: style rules cannot be suppressed` }] : []));

/** @param {string} filePath @returns {Violation[]} */
const lineViolations = (filePath) => {
  const file = rel(filePath);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  return [...fileSizeViolations(file, lines), ...nestingViolations(file, lines), ...suppressionViolations(file, lines)];
};

/** @param {string} file @param {number} line */
const sourceLine = (file, line) => (fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')[line - 1] ?? '').trim();

/** @param {Set<string>} auditedFiles @returns {BehaviorException[]} */
const readExceptions = (auditedFiles) =>
  fs
    .readdirSync(EXCEPTIONS_DIR)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => readExceptionFile(path.join(EXCEPTIONS_DIR, name)))
    .filter((exception) => auditedFiles.has(exception.file));

/** @param {string} file @returns {BehaviorException[]} */
const readExceptionFile = (file) => {
  try {
    return BehaviorExceptions.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    console.error('Reading behavior exceptions failed:', error);
    throw new Error(`style-audit: ${rel(file)} must be a JSON list of { file, rule, line, reason }.`);
  }
};

/** @param {BehaviorException} exception @param {Violation} violation */
const excuses = (exception, violation) => exception.file === violation.file && exception.rule === violation.rule && exception.line === violation.source;

/**
 * Each exception excuses exactly one violation, so two identical lines need two entries.
 * @param {Violation[]} violations @param {BehaviorException[]} exceptions @returns {Violation[]}
 */
const applyExceptions = (violations, exceptions) => {
  const { kept, unused } = violations.reduce(
    (acc, v) => {
      const hit = acc.unused.findIndex((e) => excuses(e, v));
      return hit < 0 ? { kept: [...acc.kept, v], unused: acc.unused } : { kept: acc.kept, unused: acc.unused.toSpliced(hit, 1) };
    },
    { kept: /** @type {Violation[]} */ ([]), unused: exceptions },
  );
  const stale = unused.map((e) => ({ file: e.file, rule: 'stale-exception', detail: `no violation matches: ${e.line}` }));
  return [...kept, ...stale];
};

/** @param {string[]} files @returns {Violation[]} */
const biomeViolations = (files) => {
  if (files.length === 0) return [];
  const biome = createRequire(import.meta.url).resolve('@biomejs/biome/bin/biome');
  const run = spawnSync(process.execPath, [biome, 'lint', `--config-path=${BIOME_CONFIG}`, '--max-diagnostics=none', '--reporter=json', ...files.map(rel)], { cwd: ROOT, encoding: 'utf8', maxBuffer: BIOME_OUTPUT_BYTES });
  if (run.error) throw new Error(`style-audit: could not run Biome: ${run.error.message}`);
  const parsed = BiomeReport.safeParse(JSON.parse(run.stdout || 'null'));
  if (!parsed.success) throw new Error(`style-audit: Biome gave no JSON report.\n${run.stderr}`);
  return parsed.data.diagnostics
    .filter((d) => !IGNORED_BIOME_CATEGORIES.has(d.category))
    .map((d) => ({
      file: d.location.path,
      rule: d.category.replace(/^lint\//, ''),
      detail: `line ${d.location.start.line}:${d.location.start.column}: ${d.message}`,
      source: sourceLine(d.location.path, d.location.start.line),
    }));
};

/** @param {Violation[]} violations */
const report = (violations) => {
  const counts = Object.entries(Object.groupBy(violations, (v) => v.rule)).map(([rule, list]) => `  ${rule}: ${list?.length ?? 0}`);
  const lines = violations.map((v) => `${v.file}: [${v.rule}] ${v.detail}`);
  const verdict = violations.length === 0 ? ['style-audit: clean'] : [];
  return [`style-audit: ${violations.length} violation(s)`, ...counts.toSorted(), ...lines, ...verdict].join('\n');
};

const resolveTargets = () => {
  const rawArgs = CliArgv.parse(process.argv).slice(ARGV_USER_START);
  return rawArgs.length === 0 ? [ROOT] : rawArgs.map((arg) => path.resolve(ROOT, arg));
};

const main = () => {
  const files = [...new Set(resolveTargets().flatMap(walkCode))].toSorted();
  const auditedSet = new Set(files.map(rel));
  const violations = applyExceptions([...files.flatMap(lineViolations), ...biomeViolations(files)], readExceptions(auditedSet));
  const code = violations.length === 0 ? EXIT_CLEAN : EXIT_FAILED;
  process.stderr.write(`${report(violations)}\n`, () => process.exit(code));
};

try {
  main();
} catch (error) {
  console.error('style-audit failed:', error);
  throw new Error('style-audit could not finish; see the error above.');
}
