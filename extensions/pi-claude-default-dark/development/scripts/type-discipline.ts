import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';

const dev = join(import.meta.dirname, '..');
const roots = [join(dev, '../extensions'), join(dev, 'lib'), join(dev, 'scripts'), join(dev, 'tests')];
const isSource = (name: string) => /\.(ts|mts)$/.test(name);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(path);
    return isSource(entry.name) ? [path] : [];
  });
}

export function violations(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const report = (node: ts.Node, rule: string) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${fileName}:${line + 1}:${character + 1} ${rule}: ${node.getText(source).slice(0, 80)}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isAsExpression(node) && !(ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(source) === 'const')) report(node, 'type assertion');
    if (ts.isTypeAssertionExpression(node)) report(node, 'type assertion');
    if (ts.isNonNullExpression(node)) report(node, 'non-null assertion');
    if (node.kind === ts.SyntaxKind.AnyKeyword) report(node, 'any');
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const match of text.matchAll(/@ts-(ignore|expect-error|nocheck)/g)) {
    const { line } = source.getLineAndCharacterOfPosition(match.index);
    found.push(`${fileName}:${line + 1} suppression: @ts-${match[1]}`);
  }
  return found;
}

if (import.meta.main) {
  const found = roots.flatMap(files).flatMap((file) => violations(relative(dev, file), readFileSync(file, 'utf8')));
  if (found.length) {
    console.error(found.join('\n'));
    process.exitCode = 1;
  } else console.log('type-discipline: PASS');
}
