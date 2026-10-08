import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateSimplify } from '../helpers/resource-workflows-simplify-outcome.mjs';

const success = { code: 0, signal: null, error: null };
function facts() {
  return {
    invocation: { error: null },
    execution: { tests: success, greeting: { ...success, stdout: '["Hello Ada","Hello "]\n', stderr: '' } },
    results: { testsUnchanged: true },
    evidence: {
      reviewers: ['reuse', 'simplification', 'efficiency', 'altitude'].map((angle, index) => ({
        id: `child-${index}`,
        angle,
        owned: true,
        readonly: true,
        successful: true,
        startedAt: 10 + index,
        endedAt: 30 + index,
        findingsAt: 34,
        findings: 'No cleanup findings.',
        transcript: `/owned/child-${index}.jsonl`,
      })),
      firstEditAt: null,
      orderingComplete: true,
    },
    rescue: { performed: false },
  };
}
test('a successful clean-code verdict needs no changed file', () => {
  assert.deepEqual(evaluateSimplify(facts()), { eligible: true, verdict: 'failed', missing: [], reason: 'Positive runtime controls and independent audit are still required.' });
});
test('a failing process cannot pass through captured output', () => {
  assert.equal(evaluateSimplify({ ...facts(), execution: { ...facts().execution, tests: { ...success, code: 1 } } }).eligible, false);
});
test('literal greetings reject wrong output despite unchanged tests', () => {
  assert.equal(evaluateSimplify({ ...facts(), execution: { ...facts().execution, greeting: { ...success, stdout: '["Wrong Ada","Hello "]\n', stderr: '' } } }).eligible, false);
});
test('four sequential successful reviewers are not parallel', () => {
  const original = facts();
  const reviewers = original.evidence.reviewers.map((reviewer, index) => ({ ...reviewer, startedAt: index * 20, endedAt: index * 20 + 10 }));
  assert.equal(evaluateSimplify({ ...original, evidence: { ...original.evidence, reviewers } }).eligible, false);
});
test('four requests with no successful results fail closed', () => {
  assert.equal(evaluateSimplify({ ...facts(), evidence: { reviewers: [] } }).eligible, false);
});
test('review ownership, angles, findings and edit ordering are required', () => {
  const original = facts();
  for (const patch of [{ owned: false }, { readonly: false }, { successful: false }, { id: 'child-0' }, { angle: 'reuse' }, { findings: '' }, { findingsAt: null }]) {
    const reviewers = original.evidence.reviewers.map((reviewer, index) => (index === 3 ? { ...reviewer, ...patch } : reviewer));
    assert.equal(evaluateSimplify({ ...original, evidence: { ...original.evidence, reviewers } }).eligible, false);
  }
  assert.equal(evaluateSimplify({ ...original, evidence: { ...original.evidence, firstEditAt: 20 } }).eligible, false);
});
test('missing facts, errors, signals and altered tests fail closed', () => {
  for (const input of [
    undefined,
    null,
    {},
    { ...facts(), evidence: { reviewers: 'bad!' } },
    { ...facts(), evidence: { reviewers: [null, null, null, null] } },
    { ...facts(), results: { testsUnchanged: false } },
    { ...facts(), invocation: { error: 'timeout' } },
  ])
    assert.equal(evaluateSimplify(input).eligible, false);
  for (const patch of [{ signal: 'SIGTERM' }, { error: 'launch failed' }, { code: null }]) assert.equal(evaluateSimplify({ ...facts(), execution: { ...facts().execution, tests: { ...success, ...patch } } }).eligible, false);
});
