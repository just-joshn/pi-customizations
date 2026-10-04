#!/usr/bin/env node
// Enforces the extensions/AGENTS.md vitest rules that a static scan can decide.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript/unstable/ast';
import { closeTypeScriptSources, withTypeScriptSource } from '../../scripts/typescript-source.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const skipDirectories = new Set(['node_modules', 'coverage', 'dist', '.git']);
const weakMatchers = new Set(['toBeDefined', 'toBeTruthy', 'toBeFalsy', 'toBeUndefined', 'toBeNaN']);
const chainLinks = new Set(['resolves', 'rejects', 'not', 'soft', 'poll', 'each', 'for', 'skip', 'only', 'concurrent', 'sequential']);

function dotted(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const left = dotted(node.expression);
    return left ? `${left}.${node.name.text}` : '';
  }
  if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isParenthesizedExpression(node)) return dotted(node.expression);
  return '';
}

function chainNames(node) {
  const names = [];
  let current = node;
  while (true) {
    if (ts.isPropertyAccessExpression(current)) {
      names.unshift(current.name.text);
      current = current.expression;
    } else if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      names.unshift(current.expression.name.text);
      current = current.expression.expression;
    } else if (ts.isCallExpression(current) || ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (ts.isIdentifier(current)) {
      names.unshift(current.text);
      break;
    } else break;
  }
  return names;
}

function literal(node) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isArrayLiteralExpression(node) && node.elements.length === 0) return '[]';
  return undefined;
}

function isWeakAssertion(call, matcher, negated) {
  if (weakMatchers.has(matcher)) return true;
  if (matcher === 'toThrow' && negated) return true;
  if (matcher === 'toHaveBeenCalled' || matcher === 'toHaveBeenCalled' + 'Times') return true;
  if (matcher === 'toEqual' || matcher === 'toStrictEqual') return literal(call.arguments[0]) === '[]';
  if (matcher === 'toHaveLength') return literal(call.arguments[0]) === 0;
  if (matcher === 'toBeGreaterThan') return literal(call.arguments[0]) === 0;
  return false;
}

function assertionsIn(callback) {
  const found = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const names = chainNames(node);
      const matcher = names.at(-1);
      if (names[0] === 'expect' && matcher && matcher !== 'expect' && !chainLinks.has(matcher) && !ts.isPropertyAccessExpression(node.parent)) {
        found.push({ call: node, matcher, negated: names.includes('not') });
      }
    }
    node.forEachChild(visit);
  };
  visit(callback);
  return found;
}

function descendants(node) {
  const names = new Set();
  const visit = (current) => {
    if (ts.isIdentifier(current)) {
      const parent = current.parent;
      const isPropertyName = ts.isPropertyAccessExpression(parent) && parent.name === current;
      if (!isPropertyName) names.add(current.text);
    }
    current.forEachChild(visit);
  };
  visit(node);
  return names;
}

function createReporter(source, path) {
  const found = [];
  const report = (severity, rule, node, message) =>
    found.push({
      path,
      severity,
      rule,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      message,
    });
  return { found, report };
}

function collectTests(source, report) {
  const testCalls = [];
  const walk = (node, depth) => {
    if (ts.isCallExpression(node)) {
      const first = chainNames(node)[0];
      if (first === 'describe' || first === 'test' || first === 'it') {
        const name = literal(node.arguments[0]);
        const callback = node.arguments.find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
        if (name && name.length > 72) report('review', 'test-name-length', node, `test name is ${name.length} characters ("short behavior-based test names")`);
        if (name && /\band\b/.test(name)) report('review', 'test-name-compound', node, `test name joins behaviors with "and": "${name}"`);
        if (first === 'describe') {
          if (depth >= 2) report('violation', 'describe-nesting', node, `describe nesting depth ${depth + 1} exceeds two levels`);
          walk(callback ?? node, depth + 1);
          return;
        }
        if (callback) testCalls.push({ node, name, callback });
      }
      if (/^[a-z]+\.concurrent/.test(dotted(node))) report('review', 'concurrent-test', node, 'concurrent tests need every resource independently isolated');
    }
    node.forEachChild((child) => walk(child, depth));
  };
  walk(source, 0);
  return testCalls;
}

