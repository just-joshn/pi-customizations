import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, candidate = repo] = process.argv.slice(2);
if (!repo) throw new Error('Expected original repository and optional candidate paths.');
const ts = await import(pathToFileURL(createRequire(join(repo, 'package.json')).resolve('typescript/unstable/ast')));
const { createTypeScriptSources } = await import(pathToFileURL(join(repo, 'extensions/pi-pstack/test/support/native-typescript-source.ts')));
const parser = createTypeScriptSources();
const base = execFileSync('git', ['-C', repo, 'merge-base', '9732597', '03ce27f'], { encoding: 'utf8' }).trim();
const inventories = {};
try {
  for (const [label, ref] of [
    ['base', base],
    ['branch', '9732597'],
    ['main', '03ce27f'],
    ['candidate', null],
  ]) {
    const reference = ref ?? '03ce27f';
    const paths = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', reference, '--', 'extensions/pi-pstack/test'], { encoding: 'utf8' }).trim().split('\n');
    if (!ref) paths.push(...Object.keys(inventories.branch).filter((path) => !paths.includes(path)));
    const inventory = {};
    for (const path of paths.filter((path) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path))) {
      const text = ref ? execFileSync('git', ['-C', repo, 'show', `${ref}:${path}`], { encoding: 'utf8' }) : existsSync(join(candidate, path)) ? readFileSync(join(candidate, path), 'utf8') : '';
      inventory[path] = parser.withSource(text, path, (source) => {
        const queue = [source];
        const tests = [];
        for (let index = 0; index < queue.length; index += 1) {
          const node = queue[index];
          node.forEachChild((child) => {
            queue.push(child);
          });
          if (!ts.isCallExpression(node)) continue;
          const expression = node.expression.getText(source);
          if (!/^(?:test|it)(?:\.|\(|$)/.test(expression)) continue;
          const title = node.arguments[0];
          if (!title) continue;
          if (!ts.isStringLiteral(title) && !ts.isNoSubstitutionTemplateLiteral(title) && !ts.isTemplateExpression(title)) continue;
          if (/^(?:test|it)\.(?:for|each|skipIf|runIf)$/.test(expression)) continue;
          tests.push({ title: ts.isTemplateExpression(title) ? title.getText(source) : title.text, parameterized: ts.isCallExpression(node.expression), expression });
        }
        return tests;
      });
    }
    inventories[label] = inventory;
  }
} finally {
  parser.close();
}
const missingMain = [];
const missingBranchAdded = [];
for (const [path, tests] of Object.entries(inventories.main)) {
  const actual = new Set((inventories.candidate[path] ?? []).map((test) => test.title));
  const missing = tests.filter((test) => !actual.has(test.title));
  if (missing.length) missingMain.push({ path, tests: missing });
}
for (const [path, tests] of Object.entries(inventories.branch)) {
  const before = new Set((inventories.base[path] ?? []).map((test) => test.title));
  const actual = new Set((inventories.candidate[path] ?? []).map((test) => test.title));
  const missing = tests.filter((test) => !before.has(test.title) && !actual.has(test.title));
  if (missing.length) missingBranchAdded.push({ path, tests: missing });
}
process.stdout.write(`${JSON.stringify({ scope: 'AST test definitions including parameterized titles; case data and assertions require diff review.', missingMain, missingBranchAdded, inventories }, null, 2)}\n`);
