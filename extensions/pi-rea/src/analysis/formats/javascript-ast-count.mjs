import { parse } from '@babel/parser';

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'range', 'leadingComments', 'trailingComments', 'innerComments', 'errors', 'comments']);

export function countVisitedAstNodes(source, sourcePath) {
  let file;
  try {
    file = parse(source, {
      sourceType: /\.cjs$/iu.test(sourcePath) ? 'unambiguous' : 'module',
      errorRecovery: true,
      attachComment: false,
      plugins: parserPluginsForPath(sourcePath),
      ...(/\.cjs$/iu.test(sourcePath) ? { allowReturnOutsideFunction: true, allowNewTargetOutsideFunction: true } : {}),
    });
  } catch {
    return 0;
  }
  return countNodes(file);
}

function parserPluginsForPath(sourcePath) {
  const path = sourcePath ?? '';
  const syntax = ['decorators-legacy', 'sourcePhaseImports'];
  if (/\.(?:js|jsx|mjs|cjs)$/iu.test(path)) return [...syntax, 'jsx'];
  const dts = /\.d\.(?:ts|mts|cts)$/iu.test(path);
  const isTsLike = /\.(?:ts|cts|mts)$/iu.test(path);
  const isTsx = /\.tsx$/iu.test(path);
  const isMts = /\.mts$/iu.test(path);
  const typescript = ['typescript', { dts, ...(isMts ? { disallowAmbiguousJSXLike: true } : {}) }];
  const jsxCapable = !dts && (isTsx || !isTsLike);
  return jsxCapable ? [...syntax, 'jsx', typescript] : [...syntax, typescript];
}

function countNodes(node, seen = new Set()) {
  if (node === null || typeof node !== 'object' || seen.has(node)) return 0;
  if (typeof node.type !== 'string') return 0;
  seen.add(node);
  let total = 1;
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) total += countNodes(child, seen);
    } else {
      total += countNodes(value, seen);
    }
  }
  return total;
}