function collectHelpers(source, testCallNodes) {
  const assertingHelpers = new Set();
  const helperCalls = new Map();
  const wrapperParameters = new Set();
  const collect = (node) => {
    if (ts.isFunctionLikeDeclaration(node)) {
      let wrapsTest = false;
      const scan = (child) => {
        if (testCallNodes.has(child)) wrapsTest = true;
        else if (!wrapsTest) child.forEachChild(scan);
      };
      node.forEachChild(scan);
      if (wrapsTest) for (const parameter of node.parameters) for (const name of descendants(parameter.name)) wrapperParameters.add(name);
      const body = node.body;
      if (body && ts.isFunctionDeclaration(node) && node.name) {
        helperCalls.set(node.name.text, descendants(body));
        if (assertionsIn(body).length) assertingHelpers.add(node.name.text);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      helperCalls.set(node.name.text, descendants(node.initializer));
      if (assertionsIn(node.initializer).length) assertingHelpers.add(node.name.text);
    }
    node.forEachChild(collect);
  };
  collect(source);
  for (let pass = 0; pass < helperCalls.size; pass++) {
    const before = assertingHelpers.size;
    for (const [name, calls] of helperCalls) {
      if (!assertingHelpers.has(name) && [...calls].some((called) => assertingHelpers.has(called))) assertingHelpers.add(name);
    }
    if (assertingHelpers.size === before) break;
  }
  return { assertingHelpers, wrapperParameters };
}

function collectAwaitedNames(source) {
  const awaitedNames = new Set();
  const collect = (node) => {
    if (ts.isAwaitExpression(node)) for (const name of descendants(node.expression)) awaitedNames.add(name);
    if (ts.isCallExpression(node) && /^Promise\.(all|allSettled|race|any)$/.test(dotted(node))) {
      for (const argument of node.arguments) for (const name of descendants(argument)) awaitedNames.add(name);
    }
    node.forEachChild(collect);
  };
  collect(source);
  return awaitedNames;
}

function reportTestAssertions(source, testCalls, report) {
  const testCallNodes = new Set(testCalls.map((test) => test.node));
  const { assertingHelpers, wrapperParameters } = collectHelpers(source, testCallNodes);
  for (const test of testCalls) {
    const label = test.name ? `"${test.name}"` : 'test';
    const referenced = descendants(test.callback);
    if ([...referenced].some((name) => assertingHelpers.has(name) || wrapperParameters.has(name))) continue;
    const assertions = assertionsIn(test.callback);
    if (!assertions.length) {
      report('violation', 'no-assertion', test.node, `${label} makes no assertion`);
    } else if (!assertions.some(({ call, matcher, negated }) => !isWeakAssertion(call, matcher, negated))) {
      report('violation', 'weak-only-assertion', test.node, `${label} asserts only ${[...new Set(assertions.map((item) => item.matcher))].join(', ')}`);
    }
  }
}

function checkTimerCall(node, report) {
  let ancestor = node.parent;
  let inPromise = false;
  while (ancestor && !ts.isStatement(ancestor)) {
    if (ts.isNewExpression(ancestor) && dotted(ancestor) === 'Promise') inPromise = true;
    ancestor = ancestor.parent;
  }
  if (inPromise) report('violation', 'real-wait', node, 'awaits a real timer instead of an observable readiness condition');
  else report('review', 'timer-deadline', node, 'timer-based deadline: keep it finite and clear it on success');
}

function checkModuleMock(name, node, report) {
  // A Node built-in has no module file to import, and the import form does not type-check for a CJS built-in, so a string
  // specifier is the only way to mock it. The rule still applies to every resolvable module path.
  if ((name === 'vi.mock' || name === 'vi.doMock') && ts.isStringLiteral(node.arguments[0]) && !node.arguments[0].text.startsWith('node:')) {
    report('violation', 'string-module-mock', node, 'prefer vi.mock(import("./module.js")) over a string specifier');
  }
  if (name !== 'vi.mock' && name !== 'vi.unmock' && name !== 'vi.hoisted') return;
  let scope = node.parent;
  while (scope && !ts.isSourceFile(scope)) {
    if (ts.isFunctionLikeDeclaration(scope) || ts.isBlock(scope) || ts.isIfStatement(scope) || ts.isTryStatement(scope)) {
      report('violation', 'nested-hoisted-mock', node, `${name} must stay at the top level because it is hoisted`);
      return;
    }
    scope = scope.parent;
  }
}

function checkMatcherCall(names, node, report) {
  const matcher = names.at(-1);
  if (matcher?.startsWith('toMatchSnapshot') || matcher?.startsWith('toMatchInlineSnapshot') || matcher?.startsWith('toMatchFileSnapshot')) {
    report('review', 'snapshot', node, 'snapshot: the complete serialized value must be the contract');
  }
  if (matcher === 'toThrow' || matcher === 'toThrowError') {
    const expectArgument = ts.isPropertyAccessExpression(node.expression) ? node.expression.expression.arguments?.[0] : undefined;
    if (expectArgument && ts.isCallExpression(expectArgument) && !names.includes('rejects') && !names.includes('resolves')) {
      report('violation', 'unwrapped-throw', node, 'wrap the synchronous throwing call in an arrow function before toThrow');
    }
  }
  if (matcher === 'toBeTruthy' || matcher === 'toBeFalsy') report('violation', 'truthy-matcher', node, `use a precise matcher instead of ${matcher}`);
}

function checkCall(node, report) {
  const name = dotted(node);
  if (name === 'setTimeout') checkTimerCall(node, report);
  if (name.startsWith('vi.')) checkModuleMock(name, node, report);
  checkMatcherCall(chainNames(node), node, report);
  if (name === 'process.cwd' || name === 'os.homedir' || name === 'homedir') {
    report('review', 'developer-filesystem', node, 'prefer a test-controlled directory over developer-machine filesystem state');
  }
}

function checkAsyncExpectation(node, awaitedNames, report) {
  if (node.name.text !== 'resolves' && node.name.text !== 'rejects') return;
  let chain = node;
  while (chain.parent && (ts.isPropertyAccessExpression(chain.parent) || ts.isCallExpression(chain.parent) || ts.isNonNullExpression(chain.parent))) chain = chain.parent;
  const parent = chain.parent;
  const awaited = parent && ts.isAwaitExpression(parent);
  const returned = parent && (ts.isReturnStatement(parent) || ts.isArrowFunction(parent));
  const assigned = parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : undefined;
  const passed = parent && ts.isCallExpression(parent);
  if (!awaited && !returned && !passed && !(assigned !== undefined && awaitedNames.has(assigned))) {
    report('violation', 'unawaited-async-expect', node, 'await the asynchronous expectation or it cannot fail the test');
  }
}

function checkMutation(target, report, remove = false) {
  const name = dotted(target);
  const verb = remove ? 'deleting' : 'assigning';
  if (name.startsWith('process.env.')) report('violation', 'unmanaged-env-mutation', target, `use vi.stubEnv instead of ${verb} ${name}`);
  if (!remove && (name.startsWith('globalThis.') || name.startsWith('global.'))) report('violation', 'unmanaged-global-mutation', target, `use vi.stubGlobal instead of ${verb} ${name}`);
}

function reportStatements(source, report) {
  const awaitedNames = collectAwaitedNames(source);
  const visit = (node) => {
    if (ts.isIdentifier(node) && (node.text === 'jest' || node.text === 'jasmine')) report('violation', 'jest-api', node, 'Jest APIs are not allowed in Vitest suites');
    if (ts.isStringLiteral(node) && node.text === '@jest/globals') report('violation', 'jest-api', node, 'import from vitest instead of @jest/globals');
    if (ts.isCallExpression(node)) checkCall(node, report);
    if (ts.isPropertyAccessExpression(node)) checkAsyncExpectation(node, awaitedNames, report);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) checkMutation(node.left, report);
    if (ts.isDeleteExpression(node)) checkMutation(node.expression, report, true);
    node.forEachChild(visit);
  };
  visit(source);
}

