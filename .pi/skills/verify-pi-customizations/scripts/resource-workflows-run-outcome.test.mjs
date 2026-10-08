import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkInteraction } from '../helpers/resource-workflows-local.mjs';

const evaluateRun = (attempt) => ({ eligible: checkInteraction(attempt.records, 'Hello Ada') });

const source = [{ type: 'tool_execution_end', toolName: 'bash', isError: false, result: { content: [{ type: 'text', text: 'Source contains Hello Ada' }] } }];

test('reading source containing a greeting is not a real CLI interaction', () => {
  assert.equal(evaluateRun({ kind: 'cli', records: source }).eligible, false);
});

test('internal library output cannot establish a working package export', () => {
  assert.equal(evaluateRun({ kind: 'library', records: source, packageExport: { resolved: false } }).eligible, false);
});

test('a server rescued after settlement did not satisfy agent cleanup', () => {
  assert.equal(evaluateRun({ kind: 'server', records: source, cleanup: { survivors: [123] }, rescue: { confirmed: true } }).eligible, false);
});
