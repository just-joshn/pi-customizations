import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import { auditSlice, contentLines, isUnresolved, normalize, reusedQuotes } from './parity-contracts.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.PSTACK_PARITY_HOME ?? homedir();
const quoteReuseLimit = 12;
const nativeExclusions = ['upstream', 'upstream-team-kit', 'docs', 'node_modules', 'coverage'];
const sourceRoots = [join(root, 'upstream'), join(root, 'upstream-team-kit'), join(home, '.cursor/skills-cursor'), join(home, 'src/experiments/plugins')];
const defaultRepo = join(home, 'src/experiments/plugins');
const helperSuite = join(root, 'skills/poteto-mode/scripts');

const { values } = parseArgs({ options: { parity: { type: 'string', default: join(root, 'docs/parity') }, slice: { type: 'string', multiple: true }, 'no-tests': { type: 'boolean' }, report: { type: 'string' } } });
const directory = resolve(values.parity);
const reference = JSON.parse(await readFile(join(directory, 'reference.json'), 'utf8'));
const source = await readFile(expand(reference.source));
if (createHash('sha256').update(source).digest('hex') !== reference.sha256) throw new Error('Reference document changed. Reconcile the clause inventory before claiming parity.');
const lineCount = source.toString('utf8').split('\n').length;
assertContiguous(reference.slices, lineCount);
const covered = contentLines(source.toString('utf8'));
const selected = reference.slices.filter((slice) => !values.slice?.length || values.slice.includes(slice.id));
const findings = [];
const clauses = [];
for (const slice of selected) {
  const sliceClauses = JSON.parse(await readFile(join(directory, 'clauses', `${slice.id}.json`), 'utf8'));
  findings.push(...auditSlice(slice, sliceClauses, covered));
  clauses.push(...sliceClauses);
}
findings.push(...reusedQuotes(clauses, quoteReuseLimit));
const files = new Map();
const commits = new Map();
const testResults = values['no-tests'] ? undefined : await testResultsFor(clauses);
for (const clause of clauses) for (const check of clause.checks ?? []) findings.push(...(await failedCheck(clause.id, check)));
const open = clauses.filter(isUnresolved);
for (const clause of open) findings.push(`${clause.id} is ${clause.verdict}${clause.note ? `: ${clause.note}` : ''}`);
const tally = Object.entries(Object.groupBy(clauses, (clause) => clause.verdict))
  .map(([verdict, list]) => `${verdict} ${list.length}`)
  .join(', ');
process.stdout.write(`${clauses.length} clauses in ${selected.length} slices (${tally}). ${findings.length} findings.\n`);
if (findings.length) {
  process.stdout.write(`${findings.join('\n')}\n`);
  process.exitCode = 1;
}

function expand(path) {
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return isAbsolute(path) ? path : resolve(root, path);
}

function assertContiguous(slices, count) {
  let next = 1;
  for (const slice of slices) {
    if (slice.from !== next || slice.to < slice.from) throw new Error(`Slice ${slice.id} does not continue at line ${next}.`);
    next = slice.to + 1;
  }
  if (next !== count + 1) throw new Error(`Slices end at line ${next - 1}; the reference has ${count} lines.`);
}

function inside(parent, path) {
  const offset = relative(parent, path);
  return !offset.startsWith('..') && !isAbsolute(offset);
}

async function text(path) {
  if (!files.has(path))
    files.set(
      path,
      readFile(path, 'utf8').then(normalize, () => undefined),
    );
  return files.get(path);
}

async function failedCheck(id, check) {
  if (['quote', 'source', 'file', 'source-file'].includes(check.type)) {
    const path = expand(check.path);
    const native = inside(root, path) && !nativeExclusions.some((name) => inside(join(root, name), path));
    if ((check.type === 'quote' || check.type === 'file') && !native) return [`${id} ${check.type} check cites non-native ${check.path}.`];
    if (check.type.startsWith('source') && (!sourceRoots.some((base) => inside(base, path)) || path === expand(reference.source))) return [`${id} ${check.type} check cites ${check.path} outside the preserved sources.`];
    if (check.type.endsWith('file'))
      return (await stat(path).then(
        (entry) => entry.isFile(),
        () => false,
      ))
        ? []
        : [`${id} cites missing file ${check.path}.`];
    const body = await text(path);
    if (body === undefined) return [`${id} cites missing file ${check.path}.`];
    return body.includes(normalize(check.quote)) ? [] : [`${id} quote not found in ${check.path}: "${check.quote.slice(0, 80)}"`];
  }
  if (check.type === 'commit') return (await commitHolds(check)) ? [] : [`${id} commit ${check.rev}${check.subject ? ` with subject "${check.subject}"` : ''} not found.`];
  if (check.type === 'test') return (await testHolds(check)) ? [] : [`${id} test did not pass: ${check.path} > ${check.name}`];
  return [];
}