export function analyzeSource(text, path) {
  return withTypeScriptSource(text, path, (source) => analyzeNativeSource(source, path));
}

function analyzeNativeSource(source, path) {
  const { found, report } = createReporter(source, path);
  const testCalls = collectTests(source, report);
  reportTestAssertions(source, testCalls, report);
  reportStatements(source, report);
  return found;
}

async function collectTestFiles(directory) {
  const files = [];
  for (const child of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, child.name);
    if (child.isDirectory()) {
      if (!skipDirectories.has(child.name)) files.push(...(await collectTestFiles(path)));
    } else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(child.name)) {
      const text = await readFile(path, 'utf8');
      files.push({ path, text });
    }
  }
  return files;
}

export async function testFiles(base = root) {
  const entries = await readdir(base, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory() && !skipDirectories.has(entry.name));
  const files = (await Promise.all(directories.map((entry) => collectTestFiles(join(base, entry.name))))).flat();
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function configViolations(base = root) {
  const found = [];
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || skipDirectories.has(entry.name)) continue;
    const directory = join(base, entry.name);
    const packagePath = join(directory, 'package.json');
    let manifest;
    try {
      manifest = JSON.parse(await readFile(packagePath, 'utf8'));
    } catch {
      continue;
    }
    const relativePackage = relative(base, packagePath);
    const script = manifest.scripts?.test ?? '';
    if (script && !/(^|\s)vitest\s+(run|--run)/.test(script)) found.push({ path: relativePackage, severity: 'violation', rule: 'watch-mode-script', line: 1, message: `test script "${script}" must run with vitest run` });
    let config;
    try {
      config = await readFile(join(directory, 'vitest.config.ts'), 'utf8');
    } catch {
      found.push({ path: `${entry.name}/vitest.config.ts`, severity: 'violation', rule: 'missing-config', line: 1, message: 'extension has no vitest.config.ts' });
      continue;
    }
    found.push(...checkConfigText(`${entry.name}/vitest.config.ts`, config, manifest, relativePackage));
  }
  return found;
}

