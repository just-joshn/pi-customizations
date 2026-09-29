#!/usr/bin/env node
// Enforces the root AGENTS.md rules that a static scan can decide.
//
// Scope is authored code. The pinned vendored trees (upstream, upstream-team-kit)
// and the generated resources (pi-pstack/skills, pi-pstack/prompts) are verified
// by check:resources and check:upstream, are never hand-edited, and are excluded
// here because a style edit would be overwritten by the next generate.
//
// Severity split. A `violation` is a rule the AGENTS.md checklist states as a hard
// requirement. A `note` is a judgement rule that still needs a reviewer's read.
// Two rules carry a scoped reading, stated here so the check is auditable:
// - Immutability targets a function's own data. Writing a field or an element of a
//   parameter is a violation, the pattern the rule shows. A mutating method call on
//   a parameter is a note, because passing an output sink or an accumulator is a
//   deliberate API shape that needs a reviewer, not a mechanical rewrite.
// - The console.log ban targets library code. A CLI script owns its stdout, so its
//   console calls are notes rather than violations.
//
// Two exemptions exist, and both have to be earned in the source:
// - A file that opens with a `Vendored from ... Do not edit.` banner is generated
//   by a vendor script and verified by that package's check:vendor gate, so a style
//   edit there fails the build. Those files are skipped.
// - A line carrying `agents-compliance-ignore <rule>: <reason>` is reported as an
//   exemption note. The pragma counts on the finding's line, the line above it, or
//   the enclosing function's first line. The reason is required, so the exemption is
//   a reviewed claim rather than a silencer.
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ts = createRequire(join(root, 'extensions/pi-pstack/package.json'))('typescript');

