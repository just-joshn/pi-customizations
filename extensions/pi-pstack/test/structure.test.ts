import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

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
    const control = ts.isIfStatement(node) || ts.isForStatement(node) || ts.isForOfStatement(node)
      || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)
      || ts.isTryStatement(node) || ts.isSwitchStatement(node);
    const nested = depth + Number(control);
    if (nested > 4) violations.push(`${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} exceeds four control levels`);
    else ts.forEachChild(node, child => visit(child, nested));
  };
  visit(source);
  return violations;
}

test('maintained extension code and tests meet the repository size and logging limits', async () => {
  const violations: string[] = [];
  for (const directory of ['src', 'scripts', 'test']) {
    for (const name of await readdir(join(root, directory), { recursive: true })) {
      if (!/\.(ts|mjs)$/.test(name)) continue;
      const path = join(root, directory, name);
      const text = await readFile(path, 'utf8');
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const count = text.trimEnd().split('\n').length;
      if (count >= 800) violations.push(`${path} has ${count} lines`);
      violations.push(...functions(source));
      assert.doesNotMatch(text, /console[.]log\s*\(/, path);
    }
  }
  assert.deepEqual(violations, []);
});