function checkConfigText(path, config, manifest, relativePackage) {
  const found = [];
  const add = (rule, message) => found.push({ path, severity: 'violation', rule, line: 1, message });
  if (!/coverage\s*:\s*\{[\s\S]*include\s*:\s*\[/.test(config)) add('missing-coverage-include', 'configure coverage.include so completely untested source files are visible');
  if (/isolate\s*:\s*false|fileParallelism\s*:\s*false|singleThread|singleFork|maxWorkers\s*:\s*1/.test(config)) add('disabled-isolation', 'keep file isolation and parallelism enabled unless measured evidence justifies disabling it');
  if (/sequence\s*:\s*\{[\s\S]*concurrent\s*:\s*true/.test(config)) add('concurrent-sequence', 'keep tests sequential unless concurrent tests are demonstrably independent');
  if (/coverage\s*:/.test(config) && !manifest.devDependencies?.['@vitest/coverage-v8']) {
    found.push({ path: relativePackage, severity: 'violation', rule: 'missing-coverage-provider', line: 1, message: 'declare @vitest/coverage-v8 in devDependencies' });
  }
  return found;
}

async function main() {
  const files = await testFiles();
  const results = [];
  for (const file of files) results.push(...analyzeSource(file.text, relative(root, file.path)));
  results.push(...(await configViolations()));

  const groups = new Map();
  for (const item of results) {
    if (!groups.has(item.path)) groups.set(item.path, []);
    groups.get(item.path).push(item);
  }
  for (const [path, items] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    for (const item of items.sort((left, right) => left.line - right.line)) {
      process.stdout.write(`${path}:${item.line}  ${item.severity === 'violation' ? 'error' : 'note '}  ${item.rule}  ${item.message}\n`);
    }
  }
  const violations = results.filter((item) => item.severity === 'violation');
  const counts = new Map();
  for (const item of violations) counts.set(item.rule, (counts.get(item.rule) ?? 0) + 1);
  process.stdout.write(`\n${files.length} vitest files scanned. ${violations.length} violations, ${results.length - violations.length} review items.\n`);
  for (const [rule, count] of [...counts].sort((left, right) => right[1] - left[1])) process.stdout.write(`  ${rule}: ${count}\n`);
  process.exitCode = violations.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } finally {
    closeTypeScriptSources();
  }
}
