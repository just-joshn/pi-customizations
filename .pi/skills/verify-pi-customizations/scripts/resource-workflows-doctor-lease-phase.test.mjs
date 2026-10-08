import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { boundDoctorOperation, validateDoctorLeaseConsent, validateDoctorLeaseReview } from '../helpers/resource-workflows-doctor-lease-phase.mjs';
import { evaluateDoctor } from '../helpers/resource-workflows-doctor-outcome.mjs';

const artifacts = resolve('artifacts/verify-pi-customizations/f016-doctor-lease', `test-${randomUUID()}`);

test('actual Pi 1.1 proves approved-only mutation and persisted context across immutable policies', async () => {
  const previous = [...process.argv];
  process.argv = [previous[0], previous[1], artifacts];
  try {
    await import(`./probe-resource-workflows-doctor-lease.mjs?${randomUUID()}`);
    const summary = JSON.parse(readFileSync(`${artifacts}/summary.json`, 'utf8'));
    assert.equal(summary.actualPiVersion, '1.1.0');
    assert.equal(summary.genuineCompliance, false);
    assert.equal(summary.summaries.length, 19);
    const positive = summary.summaries.find((item) => item.name === 'positive-approved-only');
    assert.equal(positive.reportReady, true);
    const {
      outcome: { facts },
    } = JSON.parse(readFileSync(positive.path, 'utf8'));
    const review = validateDoctorLeaseReview(facts, { ...facts.review, journalComplete: true });
    assert.equal(review.journalComplete, false);
    assert.equal(evaluateDoctor({ ...facts, review, journal: { ...facts.journal, complete: false } }).reportReady, false);
  } finally {
    process.argv = previous;
  }
});

test('Root wait deadline aborts a missing response independently of prompt duration', async () => {
  let signal;
  const result = await boundDoctorOperation(
    (current) => {
      signal = current;
      return new Promise(() => {});
    },
    5,
    'Root',
  );
  assert.equal(result.error, 'Root deadline expired');
  assert.equal(signal.aborted, true);
});

test('Root errors are evidence and cannot become approval', async () => {
  const result = await boundDoctorOperation(
    () => {
      throw new Error('Root unavailable');
    },
    100,
    'Root',
  );
  assert.equal(result.error, 'Root unavailable');
  assert.equal(result.value, null);
});

test('Root journal-complete assertions cannot replace structural proof', () => {
  assert.throws(() => validateDoctorLeaseConsent({ journal: { complete: false, violations: [] } }, { review: { journalComplete: true } }), /cannot replace/);
});

test('Root and prompt deadline caps cannot be extended', async () => {
  for (const ms of [0, -1, 120001, NaN, undefined])
    await assert.rejects(
      boundDoctorOperation(() => null, ms, 'Root'),
      /bounded at 120 seconds/,
    );
});
