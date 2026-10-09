import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from 'vitest';
import { runPreflight } from '../scripts/check-preflight.mjs';
import { inspectParity } from '../scripts/preflight.mjs';
import { documents, fixture, snapshot } from './preflight-fixture.mjs';

const execute = promisify(execFile);
const cli = resolve('scripts/check-preflight.mjs');
const lasting = ['ACCEPTANCE_AUTHORITY_UNAVAILABLE', 'PAIRED_ACCEPTANCE_VERIFIER_UNIMPLEMENTED'];

function codes(report) {
  return report.blockers.map((item) => item.code);
}

async function runCli(args) {
  try {
    const result = await execute(process.execPath, [cli, ...args]);
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test('complete-looking manifests cannot produce acceptance without custody and actual paired verification', async () => {
  const report = await inspectParity(await fixture());
  expect(report).toMatchObject({ kind: 'preflight', verdict: 'BLOCKED' });
  expect(codes(report)).toEqual(lasting);
});

test('forged passing flags never confer acceptance or create a completion artifact', async () => {
  const records = documents();
  const forged = Object.fromEntries(Object.entries(records).map(([path, value]) => [path, { ...value, status: 'passed', verdict: 'PASS', passed: true }]));
  const root = await fixture(forged);
  const report = await inspectParity(root);
  expect(report.verdict).toBe('BLOCKED');
  expect(codes(report)).toContain('UNSUPPORTED_ACCEPTANCE_CLAIM');
  expect(codes(report).slice(-2)).toEqual(lasting);
  expect(await readFile(join(root, 'completion.json')).catch((error) => error.code)).toBe('ENOENT');
});

test.for([null, undefined, '', 42, []])('invalid directory input is diagnosed without throwing', async (input) => {
  expect(codes(await inspectParity(input))).toEqual(['INVALID_PARITY_DIRECTORY', ...lasting]);
});

test('incomplete source locking is a concrete blocker', async () => {
  const records = documents();
  const root = await fixture({ ...records, 'source-lock.json': { ...records['source-lock.json'], status: 'incomplete' } });
  expect(codes(await inspectParity(root))).toEqual(['SOURCE_LOCK_INCOMPLETE', ...lasting]);
});

test('empty dependency inventory cannot pass preflight', async () => {
  const records = documents();
  const root = await fixture({ ...records, 'dependencies.json': { ...records['dependencies.json'], nodes: [] } });
  expect(codes(await inspectParity(root))).toEqual(['DEPENDENCY_INVENTORY_EMPTY', ...lasting]);
});

test('an unresolved dependency edge identifies its owning artifact', async () => {
  const records = documents();
  const root = await fixture({ ...records, 'dependencies.json': { ...records['dependencies.json'], edges: [{ from: 'pstack', to: 'missing', status: 'unresolved' }] } });
  const report = await inspectParity(root);
  expect(report.blockers[0]).toMatchObject({ code: 'DEPENDENCY_EDGE_UNRESOLVED', file: 'dependencies.json', locator: 'edges[0]' });
  expect(codes(report)).toEqual(['DEPENDENCY_EDGE_UNRESOLVED', 'DEPENDENCY_NODE_MISSING', ...lasting]);
});

test('unmapped inventory items remain explicit required work', async () => {
  const records = documents();
  const item = records['inventory.json'].items[0];
  const root = await fixture({ ...records, 'inventory.json': { schemaVersion: 1, items: [{ ...item, disposition: { status: 'unassigned', requirementIds: [] } }] } });
  expect(codes(await inspectParity(root))).toEqual(['SOURCE_DISPOSITION_MISSING', ...lasting]);
});

test('a missing requirement scenario is reported instead of omitted', async () => {
  const root = await fixture();
  await rm(join(root, 'scenarios/example.json'));
  expect(codes(await inspectParity(root))).toEqual(['ARTIFACT_MISSING', ...lasting]);
});

test('a scenario without a reference-and-candidate pair cannot count as executed', async () => {
  const root = await fixture();
  await writeFile(
    join(root, 'scenarios/example.json'),
    JSON.stringify({ schemaVersion: 1, fixture: { digest: 'fixture' }, comparison: { oracleFrozen: true }, execution: { pairId: null }, actions: [{ kind: 'type', literal: '/example' }] }),
  );
  expect(codes(await inspectParity(root))).toEqual(['SCENARIO_PAIR_MISSING', ...lasting]);
});

test('unknown configuration ids cannot disappear from the matrix', async () => {
  const records = documents();
  const requirement = records['requirements.json'].requirements[0];
  const root = await fixture({ ...records, 'requirements.json': { ...records['requirements.json'], requirements: [{ ...requirement, configurationIds: ['unknown'] }] } });
  expect(codes(await inspectParity(root))).toEqual(['CONFIGURATION_MISSING', ...lasting]);
});

test('actual source bytes are checked against their declared digest', async () => {
  const root = await fixture();
  await writeFile(join(root, 'reference/cursor-plugins/pstack/skills/example/SKILL.md'), '# Changed source\n');
  expect(codes(await inspectParity(root))).toEqual(['SOURCE_HASH_MISMATCH', 'REQUIREMENT_SOURCE_HASH_MISMATCH', ...lasting]);
});

test.for(['../outside', '/etc/passwd', 'C:\\secrets', 'pstack\\secret', 'pstack/../secret', '\u0000'])('unsafe inventory paths are rejected', async (path) => {
  const records = documents();
  const root = await fixture({ ...records, 'inventory.json': { ...records['inventory.json'], items: [{ ...records['inventory.json'].items[0], path }] } });
  expect(codes(await inspectParity(root))).toEqual(['UNSAFE_ARTIFACT_PATH', ...lasting]);
});

test('a source symlink is refused even when its target is inside the fixture', async () => {
  const root = await fixture();
  const path = join(root, 'reference/cursor-plugins/pstack/skills/example/SKILL.md');
  await rm(path);
  await writeFile(join(root, 'target.md'), 'not a source artifact');
  await symlink(join(root, 'target.md'), path);
  expect(codes(await inspectParity(root))).toEqual(['ARTIFACT_SYMLINK_REFUSED', 'ARTIFACT_SYMLINK_REFUSED', ...lasting]);
});

test('a symlinked parent directory cannot expose outside evidence', async () => {
  const root = await fixture();
  const outside = await fixture();
  await rm(join(root, 'reference'), { recursive: true });
  await symlink(join(outside, 'reference'), join(root, 'reference'));
  expect(codes(await inspectParity(root))).toEqual(['ARTIFACT_SYMLINK_REFUSED', 'ARTIFACT_SYMLINK_REFUSED', ...lasting]);
});

test.for(['{', '', 'null', '[]', '42', '"text"'])('malformed ledger contents produce a diagnostic', async (text) => {
  const root = await fixture();
  await writeFile(join(root, 'dependencies.json'), text);
  const expected = text === '{' || text === '' ? 'ARTIFACT_INVALID_JSON' : 'ARTIFACT_INVALID_SHAPE';
  expect(codes(await inspectParity(root))).toEqual([expected, ...lasting]);
});

test('unsupported schema versions are not silently interpreted', async () => {
  const records = documents();
  const root = await fixture({ ...records, 'dependencies.json': { ...records['dependencies.json'], schemaVersion: 2 } });
  expect(codes(await inspectParity(root))).toEqual(['ARTIFACT_UNSUPPORTED_SCHEMA', ...lasting]);
});

test('wrong nested ledger types are rejected at the boundary', async () => {
  const records = documents();
  const root = await fixture({ ...records, 'dependencies.json': { ...records['dependencies.json'], nodes: 'not an array' } });
  expect(codes(await inspectParity(root))).toEqual(['ARTIFACT_INVALID_SHAPE', ...lasting]);
});

test('an open account-owner prerequisite stays visible', async () => {
  const records = documents();
  const root = await fixture({ ...records, 'configurations.json': { ...records['configurations.json'], accountOwnerPrerequisites: [{ id: 'usage', status: 'open' }] } });
  expect(codes(await inspectParity(root))).toEqual(['ACCOUNT_OWNER_PREREQUISITE_OPEN', ...lasting]);
});

test('unresolved behavioral mismatches remain blockers', async () => {
  const records = documents();
  const root = await fixture({ ...records, 'mismatches.json': { schemaVersion: 1, items: [{ id: 'wrong-default', status: 'open' }] } });
  expect(codes(await inspectParity(root))).toEqual(['BEHAVIOR_MISMATCH_OPEN', ...lasting]);
});

test('repeated inspections return identical diagnostics and leave every artifact unchanged', async () => {
  const root = await fixture();
  const before = await snapshot(root);
  const first = await inspectParity(root);
  const second = await inspectParity(root);
  expect(first).toEqual(second);
  expect(first.verdict).toBe('BLOCKED');
  expect(await snapshot(root)).toEqual(before);
});

test('the user-facing CLI returns a blocked report with exit code two and no stderr', async () => {
  const root = await fixture();
  const before = await snapshot(root);
  const result = await runCli([root]);
  expect(result.code).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({ kind: 'preflight', verdict: 'BLOCKED' });
  expect(result.stderr).toBe('');
  expect(await snapshot(root)).toEqual(before);
});

test('invalid CLI options report usage failure rather than acceptance', async () => {
  const result = await runCli(['--accept']);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ verdict: 'BLOCKED', blockers: [{ code: 'INVALID_ARGUMENTS' }] });
  expect(result.stderr).toBe('');
});

