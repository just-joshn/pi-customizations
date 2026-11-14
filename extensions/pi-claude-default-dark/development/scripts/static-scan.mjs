import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import ts from 'typescript';

const manifest = {
  name: 'pi-claude-default-dark',
  version: '0.1.0',
  private: true,
  type: 'module',
  description: 'Pi-native, reference-locked Claude Code default-dark appearance extension',
  keywords: ['pi-package', 'pi-extension', 'pi-theme'],
  pi: { extensions: ['./extensions/index.ts'], themes: ['./themes/claude-default-dark.json'] },
  files: ['extensions', 'themes', 'README.md', 'LICENSE'],
  dependencies: {},
  peerDependencies: { '@earendil-works/pi-coding-agent': '*', '@earendil-works/pi-tui': '*' },
};
const supplied = new Set(['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui']);
const apiCalls = new Set(['registerCommand', 'registerToolRenderer', 'on']);
const uiCalls = new Set(['setTheme', 'getAllThemes', 'getTheme', 'notify', 'setWorkingIndicator', 'setWorkingMessage']);
const forbidden = new Set(['registerTool', 'sendMessage', 'sendUserMessage', 'appendEntry', 'exec', 'setActiveTools', 'setModel', 'setThinkingLevel', 'setHeader', 'setFooter', 'setEditorComponent']);

export async function scan(root) {
  const violations = [];
  const reject = (file, message) => violations.push({ file, message });
  const actual = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!isDeepStrictEqual(actual, manifest)) reject('package.json', 'manifest differs from approved package');
  async function walk(directory) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
        continue;
      }
      if (entry.name.endsWith('.json')) continue;
      if (!entry.name.endsWith('.ts')) {
        reject(file, 'unscanned file type; shipped code must be TypeScript');
        continue;
      }
      const source = ts.createSourceFile(file, await readFile(join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
      const declarations = new Map();
      const aliases = new Map([['pi', 'api']]);
      const unwrap = (node) => {
        while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
        return node;
      };
      const target = (raw) => {
        const node = unwrap(raw);
        if (!node) return undefined;
        if (ts.isIdentifier(node)) return aliases.get(node.text);
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'ui') return 'ui';
        return undefined;
      };
      function collect(node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
          declarations.set(node.name.text, node.initializer);
          const kind = target(node.initializer);
          if (kind) aliases.set(node.name.text, kind);
        }
        if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node);
        ts.forEachChild(node, collect);
      }
      collect(source);
      function setsTheme(node, seen = new Set()) {
        if (!node) return false;
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'setTheme') return true;
        if (ts.isIdentifier(node) && declarations.has(node.text) && !seen.has(node.text)) {
          seen.add(node.text);
          if (setsTheme(declarations.get(node.text), seen)) return true;
        }
        let found = false;
        ts.forEachChild(node, (child) => {
          if (setsTheme(child, seen)) found = true;
        });
        return found;
      }
      const checkImport = (name) => {
        const local = name.startsWith('./') || name.startsWith('../');
        const resolved = resolve(root, directory, name);
        const inside = resolved.startsWith(`${resolve(root, 'extensions')}/`) || resolved === resolve(root, 'themes/claude-default-dark.json');
        if (!supplied.has(name) && !(local && inside && !name.includes('/dist/'))) reject(file, `forbidden import ${name}`);
      };
      function staysInScan(node) {
        const parent = node.parent;
        if (!parent) return false;
        if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node) return true;
        if (ts.isVariableDeclaration(parent) && parent.initializer === node) return true;
        return (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === node;
      }
      function visit(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) checkImport(node.moduleSpecifier.text);
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) checkImport(node.argument.literal.text);
        if (ts.isImportEqualsDeclaration(node)) reject(file, 'forbidden import equals');
        if (ts.isIdentifier(node) && node.text === 'process') reject(file, 'forbidden process access');
        if (ts.isPropertyAccessExpression(node)) {
          const name = node.name.text;
          const kind = target(node.expression);
          if (forbidden.has(name) && (name !== 'exec' || kind === 'api')) reject(file, `forbidden ${name}`);
          if (name === 'setTheme') {
            let ancestor = node.parent;
            while (ancestor && !(ts.isCallExpression(ancestor) && ts.isPropertyAccessExpression(ancestor.expression) && ancestor.expression.name.text === 'registerCommand')) ancestor = ancestor.parent;
            if (!ancestor) reject(file, 'setTheme is only allowed inside a command');
          }
          if (kind === 'api' && !apiCalls.has(name)) reject(file, `forbidden API member ${name}`);
          if (kind === 'ui' && !uiCalls.has(name) && name !== 'theme') reject(file, `forbidden UI member ${name}`);
        }
        if (ts.isElementAccessExpression(node) && target(node.expression)) reject(file, 'computed API access');
        if (ts.isElementAccessExpression(node) && ts.isIdentifier(unwrap(node.expression)) && ['globalThis', 'global', 'window', 'self'].includes(unwrap(node.expression).text)) reject(file, 'computed global access');
        if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && target(node.initializer)) reject(file, 'destructured API access');
        if (target(node) && !staysInScan(node)) reject(file, `API object escapes the scan: ${node.getText(source)}`);
        if (ts.isCallExpression(node)) {
          const expression = unwrap(node.expression);
          const name = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined;
          if (['fetch', 'require'].includes(name) || expression.kind === ts.SyntaxKind.ImportKeyword) reject(file, `forbidden call ${name ?? 'import'}`);
          if (name === 'on') {
            const event = node.arguments[0];
            if (!event || !ts.isStringLiteral(event) || !['session_start', 'agent_start', 'turn_start'].includes(event.text)) reject(file, 'forbidden event handler');
            if (setsTheme(node.arguments[1])) reject(file, 'lifecycle handler sets theme');
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  await walk('extensions');
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? fileURLToPath(new URL('../..', import.meta.url));
  const violations = await scan(root);
  for (const { file, message } of violations) console.error(`${file}: ${message}`);
  console.log(`static-scan: ${violations.length ? 'FAIL' : 'PASS'}`);
  process.exitCode = violations.length ? 1 : 0;
}
