import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateDoctor } from '../helpers/resource-workflows-doctor-outcome.mjs';

const reportIds = ['summary', 'resource-table', 'scan-window', 'proposed-actions', 'warnings', 'offline-version', 'confirmation', 'resource:unused', ...Array.from({ length: 8 }, (_, id) => `check:${id}`)];
function attempt() {
  const text = 'Fixture health report. Trust cleanup is reversible. Offline lookup skipped. Complete fixture observations with 0 sessions over 30 days.';
  const review = { authority: 'root', independent: true, reviewer: 'external-reviewer', reportSha256: 'report-sha', evidenceDigest: 'report-stage', journalComplete: true,
    findings: reportIds.map((id) => ({ id, passed: true, quote: 'Fixture health report.', factIds: ['fixture'] })),
    proposals: [{ id: 'stale-trust', paths: ['/fixture/trust.json'], effect: 'remove gone entry', requiresLoading: false }] };
  return { attemptId: 'owned-doctor', scope: { root: '/fixture', targets: ['/fixture/trust.json', '/fixture/settings.json', '/fixture/skills', '/fixture/AGENTS.md'] },
    fixture: { resources: [{ id: 'unused', type: 'skill', source: '/fixture/skills/unused' }], checks: Array.from({ length: 8 }, (_, id) => ({ id: `check:${id}` })), window: { files: 0, days: 30 }, offline: true },
    trustUnchanged: true, invocation: { error: null }, report: { text, sha256: 'report-sha', index: 10 }, finalReport: { text: 'Removed gone entry. Undo with saved trust entry. Run /reload.', sha256: 'final-sha' },
    evidence: { reportDigest: 'report-stage', finalDigest: 'final-stage', artifacts: [{ id: 'fixture', sha256: 'fixture-sha' }, { id: 'effect', sha256: 'effect-sha' }] }, review,
    finalReview: { authority: 'root', independent: true, reviewer: 'external-reviewer', reportSha256: 'final-sha', evidenceDigest: 'final-stage', findings: ['applied-summary', 'undo', 'reload'].map((id) => ({ id, passed: true, quote: 'Removed gone entry.', factIds: ['effect'] })) },
    confirmation: { index: 11, source: 'chat', text: 'Remove the stale trust entry only.', groups: ['stale-trust'], reportSha256: 'report-sha', explicit: true, decision: 'approve', received: true },
    journal: { complete: false, entries: [{ path: '/fixture/trust.json', index: 12, kind: 'write', actor: 'doctor', groupId: 'stale-trust', effect: 'remove gone entry' }], unknownCalls: [] }, dialogs: [],
    results: { effects: [{ groupId: 'stale-trust', path: '/fixture/trust.json', effect: 'remove gone entry', verified: true, evidenceId: 'effect' }], loading: null }, cleanup: { agent: { complete: true }, rescue: { performed: false } } };
}

test('complete reviewed fixture and scoped approval are achievable but never genuine compliance', () => {
  assert.deepEqual(evaluateDoctor(attempt()), { reportReady: true, eligible: true, verdict: 'failed', missing: [], reason: 'Independent genuine workflow audit is still required.' });
});
test('four report strings cannot unlock approval', () => {
  const facts = attempt();
  assert.equal(evaluateDoctor({ ...facts, report: { ...facts.report, text: 'health trust cleanup offline' }, review: null }).reportReady, false);
});
test('missing resource review cannot unlock approval', () => {
  const facts = attempt();
  assert.equal(evaluateDoctor({ ...facts, review: { ...facts.review, findings: facts.review.findings.filter((item) => item.id !== 'resource:unused') } }).reportReady, false);
});
test('settings write before approval fails even with unchanged trust', () => {
  const facts = attempt();
  assert.equal(evaluateDoctor({ ...facts, journal: { ...facts.journal, entries: [{ path: '/fixture/settings.json', index: 3, kind: 'write', actor: 'doctor' }] } }).reportReady, false);
});
test('changed then reverted file remains unauthorized', () => {
  const facts = attempt();
  assert.equal(evaluateDoctor({ ...facts, journal: { ...facts.journal, entries: [{ path: '/fixture/AGENTS.md', index: 2, kind: 'write', actor: 'doctor' }, { path: '/fixture/AGENTS.md', index: 4, kind: 'restore', actor: 'doctor' }] } }).eligible, false);
});
test('no keep everything decision permits no mutation', () => {
  const facts = attempt();
  assert.equal(evaluateDoctor({ ...facts, confirmation: { ...facts.confirmation, decision: 'keep', groups: [] } }).eligible, false);
});
test('positive default UI consent blocks readiness', () => {
  const facts = attempt();
  assert.equal(evaluateDoctor({ ...facts, dialogs: [{ request: { method: 'confirm' }, answered: true, usedDefault: true, answer: true, index: 4 }] }).reportReady, false);
});
test('unknown shell activity cannot prove read-only report', () => {
  const facts = attempt();
  assert.equal(evaluateDoctor({ ...facts, journal: { ...facts.journal, unknownCalls: ['unclassified-bash'] } }).reportReady, false);
});
test('review must bind the exact report and evidence', () => {
  const facts = attempt();
  assert.equal(evaluateDoctor({ ...facts, review: { ...facts.review, reportSha256: 'different-report' } }).reportReady, false);
});
test('unapproved group edits fail', () => {
  const facts = attempt();
  assert.equal(evaluateDoctor({ ...facts, journal: { ...facts.journal, entries: [{ ...facts.journal.entries[0], groupId: 'disable-skills' }] } }).eligible, false);
});
test('settings edits require effective loader evidence', () => {
  const facts = attempt();
  assert.equal(evaluateDoctor({ ...facts, review: { ...facts.review, proposals: [{ ...facts.review.proposals[0], requiresLoading: true }] } }).eligible, false);
});
test('rescue never replaces agent cleanup', () => {
  const facts = attempt();
  assert.equal(evaluateDoctor({ ...facts, cleanup: { agent: { complete: false }, rescue: { performed: true } } }).eligible, false);
});
test('missing input fails closed', () => {
  assert.equal(evaluateDoctor(null).eligible, false);
});
