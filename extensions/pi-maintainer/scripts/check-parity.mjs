#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
// The parity gate. Fails unless every census unit is covered and every row is well formed.
// Usage:
//   node scripts/check-parity.mjs                         ledger and coverage against the full census
//   node scripts/check-parity.mjs --feature edit          also require every edit row verified with passing tests
//   node scripts/check-parity.mjs --report r.json ...     reuse a vitest JSON report instead of running vitest
//   node scripts/check-parity.mjs --final                 require every row verified
//   node scripts/check-parity.mjs --fragment f.json --units edit,ev-edit,aider-test/test_editblock
//                                                         validate one mapping fragment against a census slice
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { census, sourcesDir } from './census.mjs';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sources = JSON.parse(readFileSync(join(packageRoot, 'parity/sources.json'), 'utf8'));
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

function checkCoverage(units, coverage, rowIds) {
  const unitIds = new Set(units.map((unit) => unit.id));
  for (const unit of units) {
    const entry = coverage[unit.id];
    if (entry === undefined) {
      fail(`unit ${unit.id} is not covered`);
      continue;
    }
    const hasRows = Array.isArray(entry.rows);
    const hasNonclaim = typeof entry.nonclaim === 'string';
    if (hasRows === hasNonclaim) fail(`unit ${unit.id}: exactly one of rows or nonclaim`);
    if (hasRows) {
      if (entry.rows.length === 0) fail(`unit ${unit.id}: rows is empty`);
      for (const id of entry.rows) if (!rowIds.has(id)) fail(`unit ${unit.id}: unknown row ${id}`);
    }
    if (hasNonclaim) {
      if (!NONCLAIMS.has(entry.nonclaim)) fail(`unit ${unit.id}: unknown nonclaim ${entry.nonclaim}`);
      if (typeof entry.note !== 'string' || entry.note.length < 4) fail(`unit ${unit.id}: nonclaim needs a note`);
    }
  }
  return unitIds;
}

function vitestReport() {
  const reportPath = option('--report') ?? join(tmpdir(), `pi-maintainer-vitest-${process.pid}.json`);
  if (!option('--report')) {
    spawnSync('bun', ['x', 'vitest', 'run', '--reporter=json', `--outputFile=${reportPath}`], { cwd: packageRoot, stdio: 'ignore' });
  }
  if (!existsSync(reportPath)) {
    fail(`no vitest JSON report at ${reportPath}`);
    return [];
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  return report.testResults.flatMap((file) => file.assertionResults.map((result) => ({ id: `${relative(packageRoot, file.name)}::${result.fullName}`, status: result.status, meta: result.meta ?? {} })));
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

const units = census();
checkSourcePins();
const fragmentPath = option('--fragment');
if (fragmentPath) {
  const prefixes = (option('--units') ?? '').split(',').filter(Boolean);
  const slice = units.filter((unit) => prefixes.some((prefix) => unit.id === prefix || unit.id.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)));
  const fragment = JSON.parse(readFileSync(resolve(fragmentPath), 'utf8'));
  const rows = fragment.rows ?? [];
  rows.forEach(checkRow);
  const rowIds = new Set(rows.map((row) => row.id));
  if (rowIds.size !== rows.length) fail('fragment has duplicate row ids');
  const covered = checkCoverage(slice, fragment.coverage ?? {}, rowIds);
  for (const id of Object.keys(fragment.coverage ?? {})) if (!covered.has(id)) fail(`coverage key ${id} is not a unit in this slice`);
  const used = new Set(Object.values(fragment.coverage ?? {}).flatMap((entry) => entry.rows ?? []));
  for (const row of rows) if (!used.has(row.id)) fail(`row ${row.id} is not referenced by any unit`);
  process.stdout.write(`fragment: ${slice.length} units, ${rows.length} rows\n`);
} else {
  const ledger = JSON.parse(readFileSync(join(packageRoot, 'parity/ledger.json'), 'utf8'));
  const coverage = JSON.parse(readFileSync(join(packageRoot, 'parity/coverage.json'), 'utf8'));
  ledger.rows.forEach(checkRow);
  const rowIds = new Set(ledger.rows.map((row) => row.id));
  if (rowIds.size !== ledger.rows.length) fail('ledger has duplicate row ids');
  const covered = checkCoverage(units, coverage, rowIds);
  for (const id of Object.keys(coverage)) if (!covered.has(id)) fail(`coverage key ${id} is not a census unit`);
  const used = new Set(Object.values(coverage).flatMap((entry) => entry.rows ?? []));
  for (const row of ledger.rows) if (!used.has(row.id)) fail(`row ${row.id} is not referenced by any unit`);
  const feature = option('--feature');
  if (feature !== undefined && !FEATURES.includes(feature)) fail(`--feature must be one of ${FEATURES.join(', ')}`);
  const scope = argv.includes('--final') ? () => true : feature ? (row) => row.feature === feature : null;
  if (scope) {
    const results = vitestReport();
    checkVerified(ledger.rows, scope, results);
    checkTags(units, coverage, ledger.rows, scope, results);
  }
  const counts = Object.fromEntries(FEATURES.map((f) => [f, ledger.rows.filter((row) => row.feature === f).length]));
  const verified = ledger.rows.filter((row) => row.status === 'verified').length;
  process.stdout.write(`ledger: ${units.length} units, ${ledger.rows.length} rows ${JSON.stringify(counts)}, ${verified} verified\n`);
}

if (failures.length > 0) {
  for (const message of failures.slice(0, 200)) process.stderr.write(`FAIL ${message}\n`);
  if (failures.length > 200) process.stderr.write(`... and ${failures.length - 200} more\n`);
  process.exit(1);
}
process.stdout.write('PASS\n');
