import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

function functions(source: ts.SourceFile): string[] {
  const violations: string[] = [];
  const visit = (node: ts.Node, depth = 0): void => {
    if (ts.isFunctionLike(node)) depth = 0;
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      const first = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const last = source.getLineAndCharacterOfPosition(node.end).line + 1;
      if (last - first + 1 >= 50) violations.push(`${source.fileName}:${first} has ${last - first + 1} function lines`);
    }
    const control = ts.isIfStatement(node) || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isTryStatement(node) || ts.isSwitchStatement(node);
    const nested = depth + Number(control);
    if (nested > 4) violations.push(`${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} exceeds four control levels`);
    else ts.forEachChild(node, (child) => visit(child, nested));
  };
  visit(source);
  return violations;
}

test('maintained extension code and tests meet the repository size and logging limits', async () => {
  const violations: string[] = [];
  const scanned: string[] = [];
  for (const directory of ['src', 'scripts', 'test']) {
    for (const name of await readdir(join(root, directory), { recursive: true })) {
      if (!/\.(ts|mjs)$/.test(name)) continue;
      const path = join(root, directory, name);
      scanned.push(path);
      const text = await readFile(path, 'utf8');
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const count = text.trimEnd().split('\n').length;
      if (count >= 800) violations.push(`${path} has ${count} lines`);
      violations.push(...functions(source));
      expect(text).not.toMatch(/console[.]log\s*\(/);
    }
  }
  const sources = (await readdir(join(root, 'src'))).filter((name) => name.endsWith('.ts'));
  expect(scanned).toEqual(expect.arrayContaining([...sources.map((name) => join(root, 'src', name)), join(root, 'test/structure.test.ts')]));
  expect(violations).toEqual([]);
});

test('runtime source states no dependency version as a literal', async () => {
  for (const name of (await readdir(join(root, 'src'), { recursive: true })).filter((entry) => entry.endsWith('.ts'))) {
    const text = await readFile(join(root, 'src', name), 'utf8');
    expect({ name, versions: text.match(/\b\d+\.\d+\.\d+\b/g) ?? [] }).toEqual({ name, versions: [] });
  }
});

test('size analysis reports a function at the fifty-line limit', () => {
  const long = `function long() {\n${'  void 0;\n'.repeat(48)}}\n`;
  const source = ts.createSourceFile('synthetic-long.ts', long, ts.ScriptTarget.Latest, true);
  expect(functions(source)).toEqual(['synthetic-long.ts:1 has 50 function lines']);
});

test('size analysis reports nesting past four control levels', () => {
  const deep = `function deep() {\n${'if (a) {\n'.repeat(5)}hit()\n${'}\n'.repeat(5)}}\n`;
  const source = ts.createSourceFile('synthetic-deep.ts', deep, ts.ScriptTarget.Latest, true);
  expect(functions(source)).toEqual(['synthetic-deep.ts:6 exceeds four control levels']);
});
