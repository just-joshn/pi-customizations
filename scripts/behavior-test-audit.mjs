#!/usr/bin/env node
/**
 * Fail-closed audit that keeps every test a user behavior test.
 * A test may reach a package's source only through the entry points Pi loads
 * (package.json `pi.extensions` and `exports`), or a CLI's entry module.
 * It may never mock the package's own source. Type-only imports are allowed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSIONS_DIR = path.join(ROOT, 'extensions');
const POSIX_SEP = '/';
const EXIT_FAILED = 1;
const EXIT_CLEAN = 0;
const SKIP_DIRS = new Set(['node_modules', 'coverage', '.vitest', 'dist', '.git', 'worktrees', 'results', 'skills']);
const TEST_FILE = /\.(test|test-helper|spec)\.[cm]?[jt]sx?$/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const INDEX_FILE = '/index.ts';
const RESOLVE_EXTS = ['', '.ts', '.tsx', '.js', '.mjs', INDEX_FILE];

/** Standalone CLIs whose tests live beside their source. */
const CLI_UNITS = [{ dir: 'extensions/pi-pstack-v2/skills/poteto-mode/scripts/watch-pr', entries: ['cli.ts'] }];

/** `binding` imports bind names, `reexport` forwards them, `load` only runs or loads a module, `mock` replaces one. */
const IMPORT_PATTERNS = [
  { kind: 'binding', regex: /^\s*import\s+(?<type>type\s+)?(?<clause>[^'"]*?)\s*from\s*['"](?<spec>[^'"]+)['"]/gm },
  { kind: 'reexport', regex: /^\s*export\s+(?<type>type\s+)?[^'"]*?\s*from\s*['"](?<spec>[^'"]+)['"]/gm },
  { kind: 'load', regex: /^\s*import\s*['"](?<spec>[^'"]+)['"]/gm },
  { kind: 'load', regex: /\bimport\(\s*['"](?<spec>[^'"]+)['"]\s*\)/g },
  { kind: 'load', regex: /\brequire\(\s*['"](?<spec>[^'"]+)['"]\s*\)/g },
  { kind: 'mock', regex: /\b(?:vi\.(?:mock|doMock|unmock)|mock\.module)\(\s*['"](?<spec>[^'"]+)['"]/g },
];

const PackageJson = z.object({
  pi: z.object({ extensions: z.array(z.string()).optional() }).optional(),
  exports: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});

/** @typedef {{ name: string, root: string, internal: string, entries: Set<string>, tests: string[] }} Unit */
/** @typedef {{ file: string, detail: string }} Violation */

/** @param {string} filePath */
const rel = (filePath) => path.relative(ROOT, filePath).split(path.sep).join(POSIX_SEP);

/** @param {string} dir @returns {string[]} */
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    if (SKIP_DIRS.has(ent.name)) return [];
    const full = path.join(dir, ent.name);
    return ent.isDirectory() ? walk(full) : [full];
  });

/** @param {unknown} exportsField @returns {string[]} */
const exportTargets = (exportsField) => {
  if (typeof exportsField === 'string') return [exportsField];
  if (exportsField && typeof exportsField === 'object') return Object.values(exportsField).flatMap(exportTargets);
  return [];
};

/** @param {string} pkgDir @returns {Unit} */
const packageUnit = (pkgDir) => {
  const manifest = PackageJson.parse(JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')));
  const declared = [...(manifest.pi?.extensions ?? []), ...exportTargets(manifest.exports)];
  const entries = new Set(declared.map((entry) => path.resolve(pkgDir, entry)));
  const isTest = (file) => TEST_FILE.test(file) || file.startsWith(path.join(pkgDir, 'test') + path.sep);
  const tests = walk(pkgDir).filter((file) => CODE_FILE.test(file) && isTest(file));
  return { name: path.basename(pkgDir), root: pkgDir, internal: path.join(pkgDir, 'src'), entries, tests };
};

/** @param {{ dir: string, entries: string[] }} cli @returns {Unit} */
const cliUnit = (cli) => {
  const dir = path.join(ROOT, cli.dir);
  const tests = fs
    .readdirSync(dir)
    .filter((name) => TEST_FILE.test(name))
    .map((name) => path.join(dir, name));
  return { name: cli.dir, root: dir, internal: dir, entries: new Set(cli.entries.map((entry) => path.join(dir, entry))), tests };
};

/** @param {string} from @param {string} specifier @returns {string} */
const resolveSpecifier = (from, specifier) => {
  const base = path.resolve(path.dirname(from), specifier);
  const hit = RESOLVE_EXTS.map((ext) => base + ext).find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  return hit ?? base;
};

/** @param {string} clause @returns {string[]} */
const namedValues = (clause) =>
  (clause.match(/\{([^}]*)\}/)?.[1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name && !name.startsWith('type '));

/**
 * Reads one import clause. `defaultOnly` holds when the clause binds nothing but the default export and types.
 * @param {string | undefined} typeKeyword @param {string} clause
 */
const readClause = (typeKeyword, clause) => {
  if (typeKeyword) return { typeOnly: true, defaultOnly: true };
  const named = namedValues(clause);
  const rest = clause
    .replace(/\{[^}]*\}/, '')
    .replace(/,/g, '')
    .trim();
  const hasDefault = /^[A-Za-z_$][\w$]*$/.test(rest);
  return { typeOnly: !hasDefault && !rest && named.length === 0, defaultOnly: named.length === 0 && !rest.startsWith('*') };
};

/** @param {string} source @returns {{ kind: string, specifier: string, typeOnly: boolean, defaultOnly: boolean }[]} */
const specifiers = (source) =>
  IMPORT_PATTERNS.flatMap(({ kind, regex }) =>
    [...source.matchAll(regex)].map(({ groups = {} }) => {
      const specifier = groups['spec'] ?? '';
      if (kind === 'binding') return { kind, specifier, ...readClause(groups['type'], groups['clause'] ?? '') };
      if (kind === 'reexport') return { kind, specifier, typeOnly: Boolean(groups['type']), defaultOnly: false };
      return { kind, specifier, typeOnly: false, defaultOnly: true };
    }),
  );

/** @param {Unit} unit @param {string} target */
const isInternal = (unit, target) => target.startsWith(unit.internal + path.sep) && !TEST_FILE.test(target);

/** @param {Unit} unit @param {string} file @returns {Violation[]} */
const fileViolations = (unit, file) =>
  specifiers(fs.readFileSync(file, 'utf8'))
    .filter(({ specifier }) => specifier.startsWith('.'))
    .flatMap(({ kind, specifier, typeOnly, defaultOnly }) => {
      const target = resolveSpecifier(file, specifier);
      if (!isInternal(unit, target)) return [];
      if (kind === 'mock') return [{ file: rel(file), detail: `mocks its own source ${specifier}; mock only the outside world` }];
      if (typeOnly) return [];
      if (unit.entries.has(target)) return defaultOnly ? [] : [{ file: rel(file), detail: `imports named exports from entry ${specifier}; use only its default export, the way Pi loads it` }];
      return [{ file: rel(file), detail: `imports internal ${specifier}; drive behavior through ${[...unit.entries].map(rel).join(', ')}` }];
    });

/** @param {Unit} unit @returns {Violation[]} */
const unitViolations = (unit) => [...(unit.entries.size === 0 ? [{ file: rel(unit.root), detail: 'declares no entry point' }] : []), ...unit.tests.flatMap((file) => fileViolations(unit, file))];

const units = () => [
  ...fs
    .readdirSync(EXTENSIONS_DIR, { withFileTypes: true })
    .filter((ent) => ent.isDirectory() && fs.existsSync(path.join(EXTENSIONS_DIR, ent.name, 'package.json')))
    .map((ent) => packageUnit(path.join(EXTENSIONS_DIR, ent.name))),
  ...CLI_UNITS.map(cliUnit),
];

const main = () => {
  const all = units();
  const violations = all.flatMap(unitViolations);
  for (const v of violations) process.stderr.write(`${v.file}: ${v.detail}\n`);
  const testCount = all.reduce((sum, unit) => sum + unit.tests.length, 0);
  process.stdout.write(`behavior-test-audit: ${testCount} test files, ${violations.length} violations\n`);
  return violations.length === 0 ? EXIT_CLEAN : EXIT_FAILED;
};

process.exitCode = main();