const limits = { file: 800, typicalFile: 400, function: 50, nesting: 4 };
const skipDirectories = new Set(['node_modules', '.git', 'coverage', 'artifacts', '.audit', 'dist', '.pi', '.claude', '.agents', 'upstream', 'upstream-team-kit']);
const generatedPrefixes = ['extensions/pi-pstack/skills/', 'extensions/pi-pstack/prompts/'];
const secretPatterns = [
  [/(?:^|[^A-Za-z0-9])(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/, 'API key literal'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token literal'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key literal'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [/eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\./, 'serialized JWT literal'],
];
const secretNames = new Set(['password', 'passwd', 'secret', 'token', 'apikey', 'api_key', 'accessToken', 'clientSecret', 'privateKey']);
const mutatingMethods = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear']);
const controlKinds = new Set(['IfStatement', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoStatement', 'SwitchStatement', 'TryStatement']);
const loopKinds = new Set(['ForStatement', 'ForOfStatement', 'ForInStatement']);
const pythonControl = /^(?:if|for|while|try|with)\b/;
const isTestPath = (path) => /(?:^|\/)(?:test|tests|__tests__)\//.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) || /^tests?\//.test(path);
const vendoredBanner = /Vendored from [\s\S]{0,200}?Do not edit\./;
const ignorePragma = /agents-compliance-ignore\s+([a-z-]+)\s*:\s*(\S.{11,})/;
const minReasonLength = 12;

function createReporter(source, path) {
  const found = [];
  return {
    found,
    report: (severity, rule, node, message) => {
      const line = source && node ? source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 : 1;
      found.push({ path, severity, rule, line, message });
    },
  };
}

function codeLines(text) {
  return text.split('\n').filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
  }).length;
}

function declaredName(node, source) {
  if (node.name?.text) return node.name.text;
  if (ts.isVariableDeclaration(node.parent)) return node.parent.name.getText(source);
  if (ts.isPropertyAssignment(node.parent)) return node.parent.name.getText(source);
  return 'callback';
}

function isNamedFunction(node) {
  const parent = node.parent;
  return ts.isFunctionDeclaration(node) || (ts.isVariableDeclaration(parent) && parent.initializer === node) || (ts.isPropertyAssignment(parent) && parent.initializer === node);
}

function isElseIf(node) {
  return ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
}

function controlDepth(node, depth) {
  let deepest = depth;
  ts.forEachChild(node, (child) => {
    if (ts.isFunctionLike(child)) return;
    const enters = controlKinds.has(ts.SyntaxKind[child.kind]) && !isElseIf(child);
    deepest = Math.max(deepest, controlDepth(child, enters ? depth + 1 : depth));
  });
  return deepest;
}

function checkFunctionShape(source, node, report) {
  const name = declaredName(node, source);
  const lines = codeLines(source.text.slice(node.body.getStart(source), node.body.getEnd()));
  if (lines > limits.function) report(isNamedFunction(node) ? 'violation' : 'note', 'function-length', node, `${name} is ${lines} code lines, over the ${limits.function} line limit`);
  const depth = controlDepth(node, 0);
  if (depth > limits.nesting) report('violation', 'nesting-depth', node, `${name} nests control flow ${depth} levels deep, over the ${limits.nesting} level limit`);
}

function parameterNames(node) {
  const names = new Set();
  for (const parameter of node.parameters) {
    const collect = (current) => (ts.isIdentifier(current) ? names.add(current.text) : ts.forEachChild(current, collect));
    collect(parameter.name);
  }
  return names;
}

function receiverOf(node) {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return node.expression;
  return undefined;
}

function mutationOf(node, params) {
  const assignedField = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken ? receiverOf(node.left) : undefined;
  if (assignedField) return ts.isIdentifier(assignedField) && params.has(assignedField.text) ? { kind: 'field', target: assignedField.text } : undefined;
  const deletedField = ts.isDeleteExpression(node) ? receiverOf(node.expression) : undefined;
  if (deletedField) return ts.isIdentifier(deletedField) && params.has(deletedField.text) ? { kind: 'field', target: deletedField.text } : undefined;
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || !mutatingMethods.has(node.expression.name.text)) return undefined;
  const receiver = node.expression.expression;
  return ts.isIdentifier(receiver) && params.has(receiver.text) ? { kind: 'collection', target: receiver.text } : undefined;
}

function checkParameterMutation(source, node, report) {
  const params = parameterNames(node);
  if (!params.size) return;
  const walk = (child) => {
    const mutation = mutationOf(child, params);
    if (mutation?.kind === 'field') report('violation', 'parameter-mutation', child, `${child.getText(source).split('\n')[0]} writes into parameter ${mutation.target} instead of returning a new object`);
    if (mutation?.kind === 'collection') report('note', 'accumulator-mutation', child, `${child.getText(source).split('\n')[0]} mutates parameter ${mutation.target}; confirm it is an output sink and not shared state`);
    ts.forEachChild(child, walk);
  };
  ts.forEachChild(node, walk);
}

function checkCatch(node, report) {
  if (node.block.statements.length) return;
  report('violation', 'empty-catch', node, 'catch block swallows the error with no handling');
}

function stringLiteral(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

function checkSecret(node, path, report) {
  const text = stringLiteral(node);
  if (!text) return;
  for (const [pattern, label] of secretPatterns) if (pattern.test(text)) report('violation', 'hardcoded-secret', node, `${label} in source`);
  const parent = node.parent;
  if (!ts.isPropertyAssignment(parent) || isTestPath(path)) return;
  const named = stringLiteral(parent.name) ?? parent.name.getText();
  if (secretNames.has(named) && text.length >= 8) report('violation', 'hardcoded-secret', parent, `${named} carries a literal value; read it from the environment`);
}

function checkEnvFallback(node, report) {
  if (!ts.isBinaryExpression(node)) return;
  const { BarBarToken, QuestionQuestionToken } = ts.SyntaxKind;
  if (node.operatorToken.kind !== BarBarToken && node.operatorToken.kind !== QuestionQuestionToken) return;
  const left = node.left.getText();
  if (left.startsWith('process.env.') && stringLiteral(node.right)) report('note', 'env-fallback', node, `${left} falls back to a literal instead of failing loudly`);
}

function loopSource(node) {
  return (node.initializer ?? node.expression ?? node.left)?.getText().replace(/\s+/g, ' ') ?? '';
}

function checkQuadratic(node, loops, report) {
  if (!loopKinds.has(ts.SyntaxKind[node.kind])) return;
  const source = loopSource(node);
  if (source && loops.some((outer) => outer === source)) report('note', 'quadratic-scan', node, `loop iterates ${source} again inside itself, which reads as O(n^2)`);
  loops.push(source);
  ts.forEachChild(node, (child) => checkQuadratic(child, loops, report));
  loops.pop();
}

function checkConsole(node, path, report) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
  if (!['log', 'debug'].includes(node.expression.name.text)) return;
  const receiver = node.expression.expression;
  if (!ts.isIdentifier(receiver) || receiver.text !== 'console') return;
  const inScript = path.startsWith('scripts/') || path.includes('/scripts/');
  report(inScript ? 'note' : 'violation', 'console-log', node, `console.${node.expression.name.text} in ${inScript ? 'a CLI script, so confirm it is the intended output' : 'library code'}`);
}

function enclosingScopeLine(scopes, line) {
  let best;
  for (const scope of scopes) {
    if (line < scope.start || line > scope.end) continue;
    if (!best || scope.end - scope.start < best.end - best.start) best = scope;
  }
  return best?.start;
}

function analyzeTypeScript(text, path) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const { found, report } = createReporter(source, path);
  const lineCount = text.split('\n').length;
  if (lineCount > limits.file) report('violation', 'file-length', undefined, `${lineCount} lines, over the ${limits.file} line maximum`);
  else if (lineCount > limits.typicalFile) report('note', 'file-length', undefined, `${lineCount} lines, over the ${limits.typicalFile} line target`);
  const loops = [];
  const scopes = [];
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body) {
      scopes.push({ start: lineOf(node), end: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1 });
      checkFunctionShape(source, node, report);
      checkParameterMutation(source, node, report);
    }
    if (ts.isCatchClause(node)) checkCatch(node, report);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) checkSecret(node, path, report);
    checkEnvFallback(node, report);
    checkQuadratic(node, loops, report);
    checkConsole(node, path, report);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.map((item) => ({ ...item, scopeLine: enclosingScopeLine(scopes, item.line) }));
}

