/**
 * Tree-sitter syntax scan: records the start row of every ERROR node and
 * every missing node. TypeScript is skipped on purpose, matching the
 * reference behavior of disabling the built-in check for that language.
 */

import { filenameToLang } from './languages.ts';
import type { LintResult, ParsedNode, TreeSitterParser } from './types.ts';

function collectErrorRows(root: ParsedNode): number[] {
  const rows: number[] = [];
  const stack: ParsedNode[] = [root];
  for (;;) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node.type === 'ERROR' || node.isMissing) rows.push(node.startPosition.row);
    for (const child of node.children) {
      if (child !== null) stack.push(child);
    }
  }
  return rows;
}

export interface BasicLintIo {
  readonly error: (message: string) => void;
}

export interface BasicLintInput {
  readonly fname: string;
  readonly code: string;
  readonly loadParser: (lang: string) => Promise<TreeSitterParser>;
  readonly io: BasicLintIo;
}

export async function basicLint(input: BasicLintInput): Promise<LintResult | undefined> {
  const lang = filenameToLang(input.fname);
  if (lang === undefined) return undefined;
  if (lang === 'typescript') return undefined;

  let parser: TreeSitterParser;
  try {
    parser = await input.loadParser(lang);
  } catch (error: unknown) {
    input.io.error(`Unable to load parser: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }

  const tree = parser.parse(input.code);
  if (tree === null) return undefined;

  const errors = collectErrorRows(tree.rootNode);
  if (errors.length === 0) return undefined;
  return { text: '', lines: errors };
}
