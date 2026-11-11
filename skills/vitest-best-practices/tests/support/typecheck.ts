import { join, resolve } from 'node:path';

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

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.esnext.disposable.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  types: ['node', 'vitest/globals', 'vitest/importMeta', 'vite/client'],
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

const BROWSER_OPTIONS: ts.CompilerOptions = { ...OPTIONS, types: [...(OPTIONS.types ?? []), 'vitest/browser'] };

/** Module resolution walks up from here, so examples resolve the packages in this skill's package.json. */
const SKILL_ROOT = resolve(import.meta.dirname, '../..');

/**
 * One program per markdown file and environment: browser examples get their own program so their
 * matcher and locator types can't leak into Node examples, and no file's declarations leak into another.
 */
export function typecheckBlocks(id: string, blocks: CodeBlock[]): BlockProblem[] {
  const checked = blocks.filter((block) => EXTENSION[block.lang]);
  const browser = checked.filter((block) => BROWSER_CODE.test(block.code));
  const node = checked.filter((block) => !BROWSER_CODE.test(block.code));
  return [...typecheckGroup(id, node, OPTIONS), ...typecheckGroup(id, browser, BROWSER_OPTIONS)];
}

function typecheckGroup(id: string, blocks: CodeBlock[], options: ts.CompilerOptions): BlockProblem[] {
  const files = new Map<string, { block: CodeBlock; text: string }>();
  for (const block of blocks) {
    const name = join(SKILL_ROOT, '__blocks__', id.replace(/[^\w]/g, '_'), `L${block.line}.${EXTENSION[block.lang]}`);
    // The pragma shares the first line, so diagnostic line numbers stay aligned with the markdown.
    const pragma = SOLID_CODE.test(block.code) ? '/** @jsxImportSource solid-js */ ' : '';
    files.set(name, { block, text: `${pragma}${block.code}\nexport {}\n` });
  }
  if (files.size === 0) return [];
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
      getCurrentDirectory: () => SKILL_ROOT,
      getDefaultLibFileName: ts.getDefaultLibFilePath,
      fileExists: (path) => files.has(path) || ts.sys.fileExists(path),
      readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      // Bun links packages through symlinks; without realpath each link is a separate copy of a package,
      // and `vitest/browser`'s augmentation of 'vitest' lands on a different copy than the examples import.
      realpath: (path) => ts.sys.realpath?.(path) ?? path,
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
