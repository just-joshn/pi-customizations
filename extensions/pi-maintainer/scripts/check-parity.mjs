#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
// The parity gate. Fails unless every unit in scope is covered, every row is well formed, and every
// shared-module Aider test has exactly one owning SAR.
// A SAR's slice is its document units (<sar>/...), its evidence units (ev-<sar>/...), and the Aider
// test units it owns through sources.json testModuleOwners or test-owners.json.
// Usage:
//   node scripts/check-parity.mjs                         ledger and coverage against the full census
//   node scripts/check-parity.mjs --feature edit          coverage of the edit slice, every edit row verified with passing tests
//   node scripts/check-parity.mjs --report r.json ...     write the fresh vitest JSON report to this path
//   node scripts/check-parity.mjs --final                 coverage of the full census, every row verified
//   node scripts/check-parity.mjs --fragment f.json --units edit,ev-edit,aider-test/test_editblock
//                                                         validate one mapping fragment against a census slice
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { census, sourcesDir } from './census.mjs';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readJson = (path) => JSON.parse(readFileSync(join(packageRoot, path), 'utf8'));
const sources = readJson('parity/sources.json');
const testOwners = readJson('parity/test-owners.json');
const moduleOwners = sources.testModuleOwners ?? {};
const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const FEATURES = ['edit', 'git', 'map', 'lint'];
const KINDS = new Set(['parity', 'fix']);
const STATUSES = new Set(['open', 'verified']);
const NONCLAIMS = new Set(['provenance', 'evidence', 'meta', 'pi-owned', 'out-of-scope']);
const ROW_ID = /^(edit|git|map|lint)\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE_REF = /^[\w./-]+\.(py|scm|yml|yaml|toml|txt|md|json):\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;

const failures = [];
const fail = (message) => failures.push(message);

function sliceOf(unit) {
  const [group = '', module = ''] = unit.id.split('/');
  if (group !== 'aider-test') return group.replace(/^ev-/, '');
  return Object.hasOwn(moduleOwners, module) ? moduleOwners[module] : testOwners[unit.id];
}

function checkOwners(units) {
  for (const [module, owner] of Object.entries(moduleOwners)) {
    if (!sources.aider.testModules.includes(module)) fail(`testModuleOwners: ${module} is not a pinned test module`);
    if (!FEATURES.includes(owner)) fail(`testModuleOwners: ${module} names unknown SAR ${owner}`);
  }
  const shared = new Set(units.filter((unit) => unit.kind === 'aider-test' && !Object.hasOwn(moduleOwners, unit.id.split('/')[1])).map((unit) => unit.id));
  for (const id of shared) if (!Object.hasOwn(testOwners, id)) fail(`unit ${id} has no owner in test-owners.json`);
  for (const [id, owner] of Object.entries(testOwners)) {
    if (!shared.has(id)) fail(`test-owners.json: ${id} is not a shared-module test unit in the census`);
    if (!FEATURES.includes(owner)) fail(`test-owners.json: ${id} names unknown SAR ${owner}`);
  }
}

function checkRow(row) {
  const where = `row ${row?.id ?? '(no id)'}`;
  if (typeof row?.id !== 'string' || !ROW_ID.test(row.id)) fail(`${where}: id must match <feature>.<area>.<slug>`);
  if (!FEATURES.includes(row?.feature)) fail(`${where}: feature must be one of ${FEATURES.join(', ')}`);
  else if (typeof row.id === 'string' && !row.id.startsWith(`${row.feature}.`)) fail(`${where}: id prefix differs from feature ${row.feature}`);
  if (typeof row?.behavior !== 'string' || row.behavior.length < 12) fail(`${where}: behavior must be one observable sentence`);
  if (!Array.isArray(row?.aider) || row.aider.length === 0) fail(`${where}: aider needs at least one source coordinate`);
  else for (const ref of row.aider) if (!SOURCE_REF.test(ref)) fail(`${where}: aider coordinate ${JSON.stringify(ref)} is not path:lines`);
  if (!KINDS.has(row?.kind)) fail(`${where}: kind must be parity or fix`);
  if (row?.kind === 'fix') {
    for (const key of ['defect', 'intent', 'behavior']) if (typeof row.fix?.[key] !== 'string' || !row.fix[key]) fail(`${where}: fix.${key} is required`);
  } else if (row?.fix !== undefined) fail(`${where}: only fix rows carry fix`);
  if (!STATUSES.has(row?.status)) fail(`${where}: status must be open or verified`);
  for (const key of ['pi', 'src', 'tests']) if (!Array.isArray(row?.[key])) fail(`${where}: ${key} must be an array`);
}