test.for([null, undefined, 1, {}, [null], [42], ['one', 'two'], ['--accept']])('the command boundary rejects invalid arguments', async (args) => {
  expect(await runPreflight(args)).toMatchObject({ exitCode: 1, report: { verdict: 'BLOCKED', blockers: [{ code: 'INVALID_ARGUMENTS' }] } });
});

test('the command boundary returns the same report that the terminal command presents', async () => {
  const root = await fixture();
  const result = await runPreflight([root]);
  expect(result.exitCode).toBe(2);
  expect(codes(result.report)).toEqual(lasting);
});

test('a nonexistent directory is reported without exposing filesystem error messages', async () => {
  const root = await fixture();
  expect(codes(await inspectParity(join(root, 'missing')))).toEqual(['INVALID_PARITY_DIRECTORY', ...lasting]);
});

test('a file cannot be selected as the parity directory', async () => {
  const root = await fixture();
  expect(codes(await inspectParity(join(root, 'source-lock.json')))).toEqual(['INVALID_PARITY_DIRECTORY', ...lasting]);
});

test.for([
  { file: 'source-lock.json', field: 'cursorPlugins', value: null },
  { file: 'requirements.json', field: 'requirements', value: [{ id: 'bad', source: null }] },
  { file: 'configurations.json', field: 'configurations', value: [{ id: null }] },
  { file: 'inventory.json', field: 'items', value: [null] },
  { file: 'mismatches.json', field: 'items', value: [], removeSchema: true },
])('invalid nested ledger contracts are diagnosed', async ({ file, field, value, removeSchema }) => {
  const records = documents();
  const changed = { ...records[file], [field]: value, ...(removeSchema ? { schemaVersion: undefined } : {}) };
  const root = await fixture({ ...records, [file]: changed });
  expect(codes(await inspectParity(root))).toEqual([removeSchema ? 'ARTIFACT_UNSUPPORTED_SCHEMA' : 'ARTIFACT_INVALID_SHAPE', ...lasting]);
});

