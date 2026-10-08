import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateImplementation, differentialInvocation } from '../helpers/resource-workflows-implementation-outcome.mjs';

const ids = ['help', 'version', 'greeting', 'empty-name', 'unicode', 'invalid'];
function facts() {
  return {
    invocation: { error: null },
    execution: { differential: { code: 0, signal: null, error: null, reference: '/owned/greet', candidate: '/owned/greet.pyz', cases: '/owned/cases.json', ids, matched: true } },
    evidence: { capturedBeforeInvocation: true, candidateAbsentAtCapture: true, reportAbsentBeforeInvocation: true, mapAbsentBeforeInvocation: true, report: { reference: { sha256: 'ref' }, candidate: { artifact_sha256: 'zip' }, cases: { total: 6, passed: 6, failed: 0 }, intentional_differences: [] }, map: ids.map((id) => ({ case: id, behavior: `Behavior ${id}`, implementation: 'greet.pyz', test: `differential/${id}`, probe: `reference/${id}` })) },
    results: { referenceSha256: 'ref', artifactSha256: 'zip', reference: '/owned/greet', candidate: '/owned/greet.pyz', cases: '/owned/cases.json', comparison: { allMatched: true, cases: ids.map((id) => ({ id, matched: true })) } },
    rescue: { performed: false },
  };
}
test('a complete six-case packet is eligible but never approves genuine compliance', () => {
  assert.deepEqual(evaluateImplementation(facts()), { eligible: true, verdict: 'failed', missing: [], reason: 'Positive runtime controls and independent audit are still required.' });
});
test('reading the differential driver is not executing it', () => {
  assert.equal(differentialInvocation('cat /skill/differential.py'), null);
  assert.equal(differentialInvocation('echo "python3 /skill/differential.py run cases.json"'), null);
  assert.deepEqual(differentialInvocation('python3 /skill/differential.py run /owned/cases.json --reference /owned/greet --candidate "python3 /owned/greet.pyz" --out /owned/differential'), { driver: '/skill/differential.py', reference: '/owned/greet', candidate: 'python3 /owned/greet.pyz', cases: '/owned/cases.json', out: '/owned/differential' });
});
test('a correct candidate plus cat and no compatibility report is rejected', () => {
  const original = facts();
  assert.equal(evaluateImplementation({ ...original, execution: { differential: null }, evidence: { ...original.evidence, report: null, map: null } }).eligible, false);
});
test('execution must succeed with matching reference candidate and six case identities', () => {
  const original = facts();
  for (const patch of [{ code: 1 }, { signal: 'SIGTERM' }, { error: 'failed' }, { reference: '/other/greet' }, { candidate: '/other/greet.pyz' }, { cases: '/other/cases.json' }, { ids: ids.slice(1) }, { matched: false }]) assert.equal(evaluateImplementation({ ...original, execution: { differential: { ...original.execution.differential, ...patch } } }).eligible, false);
});
test('capture ordering report hashes evidence map and all six comparisons are mandatory', () => {
  const original = facts();
  for (const patch of [{ capturedBeforeInvocation: false }, { candidateAbsentAtCapture: false }, { reportAbsentBeforeInvocation: false }, { mapAbsentBeforeInvocation: false }, { map: [] }, { report: { cases: { total: 6, passed: 6, failed: 0 } } }]) assert.equal(evaluateImplementation({ ...original, evidence: { ...original.evidence, ...patch } }).eligible, false);
  assert.equal(evaluateImplementation({ ...original, results: { ...original.results, comparison: { allMatched: true, cases: [] } } }).eligible, false);
});
test('absent or malformed facts never approve', () => {
  for (const input of [undefined, null, {}, { ...facts(), invocation: { error: 'timeout' } }]) assert.equal(evaluateImplementation(input).eligible, false);
});