function checkEntry(id, entry, rowIds) {
  const hasRows = Array.isArray(entry?.rows);
  const hasNonclaim = typeof entry?.nonclaim === 'string';
  if (hasRows === hasNonclaim) fail(`unit ${id}: exactly one of rows or nonclaim`);
  if (hasRows) {
    if (entry.rows.length === 0) fail(`unit ${id}: rows is empty`);
    for (const row of entry.rows) if (!rowIds.has(row)) fail(`unit ${id}: unknown row ${row}`);
  }
  if (hasNonclaim) {
    if (!NONCLAIMS.has(entry.nonclaim)) fail(`unit ${id}: unknown nonclaim ${entry.nonclaim}`);
    if (typeof entry.note !== 'string' || entry.note.length < 4) fail(`unit ${id}: nonclaim needs a note`);
  }
}

function checkCoverage(units, coverage, rowIds, where) {
  const unitIds = new Set(units.map((unit) => unit.id));
  for (const [id, entry] of Object.entries(coverage)) {
    if (unitIds.has(id)) checkEntry(id, entry, rowIds);
    else fail(`coverage key ${id} is not a ${where}`);
  }
}

function requireCovered(units, coverage) {
  for (const unit of units) if (!Object.hasOwn(coverage, unit.id)) fail(`unit ${unit.id} is not covered`);
}

function checkContracts(units, coverage, rows) {
  const owners = new Map(rows.map((row) => [row.id, row.feature]));
  for (const unit of units) {
    const entry = coverage[unit.id];
    if (entry?.rows && !entry.rows.some((id) => owners.get(id) === sliceOf(unit))) {
      fail(`unit ${unit.id}: no ${sliceOf(unit)} contract row; later integration rows do not discharge this slice`);
    }
  }
}

function reportResults(report) {
  if (report.success !== true) fail('vitest report.success is not true');
  if (report.numFailedTests > 0 || report.numFailedTestSuites > 0) fail('vitest report contains failures');
  if (!Array.isArray(report.testResults)) throw new Error('testResults must be an array');
  return report.testResults.flatMap((file) => {
    if (typeof file.name !== 'string' || !Array.isArray(file.assertionResults)) throw new Error('invalid test suite');
    if (file.status === 'failed') fail(`vitest failed suite ${relative(packageRoot, file.name)}`);
    return file.assertionResults.map((result) => {
      if (typeof result.fullName !== 'string' || typeof result.status !== 'string') throw new Error('invalid assertion');
      const id = `${relative(packageRoot, file.name)}::${result.fullName}`;
      if (result.status === 'failed') fail(`vitest failed ${id}`);
      return { id, status: result.status, meta: result.meta ?? {} };
    });
  });
}