test.for([
  { field: 'closureAudited', value: false, code: 'DEPENDENCY_AUDIT_MISSING' },
  { field: 'unresolvedReferences', value: ['pstack/unknown'], code: 'DEPENDENCY_REFERENCE_UNRESOLVED' },
  { field: 'nodes', value: [{ id: 'pstack', readingComplete: false }], code: 'SOURCE_READING_INCOMPLETE' },
  {
    field: 'nodes',
    value: [
      { id: 'pstack', readingComplete: true },
      { id: 'pstack', readingComplete: true },
    ],
    code: 'DEPENDENCY_IDS_DUPLICATED',
  },
])('dependency incompleteness is visible without a runtime verdict', async ({ field, value, code }) => {
  const records = documents();
  const root = await fixture({ ...records, 'dependencies.json': { ...records['dependencies.json'], [field]: value } });
  expect(codes(await inspectParity(root))).toEqual([code, ...lasting]);
});

test.for([
  { field: 'acceptanceDefinitionOwner', value: null, code: 'ACCEPTANCE_DEFINITIONS_UNFROZEN' },
  { field: 'acceptanceDefinitionsFrozen', value: false, code: 'ACCEPTANCE_DEFINITIONS_UNFROZEN' },
  { field: 'coverageDenominatorComplete', value: false, code: 'COVERAGE_DENOMINATOR_INCOMPLETE' },
  { field: 'requirements', value: [], code: 'REQUIREMENT_INVENTORY_EMPTY' },
])('incomplete acceptance metadata remains a blocker', async ({ field, value, code }) => {
  const records = documents();
  const root = await fixture({ ...records, 'requirements.json': { ...records['requirements.json'], [field]: value } });
  expect(codes(await inspectParity(root))).toEqual([code, ...lasting]);
});

