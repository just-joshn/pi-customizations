#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScanner, getTokenAtPosition, isPropertyAccessExpression, SyntaxKind } from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';

export function indexSignatureEdits(source, diagnostics) {
  if (source.fileName.endsWith('vitest.config.ts')) return [];
  return diagnostics
    .filter((item) => item.code === 4111)
    .map((diagnostic) => {
      const token = getTokenAtPosition(source, diagnostic.pos);
      const node = token.parent;
      if (!isPropertyAccessExpression(node) || node.name.getStart(source) !== diagnostic.pos) throw new Error(`Unmatched compiler diagnostic in ${source.fileName}`);
      const scanner = createScanner(true, source.languageVariant, source.text, node.expression.end, node.name.getStart(source) - node.expression.end);
      const kind = scanner.scan();
      if (kind !== SyntaxKind.DotToken && kind !== SyntaxKind.QuestionDotToken) throw new Error(`No access token for compiler diagnostic in ${source.fileName}`);
      const start = scanner.getTokenStart();
      const trivia = source.text.slice(scanner.getTokenEnd(), node.name.getStart(source));
      return { start, length: node.name.end - start, replacement: `${kind === SyntaxKind.QuestionDotToken ? '?.' : ''}[${trivia}'${node.name.text}']` };
    });
}

export function applySourceEdits(text, edits) {
  const ordered = edits.toSorted((left, right) => left.start - right.start);
  for (const [index, edit] of ordered.entries()) {
    const previous = ordered[index - 1];
    if (edit.start < 0 || edit.length < 0 || edit.start + edit.length > text.length) throw new Error('Source edit exceeds the file');
    if (previous && edit.start < previous.start + previous.length) throw new Error('Source edits overlap');
  }
  const chunks = ordered.flatMap((edit, index) => {
    const previous = ordered[index - 1];
    return [text.slice(previous ? previous.start + previous.length : 0, edit.start), edit.replacement];
  });
  const last = ordered.at(-1);
  return [...chunks, text.slice(last ? last.start + last.length : 0)].join('');
}

async function migrateProject(program, root, args) {
  const diagnostics = program.getSemanticDiagnostics().filter((item) => item.code === 4111);
  const grouped = Map.groupBy(diagnostics, (item) => item.fileName);
  const paths = [...grouped.keys()].filter(Boolean).toSorted();
  const packages = new Set(args.filter((arg) => arg.startsWith('--package=')).map((arg) => arg.slice('--package='.length)));
  for (const fileName of paths) {
    if (!fileName || fileName.endsWith('vitest.config.ts')) continue;
    const path = relative(root, fileName).replaceAll('\\', '/');
    if (!path.startsWith('extensions/') || path.includes('/node_modules/')) continue;
    if (packages.size > 0 && !packages.has(path.split('/')[1])) continue;
    if (args.includes('--src-only') && !/^extensions\/[^/]+\/src\//.test(path)) continue;
    const source = program.getSourceFile(fileName);
    if (!source) throw new Error(`Compiler source unavailable: ${path}`);
    const edits = indexSignatureEdits(source, grouped.get(fileName));
    if (args.includes('--write')) {
      if ((await readFile(fileName, 'utf8')) !== source.text) throw new Error(`Source changed during migration: ${path}`);
      await writeFile(fileName, applySourceEdits(source.text, edits));
    }
    process.stdout.write(`${JSON.stringify({ path, edits: edits.length, written: args.includes('--write') })}\n`);
  }
}

async function main(args) {
  if (args.some((arg) => arg !== '--write' && arg !== '--src-only' && !/^--package=[a-z][a-z0-9-]*$/.test(arg))) {
    throw new Error('Usage: migrate-index-signature-access.mjs [--write] [--src-only] [--package=name]');
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  const configPath = resolve(root, 'tsconfig.json');
  const api = new API({ cwd: root });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [configPath] });
    try {
      const project = snapshot.getProject(configPath);
      if (!project) throw new Error('The compiler did not open the root project');
      await migrateProject(project.program, root, args);
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
