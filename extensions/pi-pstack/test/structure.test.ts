import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript/unstable/ast';
import { afterAll, expect, test } from 'vitest';
import { createTypeScriptSources } from './support/native-typescript-source.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const { withSource: withTypeScriptSource, close } = createTypeScriptSources();
afterAll(close);

function functions(source: ts.SourceFile, fileName: string): string[] {
  const violations: string[] = [];
  const visit = (node: ts.Node, depth = 0): void => {
    if (ts.isFunctionLikeDeclaration(node)) depth = 0;
    if (ts.isFunctionLikeDeclaration(node) && 'body' in node && node.body) {
      const first = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const last = source.getLineAndCharacterOfPosition(node.end).line + 1;
      if (last - first + 1 >= 50) violations.push(`${fileName}:${first} has ${last - first + 1} function lines`);
    }
    const control = ts.isIfStatement(node) || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isTryStatement(node) || ts.isSwitchStatement(node);
    const nested = depth + Number(control);
    if (nested > 4) violations.push(`${fileName}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} exceeds four control levels`);
    else node.forEachChild((child) => visit(child, nested));
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
      const count = text.trimEnd().split('\n').length;
      if (count >= 800) violations.push(`${path} has ${count} lines`);
      violations.push(...withTypeScriptSource(text, path, (source: ts.SourceFile) => functions(source, path)));
      expect(text).not.toMatch(/console[.]log\s*\(/);
    }
  }
  const sources = (await readdir(join(root, 'src'))).filter((name) => name.endsWith('.ts'));
  expect(scanned).toEqual(expect.arrayContaining([...sources.map((name) => join(root, 'src', name)), join(root, 'test/structure.test.ts')]));
  expect(violations).toEqual([]);
}, 15000);

test('runtime source states no dependency version as a literal', async () => {
  expect.hasAssertions();
  for (const name of (await readdir(join(root, 'src'), { recursive: true })).filter((entry) => entry.endsWith('.ts'))) {
    const text = await readFile(join(root, 'src', name), 'utf8');
    expect({ name, versions: text.match(/\b\d+\.\d+\.\d+\b/g) ?? [] }).toEqual({ name, versions: [] });
  }
});

test('size analysis reports a function at the fifty-line limit', () => {
  const long = `function long() {\n${'  void 0;\n'.repeat(48)}}\n`;
  const violations = withTypeScriptSource(long, 'synthetic-long.ts', (source: ts.SourceFile) => functions(source, 'synthetic-long.ts'));
  expect(violations).toEqual(['synthetic-long.ts:1 has 50 function lines']);
});

test.for([
  { name: 'named function', open: 'function fixture() {', close: '}' },
  { name: 'arrow function', open: 'const fixture = () => {', close: '};' },
  { name: 'method', open: 'const fixture = { run() {', close: '} };' },
])('size analysis preserves the fifty-line limit for a $name', ({ open, close }) => {
  const text = `${open}\n${'  void 0;\n'.repeat(48)}${close}\n`;
  expect(withTypeScriptSource(text, 'fixture.ts', (source: ts.SourceFile) => functions(source, 'fixture.ts'))).toEqual(['fixture.ts:1 has 50 function lines']);
});

test('nested functions start a fresh control-depth budget', () => {
  const nested = (levels: number) => `function outer() {\n${'if (a) {\n'.repeat(4)}const inner = () => {\n${'if (b) {\n'.repeat(levels)}hit();\n${'}\n'.repeat(levels)}};\n${'}\n'.repeat(4)}}\n`;
  expect(withTypeScriptSource(nested(5), 'fixture.ts', (source: ts.SourceFile) => functions(source, 'fixture.ts'))).toEqual(['fixture.ts:11 exceeds four control levels']);
  expect(withTypeScriptSource(nested(4), 'fixture.ts', (source: ts.SourceFile) => functions(source, 'fixture.ts'))).toEqual([]);
});

test('size analysis reports nesting past four control levels', () => {
  const deep = `function deep() {\n${'if (a) {\n'.repeat(5)}hit()\n${'}\n'.repeat(5)}}\n`;
  const violations = withTypeScriptSource(deep, 'synthetic-deep.ts', (source: ts.SourceFile) => functions(source, 'synthetic-deep.ts'));
  expect(violations).toEqual(['synthetic-deep.ts:6 exceeds four control levels']);
});