function vitestReport() {
  const temporary = mkdtempSync(join(tmpdir(), 'pi-maintainer-vitest-'));
  const reportPath = option('--report') ? resolve(packageRoot, option('--report')) : join(temporary, 'report.json');
  try {
    rmSync(reportPath, { force: true });
    const run = spawnSync('bun', ['x', 'vitest', 'run', '--reporter=json', `--outputFile=${reportPath}`], { cwd: packageRoot, stdio: 'ignore' });
    if (run.error) fail(`vitest runner error: ${run.error.message}`);
    if (run.status !== 0) fail(`vitest exited with status ${run.status}${run.signal ? ` (${run.signal})` : ''}`);
    if (!existsSync(reportPath)) {
      fail(`no vitest JSON report at ${reportPath}`);
      return [];
    }
    return reportResults(JSON.parse(readFileSync(reportPath, 'utf8')));
  } catch (error) {
    fail(`invalid vitest JSON report at ${reportPath}: ${error.message}`);
    return [];
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function matchingResults(results, test) {
  return test.endsWith('*') ? results.filter((result) => result.id.startsWith(test.slice(0, -1))) : results.filter((result) => result.id === test);
}

function checkVerified(rows, scope, results) {
  for (const row of rows.filter((r) => scope(r))) {
    if (row.status !== 'verified') fail(`row ${row.id} is ${row.status}, not verified`);
    if (row.pi.length === 0) fail(`row ${row.id}: pi mechanisms are empty`);
    if (row.src.length === 0) fail(`row ${row.id}: src is empty`);
    for (const file of row.src) if (!existsSync(join(packageRoot, file))) fail(`row ${row.id}: src ${file} does not exist`);
    if (row.tests.length === 0) fail(`row ${row.id}: tests are empty`);
    for (const test of row.tests) {
      const matched = matchingResults(results, test);
      if (matched.length === 0) fail(`row ${row.id}: no test result matches ${test}`);
      for (const result of matched) if (result.status !== 'passed') fail(`row ${row.id}: ${result.id} is ${result.status}`);
    }
  }
}

function checkTags(units, coverage, rows, scope, results) {
  const scoped = new Set(rows.filter(scope).map((row) => row.id));
  const passed = results.filter((result) => result.status === 'passed');
  const ported = new Set(passed.flatMap((result) => result.meta.aider ?? []));
  const replayed = new Set(passed.flatMap((result) => result.meta.evidence ?? []));
  for (const unit of units) {
    const entry = coverage[unit.id];
    if (!entry?.rows?.some((id) => scoped.has(id))) continue;
    if (unit.kind === 'aider-test' && !ported.has(unit.id.slice('aider-test/'.length))) fail(`unit ${unit.id}: no passing test ports it (meta.aider)`);
    if (unit.kind === 'evidence' && !replayed.has(unit.id)) fail(`unit ${unit.id}: no passing test replays it (meta.evidence)`);
  }
}

function checkSourcePins() {
  for (const [key, file] of Object.entries(sources.documents)) {
    const path = join(sourcesDir, file);
    if (!existsSync(path)) {
      fail(`document ${key} missing at ${path}`);
      continue;
    }
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (digest !== sources.documentSha256[key]) fail(`document ${key} drifted: ${digest} differs from the pinned SHA-256`);
  }
}

function sliceProgress(feature, units, coverage, rows) {
  const slice = units.filter((unit) => sliceOf(unit) === feature);
  const covered = slice.filter((unit) => Object.hasOwn(coverage, unit.id)).length;
  const owned = rows.filter((row) => row.feature === feature);
  const verified = owned.filter((row) => row.status === 'verified').length;
  return `${feature}: slice ${slice.length} units, ${covered} covered, ${slice.length - covered} uncovered, ${owned.length} rows, ${verified} verified\n`;
}

const units = census();
checkSourcePins();
checkOwners(units);
const fragmentPath = option('--fragment');
if (fragmentPath) {
  const prefixes = (option('--units') ?? '').split(',').map((prefix) => prefix.trim());
  const matches = (unit, prefix) => prefix && (unit.id === prefix || unit.id.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
  for (const prefix of prefixes) if (!units.some((unit) => matches(unit, prefix))) fail(`--units prefix ${JSON.stringify(prefix)} selects no census units`);
  const slice = units.filter((unit) => prefixes.some((prefix) => matches(unit, prefix)));
  if (slice.length === 0) fail('--units must select a nonempty intended census slice');
  const fragment = JSON.parse(readFileSync(resolve(fragmentPath), 'utf8'));
  const rows = fragment.rows ?? [];
  rows.forEach(checkRow);
  const rowIds = new Set(rows.map((row) => row.id));
  if (rowIds.size !== rows.length) fail('fragment has duplicate row ids');
  checkCoverage(slice, fragment.coverage ?? {}, rowIds, 'unit in this slice');
  requireCovered(slice, fragment.coverage ?? {});
  checkContracts(slice, fragment.coverage ?? {}, rows);
  const used = new Set(Object.values(fragment.coverage ?? {}).flatMap((entry) => entry.rows ?? []));
  for (const row of rows) if (!used.has(row.id)) fail(`row ${row.id} is not referenced by any unit`);
  process.stdout.write(`fragment: ${slice.length} units, ${rows.length} rows\n`);
} else {
  const ledger = readJson('parity/ledger.json');
  const coverage = readJson('parity/coverage.json');
  ledger.rows.forEach(checkRow);
  const rowIds = new Set(ledger.rows.map((row) => row.id));
  if (rowIds.size !== ledger.rows.length) fail('ledger has duplicate row ids');
  checkCoverage(units, coverage, rowIds, 'census unit');
  checkContracts(units, coverage, ledger.rows);
  const used = new Set(Object.values(coverage).flatMap((entry) => entry.rows ?? []));
  for (const row of ledger.rows) if (!used.has(row.id)) fail(`row ${row.id} is not referenced by any unit`);
  const feature = option('--feature');
  if (argv.includes('--feature') && !FEATURES.includes(feature)) fail(`--feature must be one of ${FEATURES.join(', ')}`);
  const final = argv.includes('--final');
  const required = feature && !final ? units.filter((unit) => sliceOf(unit) === feature) : units;
  if (required.length === 0) fail('gate must select a nonempty intended census slice');
  requireCovered(required, coverage);
  const scope = final ? () => true : feature ? (row) => row.feature === feature : null;
  if (feature && !ledger.rows.some((row) => row.feature === feature)) fail(`${feature} slice has no contract rows`);
  if (scope) {
    const results = vitestReport();
    checkVerified(ledger.rows, scope, results);
    checkTags(required, coverage, ledger.rows, scope, results);
  }
  for (const name of FEATURES) process.stdout.write(sliceProgress(name, units, coverage, ledger.rows));
  const verified = ledger.rows.filter((row) => row.status === 'verified').length;
  process.stdout.write(`ledger: ${units.length} units, ${ledger.rows.length} rows, ${verified} verified\n`);
}

if (failures.length > 0) {
  for (const message of failures.slice(0, 200)) process.stderr.write(`FAIL ${message}\n`);
  if (failures.length > 200) process.stderr.write(`... and ${failures.length - 200} more\n`);
  process.exit(1);
}
process.stdout.write('PASS\n');
