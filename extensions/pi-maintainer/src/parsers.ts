/**
 * Loads web-tree-sitter grammars for a language name. Parsers are cached per
 * language; a grammar without a bundled wasm rejects, which callers report as
 * an unloadable parser.
 *
 * The reference language name for C# is `csharp` while the bundled grammar
 * module is `c_sharp`, so the module lookup keeps its own alias table.
 */

import { createRequire } from 'node:module';

import { Language, Parser } from 'web-tree-sitter';
import type { ParsedTree, TreeSitterParser } from './types.ts';

const require = createRequire(import.meta.url);

const WASM_MODULE_ALIASES: Readonly<Record<string, string>> = { csharp: 'c_sharp' };

let initPromise: Promise<void> | undefined;
const parserCache = new Map<string, Promise<TreeSitterParser>>();

async function initOnce(): Promise<void> {
  if (initPromise === undefined) initPromise = Parser.init();
  return initPromise;
}

function wasmPath(lang: string): string {
  const moduleName = WASM_MODULE_ALIASES[lang] ?? lang;
  return require.resolve(`tree-sitter-wasms/out/tree-sitter-${moduleName}.wasm`);
}

function toParser(parser: Parser): TreeSitterParser {
  return {
    parse: (input: string): ParsedTree | null => {
      const tree = parser.parse(input);
      return tree;
    },
  };
}

export async function loadParser(lang: string): Promise<TreeSitterParser> {
  const cached = parserCache.get(lang);
  if (cached !== undefined) return cached;
  const load = (async () => {
    await initOnce();
    const language = await Language.load(wasmPath(lang));
    const parser = new Parser();
    parser.setLanguage(language);
    return toParser(parser);
  })();
  parserCache.set(lang, load);
  load.catch(() => {
    parserCache.delete(lang);
  });
  return load;
}
