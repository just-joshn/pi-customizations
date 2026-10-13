import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { CATEGORIES, capabilityUnavailable, ERROR_CODES, errorEnvelope, fail, integrityMismatch, invalidInput, revisionConflict, unsupportedTarget } from '../scripts/lib/errors.mjs';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../scripts/rea.mjs', import.meta.url));
const schema = fileURLToPath(new URL('../../../parity/reverse-engineer-anything/fixtures/reference/rea-6.4.0-errors.json', import.meta.url));

const requiredKeys = ['code', 'category', 'message', 'retryable', 'remediation', 'details'];

test('ERR-001: error envelopes match the reference schema', async () => {
  const reference = JSON.parse(await (await import('node:fs/promises')).readFile(schema, 'utf8'));
  for (const line of reference.cases) {
    for (const key of requiredKeys) assert.ok(key in line.envelope, `reference case carries ${key}`);
    assert.ok(CATEGORIES.has(line.envelope.category));
    assert.ok(ERROR_CODES.has(line.envelope.code));
    assert.equal(typeof line.envelope.remediation.action, 'string');
  }
  const produced = [
    invalidInput('bad', [{ path: ['x'], reason: 'required', message: 'x is required' }]),
    unsupportedTarget('no', { detected: 'dmg' }),
    capabilityUnavailable('open_binary', 'needs Hopper'),
    integrityMismatch('mismatch', { logical_path: 'a' }),
    revisionConflict('stale', { current_revision: 2 }),
    fail('execution_failure', 'execution_failure', 'boom'),
  ].map(errorEnvelope);
  for (const envelope of produced) {
    assert.deepEqual(Object.keys(envelope).sort(), requiredKeys.sort());
    assert.ok(CATEGORIES.has(envelope.category), `${envelope.code} has a known category`);
    assert.ok(ERROR_CODES.has(envelope.code));
    assert.equal(typeof envelope.message, 'string');
    assert.equal(typeof envelope.retryable, 'boolean');
    assert.equal(typeof envelope.remediation.action, 'string');
    assert.equal(typeof envelope.details, 'object');
  }
});

test('ERR-002: remediation names the next step', () => {
  assert.equal(errorEnvelope(capabilityUnavailable('x', 'reason')).remediation.action.length > 10, true);
  assert.equal(errorEnvelope(revisionConflict('stale')).remediation.action.includes('Re-read'), true);
  assert.equal(errorEnvelope(integrityMismatch('mismatch')).remediation.action.includes('integrity-policy'), true);
  assert.equal(errorEnvelope(unsupportedTarget('nope')).retryable, false);
});

test('ERR-003: invalid input lists every issue path', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rea-err-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const missing = await run(process.execPath, [cli, 'analyze-javascript-application', join(root, 'nope'), '--store', join(root, '.rea'), '--json']).catch((error) => ({ stdout: error.stdout, code: error.code }));
  const envelope = JSON.parse(missing.stdout);
  assert.equal(envelope.code, 'invalid_request');
  assert.equal(envelope.category, 'invalid_input');
  assert.equal(envelope.retryable, true);
  assert.deepEqual(envelope.details.issues[0].path, ['path']);
  const unknownFlag = await run(process.execPath, [cli, 'analyze-javascript-application', root, '--nonsense', '1', '--store', join(root, '.rea'), '--json']).catch((error) => ({ stdout: error.stdout }));
  const flagEnvelope = JSON.parse(unknownFlag.stdout);
  assert.equal(flagEnvelope.code, 'invalid_request');
  assert.ok(flagEnvelope.details.issues.some((issue) => issue.reason === 'unknown_flag' && issue.path[0] === '--nonsense'));
  const badNumber = await run(process.execPath, [cli, 'inspect-analysis-view', 'ev_x', '--view', 'summary', '--limit', 'lots', '--store', join(root, '.rea'), '--json']).catch((error) => ({ stdout: error.stdout }));
  assert.ok(JSON.parse(badNumber.stdout).details.issues.some((issue) => issue.path[0] === '--limit'));
});

test('ERR-004: missing prerequisite yields capability_unavailable', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rea-err4-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { stdout } = await run(process.execPath, [cli, 'capabilities', '--json']);
  const matrix = JSON.parse(stdout);
  assert.ok(matrix.capabilities.every((entry) => entry.available));
  const unsupported = await run(process.execPath, [cli, 'inspect-artifact', cli, '--store', join(root, '.rea'), '--json']).catch((error) => JSON.parse(error.stdout));
  assert.equal(unsupported.code, 'unsupported_target');
  assert.equal(unsupported.category, 'unsupported_target');
  assert.ok('detected' in unsupported.details);
});