function pythonLines(text) {
  const stack = [];
  const lines = [];
  for (const [index, line] of text.split('\n').entries()) {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    if (trimmed && !trimmed.startsWith('#') && !stack.length) lines.push({ index: index + 1, indent, trimmed });
    for (const character of trimmed) {
      if ('([{'.includes(character)) stack.push(character);
      else if (')]}'.includes(character)) stack.pop();
    }
  }
  return lines;
}

function checkPythonNesting(lines, report) {
  const blocks = [];
  for (const line of lines) {
    while (blocks.length && blocks.at(-1) >= line.indent) blocks.pop();
    if (!pythonControl.test(line.trimmed)) continue;
    blocks.push(line.indent);
    if (blocks.length > limits.nesting) report('violation', 'nesting-depth', undefined, `line ${line.index} nests control flow ${blocks.length} levels deep, over the ${limits.nesting} level limit`);
  }
}

function checkPythonFunctions(lines, report) {
  let start;
  let indent = 0;
  let name = '';
  let count = 0;
  const flush = () => {
    if (start !== undefined && count > limits.function) report('violation', 'function-length', undefined, `line ${start}: ${name} is ${count} code lines, over the ${limits.function} line limit`);
    start = undefined;
    count = 0;
  };
  for (const line of lines) {
    const definition = line.trimmed.match(/^(?:async\s+)?def\s+(\w+)/);
    if (definition) {
      flush();
      start = line.index;
      indent = line.indent;
      name = definition[1];
      continue;
    }
    if (start === undefined) continue;
    if (line.indent <= indent) flush();
    else count++;
  }
  flush();
}

