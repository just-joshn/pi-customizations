import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import test from 'node:test';

import { doctorLeaseJournal } from '../helpers/resource-workflows-doctor-lease.mjs';
import { openDoctorReadonlyLease } from '../helpers/resource-workflows-doctor-readonly-lease.mjs';

const receipt = { origin: 'parent-authenticated-readonly-broker', receiptId: 'protected-parent', toolCallId: 'real-id', operation: 'gather', agentInitiated: true, synchronousCompletion: true, complete: false };
const records = [
  { type: 'tool_execution_start', toolName: 'doctor_readonly', toolCallId: 'real-id', args: { operation: 'gather' } },
  { type: 'tool_execution_end', toolName: 'doctor_readonly', toolCallId: 'real-id', isError: false, result: { details: { doctorReadonly: receipt } } },
];
const lease = { id: 'lease', phase: 'report', cwd: '/tmp', root: '/tmp', drained: true, shutdownErrors: [], readonlyBroker: { calls: [{ toolCallId: 'real-id', operation: 'gather', correlated: true, receipt }], violations: [], complete: false } };

test('known readonly operation is classified only through protected parent receipt correlation', () => {
  const journal = doctorLeaseJournal(records, lease);
  assert.deepEqual(journal.unknownCalls, []);
  assert.equal(journal.complete, false);
  assert.equal(journal.calls[0].operation, 'gather');
  assert.equal(journal.proof.readonlyDomainComplete, false);
});
test('forged broker evidence and parent ownership gap remain unknown and incomplete', () => {
  for (const changed of [
    { ...lease, readonlyBroker: undefined },
    { ...lease, readonlyBroker: { ...lease.readonlyBroker, calls: [] } },
    { ...lease, readonlyBroker: { ...lease.readonlyBroker, calls: [{ ...lease.readonlyBroker.calls[0], correlated: false }] } },
  ]) {
    const journal = doctorLeaseJournal(records, changed);
    assert.deepEqual(journal.unknownCalls, ['real-id']);
    assert.equal(journal.complete, false);
  }
});
test('readonly lease refuses synthetic empty native capability self-attestation', () => {
  const root = realpathSync(mkdtempSync('/tmp/doctor-domain-'));
  try {
    assert.throws(() => openDoctorReadonlyLease({ root, doctor: {}, prepared: { record: { nativeBoundary: { domain: [] } } }, deadline: performance.now() + 1000 }), /native|Doctor|deferred/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
