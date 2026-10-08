import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateRe } from '../helpers/resource-workflows-re-outcome.mjs';

const observations = [
  { args: ['--help'], stdout: 'Usage: greet hello NAME\n', stderr: '', code: 0, signal: null, error: null },
  { args: ['--version'], stdout: 'greet 1.0.0\n', stderr: '', code: 0, signal: null, error: null },
  { args: ['hello', 'Ada'], stdout: 'Hello Ada\n', stderr: '', code: 0, signal: null, error: null },
  { args: [], stdout: '', stderr: 'Usage: greet hello NAME\n', code: 2, signal: null, error: null },
];
const complete = () => ({
  invocation: { error: null },
  origin: 'scripted-control',
  evidence: {
    attemptId: 'owned-attempt',
    present: Array.from({ length: 7 }, (_, i) => String(i)),
    replayCode: 0,
    identityMatches: true,
    sourceMatches: true,
    corpusComplete: true,
    reportsLinked: true,
    observations,
    replayObservations: observations,
    issues: [],
  },
});

test('help-only replay is not eligible for the four requested behaviors', () => {
  const facts = complete();
  assert.equal(evaluateRe({ ...facts, evidence: { ...facts.evidence, corpusComplete: false, observations: observations.slice(0, 1), replayObservations: observations.slice(0, 1) } }).eligible, false);
});
test('changed greeting output with exit zero is rejected', () => {
  const facts = complete();
  const wrong = observations.map((item) => (item.args[0] === 'hello' ? { ...item, stdout: 'Goodbye Ada\n' } : item));
  assert.equal(evaluateRe({ ...facts, evidence: { ...facts.evidence, observations: wrong } }).eligible, false);
});
test('nonempty initializer reports do not establish claim evidence', () => {
  const facts = complete();
  assert.equal(evaluateRe({ ...facts, evidence: { ...facts.evidence, reportsLinked: false } }).eligible, false);
});
test('complete executable evidence is eligible but never genuine compliance', () => {
  const result = evaluateRe(complete());
  assert.equal(result.eligible, true);
  assert.equal(result.verdict, 'failed');
  assert.equal(result.manualReview, 'pending');
  assert.equal(result.genuineCompliance, false);
});
test('missing, malformed and incomplete facts fail closed', () => {
  for (const facts of [null, {}, { evidence: null }, { invocation: { error: null }, evidence: { observations: [null] } }]) {
    assert.equal(evaluateRe(facts).eligible, false);
    assert.equal(evaluateRe(facts).verdict, 'failed');
  }
});
test('target identity, source, corpus, report linkage and replay each gate eligibility', () => {
  for (const key of ['identityMatches', 'sourceMatches', 'corpusComplete', 'reportsLinked']) {
    const facts = complete();
    assert.equal(evaluateRe({ ...facts, evidence: { ...facts.evidence, [key]: false } }).eligible, false);
  }
  const facts = complete();
  assert.equal(evaluateRe({ ...facts, invocation: { error: 'transport120timeout' } }).eligible, false);
  assert.equal(evaluateRe({ ...facts, evidence: { ...facts.evidence, replayCode: 1 } }).eligible, false);
  assert.equal(evaluateRe({ ...facts, evidence: { ...facts.evidence, issues: ['unresolved evidence path'] } }).eligible, false);
});
test('duplicate argv cannot replace a missing invocation and changed replay streams fail', () => {
  const facts = complete();
  assert.equal(evaluateRe({ ...facts, evidence: { ...facts.evidence, observations: [observations[0], observations[0], observations[2], observations[3]] } }).eligible, false);
  const wrong = observations.map((item) => (item.code === 2 ? { ...item, stderr: '' } : item));
  assert.equal(evaluateRe({ ...facts, evidence: { ...facts.evidence, replayObservations: wrong } }).eligible, false);
});
