import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import ts from 'typescript-api';
import * as vitest from 'vitest';
import type { CodeBlock } from './markdown.ts';

const EXTENSION: Record<string, string> = {
  ts: 'ts',
  typescript: 'ts',
  mts: 'mts',
  cts: 'cts',
  tsx: 'tsx',
  jsx: 'jsx',
  js: 'js',
  javascript: 'js',
  mjs: 'mjs',
};

// Examples are fragments: they call app code they never define and import files that don't exist.
const CANNOT_FIND_NAME = 2304;
const CANNOT_FIND_NAME_DID_YOU_MEAN = 2552;
const CANNOT_FIND_MODULE = [2307, 2792];
const FRAGMENT_NOISE = new Set([
  CANNOT_FIND_NAME,
  2503, // Cannot find namespace
  2709, // Cannot use namespace as a type
  18004, // No value exists in scope for the shorthand property
]);

const VITEST_EXPORTS = new Set(Object.keys(vitest));

// Bun installs one copy of vitest per peer set, so @vitest/browser's `declare module 'vitest'` would augment a
// different copy than the examples import. Every resolution into any vitest copy is redirected to this one.
const VITEST_DIR = dirname(createRequire(import.meta.url).resolve('vitest/package.json'));
const canonical = (file: string): string => file.replace(/^.*\/node_modules\/vitest\//, `${VITEST_DIR}/`);

function resolveModule(name: string, containingFile: string, options: ts.CompilerOptions): ts.ResolvedModuleWithFailedLookupLocations {
  const result = ts.resolveModuleName(name, containingFile, options, ts.sys);
  const resolved = result.resolvedModule;
  return resolved ? { ...result, resolvedModule: { ...resolved, resolvedFileName: canonical(resolved.resolvedFileName) } } : result;
}

function resolveTypeReference(name: string, containingFile: string, options: ts.CompilerOptions): ts.ResolvedTypeReferenceDirectiveWithFailedLookupLocations {
  const result = ts.resolveTypeReferenceDirective(name, containingFile, options, ts.sys);
  const resolved = result.resolvedTypeReferenceDirective;
  if (!resolved?.resolvedFileName) return result;
  return { ...result, resolvedTypeReferenceDirective: { ...resolved, resolvedFileName: canonical(resolved.resolvedFileName) } };
}

const NODE_TYPES = ['node', 'vitest/globals', 'vitest/importMeta', 'vite/client'];
const BROWSER_TYPES = [...NODE_TYPES, 'vitest/browser'];

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.esnext.disposable.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  types: NODE_TYPES,
  jsx: ts.JsxEmit.Preserve,
  strict: false,
  noImplicitAny: false,
  strictNullChecks: true,
  skipLibCheck: true,
  allowJs: true,
  checkJs: true,
  noEmit: true,
  esModuleInterop: true,
  resolveJsonModule: true,
  allowImportingTsExtensions: true,
};

const registry = ts.createDocumentRegistry();

function isNoise(d: ts.Diagnostic): boolean {
  const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  if (CANNOT_FIND_MODULE.includes(d.code)) return /module '\.{1,2}\//.test(message);
  if (d.code === CANNOT_FIND_NAME_DID_YOU_MEAN) return !VITEST_EXPORTS.has(message.match(/Did you mean '(\w+)'/)?.[1] ?? '');
  return FRAGMENT_NOISE.has(d.code);
}

export interface BlockProblem {
  block: CodeBlock;
  code: number;
  message: string;
}

const BROWSER_CODE = /from ['"](vitest\/browser|@vitest\/browser[^'"]*|vitest-browser-[^'"]*)['"]|\bexpect\.element\(/;
const SOLID_CODE = /from ['"](solid-js[^'"]*|@solidjs\/[^'"]*)['"]/;

const ENVIRONMENTS = {
  node: OPTIONS,
  browser: { ...OPTIONS, types: BROWSER_TYPES },
  'node-solid': { ...OPTIONS, jsxImportSource: 'solid-js' },
  'browser-solid': { ...OPTIONS, types: BROWSER_TYPES, jsxImportSource: 'solid-js' },
} satisfies Record<string, ts.CompilerOptions>;

function environment(code: string): keyof typeof ENVIRONMENTS {
  const base = BROWSER_CODE.test(code) ? 'browser' : 'node';
  return SOLID_CODE.test(code) ? `${base}-solid` : base;
}

/**
 * One program per markdown file and environment: browser examples get their own program so their
 * matcher and locator types can't leak into Node examples, and no file's declarations leak into another.
 */
export function typecheckBlocks(root: string, id: string, blocks: CodeBlock[]): BlockProblem[] {
  const groups = new Map<keyof typeof ENVIRONMENTS, CodeBlock[]>();
  for (const block of blocks) {
    if (!EXTENSION[block.lang]) continue;
    const env = environment(block.code);
    groups.set(env, [...(groups.get(env) ?? []), block]);
  }
  return [...groups].flatMap(([env, group]) => typecheckGroup(root, id, group, ENVIRONMENTS[env]));
}

function typecheckGroup(root: string, id: string, blocks: CodeBlock[], options: ts.CompilerOptions): BlockProblem[] {
  const files = new Map<string, { block: CodeBlock; text: string }>();
  for (const block of blocks) {
    const name = join(root, '__blocks__', id.replace(/[^\w]/g, '_'), `L${block.line}.${EXTENSION[block.lang]}`);
    files.set(name, { block, text: `${block.code}\nexport {}\n` });
  }
  const readFile = (path: string) => files.get(path)?.text ?? ts.sys.readFile(path);

  const service = ts.createLanguageService(
    {
      getCompilationSettings: () => options,
      getScriptFileNames: () => [...files.keys()],
      getScriptVersion: () => '0',
      getScriptSnapshot: (path) => {
        const content = readFile(path);
        return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
      },
      getCurrentDirectory: () => root,
      getDefaultLibFileName: ts.getDefaultLibFilePath,
      fileExists: (path) => files.has(path) || ts.sys.fileExists(path),
      readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      resolveModuleNameLiterals: (literals, containingFile, _redirected, compilerOptions) => literals.map((literal) => resolveModule(literal.text, containingFile, compilerOptions)),
      resolveTypeReferenceDirectiveReferences: (references, containingFile, _redirected, compilerOptions) =>
        references.map((reference) => resolveTypeReference(typeof reference === 'string' ? reference : reference.fileName.toLowerCase(), containingFile, compilerOptions)),
    },
    registry,
  );

  const problems: BlockProblem[] = [];
  for (const [name, { block }] of files) {
    const diagnostics = [...service.getSyntacticDiagnostics(name), ...service.getSemanticDiagnostics(name).filter((d) => !isNoise(d)), ...service.getSuggestionDiagnostics(name).filter((d) => d.reportsDeprecated)];
    for (const d of diagnostics) {
      const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line : 0;
      const message = `${id}:${block.line + 1 + line} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
      problems.push({ block, code: d.code, message });
    }
  }
  service.dispose();
  return problems;
}
