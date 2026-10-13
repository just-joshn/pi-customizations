import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { capabilityMatrix, EFFECT_TEMPLATE, IMPLEMENTED_OPERATIONS, UNAVAILABLE_OPERATIONS, unavailableMatrix } from '../scripts/lib/capabilities.mjs';
import { COMMANDS } from '../scripts/lib/commands.mjs';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../scripts/rea.mjs', import.meta.url));

test('CAP-001: matrix reports effects for every operation', () => {
  const matrix = capabilityMatrix();
  const effectKeys = Object.keys(EFFECT_TEMPLATE).sort();
  assert.equal(matrix.open, false);
  assert.equal(matrix.capabilities.length, IMPLEMENTED_OPERATIONS.length);
  for (const entry of matrix.capabilities) {
    assert.deepEqual(Object.keys(entry.effects).sort(), effectKeys, `${entry.operation} must declare every effect flag`);
    assert.equal(entry.available, true);
    assert.equal(entry.reason, null);
    assert.ok(entry.limitations.length > 0, `${entry.operation} must state its limitations`);
  }
  assert.deepEqual([...COMMANDS.keys()].sort(), IMPLEMENTED_OPERATIONS.map((entry) => entry.operation.replaceAll('_', '-')).sort(), 'every command is in the matrix and every matrix entry has a command');
});

test('CAP-002: missing prerequisite shows as unavailable with remediation', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rea-cap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const notGo = join(root, 'plain.txt');
  writeFileSync(notGo, 'this is not a binary at all');
  const matrix = unavailableMatrix();
  assert.ok(matrix.length > 0);
  for (const entry of matrix) {
    assert.equal(entry.available, false);
    assert.ok(entry.reason.length > 20, `${entry.operation} needs a real reason`);
    assert.ok(['missing_prerequisite', 'unsupported_host', 'unsupported_format'].includes(entry.availability_code));
  }
  const providerBacked = matrix.find((entry) => entry.operation === 'open_binary');
  assert.ok(providerBacked.reason.includes('Hopper'));
  const failure = await run(process.execPath, [cli, 'inspect-go-binary', notGo, '--store', join(root, '.rea'), '--json']).catch((error) => JSON.parse(error.stdout));
  assert.equal(failure.code, 'capability_unavailable');
  assert.equal(failure.category, 'unsupported_provider');
  assert.equal(failure.retryable, false);
  assert.ok(failure.remediation.action.length > 0);
  assert.ok(failure.details.reason.includes('not evidence'));
});

test('CAP-003: write and process effects are declared', async (t) => {
  const matrix = capabilityMatrix();
  const writing = matrix.capabilities.filter((entry) => entry.effects.may_write_filesystem).map((entry) => entry.operation);
  assert.deepEqual(writing.sort(), [
    'analyze_javascript_application',
    'evidence_export',
    'evidence_import',
    'inspect_artifact',
    'inspect_binary_layout',
    'inspect_go_binary',
    'inspect_web_network_capture',
    'record_unknown',
    'update_unknown',
  ]);
  assert.ok(
    matrix.capabilities.every((entry) => entry.effects.mutates_artifact === false),
    'no operation may modify the analyzed artifact',
  );
  assert.ok(
    matrix.capabilities.every((entry) => entry.effects.launches_process === false),
    'this port launches no process from a target',
  );
  assert.ok(
    matrix.capabilities.every((entry) => entry.effects.may_access_network === false),
    'this port makes no network access',
  );
  assert.ok(matrix.capabilities.every((entry) => entry.effects.requires_root === false));
  const root = mkdtempSync(join(tmpdir(), 'rea-cap-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { stdout } = await run(process.execPath, [cli, 'capabilities', '--all', '--json']);
  const printed = JSON.parse(stdout);
  assert.equal(printed.capabilities.length, IMPLEMENTED_OPERATIONS.length + UNAVAILABLE_OPERATIONS.length);
});