test.for([
  { field: 'configurationIds', value: [], code: 'REQUIREMENT_CONFIGURATIONS_EMPTY' },
  { field: 'scenarioIds', value: [], code: 'REQUIREMENT_SCENARIOS_EMPTY' },
  { field: 'scenarioIds', value: ['../outside'], code: 'UNSAFE_ARTIFACT_PATH' },
])('missing and unsafe requirement obligations cannot be silently dropped', async ({ field, value, code }) => {
  const records = documents();
  const requirement = records['requirements.json'].requirements[0];
  const root = await fixture({ ...records, 'requirements.json': { ...records['requirements.json'], requirements: [{ ...requirement, [field]: value }] } });
  expect(codes(await inspectParity(root))).toEqual([code, ...lasting]);
});

test.for([
  { field: 'fixture', value: { digest: null }, code: 'SCENARIO_FIXTURE_UNPINNED' },
  { field: 'comparison', value: { oracleFrozen: false }, code: 'SCENARIO_ORACLE_UNFROZEN' },
  { field: 'actions', value: [], code: 'SCENARIO_ACTIONS_EMPTY' },
])('scenario prerequisites are diagnosed independently', async ({ field, value, code }) => {
  const root = await fixture();
  const path = join(root, 'scenarios/example.json');
  const original = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...original, [field]: value }));
  expect(codes(await inspectParity(root))).toEqual([code, ...lasting]);
});

test('an invalid scenario shape is rejected before its fields are interpreted', async () => {
  const root = await fixture();
  await writeFile(join(root, 'scenarios/example.json'), JSON.stringify({ schemaVersion: 1, fixture: null }));
  expect(codes(await inspectParity(root))).toEqual(['ARTIFACT_INVALID_SHAPE', ...lasting]);
});

test('a digest array cannot masquerade as a valid string digest', async () => {
  const records = documents();
  const requirement = records['requirements.json'].requirements[0];
  const changed = { ...requirement, source: { ...requirement.source, sha256: [requirement.source.sha256] } };
  const root = await fixture({ ...records, 'requirements.json': { ...records['requirements.json'], requirements: [changed] } });
  expect(codes(await inspectParity(root))).toEqual(['ARTIFACT_INVALID_SHAPE', ...lasting]);
});

test('deeply nested forged acceptance claims cannot crash the inspection', async () => {
  const root = await fixture();
  const original = JSON.stringify(documents()['dependencies.json']);
  const nested = `${original.slice(0, -1)},"extra":${'{"child":'.repeat(12000)}{"verdict":"PASS"}${'}'.repeat(12000)}}`;
  await writeFile(join(root, 'dependencies.json'), nested);
  expect(codes(await inspectParity(root))).toEqual(['UNSUPPORTED_ACCEPTANCE_CLAIM', ...lasting]);
});

test('a directory in place of a ledger is a safe diagnostic', async () => {
  const root = await fixture();
  await rm(join(root, 'dependencies.json'));
  await mkdir(join(root, 'dependencies.json'));
  expect(codes(await inspectParity(root))).toEqual(['ARTIFACT_NOT_FILE', ...lasting]);
});