function analyzePython(text, path) {
  const { found, report } = createReporter(undefined, path);
  const add = (rule, line, message) => found.push({ path, severity: 'violation', rule, line, message });
  const lines = pythonLines(text);
  const lineCount = text.split('\n').length;
  const fileRule = lineCount > limits.file ? 'violation' : lineCount > limits.typicalFile ? 'note' : undefined;
  if (fileRule) found.push({ path, severity: fileRule, rule: 'file-length', line: 1, message: `${lineCount} lines, over the ${fileRule === 'violation' ? `${limits.file} line maximum` : `${limits.typicalFile} line target`}` });
  checkPythonNesting(lines, report);
  checkPythonFunctions(lines, report);
  const isCli = /if\s+__name__\s*==\s*['"]__main__['"]/.test(text);
  for (const line of lines) {
    if (/^def\s+\w+\([^)]*=\s*(?:\[\]|\{\}|set\(\))/.test(line.trimmed)) add('mutable-default', line.index, 'mutable default argument is shared across every call');
    if (!/^print\(/.test(line.trimmed)) continue;
    found.push({ path, severity: isCli ? 'note' : 'violation', rule: 'print-statement', line: line.index, message: `print in ${isCli ? 'a CLI entry module, so confirm it is the intended output' : 'library code'}` });
  }
  return found;
}

async function sourceFiles(base = root) {
  const files = [];
  const pending = [base];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const rel = relative(base, path);
      if (entry.isDirectory()) {
        if (skipDirectories.has(entry.name) || generatedPrefixes.some((prefix) => `${rel}/`.startsWith(prefix))) continue;
        pending.push(path);
      } else if (entry.name.endsWith('.py') || /\.(?:ts|mts|cts|mjs|cjs|js)$/.test(entry.name)) files.push(path);
    }
  }
  return files.toSorted();
}

export async function analyzeFile(path, base = root) {
  const text = await readFile(path, 'utf8');
  const rel = relative(base, path);
  if (vendoredBanner.test(text.slice(0, 400))) return [];
  const found = path.endsWith('.py') ? analyzePython(text, rel) : analyzeTypeScript(text, rel);
  return applyExemptions(found, text.split('\n'));
}

function applyExemptions(found, lines) {
  return found.map((item) => {
    const scanned = [item.line, item.line - 1, item.scopeLine, item.scopeLine ? item.scopeLine - 1 : undefined].map((line) => lines[line - 1]).filter(Boolean);
    const pragmatic = scanned.map((line) => line.match(ignorePragma)).find((match) => match?.[1] === item.rule);
    if (!pragmatic) return item;
    const reason = pragmatic[2].replace(/\*\/\s*$/, '').trim();
    if (reason.length < minReasonLength) return { ...item, severity: 'violation', rule: 'empty-exemption', message: `${item.rule} exemption needs a reason of at least ${minReasonLength} characters` };
    return { ...item, severity: 'note', rule: 'exemption', message: `${item.rule} exempted: ${reason}` };
  });
}

export async function audit(base = root) {
  const files = await sourceFiles(base);
  const results = [];
  for (const file of files) results.push(...(await analyzeFile(file, base)));
  return results;
}

async function main() {
  const results = await audit();
  for (const item of results.toSorted((left, right) => left.path.localeCompare(right.path) || left.line - right.line)) {
    process.stdout.write(`${item.path}:${item.line}  ${item.severity === 'violation' ? 'error' : 'note '}  ${item.rule}  ${item.message}\n`);
  }
  const violations = results.filter((item) => item.severity === 'violation');
  const counts = new Map();
  for (const item of violations) counts.set(item.rule, (counts.get(item.rule) ?? 0) + 1);
  process.stdout.write(`\n${results.length} findings. ${violations.length} violations, ${results.length - violations.length} review items.\n`);
  for (const [rule, count] of [...counts].toSorted((left, right) => right[1] - left[1])) process.stdout.write(`  ${rule}: ${count}\n`);
  process.exit(violations.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