async function commitHolds(check) {
  const repo = check.repo ? expand(check.repo) : defaultRepo;
  const key = `${repo}\u0000${check.rev}`;
  if (!commits.has(key))
    commits.set(
      key,
      run('git', ['-C', repo, 'log', '-1', '--format=%s', `${check.rev}^{commit}`]).then(
        ({ stdout }) => stdout.trim(),
        () => undefined,
      ),
    );
  const subject = await commits.get(key);
  return subject !== undefined && (!check.subject || subject.includes(check.subject));
}

async function testHolds(check) {
  if (!testResults) return (await text(resolve(root, check.path))) !== undefined;
  return testResults.get(`${resolve(root, check.path)}\u0000${check.name}`) === 'passed';
}

async function testResultsFor(all) {
  const checks = all.flatMap((clause) => (clause.checks ?? []).filter((check) => check.type === 'test'));
  const vitest = [...new Set(checks.filter((check) => !check.runner).map((check) => check.path))];
  const bun = [...new Set(checks.filter((check) => check.runner === 'bun').map((check) => check.path))];
  const journey = checks.some((check) => check.runner === 'journey');
  const scratch = await mkdtemp(join(tmpdir(), 'pstack-parity-'));
  try {
    return new Map([...(vitest.length ? await vitestResults(vitest, scratch) : []), ...(bun.length ? await bunResults(scratch, bun) : []), ...(journey ? await journeyResults() : [])]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function vitestResults(paths, scratch) {
  let report;
  if (values.report) report = JSON.parse(await readFile(values.report, 'utf8'));
  else {
    const output = join(scratch, 'report.json');
    await run(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...paths, '--reporter=json', `--outputFile=${output}`], { cwd: root, maxBuffer: 1 << 26 }).catch(() => undefined);
    report = JSON.parse(await readFile(output, 'utf8'));
  }
  return report.testResults.flatMap((file) => file.assertionResults.map((result) => [`${file.name}\u0000${result.fullName}`, result.status]));
}

async function bunResults(scratch, paths) {
  const groups = [
    { cwd: helperSuite, files: paths.filter((path) => inside(helperSuite, resolve(root, path))).map((path) => relative(helperSuite, resolve(root, path))) },
    { cwd: root, files: paths.filter((path) => !inside(helperSuite, resolve(root, path))).map((path) => `./${path}`) },
  ].filter((group) => group.files.length);
  const results = [];
  for (const [index, group] of groups.entries()) {
    const output = join(scratch, `bun-${index}.xml`);
    await run('bun', ['test', ...group.files, '--reporter=junit', `--reporter-outfile=${output}`], { cwd: group.cwd, maxBuffer: 1 << 26 }).catch(() => undefined);
    results.push(...junitResults(await readFile(output, 'utf8').catch(() => ''), group.cwd));
  }
  return results;
}

function junitResults(xml, cwd) {
  const results = [];
  const suites = [];
  for (const [tag] of xml.matchAll(/<\/?testsuite\b[^>]*>|<testcase\b[^>]*\/>|<testcase\b[^>]*[^/]>[\s\S]*?<\/testcase>/g)) {
    if (tag.startsWith('</testsuite')) suites.pop();
    else if (tag.startsWith('<testsuite')) suites.push(attribute(tag, 'name'));
    else {
      const [file, ...ancestors] = suites;
      const passed = !/<(failure|error|skipped)\b/.test(tag);
      results.push([`${join(cwd, file)}\u0000${[...ancestors, attribute(tag, 'name')].join(' ')}`, passed ? 'passed' : 'failed']);
    }
  }
  return results;
}

async function journeyResults() {
  const script = join(root, 'scripts/verify-journeys.mjs');
  const { stdout } = await run(process.execPath, [script], { cwd: root, maxBuffer: 1 << 26 }).catch((error) => ({ stdout: error.stdout ?? '' }));
  return [...stdout.matchAll(/^ok {3}(.+)$/gm)].map(([, name]) => [`${script}\u0000${name}`, 'passed']);
}

function attribute(tag, name) {
  const value = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? '';
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
